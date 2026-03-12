/**
 * In-memory FIFO queue for bounded concurrent slicing jobs.
 */

const { DEFAULTS } = require('../../config/constants');
const { parsePositiveInt } = require('./number-utils');

const MAX_SLICE_QUEUE_LENGTH = parsePositiveInt(
    process.env.MAX_SLICE_QUEUE_LENGTH || `${DEFAULTS.MAX_SLICE_QUEUE_LENGTH}`,
    DEFAULTS.MAX_SLICE_QUEUE_LENGTH
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

/**
 * Dispatch waiting slice jobs while free execution slots are available.
 * @returns {void}
 */
function runNextSliceJob() {
    while (activeSliceJobs < MAX_CONCURRENT_SLICES && sliceQueue.length > 0) {
        const nextJob = sliceQueue.shift();
        const waitedMs = Date.now() - nextJob.enqueuedAt;

        if (waitedMs > MAX_SLICE_QUEUE_WAIT_MS) {
            nextJob.reject(new Error('QUEUE_TIMEOUT|Slice job timed out while waiting in queue.'));
            continue;
        }

        activeSliceJobs += 1;

        nextJob
            .task()
            .then(nextJob.resolve)
            .catch(nextJob.reject)
            .finally(() => {
                activeSliceJobs -= 1;
                runNextSliceJob();
            });
    }
}

/**
 * Queue a slicing task and execute it when capacity becomes available.
 * @template T
 * @param {() => Promise<T>} task Async slicing task.
 * @returns {Promise<T>} Task result once executed.
 */
function enqueueSliceJob(task) {
    return new Promise((resolve, reject) => {
        if (sliceQueue.length >= MAX_SLICE_QUEUE_LENGTH) {
            reject(new Error('QUEUE_FULL|Slice queue is full. Please retry later.'));
            return;
        }

        sliceQueue.push({ task, resolve, reject, enqueuedAt: Date.now() });
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
        maxQueueLength: MAX_SLICE_QUEUE_LENGTH
    };
}

module.exports = {
    enqueueSliceJob,
    getQueueStatus
};
