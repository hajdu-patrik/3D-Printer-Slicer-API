const swaggerDocument = {
    openapi: '3.0.0',
    info: {
        title: '3D Printer Slicer API for FDM and SLA',
        version: '1.1.0',
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
        '/pricing/{technology}/{material}': {
            patch: {
                tags: ['Pricing'],
                summary: 'Update or create material price.',
                description: 'Protected endpoint. Requires x-api-key header. Technology must be FDM or SLA.',
                parameters: [
                    {
                        name: 'technology',
                        in: 'path',
                        required: true,
                        schema: { type: 'string', enum: ['FDM', 'SLA'] }
                    },
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
                                    price: { type: 'number', example: 950 }
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
                summary: 'Delete a material price.',
                description: 'Protected endpoint. Requires x-api-key header. Deleting default is forbidden.',
                parameters: [
                    {
                        name: 'technology',
                        in: 'path',
                        required: true,
                        schema: { type: 'string', enum: ['FDM', 'SLA'] }
                    },
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
        '/slice': {
            post: {
                tags: ['Slicing'],
                summary: 'Upload 2D/3D files and get slicing results with price estimation.',
                description: 'Supported Files: <br>* **3D Model Files:** .stl, .obj, .3mf, .stp, .step, .igs, .iges, .zip <br>* **Image Files:** .jpg, .jpeg, .png, .bmp <br>* **Vector Files:** .dxf, .svg, .eps, .pdf<br>* **ZIP Archives:** Must contain at least one supported file type. The first valid file found will be processed.',
                consumes: ['multipart/form-data'],
                requestBody: {
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
                                        description: 'Layer height **<= 0.05** triggers SLA <br>Layer height **> 0.05** triggers FDM)'
                                    },
                                    material: {
                                        type: 'string',
                                        default: 'PLA',
                                        description: 'Available materials for FDM technology: **PLA**, **ABS**, **PETG**, **TPU** <br>Available materials for SLA technology: **Standard**, **ABS-Like**, **Flexible**'
                                    },
                                    infill: {
                                        type: 'integer',
                                        default: 20,
                                        minimum: 0,
                                        maximum: 100,
                                        description: 'Infill percentage *0% to 100%*. </br>**Only affects FDM print time and material usage**!'
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

module.exports = swaggerDocument;