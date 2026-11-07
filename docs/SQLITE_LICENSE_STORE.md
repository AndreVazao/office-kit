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

Tests in this repository use a deterministic fake driver to verify SQL adapter behavior and transaction requirements. They do not prove actual SQLite locking, crash recovery, filesystem durability, OS access control, encryption or multi-process behavior. A real-driver integration test and native host are still required before production use.

This module is a persistent-store adapter boundary, not a completed desktop installer or a production licensing service.


## Real SQLite integration coverage (2026-11-07)
- CI uses Node.js 22 to execute the `node:sqlite` integration suite against a temporary on-disk database.
- Covered: close/reopen persistence, in-place mutation persistence, invalid-state rollback, independent-connection writer lock behavior using `BEGIN IMMEDIATE`, and corrupt JSON rejection.
- The locking test proves SQLite's real writer reservation across two independent connections in one process. It is not a multi-process crash-recovery or power-loss durability test.
- Branch `test/sqlite-multi-connection-locking` adds the independent-connection and corruption cases; CI/visual regression must pass on the final PR HEAD before merge.
