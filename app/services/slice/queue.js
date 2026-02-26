/**
 * In-memory FIFO queue for bounded concurrent slicing jobs.
 */

/**
 * Parse positive integer values with a safe fallback.
 * @param {string | number | undefined} value Source value.
 * @param {number} fallback Fallback integer.
 * @returns {number} Positive integer result.
 */
function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MAX_SLICE_QUEUE_LENGTH = parsePositiveInt(process.env.MAX_SLICE_QUEUE_LENGTH || '100', 100);
const MAX_SLICE_QUEUE_WAIT_MS = parsePositiveInt(process.env.MAX_SLICE_QUEUE_WAIT_MS || '300000', 300000);
const MAX_CONCURRENT_SLICES = parsePositiveInt(process.env.MAX_CONCURRENT_SLICES || '1', 1);

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

module.exports = {
    enqueueSliceJob
};
