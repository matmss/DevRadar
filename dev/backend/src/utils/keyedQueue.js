// Runs async tasks one at a time per key, in arrival order (QA-AUTH5 hardening 1).
//
// DevController uses it per GitHub login so that, for one user, "write to the database, then
// announce it over the socket" happens in the same order as the requests: a PUT whose database
// reply is slow can no longer announce dev-updated after a later DELETE announced dev-deleted
// (which re-added a deleted marker on mobile). Different logins never wait for each other.
//
// In process memory, like the rate-limit counters and the OAuth state: correct for the single
// backend instance this project assumes (dev/docs/00-architecture.md). Several instances would
// need a shared lock (or per-dev versions on the events) instead.
//
// A key is forgotten as soon as its last task settles, so idle logins cost nothing. A failing
// task rejects its own caller only; the next task for the key still runs.

/**
 * @returns {{ run: <T>(key: string, task: () => Promise<T>) => Promise<T>, size: () => number }}
 */
function createKeyedQueue() {
  /** @type {Map<string, Promise<void>>} the settled-or-pending end of each key's chain (never rejects) */
  const tails = new Map();

  return {
    /**
     * Runs `task` after every task already queued for `key` has settled.
     * @template T
     * @param {string} key
     * @param {() => Promise<T>} task
     * @returns {Promise<T>} the task's own result or rejection
     */
    run(key, task) {
      const previous = tails.get(key) || Promise.resolve();
      const result = previous.then(() => task());
      const tail = result.then(() => undefined, () => undefined);
      tails.set(key, tail);
      tail.then(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },

    /** @returns {number} keys with a task queued or running (for tests: idle keys are dropped) */
    size() {
      return tails.size;
    },
  };
}

module.exports = { createKeyedQueue };
