// dev/backend/src/utils/keyedQueue.js: per-key serialization of DevController's writes, so live
// events follow the database order (QA-AUTH5 hardening 1).
const { createKeyedQueue } = require('../../../dev/backend/src/utils/keyedQueue');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('createKeyedQueue', () => {
  it('runs tasks for the same key one at a time, in arrival order', async () => {
    const queue = createKeyedQueue();
    const log = [];
    const slow = queue.run('gaearon', async () => { log.push('a:start'); await sleep(30); log.push('a:end'); return 'a'; });
    const fast = queue.run('gaearon', async () => { log.push('b:start'); log.push('b:end'); return 'b'; });
    await expect(Promise.all([slow, fast])).resolves.toEqual(['a', 'b']);
    expect(log).toEqual(['a:start', 'a:end', 'b:start', 'b:end']);
  });

  it('does not make different keys wait for each other', async () => {
    const queue = createKeyedQueue();
    const log = [];
    const slow = queue.run('alice', async () => { await sleep(30); log.push('alice'); });
    const fast = queue.run('bob', async () => { log.push('bob'); });
    await Promise.all([slow, fast]);
    expect(log).toEqual(['bob', 'alice']);
  });

  it('rejects only the failing task; the next one for the key still runs', async () => {
    const queue = createKeyedQueue();
    const failing = queue.run('gaearon', async () => { throw new Error('db down'); });
    const next = queue.run('gaearon', async () => 'ran');
    await expect(failing).rejects.toThrow('db down');
    await expect(next).resolves.toBe('ran');
  });

  it('forgets a key once its last task has settled (no leak for idle logins)', async () => {
    const queue = createKeyedQueue();
    const first = queue.run('gaearon', () => sleep(10));
    const second = queue.run('gaearon', () => sleep(10));
    queue.run('alice', async () => { throw new Error('x'); }).catch(() => {});
    expect(queue.size()).toBe(2);
    await Promise.all([first, second]);
    await sleep(0);
    expect(queue.size()).toBe(0);
  });

  // Auth slice 6: a sign-in that displaces another account's dev holds both accounts' keys.
  it('runAll holds every key for the task and waits for each key\'s earlier tasks', async () => {
    const queue = createKeyedQueue();
    const log = [];
    const a = queue.run('a', async () => { await sleep(20); log.push('a'); });
    const b = queue.run('b', async () => { await sleep(10); log.push('b'); });
    const both = queue.runAll(['b', 'a', 'b'], async () => { log.push('both'); return 'done'; });
    const laterA = queue.run('a', async () => { log.push('later-a'); });
    await expect(both).resolves.toBe('done');
    await Promise.all([a, b, laterA]);
    expect(log).toEqual(['b', 'a', 'both', 'later-a']);
    await sleep(0);
    expect(queue.size()).toBe(0);
  });

  it('runAll never deadlocks when two tasks ask for the same keys in opposite orders', async () => {
    const queue = createKeyedQueue();
    const log = [];
    const results = await Promise.race([
      Promise.all([
        queue.runAll(['x', 'y'], async () => { await sleep(10); log.push('xy'); return 1; }),
        queue.runAll(['y', 'x'], async () => { await sleep(10); log.push('yx'); return 2; }),
        queue.run('y', async () => { log.push('y'); return 3; }),
      ]),
      sleep(1000).then(() => 'deadlock'),
    ]);
    expect(results).toEqual([1, 2, 3]);
    expect(log).toHaveLength(3);
  });

  it('runAll rejects only its own caller and releases every key', async () => {
    const queue = createKeyedQueue();
    await expect(queue.runAll(['p', 'q'], async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(queue.runAll(['q', 'p'], async () => 'next')).resolves.toBe('next');
    await sleep(0);
    expect(queue.size()).toBe(0);
  });

  it('keeps a key while a task queued after the first is still pending', async () => {
    const queue = createKeyedQueue();
    const first = queue.run('gaearon', () => sleep(5));
    const second = queue.run('gaearon', () => sleep(30));
    await first;
    await sleep(0);
    expect(queue.size()).toBe(1);
    await second;
    await sleep(0);
    expect(queue.size()).toBe(0);
  });
});
