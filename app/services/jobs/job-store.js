/**
 * In-memory async slice job store with TTL and capacity bound.
 */

const crypto = require('node:crypto');
const { parsePositiveInt } = require('../slice/number-utils');
const { recordJobTransition } = require('../metrics.service');

const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const JOB_STATUSES = Object.freeze(['queued', 'processing', 'done', 'failed']);

const JOB_RESULT_TTL_MS = parsePositiveInt(process.env.JOB_RESULT_TTL_MS, 60 * 60 * 1000);
const JOB_MAX_ENTRIES = parsePositiveInt(process.env.JOB_MAX_ENTRIES, 1000);

/**
 * Raised when the store has no room for another job.
 */
class JobStoreFullError extends Error {
    constructor() {
        super('Job store is full. Please retry later.');
        this.name = 'JobStoreFullError';
        this.status = 503;
        this.errorCode = 'JOB_STORE_FULL';
    }
}

class JobStore {
    /**
     * @param {{ttlMs: number, maxEntries: number}} config Store config.
     */
    constructor({ ttlMs, maxEntries }) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        this.jobs = new Map();
    }

    /**
     * Validate job id format.
     * @param {unknown} jobId Candidate id.
     * @returns {boolean} True for UUID-shaped ids.
     */
    static isValidJobId(jobId) {
        return typeof jobId === 'string' && JOB_ID_PATTERN.test(jobId);
    }

    /**
     * Create a queued job.
     * @returns {{jobId: string}} Job descriptor.
     * @throws {JobStoreFullError} When capacity is exhausted by unfinished jobs.
     */
    create() {
        this.prune();
        if (this.jobs.size >= this.maxEntries) {
            this.evictOldestFinished();
        }
        if (this.jobs.size >= this.maxEntries) {
            throw new JobStoreFullError();
        }

        const jobId = crypto.randomUUID();
        const now = Date.now();
        this.jobs.set(jobId, { jobId, status: 'queued', createdAt: now, updatedAt: now, expiresAt: null });
        recordJobTransition('queued');
        return { jobId };
    }

    transition(jobId, status, patch = {}) {
        const job = this.jobs.get(jobId);
        if (!job) return;
        const now = Date.now();
        Object.assign(job, patch, { status, updatedAt: now });
        if (status === 'done' || status === 'failed') {
            job.expiresAt = now + this.ttlMs;
        }
        recordJobTransition(status);
    }

    markProcessing(jobId) {
        this.transition(jobId, 'processing');
    }

    /**
     * Mark a job finished from a pipeline result.
     * @param {string} jobId Job id.
     * @param {{status: number, body: object}} result Sync-equivalent result.
     * @returns {void}
     */
    complete(jobId, result) {
        if (result.status >= 200 && result.status < 300 && result.body?.success !== false) {
            this.transition(jobId, 'done', { result: result.body });
        } else {
            this.transition(jobId, 'failed', { error: { status: result.status, body: result.body } });
        }
    }

    /**
     * Get public job view or null.
     * @param {string} jobId Job id.
     * @returns {object | null} Public representation.
     */
    get(jobId) {
        const job = this.jobs.get(jobId);
        if (!job) return null;
        if (job.expiresAt && Date.now() > job.expiresAt) {
            this.jobs.delete(jobId);
            return null;
        }
        const view = { jobId: job.jobId, status: job.status };
        if (job.status === 'done') view.result = job.result;
        if (job.status === 'failed') view.error = job.error;
        return view;
    }

    evictOldestFinished() {
        for (const [jobId, job] of this.jobs) {
            if (job.status === 'done' || job.status === 'failed') {
                this.jobs.delete(jobId);
                return;
            }
        }
    }

    prune() {
        const now = Date.now();
        for (const [jobId, job] of this.jobs) {
            if (job.expiresAt && now > job.expiresAt) this.jobs.delete(jobId);
        }
    }

    /** @returns {Record<string, number>} Stored job counts by status. */
    countByStatus() {
        const counts = Object.fromEntries(JOB_STATUSES.map((status) => [status, 0]));
        for (const job of this.jobs.values()) counts[job.status] += 1;
        return counts;
    }
}

const sliceJobStore = new JobStore({ ttlMs: JOB_RESULT_TTL_MS, maxEntries: JOB_MAX_ENTRIES });
setInterval(() => sliceJobStore.prune(), Math.min(JOB_RESULT_TTL_MS, 60_000)).unref();

module.exports = { sliceJobStore, JobStore, JobStoreFullError };
