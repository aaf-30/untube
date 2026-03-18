import fs from 'node:fs';
import path from 'node:path';
import untube from '../dist/index.js';

async function testSequentialDownload() {
    console.log('--- Starting Sequential Download Test ---');
    const videoId = 'dQw4w9WgXcQ'; // Rickroll
    const outputFile = path.join(process.cwd(), 'test_sequential.mp4');

    console.log(`[1] Fetching info and starting sequential download for: ${videoId}`);
    
    // Using sequential mode
    const stream = untube(videoId, {
        format: '136', // Use 720p for a larger file test
        mode: 'sequential'
    });

    const writeStream = fs.createWriteStream(outputFile);
    let downloadedBytes = 0;
    const startTime = Date.now();

    stream.on('info', (info, format) => {
        console.log(`[2] Video Info Received:`);
        console.log(`    Title: ${info.title}`);
        console.log(`    Format: ${format.resolution} (${format.container})`);
        console.log(`    URL: ${format.url.substring(0, 50)}...`);
        console.log(`[3] Streaming started... (No progress events in sequential mode, tracking manually)`);
    });

    // We can manually track progress for sequential mode by listening to the 'data' event on the stream itself
    stream.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const downloadedMb = (downloadedBytes / 1024 / 1024).toFixed(2);
        process.stdout.write(`\r    Streamed: ${downloadedMb} MB...`);
    });

    stream.on('error', (err) => {
        console.error(`\n[!] Error during download: ${err.message}`);
        process.exit(1);
    });

    stream.pipe(writeStream);

    writeStream.on('finish', () => {
        const timeTaken = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n[4] Sequential Download Finished in ${timeTaken} seconds!`);
        console.log(`    File saved to: ${outputFile}`);
        console.log('--- Test Completed Successfully ---');
        
        // Clean up
        fs.unlinkSync(outputFile);
        console.log('[5] Cleaned up test file.');
    });
}

testSequentialDownload();