# Secure node identity storage

## Purpose
Define the production boundary for persisting node identity keys and metadata without coupling the Office Kit core to one operating system, browser, cloud, or backend.

## Security requirements
- Private identity key material MUST be generated inside the platform keystore or as a non-extractable Web Crypto CryptoKey where durable structured cloning is supported. The identity protocol supports Ed25519 and ECDSA P-256/SHA-256; each provider must advertise its actual supported algorithms.
- Production providers MUST NOT export private keys as PKCS#8, PEM, JWK, or raw bytes.
- The public key and SHA-256 fingerprint may be exported. Private key operations are handle-based: create, sign, delete and (where supported) verify.
- Key handles are opaque, installation-scoped identifiers. They are not credentials and must not contain secret material.
- Metadata persistence is separate from private-key persistence. Metadata contains organization/node IDs, public key, fingerprint, algorithm, generation, timestamps and active/revoked state only.
- Writes that change the active generation must be atomic from the perspective of readers. Failed rotation must leave either the old active identity or the new active identity, never an ambiguous half-state.
- Revocation must mark metadata revoked before reporting success. Key deletion failures must be surfaced and retained as a cleanup condition; they must not silently claim successful cryptographic erasure.
- Backups/export must never include private keys by default. Restoring metadata without the matching private key must produce an unusable identity and require re-enrolment.
- Storage must be isolated by installation and organization scope. No global vendor account or remote service is required.

## Provider matrix
| Runtime | Intended secure provider | Candidate signing algorithm(s) | Persistence |
|---|---|---|---|
| Windows desktop | WindowsCngP256KeyStore with a native .NET CNG helper using Microsoft Software Key Storage Provider | ECDSA P-256/SHA-256; private export disabled with CNG ExportPolicy.None | Persistent user-scoped OS key handle; software-backed, not TPM-backed |
| macOS desktop | Keychain; Secure Enclave where available through a native host | ECDSA P-256 for Secure Enclave-backed signing; report other Keychain algorithms separately | OS-managed key handle |
| Linux desktop/server | PKCS#11/TPM provider for signing; Secret Service for secret wrapping where appropriate | Provider-reported Ed25519 or ECDSA P-256 | OS-managed key handle |
| Android | Android Keystore through native bridge | ECDSA P-256; do not assume Ed25519 support | app-scoped OS key handle; hardware-backed only when attested |
| Browser/PWA | IndexedDB storing non-extractable Web Crypto CryptoKey objects, subject to browser support and origin storage policy | Ed25519 or ECDSA P-256 where WebCrypto supports it | browser-origin scoped |
| Test/demo | EphemeralEd25519KeyStore / EphemeralP256KeyStore | Ed25519 and ECDSA P-256 | memory only; never production |

A provider must report its protection level and capabilities. The application must not label software-backed storage as hardware-backed.

## Identity algorithm selection

