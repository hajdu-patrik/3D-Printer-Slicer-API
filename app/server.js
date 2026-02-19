const express = require('express');
const path = require('path');
const cors = require('cors');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./docs/swagger-docs');
const pricingRoutes = require('./routes/pricing.routes');
const sliceRoutes = require('./routes/slice.routes');
const systemRoutes = require('./routes/system.routes');
const { PORT } = require('./config/constants');
const { OUTPUT_DIR, ensureRequiredDirectories } = require('./config/paths');
const { loadPricingFromDisk } = require('./services/pricing.service');

if (!process.env.ADMIN_API_KEY) {
    console.error('[SECURITY] ADMIN_API_KEY is missing. Refusing to start server.');
    process.exit(1);
}

// Initialize required directories and load pricing data
ensureRequiredDirectories();
loadPricingFromDisk();

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

// Serve static files (like generated STL files)
app.use('/download', express.static(path.join(OUTPUT_DIR)));

// Swagger UI setup
app.use(
    '/docs',
    swaggerUi.serve,
    swaggerUi.setup(swaggerDocument, {
        swaggerOptions: {
            docExpansion: 'full',
            defaultModelsExpandDepth: -1
        }
    })
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