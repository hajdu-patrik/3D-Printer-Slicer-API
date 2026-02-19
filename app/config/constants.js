const MAX_BUILD_VOLUMES = {
    FDM: { x: 250, y: 210, z: 210 },
    SLA: { x: 120, y: 120, z: 150 }
};

const EXTENSIONS = {
    direct: ['.stl', '.obj', '.3mf'],
    cad: ['.stp', '.step', '.igs', '.iges'],
    image: ['.png', '.jpg', '.jpeg', '.bmp'],
    vector: ['.dxf', '.svg', '.eps', '.pdf'],
    archive: ['.zip']
};

const PORT = 3000;

module.exports = {
    MAX_BUILD_VOLUMES,
    EXTENSIONS,
    PORT
};