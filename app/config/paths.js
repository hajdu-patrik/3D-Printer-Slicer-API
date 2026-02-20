/**
 * Filesystem path configuration used by the API and converter scripts.
 */

const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT = path.resolve(__dirname, '..');
const HELP_FILES_DIR = path.join(APP_ROOT, 'input');
const OUTPUT_DIR = path.join(APP_ROOT, 'output');
const LOGS_DIR = path.join(APP_ROOT, 'logs');
const CONFIGS_DIR = path.join(APP_ROOT, 'configs');
const PRICING_FILE = path.join(CONFIGS_DIR, 'pricing.json');

/**
 * Ensure all runtime directories exist before processing requests.
 * @returns {void}
 */
function ensureRequiredDirectories() {
    if (!fs.existsSync(HELP_FILES_DIR)) fs.mkdirSync(HELP_FILES_DIR, { recursive: true });
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    if (!fs.existsSync(CONFIGS_DIR)) fs.mkdirSync(CONFIGS_DIR, { recursive: true });
}

module.exports = {
    APP_ROOT,
    HELP_FILES_DIR,
    OUTPUT_DIR,
    LOGS_DIR,
    CONFIGS_DIR,
    PRICING_FILE,
    ensureRequiredDirectories
};