# Secure node identity storage

## Purpose
Define the production boundary for persisting node identity keys and metadata without coupling the Office Kit core to one operating system, browser, cloud, or backend.

## Security requirements
- Private Ed25519 key material MUST be generated inside the platform keystore or generated as a non-extractable Web Crypto CryptoKey where durable structured cloning is supported.
- Production providers MUST NOT export private keys as PKCS#8, PEM, JWK, or raw bytes.
- The public key and SHA-256 fingerprint may be exported. Private key operations are handle-based: create, sign, delete and (where supported) verify.
- Key handles are opaque, installation-scoped identifiers. They are not credentials and must not contain secret material.
- Metadata persistence is separate from private-key persistence. Metadata contains organization/node IDs, public key, fingerprint, algorithm, generation, timestamps and active/revoked state only.
- Writes that change the active generation must be atomic from the perspective of readers. Failed rotation must leave either the old active identity or the new active identity, never an ambiguous half-state.
- Revocation must mark metadata revoked before reporting success. Key deletion failures must be surfaced and retained as a cleanup condition; they must not silently claim successful cryptographic erasure.
- Backups/export must never include private keys by default. Restoring metadata without the matching private key must produce an unusable identity and require re-enrolment.
- Storage must be isolated by installation and organization scope. No global vendor account or remote service is required.

## Provider matrix
| Runtime | Intended secure provider | Persistence |
|---|---|---|
| Windows desktop | CNG/Windows platform key storage through a native host adapter | OS-managed key handle |
| macOS desktop | Keychain/Secure Enclave where supported through a native host adapter | OS-managed key handle |
| Linux desktop/server | Secret Service/libsecret or TPM-backed adapter where available | OS-managed key handle |
| Android | Android Keystore through native bridge | hardware-backed when available |
| Browser/PWA | IndexedDB storing non-extractable Web Crypto CryptoKey objects, subject to browser support and origin storage policy | browser-origin scoped |
| Test/demo | EphemeralEd25519KeyStore | memory only; never production |

A provider must report its protection level and capabilities. The application must not label software-backed storage as hardware-backed.

## Required provider contract
A production implementation must satisfy NodeKeyStoreProvider and additionally declare:
- stable opaque key handles across process restarts;
- Ed25519 generation without exporting private material;
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
This document is a specification, not a platform-provider implementation. `NodeIdentityManager` now requires an atomic revisioned metadata store and a keystore `hasKey`/capability contract; it records cleanup tombstones and can reconcile pending deletion or missing active keys. `EphemeralEd25519KeyStore` reports itself as non-persistent/ephemeral and is rejected unless tests explicitly opt in with `allowEphemeral: true`. `SqliteNodeIdentityMetadataStore` now provides durable public-metadata persistence with installation scoping and revisioned compare-and-set over a host-supplied SQLite connection. It stores public identity metadata and opaque key handles only; it does not store private keys. This is not a platform-specific keystore: no Windows CNG/DPAPI, macOS Keychain, Linux Secret Service, Android Keystore or browser persistent CryptoKey provider is shipped yet. The host still owns the database file, driver, OS permissions, encryption and backup policy.


## DGM-MAT bootstrap and access-session handling
- The DGM-MAT bootstrap credential is a host secret and MUST be supplied by a native/platform keystore provider through an injected `getBootstrapCredential()` function.
- The Office Kit session provider must never read DGM-MAT files directly, persist the bootstrap secret, log it, or send it to a non-loopback endpoint.
- The current implementation exchanges it only with `POST http://127.0.0.1:8181/auth/session`, with redirects disabled and cache disabled.
- The short-lived bearer access token is held in process memory only, refreshed before expiry, and invalidated on 401/403. It is not written to profile, localStorage, IndexedDB, logs or backups.
- A native Windows keystore bridge that can safely retrieve the existing DGM-MAT bootstrap credential is not implemented yet. Until that exists and is tested on the target PC, the provider remains an injectable contract, not a turnkey authenticated connection.


## Lifecycle integration validation
`SqliteNodeIdentityMetadataStore` is covered together with `NodeIdentityManager` by an integration test that closes/reopens a real SQLite file and recreates the manager across create, public-identity read, Ed25519 proof, rotation, reconciliation and revocation. The test intentionally retains an ephemeral key provider in the same process; it validates durable metadata only. It does not establish key persistence across process/OS restart or replace the required native Windows keystore.


## One-time challenge replay protection
- A possession challenge nonce must be consumed atomically before the identity manager signs it. A repeated nonce is rejected with `challenge_replayed_or_already_consumed`.
- `SqliteNodeIdentityChallengeStore` uses a unique nonce key and an immediate SQLite transaction, so separate processes sharing the same database cannot both consume the same challenge. Expired records are pruned during consumption.
- `InMemoryNodeIdentityChallengeStore` is explicitly non-persistent and is selected only when the manager is constructed with `allowEphemeral: true` and no store is supplied.
- A persistent keystore requires a challenge store declaring `persistent: true`; the manager rejects an in-memory replay store in that configuration.
- This protects local signing against replay at the signer. A remote verifier must independently enforce challenge issuance, audience binding, expiry and one-time acceptance; local nonce storage does not replace verifier-side replay protection.
- SQLite still depends on host-owned file access controls, durability and backup policy. Power-loss and filesystem-level crash guarantees are not claimed.
