# SQLite monotonic checkpoint coordinator

Status: the SQLite checkpoint-metadata adapter was squash-merged by PR #84
as `0163babd2ad2524dc1d82fe3f45e1c016070d6ee`. It persists the finalized
checkpoint and a single prepared record in real SQLite transactions. It is not
yet connected to `SqliteOfficeIncidentStore` and does not append incident
events or snapshots. No TPM or rollback-protection claim is made.

## Adapter contract

`SqliteMonotonicCheckpointJournal` implements the coordinator journal methods:

- `withExclusiveLock(operation)`: delegates to a mandatory injected lock
  provider. The provider must serialize every process that can write this
  database. A test-only in-memory lock is not cross-process evidence.
- `readCheckpoint()`: reads the installation-scoped finalized checkpoint.
- `readPreparedCheckpoint()`: reads the durable prepare record, or null.
- `prepareCheckpoint({ expected, next, payload })`: validates the transition
  and persists the prepare record in a `BEGIN IMMEDIATE` transaction.
- `finalizeCheckpoint(record)`: atomically updates checkpoint metadata and
  removes the prepare record; repeated finalization of an already finalized
  record is idempotent.
- `discardPreparedCheckpoint(id)`: removes only the matching prepared row.
  The coordinator must first prove that the external anchor still equals the
  predecessor checkpoint.

The adapter requires a host-configured SQLite connection with an appropriate
durability policy. Production host configuration must explicitly select
`synchronous=FULL`, a journal mode, busy timeout, private file permissions,
and backup/restore policy. The adapter does not silently change connection
pragmas.

## Commit sequence

1. Acquire the injected exclusive lock.
2. Reconcile the provider state against the finalized local checkpoint.
3. Persist and read back the prepare record.
4. Call provider compare-and-advance.
5. Finalize the SQLite checkpoint metadata and verify that no prepare remains.
6. Return only after both sides report the same checkpoint.

## Recovery rules

- Anchor equals prepared target: finalize the durable prepare.
- Anchor equals prepared predecessor: discard the uncommitted prepare.
- Anchor and local/prepared state disagree: fail closed; retain evidence.
- Provider is unsupported/unavailable and no prepare exists: report its actual
  status, never `protected`.
- Provider outcome is ambiguous: re-read durable state; finalize only if the
  target is proven. Otherwise preserve the prepare for next-start recovery.

## Evidence and remaining gates

The PR #84 tests use the real `node:sqlite` engine, a temporary on-disk database,
WAL with `synchronous=FULL`, close/reopen, and a fake anchor provider. They
exercise persisted prepare/finalize and coordinator recovery. CI #554 and
visual regression #474 passed on final PR HEAD `c2598283cbe99f0d96c694f5e2f07419ce9181bd`.
PR #85 adds a shared in-process operation lock to the Windows host and a
child-process test for the host singleton lock; it is not yet merged. These
checks do not prove arbitrary-process SQLite exclusion, power-loss durability
on physical storage, incident journal integration, a hardware anchor, or
rollback resistance. The fake provider's declared capabilities are test
fixtures only.

Next work:
1. Integrate the checkpoint adapter with the immutable incident event/MAC
   append path so the checkpoint hash and MAC refer to an actual journal event.
2. Complete PR #85 host operation-lock wiring; the supported Windows host
   singleton excludes another Office Kit host process, while the shared
   in-process queue serializes incident writes with checkpoint operations.
3. Add fault injection around real SQLite commit boundaries and backup/restore.
4. Implement TPM 2.0 provisioning/provider separately; absent or unavailable
   hardware must remain `unsupported` / `unavailable`.

A provider reporting `unsupported`, `unprovisioned` or `unavailable` cannot
be promoted to `protected`.
