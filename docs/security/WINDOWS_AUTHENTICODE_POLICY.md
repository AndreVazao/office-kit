# Windows Authenticode trust policy

Status: staged implementation for issue #110; installation-scoped CNG policy-key provisioning and the canonical signed-policy v1 contract are implemented. Production host verification, WinTrust signature binding and revocation enforcement remain pending; not production-approved.

This document defines the security properties required before the Windows helper verifier can be treated as a production boundary. It deliberately does not claim that the current `WinVerifyTrust` implementation satisfies them.

## 1. Trust inputs and publisher identity

- The helper publisher identity must not be selected by an ordinary process environment variable, command-line argument, or mutable user preference.
- The installed product must consume a publisher policy provisioned by the elevated installer in the installation directory or machine scope.
- The policy must be authenticated independently before its contents are trusted. The intended design is a signed publisher-policy manifest validated through Windows Authenticode chain policy, with restrictive installation ACLs preventing standard-user replacement.
- The policy must identify the publisher using a collision-resistant digest of the certificate public key (SHA-256 over the SubjectPublicKeyInfo), with certificate validity and chain policy checked separately. A legacy SHA-1 certificate thumbprint may be retained only as a migration/diagnostic field, not the sole identity primitive.
- Missing, malformed, unsigned, untrusted, expired, or ACL-insecure policy is a hard startup failure. There is no environment-variable fallback in production mode.
- Development/test injection remains possible only through explicit dependency injection in tests; it must not be reachable through production configuration.

### 1.1 Bootstrap and policy lifecycle

The publisher policy must have a non-circular trust bootstrap:

1. The elevated installer first verifies the installer/package signature through the operating system Authenticode trust chain. It records the signer public-key identity from the exact verified installer signature; it must not accept a publisher value supplied by the launching user's environment.
2. The installer provisions the helper publisher policy and protects its directory/file with machine-scoped ACLs that deny modification by standard users. The policy records the expected SHA-256 SPKI digest, the accepted signature-selection rule, and a policy schema/version.
3. The policy's integrity must be authenticated independently of the file's ACL. Verification must run in the host bootstrap before the CNG helper is launched; do not make the helper verify the policy that authorizes that same helper. Preferred implementation: the elevated installer provisions a machine-scoped CNG signing key; its non-exportable private key is ACL-restricted to SYSTEM/installer, while the host verifier reads only the public verification material through operating-system crypto APIs and validates the canonical policy signature. This check must not launch the helper being verified. Missing, replaced or incorrectly scoped key material is a hard startup failure. An embedded public root key in a signed installer-controlled launcher is an alternative, but key rotation must be explicit and authenticated.
4. The installer must not silently regenerate a missing policy or key during ordinary startup. Recovery/re-provisioning is an explicit elevated install/repair operation that re-verifies the signed package and records a new authenticated policy.
5. Upgrade may rotate the expected publisher only when the new signed installer is accepted under the currently installed publisher policy or an explicit, authenticated publisher-transition policy. A new unrelated publisher must never replace the pin merely because Windows trusts its certificate chain.
6. The policy and CNG key are installation-scoped; uninstall removes them only after explicit uninstall confirmation and must not remove unrelated user data or keys.

This makes the OS trust chain the initial installer gate and the installer-provisioned CNG-authenticated policy the runtime pin. It avoids the circular design in which a mutable manifest is allowed to nominate its own trusted publisher. Exact CNG key ACL/scope, canonical serialization, key recovery and publisher-transition behavior require implementation tests before production approval.

The existing environment-variable thumbprint remains a test harness input only. Production launchers must not read it, and CI must prove that changing or removing it cannot change the installed publisher identity.

## 2. Signature selection and signer binding

- Verification must identify the exact Authenticode signature index selected for acceptance.
- The signer certificate used for publisher comparison must be obtained from the WinTrust provider state for that same signature after successful verification. It must not be independently inferred with `X509Certificate.CreateFromSignedFile`.
- The default policy accepts the primary signature only. Secondary signatures are not an implicit fallback when the primary signature fails.
- If dual-signature compatibility is deliberately enabled in a future policy, every accepted index and algorithm must be enumerated and validated independently; acceptance must still resolve to exactly one signer identity matching the installed publisher policy.
- Provider state must be closed with the WinTrust state-close action in a `finally` path, including signer mismatch and extraction failures.
- Unsigned, malformed, ambiguous, or unsupported signature layouts fail closed.

## 3. Revocation policy

Installation/update and runtime startup are separate trust operations.

### Installation and update

- Perform full chain revocation checking for the signer chain, excluding only the root CA where required by Windows chain policy.
- Network retrieval may be used, but the verification process must be non-interactive and externally bounded. Timeout, network failure, unavailable revocation data, unknown status, or revoked status rejects the package.
- A timeout must terminate the verifier process and must not be converted into success.

