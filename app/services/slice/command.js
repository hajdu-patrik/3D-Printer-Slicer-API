/**
 * Child process command execution helpers for slicer/converter calls.
 */

const { exec } = require('node:child_process');

const DEBUG_COMMAND_LOGS = process.env.DEBUG_COMMAND_LOGS === 'true';
const MAX_LOG_OUTPUT = 4000;
const COMMAND_TIMEOUT_MS = Number.parseInt(process.env.SLICE_COMMAND_TIMEOUT_MS || '600000', 10) || 600000;

/**
 * Truncate command output for safe/compact logging.
 * @param {string} text Command output text.
 * @returns {string} Original or truncated text.
 */
function truncateLogOutput(text) {
    if (!text || text.length <= MAX_LOG_OUTPUT) return text;
    return `${text.slice(0, MAX_LOG_OUTPUT)}\n...[truncated]`;
}

/**
 * Execute shell command with bounded timeout and buffer.
 * @param {string} cmd Command line to execute.
 * @returns {Promise<{stdout: string, stderr: string}>} Command output streams.
 */
function runCommand(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { maxBuffer: 1024 * 10000, timeout: COMMAND_TIMEOUT_MS }, (error, stdout, stderr) => {
            if (DEBUG_COMMAND_LOGS && stdout) console.log(`[CMD LOG]:\n${truncateLogOutput(stdout)}`);
            if (DEBUG_COMMAND_LOGS && stderr) console.error(`[CMD ERR]:\n${truncateLogOutput(stderr)}`);

            if (error) {
                if (error.killed) {
                    error.message = `The slicing process timed out after ${Math.round(COMMAND_TIMEOUT_MS / 60000)} minutes.`;
                }

                console.error(`[EXEC ERROR] Command failed: ${cmd}`);
                if (stderr || stdout) {
                    console.error(`[EXEC OUTPUT]:\n${truncateLogOutput(stderr || stdout)}`);
                }
                error.stderr = stderr || stdout || error.message;
                return reject(error);
            }
            resolve({ stdout, stderr });
        });
    });
}

module.exports = {
    runCommand
};
