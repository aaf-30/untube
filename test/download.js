import fs from 'node:fs';
import path from 'node:path';
import untube from '../dist/index.js';

async function testDownload() {
    console.log('--- Starting Download Test ---');
    const videoId = 'pAZwZuGCSwI';
    const outputFile = path.join(process.cwd(), 'test_pAZwZuGCSwI_140.m4a');

    console.log(`[1] Fetching info and starting download for: ${videoId}`);
    
    const stream = untube(videoId, {
        format: '140',
        mode: 'parallel'
    });

    const writeStream = fs.createWriteStream(outputFile);
    const startTime = Date.now();

    stream.on('info', (info, format) => {
        console.log(`[2] Video Info Received:`);
        console.log(`    Title: ${info.title}`);
        console.log(`    Format: ${format.resolution} (${format.container})`);
        console.log(`    URL: ${format.url.substring(0, 50)}...`);
    });

    stream.on('progress', (progress) => {
        const downloadedMb = (progress.downloadedBytes / 1024 / 1024).toFixed(2);
        const totalMb = (progress.totalBytes / 1024 / 1024).toFixed(2);
        process.stdout.write(`\r[3] Downloading: ${progress.percent}% complete (${downloadedMb} MB / ${totalMb} MB)...`);
    });

    stream.on('error', (err) => {
        console.error(`\n[!] Error during download: ${err.message}`);
        process.exit(1);
    });

    stream.pipe(writeStream);

    writeStream.on('finish', () => {
        const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n[4] Parallel Download Finished in ${timeTaken} seconds!`);
        console.log(`    File saved to: ${outputFile}`);
        console.log('--- Test Completed Successfully ---');
        
        fs.unlinkSync(outputFile);
        console.log('[5] Cleaned up test file.');
    });
}

testDownload();