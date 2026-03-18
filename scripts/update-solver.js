import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bundlePath = path.join(__dirname, '..', 'src', 'solver-bundle.ts');
const YT_SOLVER_URL = 'https://github.com/yt-dlp/ejs/releases/latest/download/yt.solver.core.js';

try {
    const currentBundle = fs.readFileSync(bundlePath, 'utf8');
    const splitToken = 'var jsc = (function (meriyah, astring) {';
    const parts = currentBundle.split(splitToken);
    
    if (parts.length < 2) {
        throw new Error('Could not find the start of jsc function in solver-bundle.ts');
    }

    const header = parts[0];
    
    console.log(`Downloading latest solver from ${YT_SOLVER_URL}...`);
    const response = await fetch(YT_SOLVER_URL);
    if (!response.ok) {
        throw new Error(`Failed to download solver: ${response.status} ${response.statusText}`);
    }
    const newYtSolver = await response.text();

    const ytParts = newYtSolver.split(splitToken);
    if (ytParts.length < 2) {
        throw new Error('Could not find the start of jsc function in yt.solver.core.js');
    }

    const newBundle = header + splitToken + ytParts.slice(1).join(splitToken) + '\n\nexport default jsc;\n';
    
    fs.writeFileSync(bundlePath, newBundle, 'utf8');
    console.log('Successfully updated src/solver-bundle.ts with the latest yt.solver.core.js from GitHub releases!');
} catch (err) {
    console.error('Failed to update solver:', err);
    process.exit(1);
}
