/**
 * Serializes asynchronous operations within one host process.
 *
 * Cross-process exclusion is supplied by the platform host's singleton lock;
 * this provider only coordinates operations inside that already-exclusive host.
 */
export function createInProcessExclusiveLockProvider() {
  let tail = Promise.resolve();
  let closed = false;
  let pending = 0;

  return Object.freeze({
    async acquire() {
      if (closed) throw new Error("exclusive_operation_lock_closed");
      const previous = tail;
      let releaseGate;
      const gate = new Promise(resolve => { releaseGate = resolve; });
      tail = previous.then(() => gate);
      pending += 1;
      await previous;
      let released = false;
      return Object.freeze({
        release: async () => {
          if (released) throw new Error("exclusive_operation_lock_already_released");
          released = true;
          pending -= 1;
          releaseGate();
        }
      });
    },

    async close() {
      closed = true;
      await tail;
      if (pending !== 0) throw new Error("exclusive_operation_lock_drain_incomplete");
    }
  });
}
