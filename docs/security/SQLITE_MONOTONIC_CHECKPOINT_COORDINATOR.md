# SQLite monotonic checkpoint coordinator

Status: orchestration layer implemented on the feature branch. The existing
`SqliteOfficeIncidentStore` is not yet wired to this coordinator; a concrete
SQLite journal adapter and end-to-end integration remain required before this
phase can be marked complete. No TPM or rollback-protection claim is made.

## Required journal adapter contract

The coordinator accepts an adapter exposing:

- `withExclusiveLock(operation)`: process-wide and cross-process serialization
  for all writers sharing the database.
- `readCheckpoint()`: last finalized local checkpoint.
- `readPreparedCheckpoint()`: durable pending prepare record, or null.
- `prepareCheckpoint({ expected, next, payload })`: durably persist the pending
  record before returning.
- `finalizeCheckpoint(record)`: idempotently commit the prepared event/snapshot
  and advance the local checkpoint in one SQLite transaction.
- `discardPreparedCheckpoint(id)`: remove only a prepare that is proven not
  to have been externally committed.

The coordinator verifies the prepared record after writing it. The adapter is
responsible for transaction durability, SQLite locking, immutable event/MAC
insertion and atomic finalization.

## Commit sequence

1. Acquire the adapter's exclusive lock.
2. Reconcile the provider state against the finalized local checkpoint.
3. Persist and read back the prepare record.
4. Call provider compare-and-advance.
5. Finalize the SQLite record and verify that no prepare remains.
6. Return only after both sides report the same checkpoint.

## Recovery rules

- Anchor equals prepared target: finalize the durable prepare.
- Anchor equals prepared predecessor: discard the uncommitted prepare.
- Anchor and local/prepared state disagree: fail closed; retain evidence.
- Provider is unsupported/unavailable and no prepare exists: report its actual
  status, never `protected`.
- Provider outcome is ambiguous: re-read durable state; finalize only if the
  target is proven. Otherwise preserve the prepare for next-start recovery.

## Current limitations and next gate

The current module is a tested orchestration boundary with fault-injection
coverage. Its test journal is an in-memory fake and is not evidence of SQLite
durability, cross-process locking or TPM security. The next increment must
implement the adapter against the existing `SqliteOfficeIncidentStore` event,
MAC and snapshot tables, add crash/fault-injection tests around actual SQLite
transactions, and validate Linux/Windows CI plus browser visual checks on one
final commit SHA.

A provider reporting `unsupported`, `unprovisioned` or `unavailable` cannot
be promoted to `protected`. Native Windows TPM 2.0 integration and physical
TPM validation remain separate future gates.