- `NodeIdentityManager` supports `Ed25519` and `ECDSA-P256-SHA256`.
- Ed25519 uses a 32-byte raw public key and a 64-byte signature. ECDSA P-256 uses a 65-byte uncompressed raw public key and a 64-byte fixed-width `r || s` signature over SHA-256.
- The algorithm is stored in public identity metadata and included in possession proofs. Verifiers must use the explicit algorithm; there is no implicit downgrade or fallback.
- Legacy identity metadata without an `algorithm` field is interpreted as Ed25519 for compatibility.
- A provider must advertise only algorithms it can actually generate and sign with. Its optional `defaultAlgorithm` must be one of those advertised.
- Platform references: [Microsoft CNG Key Storage Providers](https://learn.microsoft.com/en-us/windows/win32/seccertenroll/cng-key-storage-providers), [Android Keystore](https://developer.android.com/privacy-and-security/keystore), and [Apple Keychain Services](https://developer.apple.com/documentation/security/keychain-services). These platform APIs do not imply that every algorithm is available in hardware on every device.

## Required provider contract
A production implementation must satisfy NodeKeyStoreProvider and additionally declare:
- stable opaque key handles across process restarts;
- Generation of one or more explicitly declared algorithms without exporting private material;
- signing using the opaque handle;
- deletion with verifiable success/failure and key-existence inspection (`hasKey`);
- provider capability metadata describing persistence, protection level, hardware backing and private-key exportability;
- public-key export only;
- verification using a public key independent of local private-key state.

Metadata storage must provide `get()` and an atomic `compareAndSet(expectedRevision, next)` operation. `expectedRevision=null` means the record must not exist; existing legacy records without a revision are treated as revision 0 and migrated on the next write. Revisions increase monotonically. The store must reject cross-installation scope changes unless an explicit migration operation is authorized.

## Lifecycle and failure behavior
1. Create key in secure provider.
2. Validate public key and derive SHA-256 fingerprint.
3. Atomically persist public metadata and opaque key handle.
4. If metadata commit fails, delete the newly created key; report cleanup failure if deletion also fails.
5. Rotate by creating and validating the next key first, then atomically switching active metadata; delete the retired key only after commit.
6. Revoke by atomically marking identity revoked, then deleting the key. If deletion fails, retain a tombstone and surface a security warning.
7. On startup, reconcile metadata against provider key existence. Missing keys cause identity_unavailable, never silent key regeneration under the same node identity.

## Acceptance tests
- Private key never appears in serialized metadata, logs, exports or provider return values.
- Key handle and public identity survive process restart in each persistent provider.
- Key cannot sign after deletion/revocation.
- Failed metadata commit rolls back newly generated keys or leaves a recoverable cleanup record.
- Failed key deletion never reports complete revocation/erasure.
- Rotation is atomic under injected failures at every step.
- Storage scopes cannot be crossed by changing organization/node identifiers.
- Provider capability claims match the actual platform protection level.
- Ephemeral provider is rejected by production configuration.

## Current status
This document remains a specification, not a platform-provider implementation. `NodeIdentityManager` supports Ed25519 and ECDSA P-256/SHA-256, records the explicit algorithm in identity metadata and possession proofs, and requires an atomic revisioned metadata store plus a keystore `hasKey`/capability contract. `EphemeralEd25519KeyStore` and `EphemeralP256KeyStore` are test/demo providers only and are rejected by production configuration unless tests explicitly opt in with `allowEphemeral: true`. `SqliteNodeIdentityMetadataStore` provides durable public-metadata persistence with installation scoping and revisioned compare-and-set over a host-supplied SQLite connection. It stores public identity metadata and opaque key handles only; it does not store private keys. WindowsCngP256KeyStore and its native .NET helper are present in the repository. The provider creates persistent user-scoped ECDSA P-256 keys in Microsoft Software Key Storage Provider with ExportPolicy.None, reports os-protected/software-backed (hardwareBacked=false), and scopes opaque key names by installation ID. The Windows CI workflow builds the helper and exercises persistence across separate helper processes, private-key export refusal, signing, verification, deletion and cross-installation isolation. PR #46 adds createWindowsNodeIdentityRuntime in the Windows-only entry point, composing CNG with SQLite public-metadata and one-time challenge stores. On HEAD 77669de98b42bdc6bcf1d866797cc6ef1a066707, Windows CI passed the composed create/prove/reopen-manager/replay/revoke integration and the visual workflow passed with six viewport screenshots and no browser errors. This does not prove TPM backing, a full host-process/system restart, installer integration, uninstaller cleanup, ACL/backup policy or behavior on the user's physical PC. macOS Keychain/Secure Enclave, Linux PKCS#11/TPM, Android Keystore and browser IndexedDB CryptoKey providers remain unimplemented. The host still owns the SQLite metadata/challenge database, file ACLs, encryption and backup policy.


## DGM-MAT bootstrap and access-session handling
- The DGM-MAT bootstrap credential is a host secret and MUST be supplied by a native/platform keystore provider through an injected `getBootstrapCredential()` function.
- The Office Kit session provider must never read DGM-MAT files directly, persist/cache the plaintext bootstrap secret, log it, or send it to a non-loopback endpoint. A host-owned keystore may persist only an encrypted envelope.
- The current implementation exchanges it only with `POST http://127.0.0.1:8181/auth/session`, with redirects disabled and cache disabled.
- The short-lived bearer access token is held in process memory only, refreshed before expiry, and invalidated on 401/403. It is not written to profile, localStorage, IndexedDB, logs or backups.
- A DGM-MAT-only Windows composition and generic CNG secret-vault bridge are now implemented on branch `feat/dgmat-cng-bootstrap-host`, pending CI and native Windows integration results. The code path is not yet validated on a live DGM-MAT instance or the target physical PC; it must not be described as a turnkey production connection until those checks pass.


## Lifecycle integration validation
`SqliteNodeIdentityMetadataStore` is covered together with `NodeIdentityManager` by an integration test that closes/reopens a real SQLite file and recreates the manager across create, public-identity read, Ed25519 proof, rotation, reconciliation and revocation. The test intentionally retains an ephemeral key provider in the same process; it validates durable metadata only. It does not establish key persistence across process/OS restart or replace the required native Windows keystore.


## One-time challenge replay protection
- A possession challenge nonce is consumed atomically before the identity manager signs it. A repeated nonce is rejected.
- `SqliteNodeIdentityChallengeStore` uses a unique nonce key and an immediate SQLite transaction, so separate processes sharing the same database cannot both consume the same challenge. Expired records are pruned during consumption.
- `InMemoryNodeIdentityChallengeStore` is explicitly non-persistent and is selected only when the manager is constructed with `allowEphemeral: true` and no store is supplied.
- A persistent keystore requires a challenge store declaring `persistent: true`; the manager rejects an in-memory replay store in that configuration.
- This protects local signing against replay at the signer. A remote verifier must independently enforce challenge issuance, audience binding, expiry and one-time acceptance; local nonce storage does not replace verifier-side replay protection.
- SQLite durability still depends on host-owned file access controls and storage policy. Power-loss guarantees are not claimed.


## Generic Windows secret vault and DGM-MAT bootstrap credential — 2026-11-11

`WindowsCngSecretVault` is a generic Windows-host primitive, not a DGM-MAT adapter. It scopes each secret by installation ID, namespace and name. SQLite stores only a versioned authenticated envelope: AES-256-GCM ciphertext, nonce, tag and an RSA-OAEP-SHA256-wrapped random data key. The AES-GCM associated data binds the value to its installation, namespace and secret name, preventing ciphertext substitution across scopes.

The wrapping RSA private key is persisted in the user-scoped Microsoft Software Key Storage Provider with `ExportPolicy.None`; its deterministic CNG key name is derived from a hash of installation ID and namespace. It is separate from the ECDSA node-identity key namespace. The helper validates the RSA algorithm and non-exportability before returning its public key or unwrapping a data key. Capabilities explicitly report OS-protected software storage and `hardwareBacked=false`; no TPM claim is made.

The DGM-MAT-only `createWindowsDgmMatHost` composition uses the namespace `dgmat.bootstrap`. It requires `ownerConsent: true` for provisioning and removal, connects only when explicitly requested, and clears the in-memory access session on disconnect/close. Bootstrap retrieval accepts an AbortSignal; cancellation kills the bounded native-helper process so the session-exchange deadline also covers the keystore read. The adapter remains authenticated loopback GET-only/read-only, and host health keeps backend operational state `unverified`.

Unit tests use a fake CNG process and are not native-keystore evidence. The Windows CI integration test uses the published helper to verify persistence across helper processes, encrypted SQLite contents, non-exportability and installation/namespace isolation. A live DGM-MAT instance and physical-PC validation remain pending. The portable bundle allowlist includes the generic vault module; DGM-MAT-specific composition is excluded from Universal and VST.


Backup/restore limitation: the RSA wrapping key is user-scoped and non-exportable. A copy of the SQLite database alone is not sufficient to restore these secrets on another Windows user profile or machine. Recovery currently requires continuity of the original Windows user profile and CNG key container, or explicit credential re-enrolment after loss. A durable, tested backup/recovery workflow for this key dependency is still a production blocker.
