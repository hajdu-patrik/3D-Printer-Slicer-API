/**
 * OpenAPI document for the 3D Printer Slicer API.
 * Contains pricing and slicing endpoint schemas.
 */

/**
 * Build OpenAPI document dynamically from current pricing state.
 * @param {{FDM?: Record<string, number>, SLA?: Record<string, number>}} pricing Current pricing map.
 * @returns {object} OpenAPI document object.
 */
function createSwaggerDocument(pricing) {
    return {
        openapi: '3.0.0',
        info: {
            title: '3D Printer Slicer API for FDM and SLA',
            version: '2.1.1',
            description: 'Automated 3D slicing and pricing engine for FDM and SLA technologies.'
        },
        tags: [
            { name: 'Pricing', description: 'Runtime pricing configuration endpoints' },
            { name: 'Slicing', description: 'Explicit FDM/SLA slicing and print estimation endpoints' }
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
                                    material: { type: 'string', example: 'High-Templ', description: 'New SLA material name.' },
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
                summary: 'Update or create SLA material price.',
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
        '/slice/FDM': {
            post: {
                tags: ['Slicing'],
                summary: 'FDM-only slicing endpoint.',
                description: 'Processes upload strictly as FDM. No technology auto-detection.',
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
                                        description: 'Allowed FDM layer heights only.'
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
                    500: { description: 'Server Error' }
                }
            }
        },
        '/slice/SLA': {
            post: {
                tags: ['Slicing'],
                summary: 'SLA-only slicing endpoint.',
                description: 'Processes upload strictly as SLA. No technology auto-detection.',
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
                                        enum: ['0.025', '0.05'],
                                        default: '0.05',
                                        description: 'Allowed SLA layer heights only.'
                                    },
                                    material: {
                                        type: 'string',
                                        default: 'Standard',
                                        description: 'SLA material key.'
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
                    500: { description: 'Server Error' }
                }
            }
        }
    }
    };
}

module.exports = createSwaggerDocument;