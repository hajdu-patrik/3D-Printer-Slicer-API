/**
 * Build OpenAPI document for pricing and slicing endpoints.
 * @param {{FDM?: Record<string, number>, SLA?: Record<string, number>}} pricing Current pricing map.
 * @returns {object} OpenAPI document object.
 */
function createSwaggerDocument(pricing) {
    return {
        openapi: '3.0.0',
        info: {
            title: '3D Printer Slicer API for FDM and SLA',
            version: '3.0.3',
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
                description: 'Returns the full pricing object for FDM and SLA technologies.',
                responses: {
                    200: {
                        description: 'Pricing object retrieved successfully',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        FDM: { type: 'object', additionalProperties: { type: 'number' } },
                                        SLA: { type: 'object', additionalProperties: { type: 'number' } }
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
                                    price: { type: 'number', example: 1200, description: 'Hourly price in HUF.' }
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
                                    price: { type: 'number', example: 2400, description: 'Hourly price in HUF.' }
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
                summary: 'Update existing FDM material price.',
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
                                    price: { type: 'number', example: 1000, description: 'Hourly price in HUF for the specified material and technology.' }
                                },
                                required: ['price']
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
                summary: 'Update existing SLA material price.',
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
                                    price: { type: 'number', example: 1800, description: 'Hourly price in HUF for the specified material and technology.' }
                                },
                                required: ['price']
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
                                        description: 'The file to slice and to estimate price!'
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
                                    printerProfile: {
                                        type: 'string',
                                        description: 'Optional override profile filename from `configs/prusa` (for example `FDM_0.2mm.ini`).'
                                    }
                                },
                                required: ['choosenFile', 'layerHeight', 'material']
                            }
                        }
                    }
                },
                responses: {
                    200: { description: 'Slicing successful' },
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
                                        description: 'The file to slice and to estimate price!'
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
                                    printerProfile: {
                                        type: 'string',
                                        description: 'Optional Orca machine profile filename from `configs/orca` (for example `Bambu_P1S_0.4_nozzle.json`).'
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
                    200: { description: 'Slicing successful' },
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
        }
    }
    };
}

module.exports = createSwaggerDocument;