# Windows native runtime integration

## Purpose

This document defines how a future desktop host consumes the Windows-only identity runtime. It is an integration contract, not a claim that a desktop launcher or installer already exists.

## Composition

The host opens and owns its SQLite connection, then passes the connection through the small synchronous interface required by the scene engine:

- `exec(sql)`
- `prepare(sql)`
- `transaction(callback)`, returning a callable transaction with `.immediate()`

The host then calls `createWindowsNodeIdentityRuntime({ database, installationId, hostExecutable })` from `packages/scene-engine/src/windows.mjs`.

The returned object exposes `manager`, `keyStore`, `metadataStore`, `challengeStore`, and a frozen capability snapshot. The host should normally use `manager` and keep provider objects internal to its composition root.

## Startup and health

1. Resolve a stable installation ID generated at install time; do not derive it from a username, hostname, or mutable directory.
2. Resolve the absolute path of the signed CNG helper from the installation.
3. Open the per-installation SQLite database from a user-private data directory.
4. Apply restrictive Windows ACLs to the data directory and database before opening it. Do not place the database under a shared/public directory.
5. Compose the runtime and call `manager.reconcile()` before declaring identity health.
6. Report health as unavailable when reconciliation returns `identity_unavailable`, `cleanup_pending`, or `revoked_cleanup_pending`. Never silently create a replacement identity on startup.
7. Expose only the public identity and capability metadata to UI/diagnostics; never expose private key material or raw database contents.

## Lifecycle

- First-time enrollment is an explicit user/administrator action that calls `manager.create({ organizationId, nodeId })`.
- Proof of possession uses a fresh challenge and a single call to `manager.provePossession(challenge)`; challenges are durably consumed.
- Rotation is explicit and calls `manager.rotate()`; the manager records pending deletion so interrupted cleanup can be reconciled on next startup.
- Uninstall must ask for an explicit data-retention choice. Removing binaries must not silently delete identity metadata or OS keystore keys.
- If identity deletion is requested, call `manager.revoke()` and confirm reconciliation before deleting the database. Preserve a backup/export only when the product's retention policy explicitly allows it.

## Security boundary

- The host owns SQLite driver, connection, file path, ACLs, backups, locking, migrations, shutdown and crash recovery.
- The host owns helper installation, signature verification, update and rollback policy. The helper must not be replaceable by an untrusted process.
- CNG uses the Microsoft Software Key Storage Provider. This is OS-protected persistent storage with non-exportable private keys; it is **not** a claim of TPM/hardware-backed protection.
- Do not put credentials, access tokens, adapter secrets, or private key bytes in SQLite metadata.
- Do not enable network discovery, federation, remote commands, or adapter write operations as a side effect of identity initialization.
- The generic browser entrypoint must remain free of Node and Windows imports.

## Validation status

- [x] Native Windows runner: create, sign/verify, SQLite close/reopen, manager recreation, replay rejection, rotate, old-key deletion, post-restart proof, revoke and post-revoke reconciliation. PR #48 code HEAD `1b856195ada69de5fbb0ab64b7c82d736aafdacb`; CI `42484745984`, visual `42484745951`.
- [ ] Injected cleanup failure and interrupted-cleanup recovery in the composed runtime.
- [ ] Installer: per-user ACL verification, helper signature verification, upgrade/rollback, health check, uninstall with both retain/delete choices.
- [ ] Physical PC: validate on a supported Windows installation and verify recovery after forced process termination. CI is not a substitute for this.