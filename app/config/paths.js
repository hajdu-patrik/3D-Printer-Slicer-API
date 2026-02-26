/**
 * Filesystem path configuration used by the API and converter scripts.
 */

const fs = require('node:fs');
const path = require('node:path');

const APP_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_ROOT = fs.existsSync(path.join(APP_ROOT, 'package.json'))
    ? APP_ROOT
    : path.resolve(APP_ROOT, '..');
const APP_CONFIG_DIR = path.join(APP_ROOT, 'config');
const HELP_FILES_DIR = path.join(WORKSPACE_ROOT, 'input');
const OUTPUT_DIR = path.join(WORKSPACE_ROOT, 'output');
const CONFIGS_DIR = path.join(WORKSPACE_ROOT, 'configs');
const PRICING_FILE = path.join(CONFIGS_DIR, 'pricing.json');

/**
 * Ensure all runtime directories exist before processing requests.
 * @returns {void}
 */
function ensureRequiredDirectories() {
    if (!fs.existsSync(APP_CONFIG_DIR)) fs.mkdirSync(APP_CONFIG_DIR, { recursive: true });
    if (!fs.existsSync(HELP_FILES_DIR)) fs.mkdirSync(HELP_FILES_DIR, { recursive: true });
    if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (!fs.existsSync(CONFIGS_DIR)) fs.mkdirSync(CONFIGS_DIR, { recursive: true });
}

module.exports = {
    APP_ROOT,
    HELP_FILES_DIR,
    OUTPUT_DIR,
    CONFIGS_DIR,
    PRICING_FILE,
    ensureRequiredDirectories
};