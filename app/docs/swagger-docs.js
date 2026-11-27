/**
 * Build OpenAPI document for pricing and slicing endpoints.
 * @param {{FDM?: Record<string, number>, SLA?: Record<string, number>}} pricing Current pricing map.
 * @returns {object} OpenAPI document object.
 */
function createSwaggerDocument(pricing) {
    const materialCostSchema = {
        type: 'object',
        properties: {
            FDM: { type: 'object', additionalProperties: { type: 'number' }, description: 'HUF per gram.' },
            SLA: { type: 'object', additionalProperties: { type: 'number' }, description: 'HUF per millilitre.' }
        }
    };
    const setupFeeSchema = {
        type: 'object',
        properties: {
            FDM: { type: 'number', description: 'Flat HUF per order.' },
            SLA: { type: 'number', description: 'Flat HUF per order.' }
        }
    };
    const apiKeyHeader = { name: 'x-api-key', in: 'header', required: true, schema: { type: 'string' } };

    const priceBreakdownSchema = {
        type: 'object',
        description: 'Price calculation breakdown. total = ceil((setup_fee + quantity * per_piece) / 10) * 10, per_piece = max(hours, 0.25) * hourly rate + material amount * material cost per unit.',
        properties: {
            time_cost_huf: { type: 'number' },
            material_cost_huf: { type: 'number' },
            setup_fee_huf: { type: 'number' },
            per_piece_huf: { type: 'number' },
            quantity: { type: 'integer' },
            total_huf: { type: 'number' },
            material_unit: { type: 'string', enum: ['g', 'ml'] },
            material_cost_per_unit: { type: 'number' }
        }
    };

    const statsSchema = {
        type: 'object',
        properties: {
            print_time_seconds: { type: 'number' },
            print_time_readable: { type: 'string' },
            print_time_source: { type: 'string', enum: ['slicer', 'estimate'], description: '`slicer` when read from slicer output, `estimate` when the heuristic fallback was used.' },
            material_used_m: { type: 'number' },
            material_used_g: { type: 'number', description: 'FDM filament weight in grams.' },
            material_used_ml: { type: 'number', description: 'SLA resin volume in millilitres.' },
            object_height_mm: { type: 'number' },
            estimated_price_huf: { type: 'number' }
        }
    };

    const sliceSuccessSchema = {
        type: 'object',
        properties: {
            success: { type: 'boolean', example: true },
            cache_hit: { type: 'boolean', description: 'True when the slicing result was served from the result cache (price is recomputed, no new output file is created).' },
            slicer_engine: { type: 'string', enum: ['prusa', 'orca'] },
            technology: { type: 'string', enum: ['FDM', 'SLA'] },
            material: { type: 'string' },
            infill: { type: 'string', example: '20%' },
            profiles: { type: 'object', additionalProperties: { type: 'string' } },
            model_transform: { type: 'object' },
            model_geometry: {
                type: 'object',
                description: 'Geometry of the final (oriented and transformed) model. The printed material mass is stats.material_used_g.',
                properties: {
                    volume_cm3: { type: 'number', nullable: true, description: 'Solid model volume; null when the mesh is not watertight.' },
                    surface_area_cm2: { type: 'number', nullable: true },
                    is_watertight: { type: 'boolean', nullable: true },
                    triangle_count: { type: 'integer', nullable: true }
                }
            },
            preview: {
                type: 'object',
                description: 'Present only when includePreview=true and rendering succeeded.',
                properties: {
                    format: { type: 'string', example: 'png' },
                    width: { type: 'integer', example: 512 },
                    height: { type: 'integer', example: 512 },
                    data_base64: { type: 'string', description: 'Isometric PNG preview of the model as sliced.' }
                }
            },
            build_volume_limits_mm: { type: 'object' },
            hourly_rate: { type: 'number' },
            quantity: { type: 'integer', example: 1 },
            price_breakdown: priceBreakdownSchema,
            stats: statsSchema
        }
    };

    const jobAcceptedSchema = {
        type: 'object',
        properties: {
            success: { type: 'boolean', example: true },
            jobId: { type: 'string', format: 'uuid' },
            status: { type: 'string', example: 'queued' },
            statusUrl: { type: 'string', example: '/slice/jobs/00000000-0000-4000-8000-000000000000' }
        }
    };

    const autoOrientField = {
        type: 'boolean',
        default: true,
        description: 'Enable automatic orientation optimization. Invalid value returns `INVALID_AUTO_ORIENT`.'
    };
    const quantityField = {
        type: 'integer',
        default: 1,
        minimum: 1,
        maximum: 1000,
        description: 'Number of pieces to price (pricing only; not part of the result cache key). Invalid value returns `INVALID_QUANTITY`.'
    };
    const includePreviewField = {
        type: 'boolean',
        default: false,
        description: 'Add an isometric PNG preview (base64) of the model as sliced to the response. Invalid value returns `INVALID_INCLUDE_PREVIEW`.'
    };

    const document = {
        openapi: '3.0.0',
        info: {
            title: '3D Printer Slicer API for FDM and SLA',
            version: '3.3.0',
            description: 'Automated 3D slicing and pricing engine for FDM and SLA technologies.'
        },
        tags: [
            { name: 'Pricing', description: 'Runtime pricing configuration endpoints' },
            { name: 'Slicing', description: 'Explicit FDM/SLA slicing and print estimation endpoints' },
            { name: 'Admin', description: 'Protected operational endpoints requiring x-api-key' }
        ],
        paths: {
        '/pricing': {
            get: {
                tags: ['Pricing'],
                summary: 'Get current pricing configuration.',
                description: 'Returns the full pricing object: hourly rates for FDM and SLA plus the optional materialCost (HUF/g FDM, HUF/ml SLA) and setupFee (flat HUF per order) sections.',
                responses: {
                    200: {
                        description: 'Pricing object retrieved successfully',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        FDM: { type: 'object', additionalProperties: { type: 'number' } },
                                        SLA: { type: 'object', additionalProperties: { type: 'number' } },
                                        materialCost: materialCostSchema,
                                        setupFee: setupFeeSchema
                                    }
                                }
                            }
                        }
                    }
                }
            }
        },
        '/pricing/FDM': {
            post: {
                tags: ['Pricing'],
                summary: 'Create a new FDM material.',
                description: 'Protected endpoint. Requires x-api-key header.',
                parameters: [
                    {
                        name: 'x-api-key',
                        in: 'header',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    material: { type: 'string', example: 'ASA', description: 'New FDM material name.' },
                                    price: { type: 'number', example: 1200, description: 'Hourly price in HUF.' },
                                    materialCostPerUnit: { type: 'number', example: 14, description: 'Optional material cost in HUF per gram (FDM).' }
                                },
                                required: ['material', 'price']
                            }
                        }
                    }
                },
                responses: {
                    201: { description: 'Material created successfully' },
                    400: { description: 'Validation error' },
                    401: { description: 'Unauthorized' },
                    409: { description: 'Material already exists' },
                    500: { description: 'Persistence error' }
                }
            }
        },
        '/pricing/SLA': {
            post: {
                tags: ['Pricing'],
                summary: 'Create a new SLA material.',
                description: 'Protected endpoint. Requires x-api-key header.',
                parameters: [
                    {
                        name: 'x-api-key',
                        in: 'header',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    material: { type: 'string', example: 'High-Temp', description: 'New SLA material name.' },
                                    price: { type: 'number', example: 2400, description: 'Hourly price in HUF.' },
                                    materialCostPerUnit: { type: 'number', example: 50, description: 'Optional material cost in HUF per millilitre (SLA).' }
                                },
                                required: ['material', 'price']
                            }
                        }
                    }
                },
                responses: {
                    201: { description: 'Material created successfully' },
                    400: { description: 'Validation error' },
                    401: { description: 'Unauthorized' },
                    409: { description: 'Material already exists' },
                    500: { description: 'Persistence error' }
                }
            }
        },
        '/pricing/FDM/{material}': {
            patch: {
                tags: ['Pricing'],
                summary: 'Update existing FDM material price and/or material cost.',
                description: 'Protected endpoint. Requires x-api-key header.',
                parameters: [
                    {
                        name: 'material',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    },
                    {
                        name: 'x-api-key',
                        in: 'header',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    price: { type: 'number', example: 1000, description: 'Hourly price in HUF for the specified material and technology. Optional when materialCostPerUnit is provided.' },
                                    materialCostPerUnit: { type: 'number', example: 14, description: 'Optional material cost in HUF per gram (FDM).' }
                                },
                                description: 'At least one of price or materialCostPerUnit is required.'
                            }
                        }
                    }
                },
                responses: {
                    200: { description: 'Price updated successfully' },
                    400: { description: 'Validation error (including non-existing material)' },
                    401: { description: 'Unauthorized' },
                    500: { description: 'Persistence error' }
                }
            },
            delete: {
                tags: ['Pricing'],
                summary: 'Delete an FDM material price.',
                description: 'Protected endpoint. Requires x-api-key header. Deleting default is forbidden.',
                parameters: [
                    {
                        name: 'material',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    },
                    {
                        name: 'x-api-key',
                        in: 'header',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    200: { description: 'Material deleted successfully' },
                    400: { description: 'Validation error (including default deletion attempt)' },
                    401: { description: 'Unauthorized' },
                    404: { description: 'Material not found' },
                    500: { description: 'Persistence error' }
                }
            }
        },
        '/pricing/SLA/{material}': {
            patch: {
                tags: ['Pricing'],
                summary: 'Update existing SLA material price and/or material cost.',
                description: 'Protected endpoint. Requires x-api-key header.',
                parameters: [
                    {
                        name: 'material',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    },
                    {
                        name: 'x-api-key',
                        in: 'header',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    price: { type: 'number', example: 1800, description: 'Hourly price in HUF for the specified material and technology. Optional when materialCostPerUnit is provided.' },
                                    materialCostPerUnit: { type: 'number', example: 14, description: 'Optional material cost in HUF per millilitre (SLA).' }
                                },
                                description: 'At least one of price or materialCostPerUnit is required.'
                            }
                        }
                    }
                },
                responses: {
                    200: { description: 'Price updated successfully' },
                    400: { description: 'Validation error (including non-existing material)' },
                    401: { description: 'Unauthorized' },
                    500: { description: 'Persistence error' }
                }
            },
            delete: {
                tags: ['Pricing'],
                summary: 'Delete an SLA material price.',
                description: 'Protected endpoint. Requires x-api-key header. Deleting default is forbidden.',
                parameters: [
                    {
                        name: 'material',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' }
                    },
                    {
                        name: 'x-api-key',
                        in: 'header',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    200: { description: 'Material deleted successfully' },
                    400: { description: 'Validation error (including default deletion attempt)' },
                    401: { description: 'Unauthorized' },
                    404: { description: 'Material not found' },
                    500: { description: 'Persistence error' }
                }
            }
        },
        '/pricing/{technology}/setup-fee': {
            put: {
                tags: ['Pricing'],
                summary: 'Set the flat per-order setup fee for a technology.',
                description: 'Protected endpoint. Requires x-api-key header.',
                parameters: [
                    { name: 'technology', in: 'path', required: true, schema: { type: 'string', enum: ['FDM', 'SLA'] } },
                    apiKeyHeader
                ],
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    setupFee: { type: 'number', example: 500, minimum: 0, description: 'Flat setup fee in HUF per order.' }
                                },
                                required: ['setupFee']
                            }
                        }
                    }
                },
                responses: {
                    200: { description: 'Setup fee updated successfully' },
                    400: { description: 'Validation error' },
                    401: { description: 'Unauthorized' },
                    500: { description: 'Persistence error' }
                }
            }
        },
        '/prusa/slice/jobs': {
            post: {
                tags: ['Slicing'],
                summary: 'Submit an asynchronous PrusaSlicer job.',
                description: 'Same multipart fields and validation as POST /prusa/slice, but returns 202 immediately with a jobId. Poll GET /slice/jobs/{jobId} for the result. Validation errors and queue rejections (SLICE_QUEUE_FULL, SLICE_QUEUE_CLIENT_LIMIT) are returned synchronously.',
                requestBody: null,
                responses: {
                    202: { description: 'Job accepted', content: { 'application/json': { schema: jobAcceptedSchema } } },
                    400: { description: 'Bad Request' },
                    429: { description: 'Rate limit or per-client queue limit exceeded' },
                    503: { description: 'Queue full or job store full (JOB_STORE_FULL)' }
                }
            }
        },
        '/orca/slice/jobs': {
            post: {
                tags: ['Slicing'],
                summary: 'Submit an asynchronous OrcaSlicer job.',
                description: 'Same multipart fields and validation as POST /orca/slice, but returns 202 immediately with a jobId. Poll GET /slice/jobs/{jobId} for the result.',
                requestBody: null,
                responses: {
                    202: { description: 'Job accepted', content: { 'application/json': { schema: jobAcceptedSchema } } },
                    400: { description: 'Bad Request' },
                    429: { description: 'Rate limit or per-client queue limit exceeded' },
                    503: { description: 'Queue full or job store full (JOB_STORE_FULL)' }
                }
            }
        },
        '/slice/jobs/{jobId}': {
            get: {
                tags: ['Slicing'],
                summary: 'Get asynchronous slice job status.',
                description: 'Status is one of queued, processing, done (with result) or failed (with error.status and error.body). Rate limited per IP (default 60 requests / 60 seconds, JOB_POLL_RATE_LIMIT_EXCEEDED).',
                parameters: [
                    { name: 'jobId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }
                ],
                responses: {
                    200: {
                        description: 'Job status',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string', enum: ['queued', 'processing', 'done', 'failed'] },
                                        result: sliceSuccessSchema,
                                        error: {
                                            type: 'object',
                                            properties: {
                                                status: { type: 'integer' },
                                                body: { type: 'object' }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    400: { description: 'Invalid job id (INVALID_JOB_ID)' },
                    404: { description: 'Job not found or expired (JOB_NOT_FOUND)' },
                    429: { description: 'Polling rate limit exceeded (JOB_POLL_RATE_LIMIT_EXCEEDED)' }
                }
            }
        },
        '/metrics': {
            get: {
                tags: ['Admin'],
                summary: 'Prometheus text-format metrics.',
                description: 'Protected endpoint. Requires x-api-key header. Exposes slice, queue, job and cache metrics.',
                parameters: [apiKeyHeader],
                responses: {
                    200: { description: 'Prometheus exposition format', content: { 'text/plain': { schema: { type: 'string' } } } },
                    401: { description: 'Unauthorized' },
                    429: { description: 'Admin rate limit exceeded' }
                }
            }
        },
        '/prusa/slice': {
            post: {
                tags: ['Slicing'],
                summary: 'PrusaSlicer endpoint (FDM/SLA auto mode by layer height).',
                description: 'Uses PrusaSlicer. Automatically chooses technology by layer height: SLA for 0.025/0.05, FDM for 0.1/0.2/0.3. Supports optional size/scale/rotation preprocessing and printer profile based build-volume validation.',
                consumes: ['multipart/form-data'],
                requestBody: {
                    required: true,
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                properties: {
                                    choosenFile: {
                                        type: 'string',
                                        format: 'binary',
                                        description: 'Supported model/CAD file to slice and estimate price.'
                                    },
                                    layerHeight: {
                                        type: 'string',
                                        enum: ['0.025', '0.05', '0.1', '0.2', '0.3'],
                                        default: '0.2',
                                        description: 'Allowed layer heights. Determines FDM or SLA technology for PrusaSlicer.'
                                    },
                                    material: {
                                        type: 'string',
                                        default: 'PLA',
                                        description: 'Material key for selected technology (FDM or SLA). Invalid cross-technology pairing returns 4xx.' 
                                    },
                                    infill: {
                                        type: 'integer',
                                        default: 20,
                                        minimum: 0,
                                        maximum: 100,
                                        description: 'Infill percentage from `0` to `100` (used for FDM).' 
                                    },
                                    sizeUnit: {
                                        type: 'string',
                                        enum: ['mm', 'inch'],
                                        default: 'mm',
                                        description: 'Unit for targetSizeX/Y/Z values.'
                                    },
                                    keepProportions: {
                                        type: 'boolean',
                                        default: true,
                                        description: 'If true, target dimensions are interpreted with locked aspect ratio.'
                                    },
                                    targetSizeX: {
                                        type: 'number',
                                        description: 'Optional target X size in the selected sizeUnit.'
                                    },
                                    targetSizeY: {
                                        type: 'number',
                                        description: 'Optional target Y size in the selected sizeUnit.'
                                    },
                                    targetSizeZ: {
                                        type: 'number',
                                        description: 'Optional target Z size in the selected sizeUnit.'
                                    },
                                    scalePercent: {
                                        type: 'number',
                                        description: 'Optional uniform scale in percent. Cannot be combined with targetSizeX/Y/Z.'
                                    },
                                    rotationX: {
                                        type: 'number',
                                        default: 0,
                                        description: 'Optional rotation around X axis in degrees.'
                                    },
                                    rotationY: {
                                        type: 'number',
                                        default: 0,
                                        description: 'Optional rotation around Y axis in degrees.'
                                    },
                                    rotationZ: {
                                        type: 'number',
                                        default: 0,
                                        description: 'Optional rotation around Z axis in degrees.'
                                    },
                                    autoOrient: autoOrientField,
                                    quantity: quantityField,
                                    includePreview: includePreviewField,
                                    printerProfile: {
                                        type: 'string',
                                        description: 'Optional override profile filename from `configs/prusa` (for example `FDM_0.2mm.ini`, or `MK4_FDM_0.1mm.ini` / `MK4_FDM_0.2mm.ini` / `MK4_FDM_0.3mm.ini` for the Original Prusa MK4).'
                                    }
                                },
                                required: ['choosenFile', 'layerHeight', 'material']
                            }
                        }
                    }
                },
                responses: {
                    200: { description: 'Slicing successful', content: { 'application/json': { schema: sliceSuccessSchema } } },
                    429: { description: 'Rate limit exceeded or per-client queue limit reached' },
                    503: { description: 'Slice queue full or queue wait timeout' },
                    400: { description: 'Bad Request' },
                    422: { description: 'Model or profile validation failed (for example out-of-printer-bounds model).' },
                    500: { description: 'Server Error' }
                }
            }
        },
        '/orca/slice': {
            post: {
                tags: ['Slicing'],
                summary: 'OrcaSlicer endpoint (FDM-only).',
                description: 'Uses OrcaSlicer and always processes as FDM, including pricing. Supports optional size/scale/rotation preprocessing, machine/process profile overrides, and profile-based build-volume validation.',
                consumes: ['multipart/form-data'],
                requestBody: {
                    required: true,
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                properties: {
                                    choosenFile: {
                                        type: 'string',
                                        format: 'binary',
                                        description: 'Supported model/CAD file to slice and estimate price.'
                                    },
                                    layerHeight: {
                                        type: 'string',
                                        enum: ['0.1', '0.2', '0.3'],
                                        default: '0.2',
                                        description: 'Requested FDM layer height profile for OrcaSlicer.'
                                    },
                                    material: {
                                        type: 'string',
                                        default: 'PLA',
                                        description: 'FDM material key.'
                                    },
                                    infill: {
                                        type: 'integer',
                                        default: 20,
                                        minimum: 0,
                                        maximum: 100,
                                        description: 'Infill percentage from `0` to `100`.'
                                    },
                                    sizeUnit: {
                                        type: 'string',
                                        enum: ['mm', 'inch'],
                                        default: 'mm',
                                        description: 'Unit for targetSizeX/Y/Z values.'
                                    },
                                    keepProportions: {
                                        type: 'boolean',
                                        default: true,
                                        description: 'If true, target dimensions are interpreted with locked aspect ratio.'
                                    },
                                    targetSizeX: {
                                        type: 'number',
                                        description: 'Optional target X size in the selected sizeUnit.'
                                    },
                                    targetSizeY: {
                                        type: 'number',
                                        description: 'Optional target Y size in the selected sizeUnit.'
                                    },
                                    targetSizeZ: {
                                        type: 'number',
                                        description: 'Optional target Z size in the selected sizeUnit.'
                                    },
                                    scalePercent: {
                                        type: 'number',
                                        description: 'Optional uniform scale in percent. Cannot be combined with targetSizeX/Y/Z.'
                                    },
                                    rotationX: {
                                        type: 'number',
                                        default: 0,
                                        description: 'Optional rotation around X axis in degrees.'
                                    },
                                    rotationY: {
                                        type: 'number',
                                        default: 0,
                                        description: 'Optional rotation around Y axis in degrees.'
                                    },
                                    rotationZ: {
                                        type: 'number',
                                        default: 0,
                                        description: 'Optional rotation around Z axis in degrees.'
                                    },
                                    autoOrient: autoOrientField,
                                    quantity: quantityField,
                                    includePreview: includePreviewField,
                                    printerProfile: {
                                        type: 'string',
                                        description: 'Optional Orca machine profile filename from `configs/orca` (`Bambu_P1S_0.4_nozzle.json`, `Bambu_A1_0.4_nozzle.json`, `Bambu_A1_mini_0.4_nozzle.json`).'
                                    },
                                    processProfile: {
                                        type: 'string',
                                        description: 'Optional Orca process profile filename from `configs/orca` (for example `FDM_0.2mm.json`).'
                                    }
                                },
                                required: ['choosenFile', 'layerHeight', 'material']
                            }
                        }
                    }
                },
                responses: {
                    200: { description: 'Slicing successful', content: { 'application/json': { schema: sliceSuccessSchema } } },
                    429: { description: 'Rate limit exceeded or per-client queue limit reached' },
                    503: { description: 'Slice queue full or queue wait timeout' },
                    400: { description: 'Bad Request' },
                    422: { description: 'Model or profile validation failed (for example out-of-printer-bounds model).' },
                    500: { description: 'Server Error' }
                }
            }
        },
        '/admin/output-files': {
            get: {
                tags: ['Admin'],
                summary: 'List generated files under output directory.',
                description: 'Protected endpoint. Requires x-api-key header.',
                parameters: [
                    {
                        name: 'x-api-key',
                        in: 'header',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    200: {
                        description: 'Output files listed successfully',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean', example: true },
                                        message: { type: 'string', example: 'Output directory is empty.' },
                                        total: { type: 'integer', example: 12 },
                                        files: {
                                            type: 'array',
                                            items: {
                                                type: 'object',
                                                properties: {
                                                    fileName: { type: 'string', example: 'Cactus-output-1772126605107.gcode' },
                                                    downloadUrl: { type: 'string', example: '/admin/download/Cactus-output-1772126605107.gcode' },
                                                    sizeBytes: { type: 'integer', example: 409600 },
                                                    createdAt: { type: 'string', format: 'date-time' },
                                                    modifiedAt: { type: 'string', format: 'date-time' }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    401: { description: 'Unauthorized' },
                    503: { description: 'Admin API key is not configured on server' },
                    500: { description: 'Failed to list output files' }
                }
            }
        },
        '/admin/download/{fileName}': {
            get: {
                tags: ['Admin'],
                summary: 'Download a generated output file from output directory.',
                description:
                    'Protected endpoint. Requires x-api-key header. Only .gcode and .sl1 files are allowed for direct file download. Use `ALL` as fileName to download every generated output file in a ZIP archive within MAX_ZIP_ENTRIES and MAX_ZIP_UNCOMPRESSED_BYTES limits.',
                parameters: [
                    {
                        name: 'fileName',
                        in: 'path',
                        required: true,
                        schema: { type: 'string' },
                        description: 'Output file name (for example `Camera-output-1777587007258.gcode`) or the special token `ALL` for ZIP download.'
                    },
                    {
                        name: 'x-api-key',
                        in: 'header',
                        required: true,
                        schema: { type: 'string' }
                    }
                ],
                responses: {
                    200: {
                        description: 'Binary output stream (`application/octet-stream` for single file or `application/zip` for `ALL` token).',
                        content: {
                            'application/octet-stream': {
                                schema: {
                                    type: 'string',
                                    format: 'binary'
                                }
                            },
                            'application/zip': {
                                schema: {
                                    type: 'string',
                                    format: 'binary'
                                }
                            }
                        }
                    },
                    400: { description: 'Invalid file name/path' },
                    401: { description: 'Unauthorized' },
                    404: { description: 'Output file not found' },
                    413: { description: 'Bulk ZIP download exceeds configured MAX_ZIP_ENTRIES or MAX_ZIP_UNCOMPRESSED_BYTES limits' },
                    503: { description: 'Admin API key is not configured on server' },
                    500: { description: 'Failed to download output file' }
                }
            }
        }
    }
    };

    // Async job endpoints share the multipart contract of the synchronous endpoints.
    document.paths['/prusa/slice/jobs'].post.requestBody = document.paths['/prusa/slice'].post.requestBody;
    document.paths['/orca/slice/jobs'].post.requestBody = document.paths['/orca/slice'].post.requestBody;

    return document;
}

module.exports = createSwaggerDocument;