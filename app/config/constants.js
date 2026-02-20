/**
 * Shared runtime constants for slicing limits, supported extensions, and API port.
 */

/**
 * Maximum printable build volumes in millimeters by technology.
 * @type {{FDM: {x: number, y: number, z: number}, SLA: {x: number, y: number, z: number}}}
 */
const MAX_BUILD_VOLUMES = {
    FDM: { x: 250, y: 210, z: 210 },
    SLA: { x: 120, y: 120, z: 150 }
};

/**
 * Accepted file extensions grouped by processing pipeline.
 * @type {{direct: string[], cad: string[], image: string[], vector: string[], archive: string[]}}
 */
const EXTENSIONS = {
    direct: ['.stl', '.obj', '.3mf'],
    cad: ['.stp', '.step', '.igs', '.iges'],
    image: ['.png', '.jpg', '.jpeg', '.bmp'],
    vector: ['.dxf', '.svg', '.eps', '.pdf'],
    archive: ['.zip']
};

/**
 * HTTP port used by the Express API.
 * @type {number}
 */
const PORT = 3000;

module.exports = {
    MAX_BUILD_VOLUMES,
    EXTENSIONS,
    PORT
};