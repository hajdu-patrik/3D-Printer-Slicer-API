/**
 * API server bootstrap for slicing, pricing, health, and Swagger endpoints.
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const swaggerUi = require('swagger-ui-express');
require('dotenv').config();
const createSwaggerDocument = require('./docs/swagger-docs');
const pricingRoutes = require('./routes/pricing.routes');
const sliceRoutes = require('./routes/slice.routes');
const systemRoutes = require('./routes/system.routes');
const errorHandler = require('./middleware/errorHandler');
const { PORT, DEFAULTS } = require('./config/constants');
const { ensureRequiredDirectories } = require('./config/paths');
const { loadPricingFromDisk, getPricing } = require('./services/pricing.service');

// Security check for critical environment variables
if (!process.env.ADMIN_API_KEY) {
    console.error('[SECURITY] ADMIN_API_KEY is missing. Refusing to start server.');
    process.exit(1);
}

// Initialize required directories and load pricing data
ensureRequiredDirectories();
loadPricingFromDisk();

/** @type {import('express').Express} */
const app = express();

const standardHelmet = helmet();
const docsHelmet = helmet({
    contentSecurityPolicy: false
});

/**
 * Parse comma-separated origin list from environment.
 * @param {string | undefined} value Raw environment value.
 * @returns {string[]} Normalized origins.
 */
function parseAllowedOrigins(value) {
    return String(value || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean);
}

const adminAllowedOrigins = parseAllowedOrigins(process.env.ADMIN_CORS_ALLOWED_ORIGINS);

/**
 * Resolve dynamic CORS options for public and admin endpoints.
 * Public routes allow all origins. Admin routes require explicit allowlist for browser-origin requests.
 * @param {import('express').Request} req Express request instance.
 * @param {(err: Error | null, options?: import('cors').CorsOptions) => void} callback CORS callback.
 * @returns {void}
 */
function resolveCorsOptions(req, callback) {
    const requestOrigin = req.header('Origin');
    const isAdminRoute = req.path === '/admin' || req.path.startsWith('/admin/');

    if (!isAdminRoute) {
        callback(null, { origin: true });
        return;
    }

    if (!requestOrigin) {
        callback(null, { origin: true });
        return;
    }

    if (adminAllowedOrigins.includes(requestOrigin)) {
        callback(null, { origin: true });
        return;
    }

    const corsError = new Error('Admin CORS origin is not allowed.');
    corsError.code = 'ADMIN_CORS_ORIGIN_NOT_ALLOWED';
    corsError.status = 403;
    callback(corsError);
}

app.use((req, res, next) => {
    const isDocsRoute = req.path === '/openapi.json' || req.path.startsWith('/docs');
    if (isDocsRoute) {
        return docsHelmet(req, res, next);
    }

    return standardHelmet(req, res, next);
});

app.use(cors(resolveCorsOptions));
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || DEFAULTS.JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: false, limit: process.env.FORM_BODY_LIMIT || DEFAULTS.FORM_BODY_LIMIT }));

// Swagger UI setup
const swaggerUiOptions = {
    swaggerOptions: {
        url: '/openapi.json',
        docExpansion: 'none',
        operationsSorter: 'method',
        defaultModelsExpandDepth: -1
    },
    customCss: '.parameters-col_description .parameter__in { display: none !important; }'
};

/**
 * Apply no-cache headers to documentation responses.
 * @param {import('express').Response} res Express response instance.
 * @returns {void}
 */
function setNoCacheHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
}

// API Documentation endpoints
app.get('/openapi.json', (req, res) => {
    setNoCacheHeaders(res);
    return res.status(200).json(createSwaggerDocument(getPricing()));
});

// Serve Swagger UI with custom options and no-cache headers
app.use(
    '/docs',
    swaggerUi.serve,
    (req, res, next) => {
        setNoCacheHeaders(res);
        return swaggerUi.setup(undefined, swaggerUiOptions)(req, res, next);
    }
);
app.get('/', (req, res) => res.redirect('/docs'));

// API Routes
app.use(pricingRoutes);
app.use(sliceRoutes);
app.use(systemRoutes);

// Catch-all for unknown routes
app.all('*', (req, res) => {
    console.warn(`[ROUTING] Unknown or invalid request: ${req.method} ${req.originalUrl}`);
    return res.status(404).json({
        success: false,
        error: 'Route not found.',
        errorCode: 'ROUTE_NOT_FOUND'
    });
});

// Global error handler
app.use(errorHandler);

app.listen(PORT, () => {
    console.log(`FDM and SLA Slicer Engine running on port ${PORT}`);
    console.log(`Swagger Docs available at http://localhost:${PORT}/docs`);
});