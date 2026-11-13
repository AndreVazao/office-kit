import test from "node:test";
import assert from "node:assert/strict";
import { createInProcessExclusiveLockProvider } from "../src/exclusive-operation-lock.mjs";

test("serializes queued operations and drains them before close", async () => {
  const provider = createInProcessExclusiveLockProvider();
  const first = await provider.acquire();
  let secondAcquired = false;
  const secondPromise = provider.acquire().then(lease => {
    secondAcquired = true;
    return lease;
  });
  await Promise.resolve();
  assert.equal(secondAcquired, false);

  let closed = false;
  const closing = provider.close().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);

  await first.release();
  const second = await secondPromise;
  assert.equal(secondAcquired, true);
  assert.equal(closed, false);
  await second.release();
  await closing;
  assert.equal(closed, true);
  await assert.rejects(provider.acquire(), /exclusive_operation_lock_closed/);
});

test("rejects double release without unlocking a later operation", async () => {
  const provider = createInProcessExclusiveLockProvider();
  const first = await provider.acquire();
  await first.release();
  await assert.rejects(first.release(), /exclusive_operation_lock_already_released/);
  const second = await provider.acquire();
  await second.release();
  await provider.close();
});
