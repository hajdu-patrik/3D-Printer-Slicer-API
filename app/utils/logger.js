/**
 * Structured error logger with rolling retention.
 */

const fs = require('node:fs');
const path = require('node:path');
const { LOGS_DIR } = require('../config/paths');

/**
 * Append an error entry to log storage and prune entries older than seven days.
 * @param {{message?: string, stderr?: string, stack?: string, path?: string}} errorData Error payload.
 * @returns {void}
 */
function logError(errorData) {
    const logFile = path.join(LOGS_DIR, 'log.json');
    const now = new Date();

    const newLogEntry = {
        timestamp: now.toISOString(),
        error: errorData.message || 'Unknown Error',
        details: errorData.stderr || errorData.stack || 'No details',
        path: errorData.path || 'N/A'
    };

    let logs = [];

    if (fs.existsSync(logFile)) {
        try {
            const fileContent = fs.readFileSync(logFile, 'utf8');
            logs = JSON.parse(fileContent);
        } catch (err) {
            console.error(`Error reading log file, starting fresh: ${err.message}`);
        }
    }

    logs.push(newLogEntry);

    const sevenDaysAgo = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
    logs = logs.filter((log) => new Date(log.timestamp) > sevenDaysAgo);

    fs.writeFileSync(logFile, JSON.stringify(logs, null, 2));
}

module.exports = {
    logError
};