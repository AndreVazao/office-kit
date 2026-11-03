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
- deletion with verifiable success/failure;
- public-key export only;
- verification using a public key independent of local private-key state;
- capability/protection metadata (hardware-backed, OS-protected, browser-origin, or ephemeral).

Metadata storage must provide read, atomic write/replace, and transactional rotation/revocation semantics. It must reject cross-installation scope changes unless an explicit migration operation is authorized.

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
This document is a specification, not an implementation. The current EphemeralEd25519KeyStore remains test-only. No platform-specific persistent provider is shipped yet.