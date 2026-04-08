/**
 * Child process command execution helpers for slicer/converter calls.
 */

const { execFile } = require('node:child_process');
const { DEFAULTS } = require('../../config/constants');

const DEBUG_COMMAND_LOGS = process.env.DEBUG_COMMAND_LOGS === 'true';
const MAX_LOG_OUTPUT = DEFAULTS.MAX_LOG_OUTPUT;
const COMMAND_TIMEOUT_MS = Number.parseInt(
    process.env.SLICE_COMMAND_TIMEOUT_MS || `${DEFAULTS.SLICE_COMMAND_TIMEOUT_MS}`,
    10
) || DEFAULTS.SLICE_COMMAND_TIMEOUT_MS;

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
 * Execute command with argument array using execFile (no shell interpolation).
 * @param {string} executable Command executable path or name.
 * @param {string[]} args Command arguments array.
 * @returns {Promise<{stdout: string, stderr: string}>} Command output streams.
 */
function runCommand(executable, args = []) {
    return new Promise((resolve, reject) => {
        execFile(executable, args, { maxBuffer: 1024 * 10000, timeout: COMMAND_TIMEOUT_MS }, (error, stdout, stderr) => {
            if (DEBUG_COMMAND_LOGS && stdout) console.log(`[CMD LOG]:\n${truncateLogOutput(stdout)}`);
            if (DEBUG_COMMAND_LOGS && stderr) console.error(`[CMD ERR]:\n${truncateLogOutput(stderr)}`);

            if (error) {
                if (error.killed) {
                    error.message = `The slicing process timed out after ${Math.round(COMMAND_TIMEOUT_MS / 60000)} minutes.`;
                }

                console.error(`[EXEC ERROR] Command failed: ${executable} ${args.join(' ')}`);
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
