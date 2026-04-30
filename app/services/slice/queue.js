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
 * Base queue-domain error carrying stable API mapping metadata.
 */
class SliceQueueError extends Error {
    /**
     * @param {string} message User-facing error message.
     * @param {number} status HTTP status code.
     * @param {string} errorCode Stable API error code.
     */
    constructor(message, status, errorCode) {
        super(message);
        this.name = this.constructor.name;
        this.status = status;
        this.errorCode = errorCode;
    }
}

/**
 * Queue overflow error.
 */
class SliceQueueFullError extends SliceQueueError {
    constructor() {
        super('Slice queue is full. Please retry later.', 503, 'SLICE_QUEUE_FULL');
    }
}

/**
 * Queue wait-time timeout error.
 */
class SliceQueueTimeoutError extends SliceQueueError {
    constructor() {
        super('Slice job timed out while waiting in queue.', 503, 'SLICE_QUEUE_TIMEOUT');
    }
}

/**
 * Per-client fairness cap error.
 */
class SliceQueueClientLimitError extends SliceQueueError {
    constructor() {
        super('Too many queued slice jobs for this client. Please wait and retry.', 429, 'SLICE_QUEUE_CLIENT_LIMIT');
    }
}

const LEGACY_QUEUE_ERROR_PREFIXES = Object.freeze({
    'QUEUE_FULL|': { status: 503, errorCode: 'SLICE_QUEUE_FULL' },
    'QUEUE_TIMEOUT|': { status: 503, errorCode: 'SLICE_QUEUE_TIMEOUT' },
    'QUEUE_CLIENT_LIMIT|': { status: 429, errorCode: 'SLICE_QUEUE_CLIENT_LIMIT' }
});

/**
 * Convert legacy prefixed queue error messages into response metadata.
 * @param {Error} err Queue error.
 * @returns {{status: number, errorCode: string, error: string} | null} Normalized mapping when recognized.
 */
function parseLegacyQueueError(err) {
    const message = typeof err?.message === 'string' ? err.message : '';

    for (const [prefix, metadata] of Object.entries(LEGACY_QUEUE_ERROR_PREFIXES)) {
        if (message.startsWith(prefix)) {
            const errorText = message.slice(prefix.length).trim() || 'Queue processing failed.';
            return {
                status: metadata.status,
                errorCode: metadata.errorCode,
                error: errorText
            };
        }
    }

    return null;
}

/**
 * Normalize queue-domain errors into stable API response payload metadata.
 * @param {Error} err Queue error.
 * @returns {{status: number, body: {success: boolean, error: string, errorCode: string}} | null} Queue response mapping.
 */
function toQueueErrorResponse(err) {
    if (err instanceof SliceQueueError) {
        return {
            status: err.status,
            body: {
                success: false,
                error: err.message,
                errorCode: err.errorCode
            }
        };
    }

    const legacy = parseLegacyQueueError(err);
    if (legacy) {
        return {
            status: legacy.status,
            body: {
                success: false,
                error: legacy.error,
                errorCode: legacy.errorCode
            }
        };
    }

    return null;
}

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
            nextJob.reject(new SliceQueueTimeoutError());
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
            reject(new SliceQueueFullError());
            return;
        }

        if (getTotalJobsForKey(queueKey) >= MAX_SLICE_QUEUE_PER_IP) {
            reject(new SliceQueueClientLimitError());
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
    getQueueStatus,
    toQueueErrorResponse,
    SliceQueueError,
    SliceQueueFullError,
    SliceQueueTimeoutError,
    SliceQueueClientLimitError
};
