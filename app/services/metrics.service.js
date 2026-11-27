/**
 * Dependency-free in-memory metrics registry rendered in Prometheus text format.
 */

const DURATION_BUCKETS_SECONDS = [1, 5, 10, 30, 60, 120, 300, 600];

const sliceCounters = new Map();
const sliceErrorCounters = new Map();
const cacheCounters = { hit: 0, miss: 0 };
const jobTransitionCounters = new Map();
const queueRejectionCounters = new Map();
const durationHistogram = {
    buckets: DURATION_BUCKETS_SECONDS.map(() => 0),
    count: 0,
    sum: 0
};

/**
 * Escape a Prometheus label value.
 * @param {unknown} value Raw label value.
 * @returns {string} Escaped value.
 */
function escapeLabelValue(value) {
    return String(value).replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll('"', '\\"');
}

/**
 * Serialize labels into a Prometheus label block.
 * @param {Record<string, unknown>} labels Label map.
 * @returns {string} Label block, e.g. {a="b"}.
 */
function formatLabels(labels) {
    const parts = Object.entries(labels).map(([key, value]) => `${key}="${escapeLabelValue(value)}"`);
    return parts.length > 0 ? `{${parts.join(',')}}` : '';
}

function increment(map, labels) {
    const key = formatLabels(labels);
    map.set(key, (map.get(key) || 0) + 1);
}

/**
 * Record one finished slice request.
 * @param {{engine: string, technology?: string | null, outcome: 'success'|'cache_hit'|'error', errorCode?: string | null}} sample Sample.
 * @returns {void}
 */
function recordSliceResult({ engine, technology, outcome, errorCode }) {
    increment(sliceCounters, { engine, technology: technology || 'unknown', outcome });
    if (outcome === 'error') {
        increment(sliceErrorCounters, { engine, error_code: errorCode || 'UNKNOWN' });
    }
}

/**
 * Record the duration of one executed (non-cached) slice pipeline.
 * @param {number} seconds Duration in seconds.
 * @returns {void}
 */
function observeSliceDuration(seconds) {
    durationHistogram.count += 1;
    durationHistogram.sum += seconds;
    DURATION_BUCKETS_SECONDS.forEach((bound, index) => {
        if (seconds <= bound) durationHistogram.buckets[index] += 1;
    });
}

/**
 * Record a result-cache lookup.
 * @param {boolean} isHit Whether the lookup hit.
 * @returns {void}
 */
function recordCacheLookup(isHit) {
    if (isHit) cacheCounters.hit += 1;
    else cacheCounters.miss += 1;
}

/**
 * Record an async job status transition.
 * @param {'queued'|'processing'|'done'|'failed'} status New status.
 * @returns {void}
 */
function recordJobTransition(status) {
    increment(jobTransitionCounters, { status });
}

/**
 * Record a queue-domain rejection.
 * @param {string} errorCode Queue error code.
 * @param {'precheck'|'enqueue'} stage Rejection stage.
 * @returns {void}
 */
function recordQueueRejection(errorCode, stage) {
    increment(queueRejectionCounters, { error_code: errorCode, stage });
}

function renderCounterMap(lines, name, help, map) {
    lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} counter`);
    for (const [labels, value] of map) {
        lines.push(`${name}${labels} ${value}`);
    }
}

/**
 * Render all metrics in Prometheus text exposition format.
 * @param {{queue: {queueLength: number, activeJobs: number}, jobsByStatus: Record<string, number>, cache: {size: number}}} gauges Live gauge values.
 * @returns {string} Prometheus text payload.
 */
function renderMetrics({ queue, jobsByStatus, cache }) {
    const lines = [];

    lines.push('# HELP slicer_queue_length Slice jobs waiting in the queue.', '# TYPE slicer_queue_length gauge');
    lines.push(`slicer_queue_length ${queue.queueLength}`);
    lines.push('# HELP slicer_active_jobs Slice jobs currently executing.', '# TYPE slicer_active_jobs gauge');
    lines.push(`slicer_active_jobs ${queue.activeJobs}`);

    renderCounterMap(lines, 'slicer_slices_total', 'Finished slice requests by engine, technology and outcome.', sliceCounters);
    renderCounterMap(lines, 'slicer_slice_errors_total', 'Failed slice requests by engine and error code.', sliceErrorCounters);
    renderCounterMap(lines, 'slicer_queue_rejections_total', 'Queue rejections by error code and stage.', queueRejectionCounters);

    lines.push(
        '# HELP slicer_slice_duration_seconds Duration of executed (non-cached) slice pipelines.',
        '# TYPE slicer_slice_duration_seconds histogram'
    );
    DURATION_BUCKETS_SECONDS.forEach((bound, index) => {
        lines.push(`slicer_slice_duration_seconds_bucket{le="${bound}"} ${durationHistogram.buckets[index]}`);
    });
    lines.push(`slicer_slice_duration_seconds_bucket{le="+Inf"} ${durationHistogram.count}`);
    lines.push(`slicer_slice_duration_seconds_sum ${durationHistogram.sum}`);
    lines.push(`slicer_slice_duration_seconds_count ${durationHistogram.count}`);

    lines.push('# HELP slicer_cache_lookups_total Result cache lookups by result.', '# TYPE slicer_cache_lookups_total counter');
    lines.push(`slicer_cache_lookups_total{result="hit"} ${cacheCounters.hit}`);
    lines.push(`slicer_cache_lookups_total{result="miss"} ${cacheCounters.miss}`);
    lines.push('# HELP slicer_cache_entries Entries currently held in the result cache.', '# TYPE slicer_cache_entries gauge');
    lines.push(`slicer_cache_entries ${cache.size}`);

    renderCounterMap(lines, 'slicer_jobs_total', 'Async job status transitions.', jobTransitionCounters);
    lines.push('# HELP slicer_jobs Async jobs currently stored by status.', '# TYPE slicer_jobs gauge');
    for (const [status, count] of Object.entries(jobsByStatus)) {
        lines.push(`slicer_jobs{status="${escapeLabelValue(status)}"} ${count}`);
    }

    return `${lines.join('\n')}\n`;
}

module.exports = {
    recordSliceResult,
    observeSliceDuration,
    recordCacheLookup,
    recordJobTransition,
    recordQueueRejection,
    renderMetrics
};
