# License activation registry

## Purpose

The entitlement verifier establishes that a license was signed by a trusted issuer. The activation registry separately enforces the licensed installation count. A valid offline signature alone cannot count how many disconnected computers are using a license.

## Storage boundary

The registry accepts a host-supplied store with:
- `read(key)` for durable reads;
- `transact(key, updater)` for a durable, atomic, serializable transaction scoped to one license.

The transaction guarantee must hold across all processes and machines that share the registry. An in-process mutex, browser local storage, JSON file without locking, or the test-only memory store is not sufficient for production multi-process or multi-PC enforcement. A production provider should use a transactional database or OS-backed service with documented crash consistency, access control and backup/recovery.

## Activation semantics

- The registry invokes an injected trusted `verifyLicenseEnvelope` function itself. Callers provide the signed envelope, not a claimed `valid: true` object; UI-supplied entitlement data is not trusted.
- A machine is represented by an opaque installation ID and SHA-256 fingerprint. Raw serial numbers, MAC addresses, disk IDs or other hardware identifiers must not be collected or stored.
- Repeating activation for the same installation/fingerprint is idempotent.
- A different installation consumes one seat; the limit is enforced inside the atomic transaction.
- Deactivation is scoped to the exact installation and is idempotent. Replacing hardware or migrating an installation requires an explicit deactivate/reactivate workflow.
- Listing activation metadata deliberately omits machine fingerprints.
- The registry is not an offline multi-PC authority. Separate offline machines cannot coordinate seat counts. A central/private registry or a documented online activation window is required for shared volume packs.

## Current implementation boundary

The core registry and SQLite store are implemented. The SQLite store has real file-backed `node:sqlite` tests, including a two-child-process race for a single seat (PR #115, final HEAD `0b4bbcf12716ef856f1c66e89ebdd9a07de5f590`; CI [44916584036](https://github.com/AndreVazao/office-kit/actions/runs/44916584036) and visual [44916584062](https://github.com/AndreVazao/office-kit/actions/runs/44916584062) passed on that SHA). The race test injects a deterministic fake license-envelope verifier; it does not establish trust in production license signatures.

No native host activation composition, trusted production issuer keyring, platform activation-identity provider, remote registry, activation UI, billing, or customer portal is included. The local SQLite store coordinates only processes sharing the same local database; it is not a multi-PC offline authority. Do not ship volume-license enforcement until host integration, signer/key management, backup/recovery, and security review are complete.
