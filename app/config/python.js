/**
 * Resolve trusted Python executable path for converter/orientation subprocesses.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Resolve absolute Python executable path.
 * If PYTHON_EXECUTABLE is provided, it must be an existing absolute path.
 * Otherwise, known safe runtime locations are checked.
 * @returns {string} Absolute Python executable path.
 */
function resolvePythonExecutable() {
    const configured = String(process.env.PYTHON_EXECUTABLE || '').trim();
    if (configured) {
        if (!path.isAbsolute(configured)) {
            throw new Error('[SECURITY] PYTHON_EXECUTABLE must be an absolute path.');
        }
        if (!fs.existsSync(configured)) {
            throw new Error(`[SECURITY] PYTHON_EXECUTABLE does not exist: ${configured}`);
        }
        return configured;
    }

    const virtualEnv = String(process.env.VIRTUAL_ENV || '').trim();
    const candidates = [
        virtualEnv ? path.join(virtualEnv, 'bin', 'python3') : '',
        virtualEnv ? path.join(virtualEnv, 'Scripts', 'python.exe') : '',
        '/opt/venv/bin/python3',
        '/usr/local/bin/python3',
        '/usr/bin/python3'
    ];

    const resolved = candidates.find((candidate) => candidate && path.isAbsolute(candidate) && fs.existsSync(candidate));
    if (!resolved) {
        throw new Error('[SECURITY] Could not resolve Python executable to an absolute path. Set PYTHON_EXECUTABLE.');
    }

    return resolved;
}

const PYTHON_EXECUTABLE = resolvePythonExecutable();

module.exports = {
    PYTHON_EXECUTABLE,
    resolvePythonExecutable
};
