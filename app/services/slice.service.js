const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { MAX_BUILD_VOLUMES, EXTENSIONS } = require('../config/constants');
const { OUTPUT_DIR, CONFIGS_DIR } = require('../config/paths');
const { logError } = require('../utils/logger');
const { getRate } = require('./pricing.service');

function runCommand(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, { maxBuffer: 1024 * 10000, timeout: 600000 }, (error, stdout, stderr) => {
            if (stdout) console.log(`[CMD LOG]:\n${stdout}`);
            if (stderr) console.error(`[CMD ERR]:\n${stderr}`);

            if (error) {
                if (error.killed) {
                    error.message = 'The slicing process timed out after 10 minutes.';
                }

                console.error(`[EXEC ERROR] Command failed: ${cmd}`);
                error.stderr = stderr || stdout || error.message;
                return reject(error);
            }
            resolve({ stdout, stderr });
        });
    });
}

async function getModelInfo(filePath) {
    try {
        const { stdout } = await runCommand(`prusa-slicer --info "${filePath}"`);
        let x = 0, y = 0, z = 0;

        const matchX = stdout.match(/size_x\s*=\s*([0-9.]+)/i);
        const matchY = stdout.match(/size_y\s*=\s*([0-9.]+)/i);
        const matchZ = stdout.match(/size_z\s*=\s*([0-9.]+)/i);

        if (matchX) x = parseFloat(matchX[1]);
        if (matchY) y = parseFloat(matchY[1]);
        if (matchZ) z = parseFloat(matchZ[1]);

        return { x, y, z, height_mm: z };
    } catch (err) {
        console.warn(`[WARN] Could not get model info: ${err.message}`);
        return { x: 0, y: 0, z: 0, height_mm: 0 };
    }
}

function parseTimeString(timeStr) {
    let seconds = 0;
    if (/^\d+$/.test(timeStr)) return parseInt(timeStr);
    const days = timeStr.match(/(\d+)d/);
    const hours = timeStr.match(/(\d+)h/);
    const mins = timeStr.match(/(\d+)m/);
    const secs = timeStr.match(/(\d+)s/);
    if (days) seconds += parseInt(days[1]) * 86400;
    if (hours) seconds += parseInt(hours[1]) * 3600;
    if (mins) seconds += parseInt(mins[1]) * 60;
    if (secs) seconds += parseInt(secs[1]);
    return seconds;
}

async function parseOutputDetailed(filePath, technology, layerHeight, knownHeight) {
    const stats = {
        print_time_seconds: 0,
        print_time_readable: 'Unknown',
        material_used_m: 0,
        object_height_mm: knownHeight || 0,
        estimated_price_huf: 0
    };

    if (technology === 'FDM' && fs.existsSync(filePath)) {
        try {
            const content = fs.readFileSync(filePath, 'utf8');
            const m73Match = content.match(/M73 P0 R(\d+)/);
            if (m73Match) stats.print_time_seconds = parseInt(m73Match[1]) * 60;

            if (stats.print_time_seconds === 0) {
                const timeMatch = content.match(/; estimated printing time = (.*)/i);
                if (timeMatch) {
                    stats.print_time_readable = timeMatch[1].trim();
                    stats.print_time_seconds = parseTimeString(stats.print_time_readable);
                }
            }

            const filMatch = content.match(/; filament used \[mm\] = ([0-9.]+)/i);
            if (filMatch) stats.material_used_m = parseFloat(filMatch[1]) / 1000;
        } catch (e) {
            console.error('[PARSER ERROR]', e.message);
        }
    }

    if (technology === 'SLA' && stats.print_time_seconds === 0 && stats.object_height_mm > 0) {
        const totalLayers = Math.ceil(stats.object_height_mm / Math.max(parseFloat(layerHeight), 0.025));
        const secondsPerLayer = 11;
        const baseTime = 120;
        stats.print_time_seconds = baseTime + (totalLayers * secondsPerLayer);
    }

    if (stats.print_time_seconds > 0) {
        const h = Math.floor(stats.print_time_seconds / 3600);
        const m = Math.floor((stats.print_time_seconds % 3600) / 60);
        stats.print_time_readable = `${h}h ${m}m ${technology === 'SLA' ? '(Est.)' : ''}`;
    }

    return stats;
}

