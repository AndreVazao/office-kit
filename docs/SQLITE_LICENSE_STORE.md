# SQLite activation store boundary

## Purpose

Provide a durable local activation store without coupling the Office Kit core to a native runtime, filesystem path, database driver package or OS-specific secret store.

## Implementation

`SqliteLicenseActivationStore` wraps a host-supplied better-sqlite3-compatible connection. It creates a single table keyed by license ID, stores versioned JSON state, and executes each read-modify-write operation inside SQLite's `transaction().immediate()` boundary. SQLite's write reservation serializes competing writers that share the same database file, including separate host processes.

The adapter compares the serialized pre-update and post-update states, so it persists both replacement objects and in-place mutations while avoiding writes for true no-op transactions. The core does not open the database file, choose its location, install the driver, or manage encryption. The native host must own those responsibilities and must ensure that all instances intended to share a seat count use the same protected database. Backups and restores must preserve transactionally consistent database state.

## Host requirements

- Supply a maintained SQLite driver exposing `exec`, `prepare().get/run`, and `transaction(callback).immediate()`.
- Store the database under the current user's private application-data directory with restrictive OS permissions.
- Use an encrypted volume or host-level encryption where the threat model requires it; SQLite itself does not encrypt this table.
- Keep machine fingerprints out of logs and UI; the registry already omits them from listing results.
- Do not place a shared multi-PC database on an arbitrary network share. For multi-PC seat enforcement, use a service/database with documented locking and availability guarantees.
- Back up using SQLite's supported backup mechanism, not by copying a live database file without coordination.

## Verification boundary

The suite includes deterministic fake-driver tests and real `node:sqlite` file-backed integration tests. The latter cover WAL persistence, `BEGIN IMMEDIATE` writer contention, and a two-process license-seat race on one local database. The concurrent test uses a deterministic test-only license verifier; it proves same-host serialization and seat-limit enforcement, not production signature validation.

These tests do not prove power-loss durability, OS access control, database encryption, network-share semantics, cross-PC/offline coordination, or physical-host behavior. This adapter is not a completed desktop installer or a production licensing service.


## Real SQLite integration coverage (2026-11-07)
- CI uses Node.js 22 to execute the `node:sqlite` integration suite against a temporary on-disk database.
- Covered: close/reopen persistence, in-place mutation persistence, invalid-state rollback, independent-connection writer lock behavior using `BEGIN IMMEDIATE`, and corrupt JSON rejection.
- The locking test proves SQLite's real writer reservation across two independent connections in one process. It is not a multi-process crash-recovery or power-loss durability test.
- Branch `test/sqlite-multi-connection-locking` adds the independent-connection and corruption cases; CI/visual regression must pass on the final PR HEAD before merge.


## Concurrent license-seat enforcement (2026-11-21)

- PR #115 adds a real multi-process activation race test. Two independent Node.js child processes use the same on-disk SQLite/WAL database and the same test entitlement with `maxInstallations: 1`.
- The parent holds a real `BEGIN IMMEDIATE` writer reservation until both processes reach the registry transaction boundary. After release, exactly one activation succeeds and the other returns `installation_limit_reached`; reopening SQLite confirms exactly one active installation.
- Exact PR HEAD: `0b4bbcf12716ef856f1c66e89ebdd9a07de5f590`. CI run [44916584036](https://github.com/AndreVazao/office-kit/actions/runs/44916584036) passed Linux/Windows on Node 22 and Node 26.13.1; visual run [44916584062](https://github.com/AndreVazao/office-kit/actions/runs/44916584062) passed on the same SHA.
- The entitlement verifier is a deterministic test-only fake. This is same-host process coordination on a local database, not production license-signature validation, cross-PC/offline seat enforcement, network-share support, power-loss proof, or physical-host validation.
