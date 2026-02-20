/**
 * OpenAPI document for the 3D Printer Slicer API.
 * Contains pricing and slicing endpoint schemas.
 */

const DEFAULT_FDM_MATERIALS = ['PLA', 'ABS', 'PETG', 'TPU'];
const DEFAULT_SLA_MATERIALS = ['Standard', 'ABS-Like', 'Flexible'];

/**
 * Resolve dynamic material enums from current pricing state.
 * @param {{FDM?: Record<string, number>, SLA?: Record<string, number>}} pricing Current pricing map.
 * @returns {{fdmMaterials: string[], slaMaterials: string[], allMaterials: string[]}}
 */
function getMaterialEnums(pricing) {
    const fdmMaterials = Object.keys(pricing?.FDM || {});
    const slaMaterials = Object.keys(pricing?.SLA || {});

    const normalizedFdm = fdmMaterials.length > 0 ? fdmMaterials : DEFAULT_FDM_MATERIALS;
    const normalizedSla = slaMaterials.length > 0 ? slaMaterials : DEFAULT_SLA_MATERIALS;
    const allMaterials = [...new Set([...normalizedFdm, ...normalizedSla])];

    return {
        fdmMaterials: normalizedFdm,
        slaMaterials: normalizedSla,
        allMaterials
    };
}

/**
 * Build OpenAPI document dynamically from current pricing state.
 * @param {{FDM?: Record<string, number>, SLA?: Record<string, number>}} pricing Current pricing map.
 * @returns {object} OpenAPI document object.
 */
function createSwaggerDocument(pricing) {
    const { fdmMaterials, slaMaterials, allMaterials } = getMaterialEnums(pricing);

    return {
        openapi: '3.0.0',
        info: {
            title: '3D Printer Slicer API for FDM and SLA',
            version: '1.2.0',
            description: 'Automated 3D slicing and pricing engine for FDM and SLA technologies.'
        },
        tags: [
            { name: 'Pricing', description: 'Runtime pricing configuration endpoints' },
            { name: 'Slicing', description: 'Slicing and print estimation endpoint' }
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
                                    material: { type: 'string', example: 'DHigh-Templ', description: 'New SLA material name.' },
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
                summary: 'Update or create FDM material price.',
                description: 'Protected endpoint. Requires x-api-key header.',
                parameters: [
                    {
                        name: 'material',
                        in: 'path',
                        required: true,
                        schema: { type: 'string', enum: fdmMaterials }
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
                    400: { description: 'Validation error' },
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
                        schema: { type: 'string', enum: fdmMaterials }
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
                summary: 'Update or create SLA material price.',
                description: 'Protected endpoint. Requires x-api-key header.',
                parameters: [
                    {
                        name: 'material',
                        in: 'path',
                        required: true,
                        schema: { type: 'string', enum: slaMaterials }
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
                    400: { description: 'Validation error' },
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
                        schema: { type: 'string', enum: slaMaterials }
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
        '/slice': {
            post: {
                tags: ['Slicing'],
                summary: 'Upload 2D/3D files and get slicing results with price estimation.',
                description: 'Supported files:\n\n- **3D models:** `.stl`, `.obj`, `.3mf`, `.stp`, `.step`, `.igs`, `.iges`, `.zip`\n- **Images:** `.jpg`, `.jpeg`, `.png`, `.bmp`\n- **Vectors:** `.dxf`, `.svg`, `.eps`, `.pdf`\n- **ZIP archives:** must contain at least one supported file type; first valid file is processed.',
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
                                        description: 'Layer height `<= 0.05` triggers SLA, layer height `> 0.05` triggers FDM.'
                                    },
                                    material: {
                                        type: 'string',
                                        enum: allMaterials,
                                        default: 'PLA',
                                        description: 'FDM materials: `PLA`, `ABS`, `PETG`, `TPU`. SLA materials: `Standard`, `ABS-Like`, `Flexible`.'
                                    },
                                    infill: {
                                        type: 'integer',
                                        default: 20,
                                        minimum: 0,
                                        maximum: 100,
                                        description: 'Infill percentage from `0` to `100`. Only affects FDM print time and material usage.'
                                    }
                                },
                                required: ['choosenFile', 'layerHeight', 'material']
                            }
                        }
                    }
                },
                responses: {
                    200: {
                        description: 'Slicing successful',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        technology: { type: 'string', example: 'FDM' },
                                        hourly_rate: { type: 'number', example: 800 },
                                        stats: {
                                            type: 'object',
                                            properties: {
                                                print_time_readable: { type: 'string', example: '1h 30m' },
                                                estimated_price_huf: { type: 'number', example: 1250 }
                                            }
                                        },
                                        download_url: { type: 'string' }
                                    }
                                }
                            }
                        }
                    },
                    400: { description: 'Bad Request' },
                    500: { description: 'Server Error' }
                }
            }
        }
    }
    };
}

module.exports = createSwaggerDocument;