### Offline runtime startup

- Use cache-only revocation retrieval and explicitly request chain revocation checking.
- A positively revoked certificate is always rejected.
- Missing, stale, or indeterminate cached revocation data is treated as unknown and rejected. Offline startup is therefore available only while Windows has usable cached revocation evidence.
- There is no silent soft-fail, no `WTD_REVOCATION_CHECK_NONE`, and no automatic grace-period acceptance in this design.
- If a future availability requirement proposes a bounded grace period, it requires a separate threat model, authenticated time/freshness evidence and explicit product decision; it must not be smuggled into this verifier as a fallback.

## 4. WinTrust execution requirements

- Use the Authenticode generic verify-v2 action and non-interactive UI policy.
- Use explicit `WINTRUST_SIGNATURE_SETTINGS` selection and provider-state inspection to bind the selected signer to the validated signature.
- Keep the WinTrust state handle alive until signer extraction and all policy comparisons complete; then close it.
- Run verification in a child process with a hard wall-clock timeout and bounded output. Timeout, abnormal exit, malformed output, native API error, or unexpected status is rejection.
- Avoid unbounded AIA/CRL retrieval during runtime startup. Do not disable revocation to achieve this.
- Native structures, pointer ownership, architecture alignment and HRESULT handling require Windows x64 integration coverage.

## 5. Required test matrix

Native Windows tests must cover:

1. Valid trusted signer matching the installed publisher policy.
2. Valid but untrusted signer.
3. Valid trusted signer with the wrong publisher key.
4. Expired signer certificate.
5. Revoked signer certificate.
6. Revocation status unavailable/unknown during install/update.
7. Revocation status unavailable/unknown during cache-only startup.
8. Modified/tampered helper after signing.
9. Unsigned helper.
10. Primary signature invalid with a valid secondary signature.
11. Multiple valid signatures with different publishers.
12. Multiple valid signatures where only a secondary signature matches the configured publisher.
13. Missing, altered, unsigned and ACL-insecure publisher policy.
14. Verifier timeout and child-process termination.

Tests must assert both acceptance and rejection outcomes. Synthetic unit tests do not replace native Windows integration tests.

## 6. Evidence boundary

The existing CI smoke test proves that edition bundles start through their test-only injected signature-integrity verifier and that the production launcher rejects the untrusted ephemeral signer. It does not prove a trusted production chain, positive production verifier acceptance, revocation behavior, multiple-signature binding, commercial signing, or physical-PC behavior.

Issue #110 remains open until the production implementation and native test matrix above pass on Windows Node 22 and 26. PR #107 was merged as a portable-bundle increment; that merge does not close this publisher-trust gate or authorize commercial distribution.


## 7. Native API compatibility notes

The Windows API references clarify several implementation details that must be reflected in the native tests:

