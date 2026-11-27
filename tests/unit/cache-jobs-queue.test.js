'use strict';

// Small queue limits must be set before the queue module is required (read at require-time).
process.env.PYTHON_EXECUTABLE = process.execPath;
process.env.ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'unit-test-key';
process.env.MAX_CONCURRENT_SLICES = '1';
process.env.MAX_SLICE_QUEUE_LENGTH = '3';
process.env.MAX_SLICE_QUEUE_PER_IP = '2';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const cache = require('../../app/services/slice/result-cache');
const { JobStore, JobStoreFullError } = require('../../app/services/jobs/job-store');
const queue = require('../../app/services/slice/queue');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('cache key ignores quantity but changes with layerHeight and material', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cache-key-'));
    try {
        const profile = path.join(dir, 'p.ini');
        fs.writeFileSync(profile, 'a = 1\n');
        const base = { fileHash: 'abc', engine: 'prusa', profileFiles: [profile] };
        const key = (options) => cache.buildCacheKey({ ...base, options });

        const k1 = key({ layerHeight: 0.2, material: 'PLA', quantity: 1 });
        assert.match(k1, /^[0-9a-f]{64}$/);
        assert.equal(key({ layerHeight: 0.2, material: 'PLA', quantity: 50 }), k1);
        assert.equal(key({ material: 'PLA', layerHeight: 0.2 }), k1, 'key order must not matter');
        assert.notEqual(key({ layerHeight: 0.1, material: 'PLA', quantity: 1 }), k1);
        assert.notEqual(key({ layerHeight: 0.2, material: 'PETG', quantity: 1 }), k1);

        assert.equal(cache.buildCacheKey({ ...base, fileHash: null, options: {} }), null);
        assert.equal(cache.buildCacheKey({ ...base, profileFiles: [path.join(dir, 'missing.ini')], options: {} }), null);
        assert.deepEqual(cache.pickPricingOnlyFields({ quantity: 3, layerHeight: 0.2 }), { quantity: 3 });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});

test('cache LRU eviction and deep copies', () => {
    const lru = new cache.SliceResultCache({ ttlMs: 60000, maxEntries: 2 });
    lru.set('a', { n: 1 });
    lru.set('b', { n: 2 });
    assert.deepEqual(lru.get('a'), { n: 1 }); // refresh a; b is now oldest
    lru.set('c', { n: 3 });
    assert.equal(lru.get('b'), null);
    assert.deepEqual(lru.get('a'), { n: 1 });
    assert.deepEqual(lru.get('c'), { n: 3 });
    assert.equal(lru.size, 2);

    const copy = lru.get('a');
    copy.n = 99;
    assert.deepEqual(lru.get('a'), { n: 1 });
});

test('cache TTL expiry and disabled mode', async () => {
    const ttl = new cache.SliceResultCache({ ttlMs: 20, maxEntries: 10 });
    ttl.set('k', { v: 1 });
    assert.deepEqual(ttl.get('k'), { v: 1 });
    await sleep(50);
    assert.equal(ttl.get('k'), null);

    ttl.set('k2', { v: 2 });
    await sleep(50);
    ttl.prune();
    assert.equal(ttl.size, 0);

    const off = new cache.SliceResultCache({ ttlMs: 0, maxEntries: 10 });
    assert.equal(off.isEnabled(), false);
    off.set('x', { v: 1 });
    assert.equal(off.get('x'), null);
});

test('JobStore create / transition / get', () => {
    const store = new JobStore({ ttlMs: 60000, maxEntries: 10 });
    const { jobId } = store.create();
    assert.equal(JobStore.isValidJobId(jobId), true);
    assert.equal(JobStore.isValidJobId('nope'), false);
    assert.deepEqual(store.get(jobId), { jobId, status: 'queued' });

    store.markProcessing(jobId);
    assert.equal(store.get(jobId).status, 'processing');

    store.complete(jobId, { status: 200, body: { success: true, x: 1 } });
    assert.deepEqual(store.get(jobId), { jobId, status: 'done', result: { success: true, x: 1 } });
    assert.equal(store.get('00000000-0000-4000-8000-000000000000'), null);

    const failing = store.create().jobId;
    store.complete(failing, { status: 422, body: { success: false, errorCode: 'X' } });
    const view = store.get(failing);
    assert.equal(view.status, 'failed');
    assert.equal(view.error.status, 422);
    assert.deepEqual(store.countByStatus(), { queued: 0, processing: 0, done: 1, failed: 1 });
});