function cleanupFiles(fileList) {
    fileList.forEach((file) => {
        if (file && fs.existsSync(file)) {
            try {
                if (fs.lstatSync(file).isDirectory()) {
                    fs.rmSync(file, { recursive: true, force: true });
                    console.log(`[CLEANUP] Deleted directory: ${file}`);
                } else {
                    fs.unlinkSync(file);
                    console.log(`[CLEANUP] Deleted file: ${file}`);
                }
            } catch (err) {
                console.error(`[CLEANUP ERROR] Could not delete ${file}: ${err.message}`);
            }
        }
    });
}

async function handleSlice(req, res) {
    const file = req.files ? req.files.find((f) => f.fieldname === 'choosenFile') : null;
    if (!file) return res.status(400).json({ error: 'No file uploaded (use key "choosenFile")' });

    let inputFile = file.path;
    const originalName = file.originalname.toLowerCase();
    const originalExt = path.extname(originalName);

    const tempFileWithExt = inputFile + originalExt;
    fs.renameSync(inputFile, tempFileWithExt);
    inputFile = tempFileWithExt;

    const filesCleanupList = [inputFile];

    const layerHeight = parseFloat(req.body.layerHeight || '0.2');
    const material = req.body.material || 'PLA';
    const depth = parseFloat(req.body.depth || '2.0');

    let infillRaw = parseInt(req.body.infill);
    if (isNaN(infillRaw)) infillRaw = 20;
    infillRaw = Math.max(0, Math.min(100, infillRaw));
    const infillPercentage = `${infillRaw}%`;

    const technology = layerHeight <= 0.05 ? 'SLA' : 'FDM';

    console.log(`[INFO] Request: ${originalName} | Tech: ${technology} | Mat: ${material}`);

    try {
        let processableFile = inputFile;
        let currentExt = path.extname(processableFile).toLowerCase();
        let finalStlPath = processableFile;
        let unzipDir = null;

        if (currentExt === '.zip') {
            console.log('[INFO] Extracting ZIP...');
            unzipDir = path.join(path.dirname(inputFile), `unzip_${Date.now()}`);
            if (!fs.existsSync(unzipDir)) fs.mkdirSync(unzipDir);

            filesCleanupList.push(unzipDir);

            await runCommand(`unzip -o "${inputFile}" -d "${unzipDir}"`);

            const files = fs.readdirSync(unzipDir);
            const supportedExts = [...EXTENSIONS.direct, ...EXTENSIONS.cad, ...EXTENSIONS.image, ...EXTENSIONS.vector];

            const foundFile = files.find((f) => supportedExts.includes(path.extname(f).toLowerCase()));

            if (!foundFile) throw new Error('ZIP does not contain a supported 3D/Image/Vector file.');

            console.log(`[INFO] Found in ZIP: ${foundFile}`);
            processableFile = path.join(unzipDir, foundFile);
            currentExt = path.extname(processableFile).toLowerCase();
        }

        if (EXTENSIONS.image.includes(currentExt)) {
            console.log(`[INFO] Converting Image to STL (Depth: ${depth}mm)...`);
            finalStlPath = processableFile + '.stl';
            filesCleanupList.push(finalStlPath);
            await runCommand(`python3 img2stl.py "${processableFile}" "${finalStlPath}" ${depth}`);
        } else if (EXTENSIONS.vector.includes(currentExt)) {
            console.log(`[INFO] Converting Vector to STL (Depth: ${depth}mm)...`);
            finalStlPath = processableFile + '.stl';
            filesCleanupList.push(finalStlPath);
            await runCommand(`python3 vector2stl.py "${processableFile}" "${finalStlPath}" ${depth}`);
        } else if (['.obj', '.3mf', '.ply'].includes(currentExt)) {
            console.log('[INFO] Converting Mesh to STL...');
            finalStlPath = processableFile + '.stl';
            filesCleanupList.push(finalStlPath);
            await runCommand(`python3 mesh2stl.py "${processableFile}" "${finalStlPath}"`);
        } else if (EXTENSIONS.cad.includes(currentExt)) {
            console.log('[INFO] Converting CAD to STL...');
            finalStlPath = processableFile + '.stl';
            filesCleanupList.push(finalStlPath);
            await runCommand(`python3 cad2stl.py "${processableFile}" "${finalStlPath}"`);
        } else if (currentExt === '.stl') {
            finalStlPath = processableFile;
        }

        processableFile = finalStlPath;

        console.log(`[INFO] Optimizing orientation for ${technology}...`);

        const orientedStlPath = processableFile.replace('.stl', '_oriented.stl');

        try {
            await runCommand(`python3 orient.py "${processableFile}" "${orientedStlPath}" ${technology}`);

            if (fs.existsSync(orientedStlPath)) {
                filesCleanupList.push(orientedStlPath);
                processableFile = orientedStlPath;
            }
        } catch (orientErr) {
            console.warn(`[WARN] Orientation optimization failed, proceeding with original. Error: ${orientErr.message}`);
        }

        const modelInfo = await getModelInfo(processableFile);

        const limits = MAX_BUILD_VOLUMES[technology];
        if (modelInfo.x > limits.x || modelInfo.y > limits.y || modelInfo.z > limits.z) {
            throw new Error(`MODEL_TOO_LARGE|The model size (${modelInfo.x.toFixed(1)} x ${modelInfo.y.toFixed(1)} x ${modelInfo.z.toFixed(1)} mm) exceeds the maximum build volume for ${technology} (${limits.x} x ${limits.y} x ${limits.z} mm).`);
        }

        const outputFilename = `output-${Date.now()}.${technology === 'SLA' ? 'sl1' : 'gcode'}`;
        const outputPath = path.join(OUTPUT_DIR, outputFilename);
        const configFile = path.join(CONFIGS_DIR, `${technology}_${layerHeight}mm.ini`);

        if (!fs.existsSync(configFile)) throw new Error(`Missing config file: ${path.basename(configFile)}`);

        console.log(`[INFO] Slicing with ${path.basename(configFile)}...`);

        let slicerArgs = `--load "${configFile}"`;

        slicerArgs += ' --center 100,100';

        if (technology === 'SLA') {
            slicerArgs += ` --export-sla --output "${outputPath}"`;
        } else {
            slicerArgs += ' --support-material --support-material-auto';
            slicerArgs += ` --gcode-flavor marlin --export-gcode --output "${outputPath}" --fill-density ${infillPercentage}`;
        }

        await runCommand(`prusa-slicer ${slicerArgs} "${processableFile}"`);

        const stats = await parseOutputDetailed(outputPath, technology, layerHeight, modelInfo.height_mm);

        const hourlyRate = getRate(technology, material);
        const printHours = stats.print_time_seconds / 3600;

        const calcHours = Math.max(printHours, 0.25);
        const totalPrice = Math.ceil((calcHours * hourlyRate) / 10) * 10;

        cleanupFiles(filesCleanupList);

        res.json({
            success: true,
            technology,
            material,
            infill: infillPercentage,
            hourly_rate: hourlyRate,
            stats: {
                ...stats,
                estimated_price_huf: totalPrice
            },
            download_url: `/download/${outputFilename}`
        });
    } catch (err) {
        console.error('[CRITICAL ERROR]', err.message);
        cleanupFiles(filesCleanupList);

        if (err.message.startsWith('MODEL_TOO_LARGE|')) {
            const cleanMessage = err.message.split('|')[1];
            return res.status(400).json({
                success: false,
                error: cleanMessage,
                errorCode: 'MODEL_EXCEEDS_BUILD_VOLUME'
            });
        }

        logError({
            message: err.message,
            stderr: err.stderr,
            stack: err.stack,
            path: inputFile
        });

        res.status(500).json({
            success: false,
            error: 'Slicing failed. The error has been logged for review.',
            errorCode: 'INTERNAL_PROCESSING_ERROR'
        });
    }
}

module.exports = {
    handleSlice
};