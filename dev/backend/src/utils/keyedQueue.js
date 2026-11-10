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
//
// runAll holds several keys for one task (a sign-in that displaces another account's dev, auth
// slice 6). It takes them one by one in sorted order, holding each while waiting for the next.
// Since every multi-key task takes keys in the same global order and a single-key task never
// waits for a second key, no two tasks can wait for each other: no deadlock.

/**
 * @returns {{ run: <T>(key: string, task: () => Promise<T>) => Promise<T>,
 *   runAll: <T>(keys: string[], task: () => Promise<T>) => Promise<T>, size: () => number }}
 */
function createKeyedQueue() {
  /** @type {Map<string, Promise<void>>} the settled-or-pending end of each key's chain (never rejects) */
  const tails = new Map();

  /**
   * Runs `task` after every task already queued for `key` has settled.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>} task
   * @returns {Promise<T>} the task's own result or rejection
   */
  function run(key, task) {
    const previous = tails.get(key) || Promise.resolve();
    const result = previous.then(() => task());
    const tail = result.then(() => undefined, () => undefined);
    tails.set(key, tail);
    tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return result;
  }

  /**
   * Runs `task` while holding every key in `keys` (duplicates ignored), taken in sorted order.
   * @template T
   * @param {string[]} keys
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  function runAll(keys, task) {
    const sorted = [...new Set(keys)].sort();
    const hold = (i) => (i === sorted.length ? task() : run(sorted[i], () => hold(i + 1)));
    return hold(0);
  }

  return {
    run,
    runAll,

    /** @returns {number} keys with a task queued or running (for tests: idle keys are dropped) */
    size() {
      return tails.size;
    },
  };
}

module.exports = { createKeyedQueue };