test('JobStore TTL pruning of finished jobs', async () => {
    const store = new JobStore({ ttlMs: 20, maxEntries: 10 });
    const finished = store.create().jobId;
    const pending = store.create().jobId;
    store.complete(finished, { status: 200, body: { success: true } });
    await sleep(50);
    assert.equal(store.get(finished), null);
    store.prune();
    assert.equal(store.jobs.size, 1);
    assert.equal(store.get(pending).status, 'queued');
});

test('JobStore max entries: evicts oldest finished, else JOB_STORE_FULL', () => {
    const store = new JobStore({ ttlMs: 60000, maxEntries: 2 });
    const a = store.create().jobId;
    const b = store.create().jobId;
    assert.throws(
        () => store.create(),
        (err) => err instanceof JobStoreFullError && err.status === 503 && err.errorCode === 'JOB_STORE_FULL'
    );

    store.complete(a, { status: 200, body: { success: true } });
    const c = store.create().jobId;
    assert.equal(store.get(a), null);
    assert.equal(store.get(b).status, 'queued');
    assert.equal(store.get(c).status, 'queued');
});

test('queue: per-client limit (429) then queue full (503), then drains', async () => {
    const releases = [];
    const blocking = () => new Promise((resolve) => releases.push(resolve));
    const accepted = [];
    const accept = (key) => {
        const promise = queue.enqueueSliceJob(blocking, { queueKey: key });
        accepted.push(promise);
        return promise;
    };

    accept('A'); // becomes active
    accept('A'); // queued (A total = 2)
    await assert.rejects(queue.enqueueSliceJob(blocking, { queueKey: 'A' }), (err) => (
        err instanceof queue.SliceQueueClientLimitError
        && err.status === 429
        && err.errorCode === 'SLICE_QUEUE_CLIENT_LIMIT'
    ));
    assert.throws(() => queue.assertSliceQueueCapacity('A'), queue.SliceQueueClientLimitError);
    assert.doesNotThrow(() => queue.assertSliceQueueCapacity('B'));

    accept('B'); // queued
    accept('C'); // queued -> queue length 3
    assert.equal(queue.getQueueStatus().queueLength, 3);
    await assert.rejects(queue.enqueueSliceJob(blocking, { queueKey: 'D' }), (err) => (
        err instanceof queue.SliceQueueFullError
        && err.status === 503
        && err.errorCode === 'SLICE_QUEUE_FULL'
    ));
    assert.throws(() => queue.assertSliceQueueCapacity('D'), queue.SliceQueueFullError);

    assert.deepEqual(queue.toQueueErrorResponse(new queue.SliceQueueFullError()), {
        status: 503,
        body: { success: false, error: 'Slice queue is full. Please retry later.', errorCode: 'SLICE_QUEUE_FULL' }
    });
    assert.equal(queue.toQueueErrorResponse(new queue.SliceQueueClientLimitError()).status, 429);
    assert.equal(queue.toQueueErrorResponse(new Error('QUEUE_TIMEOUT|waited too long')).body.errorCode, 'SLICE_QUEUE_TIMEOUT');
    assert.equal(queue.toQueueErrorResponse(new Error('other')), null);

    // Drain FIFO: each release completes the active job and starts the next.
    for (let i = 0; i < 4; i += 1) {
        while (releases.length === 0) await new Promise((resolve) => setImmediate(resolve));
        releases.shift()('done');
    }
    assert.deepEqual(await Promise.all(accepted), ['done', 'done', 'done', 'done']);
    await sleep(10); // let the final .finally() bookkeeping run
    const status = queue.getQueueStatus();
    assert.equal(status.queueLength, 0);
    assert.equal(status.activeJobs, 0);
});
