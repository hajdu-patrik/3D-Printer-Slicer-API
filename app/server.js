/**
 * API server bootstrap for slicing, pricing, health, and Swagger endpoints.
 */

const express = require('express');
const path = require('node:path');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const createSwaggerDocument = require('./docs/swagger-docs');
const pricingRoutes = require('./routes/pricing.routes');
const sliceRoutes = require('./routes/slice.routes');
const systemRoutes = require('./routes/system.routes');
const { PORT } = require('./config/constants');
const { OUTPUT_DIR, ensureRequiredDirectories } = require('./config/paths');
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
app.use(cors());
app.use(express.json());

// Serve static files (like generated STL files)
app.use('/download', express.static(path.join(OUTPUT_DIR)));

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

function setNoCacheHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
}

app.get('/openapi.json', (req, res) => {
    setNoCacheHeaders(res);
    return res.status(200).json(createSwaggerDocument(getPricing()));
});

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
    res.redirect('/docs');
});

// Global error handler
app.listen(PORT, () => {
    console.log(`FDM and SLA Slicer Engine running on port ${PORT}`);
    console.log(`Swagger Docs available at http://localhost:${PORT}/docs`);
});