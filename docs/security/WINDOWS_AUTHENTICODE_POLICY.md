# Windows Authenticode trust policy

Status: design contract for issue #110; not yet implemented or production-approved.

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
3. The policy's integrity must be authenticated independently of the file's ACL. Preferred implementation: a machine-scoped, non-exportable CNG key created/provisioned by the elevated installer authenticates the canonical policy bytes; the helper verifies that authenticator before consuming any policy field. If the chosen CNG key is unavailable, replaced, or has an invalid scope, startup fails closed.
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
