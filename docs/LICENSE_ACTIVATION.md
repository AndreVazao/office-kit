# License activation registry

## Purpose

The entitlement verifier establishes that a license was signed by a trusted issuer. The activation registry separately enforces the licensed installation count. A valid offline signature alone cannot count how many disconnected computers are using a license.

## Storage boundary

The registry accepts a host-supplied store with:
- `read(key)` for durable reads;
- `transact(key, updater)` for a durable, atomic, serializable transaction scoped to one license.

The transaction guarantee must hold across all processes and machines that share the registry. An in-process mutex, browser local storage, JSON file without locking, or the test-only memory store is not sufficient for production multi-process or multi-PC enforcement. A production provider should use a transactional database or OS-backed service with documented crash consistency, access control and backup/recovery.

## Activation semantics

- Only a result returned by the trusted license verification boundary is accepted; UI-supplied entitlement data is not trusted.
- A machine is represented by an opaque installation ID and SHA-256 fingerprint. Raw serial numbers, MAC addresses, disk IDs or other hardware identifiers must not be collected or stored.
- Repeating activation for the same installation/fingerprint is idempotent.
- A different installation consumes one seat; the limit is enforced inside the atomic transaction.
- Deactivation is scoped to the exact installation and is idempotent. Replacing hardware or migrating an installation requires an explicit deactivate/reactivate workflow.
- Listing activation metadata deliberately omits machine fingerprints.
- The registry is not an offline multi-PC authority. Separate offline machines cannot coordinate seat counts. A central/private registry or a documented online activation window is required for shared volume packs.

## Current implementation boundary

The module defines the registry logic and a strict store contract. Tests use a process-local in-memory atomic test double only. No production database, Windows DPAPI/CNG provider, Android Keystore provider, remote licensing service, activation UI, billing, or customer portal is included. Do not ship volume-license enforcement until a production store and host identity provider are implemented and security-reviewed.