- `WINTRUST_SIGNATURE_SETTINGS` supports `WSS_VERIFY_SPECIFIC`, `WSS_GET_SECONDARY_SIG_COUNT`, and returns `dwVerifiedSigIndex`. The implementation must check the returned verified index rather than assuming the requested index was used. See [WINTRUST_SIGNATURE_SETTINGS](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/ns-wintrust-wintrust_signature_settings).
- `WTD_REVOCATION_CHECK_CHAIN_EXCLUDE_ROOT` is the explicit chain-revocation flag; `WTD_CACHE_ONLY_URL_RETRIEVAL` restricts retrieval to local cache. They are separate flags and must be combined only for the offline-startup policy. `WTD_REVOCATION_CHECK_NONE` must not be set. See [WINTRUST_DATA](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/ns-wintrust-wintrust_data).
- Use `INVALID_HANDLE_VALUE` as the WinVerifyTrust window handle for a non-interactive verification context, alongside `WTD_UI_NONE`. See [WinVerifyTrust](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/nf-wintrust-winverifytrust).
- Microsoft documents `WTHelperProvDataFromStateData`, `WTHelperGetProvSignerFromChain` and `WTHelperGetProvCertFromChain` as the route from WinTrust state to the verified signer certificate, but explicitly warns that these helper APIs may be altered or unavailable in later Windows versions. Their use therefore requires compatibility tests on every supported Windows baseline. If that compatibility risk is unacceptable, use a supported Authenticode/.NET verification path that can cryptographically bind the parsed signer to the signature index and separately validate the certificate chain; do not silently fall back to the first certificate in the file.
- WinTrust returns a `LONG`; only exact zero is success. Do not use generic HRESULT success macros or treat warning statuses as success. See [WinVerifyTrust return values](https://learn.microsoft.com/en-us/windows/win32/api/wintrust/nf-wintrust-winverifytrust).

The WinTrust helper API caveat is a design risk, not a reason to omit signer binding. The selected implementation must document its compatibility strategy and fail closed if the signer cannot be extracted unambiguously.


## 2026-11-21 — interim baseline restoration

The native WinVerifyTrust rewrite previously present in PR #107 was reverted in commit f26f4b365a9ae48cca67bd1c2504ab4404d3846f to the bounded PowerShell Get-AuthenticodeSignature verifier already present on main. This removes the PR-introduced WTD_REVOCATION_CHECK_NONE path and the separate X509Certificate.CreateFromSignedFile signer extraction. The restored verifier requires Authenticode Status Valid and a matching process-environment SHA-1 thumbprint; runChecked bounds the PowerShell child process to 15 seconds and rejects timeout/nonzero exit. This is an interim reviewed compatibility baseline, not the target production design. Installer-authenticated publisher policy, SHA-256 SPKI pinning, explicit revocation policy and native Windows test coverage remain outstanding; issue #110 stays open.

## 8. Implementation checkpoint — remove environment pin from production startup (2026-11-22)

The production host no longer reads `OFFICE_KIT_CNG_SIGNER_THUMBPRINT` as an implicit expected publisher. The DGM-MAT/VST portable launcher no longer requires that environment variable. The default host composition has no authenticated publisher-policy provider yet and therefore rejects startup with `windows_host_publisher_policy_unavailable` before opening SQLite. This is an intentional fail-closed intermediate state.

The verifier's explicit `expectedThumbprint` argument is retained only for isolated tests that exercise the bounded PowerShell command construction and status handling. It is not read from CLI arguments, process environment or user preferences by the production composition. Separate test runners may still use the environment variable for their own injected signature-integrity verifier; that test-only path does not authorize the production host.

This checkpoint closes only the environment-controlled implicit pin path. It does not implement the installer-authenticated policy, SHA-256 SPKI pin, exact signature-index/signer binding, revocation checks, commercial trust chain or positive production startup. Issue #110 remains open and the Windows host must remain unavailable for production startup until those remaining requirements are implemented and tested.


## 9. Canonical signed publisher-policy envelope v1 — implementation checkpoint

PR #135 introduced the installation-scoped CNG policy key primitive. The native helper now provisions a machine RSA-3072 key under the Microsoft Software KSP, with signing-only usage, a non-exportable private key and a protected DACL. The key name is derived from the installation ID as \`okp-\` plus the first 32 lowercase hex characters of SHA-256(installationId). Existing keys are never overwritten or regenerated. Provisioning/signing require an elevated installer context; deletion requires an explicit matching installation ID.

The next contract uses a canonical UTF-8 JSON payload with this exact property order:

1. \`schemaVersion\` — integer \`1\`
2. \`productId\` — \`office-kit\`
3. \`edition\` — \`universal\`, \`dgmat\` or \`vst\`
4. \`installationId\` — installation-scoped Office Kit ID
5. \`keyName\` — derived CNG machine-key name
6. \`policyVersion\` — positive integer
7. \`createdAt\` — canonical UTC ISO-8601 timestamp
8. \`publisherSpkiSha256\` — lowercase SHA-256 digest of the publisher certificate SPKI
9. \`signatureIndex\` — exactly \`0\`; primary signature only
10. \`revocationPolicy\` — exact values below

\`\`\`json
{
  "schemaVersion": 1,
  "productId": "office-kit",
  "edition": "universal",
  "installationId": "officekit-<32 lowercase hex characters>",
  "keyName": "okp-<32 lowercase hex characters>",
  "policyVersion": 1,
  "createdAt": "2026-11-23T16:30:00.000Z",
  "publisherSpkiSha256": "<64 lowercase hex characters>",
  "signatureIndex": 0,
  "revocationPolicy": {
    "installUpdate": "online-chain-exclude-root-fail-closed",
    "runtimeStartup": "cache-only-chain-exclude-root-fail-closed"
  }
}
\`\`\`

The envelope is canonical JSON with exact keys \`format\`, \`keyName\`, \`payload\`, \`signature\`. The payload is Base64 of the canonical UTF-8 bytes; the signature is Base64 of a 384-byte RSA-3072 PKCS#1 v1.5 SHA-256 signature produced by the installation's CNG machine key. The format identifier is \`officekit-publisher-policy-envelope-v1\`.

The Node contract validates exact keys/property order, canonical JSON, installation and edition binding, the derived key name, RSA-3072 SPKI type, signature length, signature integrity, primary-only signature selection and the two fixed fail-closed revocation modes. Duplicate JSON keys, unknown properties, noncanonical Base64, tampering, wrong key, replay across installations/editions and unsupported signature/revocation modes are rejected.

This is a format and cryptographic-validation contract, not yet a production bootstrap. The Windows host still does not read or trust this envelope during startup. The next stage must retrieve the public verification material directly from the protected machine CNG key store (without launching the CNG helper), validate the key's machine scope/ACL, verify the envelope before any helper launch or SQLite open, and then bind the Authenticode signer to the exact WinTrust-verified signature index. Until that work and the native Windows matrix pass, the default production host remains fail-closed.


## 10. Direct CNG public-key bootstrap

The Windows host can now read the publisher-policy verification key directly from the Microsoft Software KSP using Windows PowerShell/.NET CNG APIs. It does not launch \`OfficeKit.CngHost.exe\` to verify that executable, avoiding a circular trust dependency.

The reader requires:
- The deterministic installation-scoped machine key name.
- Machine scope, RSA-3072, signing-only usage and no private-key export.
- The exact protected owner/group/DACL descriptor provisioned by PR #135.
- Public modulus/exponent only; it reconstructs an RSA-3072 SPKI in Node.
- A bounded, non-interactive PowerShell invocation with no shell expansion or environment-supplied key name.

\`loadPublisherPolicy\` reads a bounded regular policy file, rejects symlinks, retrieves the public key directly from CNG, and verifies the signed canonical envelope against the expected installation ID and edition. Windows CI provisions a disposable machine CNG key, signs a v1 payload, reads the key directly through PowerShell, verifies the envelope, and removes the key with explicit installation-ID confirmation.

This loader is not yet wired into \`createWindowsHost\`. The default host remains fail-closed until the following stage implements WinTrust verification of the helper, binds the signer certificate to the exact verified signature index, applies the two revocation modes and runs the complete native Windows positive/negative matrix.

## 11. Native WinTrust and startup-policy integration checkpoint — 2026-11-23

PR #139 adds the following implementation on top of the canonical policy envelope and direct CNG public-key reader:

- The host creates/reads its installation identity, then loads `publisher-policy.json` from the installation data root and validates the envelope against the installation-scoped CNG machine key and the explicit edition.
- The host verifies the helper before opening SQLite. Missing or invalid policy is a hard failure; there is no environment-variable fallback.
- Universal uses the `universal` policy identity. The VST and DGM-MAT Windows composition wrappers explicitly select their own `vst` and `dgmat` policy identities.
- The native verifier uses Authenticode generic verify-v2, `WTD_UI_NONE`, `INVALID_HANDLE_VALUE`, explicit primary signature index `0`, and the WinTrust provider state to extract the signer certificate from the exact verified signature.
- The extracted certificate SPKI SHA-256 must match the signed policy pin. The verifier closes WinTrust provider state in a `finally` path.
- Runtime startup uses cache-only chain revocation excluding the root and fails closed when revocation evidence is unavailable. The online install/update mode is implemented as a separate verifier mode with a longer bounded timeout.
- The PowerShell child process has bounded execution time and bounded output. A timeout, abnormal exit, malformed response, signature failure, wrong index, revoked publisher, unavailable revocation evidence or publisher mismatch rejects the helper.
- Test-only policy loaders and signature verifiers are injected explicitly in isolated test harnesses. They do not change production defaults.

### Remaining acceptance gaps

PR #139 is not production approval and must not be treated as permission to distribute the Windows host. The following remain required:

1. The elevated installer/update flow in #104 must verify its own package under Windows Authenticode before provisioning the CNG policy key and writing the signed policy envelope. Provisioning must be atomic, ACL-protected and recoverable without ordinary-startup key regeneration.
2. The online verifier mode must be called by the real installer/update path; it is currently exercised by the native Windows integration test, not by a production installer.
3. Complete the native Windows test matrix for expired certificates, positively revoked certificates, unknown/unavailable revocation status, untrusted signers, multiple signatures with different publishers, primary-invalid/secondary-valid binaries, missing/altered policy, and process timeout/termination.
4. Validate the native WinTrust helper APIs on every supported Windows baseline. If the provider helper exports are unavailable or return ambiguous state, startup must fail closed; there is no PowerShell or secondary-signature fallback.
5. Run the final integration on a physical Windows PC and with the actual commercially signed installer/helper. GitHub-hosted CI and Microsoft-signed system binaries do not prove the user's installed environment or commercial distribution chain.

The Windows CI run associated with PR #139 must be checked on its exact final HEAD. Until every applicable Linux/Windows Node 22/26 job, native CNG policy test, native WinTrust test and visual regression passes on one SHA, the PR must remain unmerged. Issue #110 remains open until installer provisioning and the full native test matrix are complete.
