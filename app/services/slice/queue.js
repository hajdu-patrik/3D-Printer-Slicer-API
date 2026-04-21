/**
 * In-memory FIFO queue for bounded concurrent slicing jobs.
 */

const { DEFAULTS } = require('../../config/constants');
const { parsePositiveInt } = require('./number-utils');

const MAX_SLICE_QUEUE_LENGTH = parsePositiveInt(
    process.env.MAX_SLICE_QUEUE_LENGTH || `${DEFAULTS.MAX_SLICE_QUEUE_LENGTH}`,
    DEFAULTS.MAX_SLICE_QUEUE_LENGTH
);
const MAX_SLICE_QUEUE_PER_IP = parsePositiveInt(
    process.env.MAX_SLICE_QUEUE_PER_IP || `${DEFAULTS.MAX_SLICE_QUEUE_PER_IP}`,
    DEFAULTS.MAX_SLICE_QUEUE_PER_IP
);
const MAX_SLICE_QUEUE_WAIT_MS = parsePositiveInt(
    process.env.MAX_SLICE_QUEUE_WAIT_MS || `${DEFAULTS.MAX_SLICE_QUEUE_WAIT_MS}`,
    DEFAULTS.MAX_SLICE_QUEUE_WAIT_MS
);
const MAX_CONCURRENT_SLICES = parsePositiveInt(
    process.env.MAX_CONCURRENT_SLICES || `${DEFAULTS.MAX_CONCURRENT_SLICES}`,
    DEFAULTS.MAX_CONCURRENT_SLICES
);

const sliceQueue = [];
let activeSliceJobs = 0;
const queuedByKey = new Map();
const activeByKey = new Map();

/**
 * Increment tracked count for key.
 * @param {Map<string, number>} map Counter map.
 * @param {string} key Counter key.
 * @returns {void}
 */
function incrementKeyCount(map, key) {
    map.set(key, (map.get(key) || 0) + 1);
}

/**
 * Decrement tracked count for key.
 * @param {Map<string, number>} map Counter map.
 * @param {string} key Counter key.
 * @returns {void}
 */
function decrementKeyCount(map, key) {
    const nextValue = (map.get(key) || 0) - 1;
    if (nextValue > 0) {
        map.set(key, nextValue);
    } else {
        map.delete(key);
    }
}

/**
 * Get total queued+active jobs for a queue key.
 * @param {string} queueKey Queue ownership key.
 * @returns {number} Total pending and active jobs.
 */
function getTotalJobsForKey(queueKey) {
    return (queuedByKey.get(queueKey) || 0) + (activeByKey.get(queueKey) || 0);
}

/**
 * Dispatch waiting slice jobs while free execution slots are available.
 * @returns {void}
 */
function runNextSliceJob() {
    while (activeSliceJobs < MAX_CONCURRENT_SLICES && sliceQueue.length > 0) {
        const nextJob = sliceQueue.shift();
        decrementKeyCount(queuedByKey, nextJob.queueKey);
        const waitedMs = Date.now() - nextJob.enqueuedAt;

        if (waitedMs > MAX_SLICE_QUEUE_WAIT_MS) {
            nextJob.reject(new Error('QUEUE_TIMEOUT|Slice job timed out while waiting in queue.'));
            continue;
        }

        activeSliceJobs += 1;
        incrementKeyCount(activeByKey, nextJob.queueKey);

        nextJob
            .task()
            .then(nextJob.resolve)
            .catch(nextJob.reject)
            .finally(() => {
                activeSliceJobs -= 1;
                decrementKeyCount(activeByKey, nextJob.queueKey);
                runNextSliceJob();
            });
    }
}

/**
 * Queue a slicing task and execute it when capacity becomes available.
 * @template T
 * @param {() => Promise<T>} task Async slicing task.
 * @param {{queueKey?: string}} [options] Queue behavior options.
 * @returns {Promise<T>} Task result once executed.
 */
function enqueueSliceJob(task, options = {}) {
    const queueKey = String(options.queueKey || 'anonymous');

    return new Promise((resolve, reject) => {
        if (sliceQueue.length >= MAX_SLICE_QUEUE_LENGTH) {
            reject(new Error('QUEUE_FULL|Slice queue is full. Please retry later.'));
            return;
        }

        if (getTotalJobsForKey(queueKey) >= MAX_SLICE_QUEUE_PER_IP) {
            reject(new Error('QUEUE_CLIENT_LIMIT|Too many queued slice jobs for this client. Please wait and retry.'));
            return;
        }

        sliceQueue.push({ task, resolve, reject, enqueuedAt: Date.now(), queueKey });
        incrementKeyCount(queuedByKey, queueKey);
        runNextSliceJob();
    });
}

/**
 * Get current queue status for health check diagnostics.
 * @returns {{queueLength: number, activeJobs: number, maxConcurrent: number, maxQueueLength: number}}
 */
function getQueueStatus() {
    return {
        queueLength: sliceQueue.length,
        activeJobs: activeSliceJobs,
        maxConcurrent: MAX_CONCURRENT_SLICES,
        maxQueueLength: MAX_SLICE_QUEUE_LENGTH,
        maxQueuePerClient: MAX_SLICE_QUEUE_PER_IP
    };
}

module.exports = {
    enqueueSliceJob,
    getQueueStatus
};
