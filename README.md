# untube

[![npm version](https://img.shields.io/npm/v/untube.svg)](https://www.npmjs.com/package/untube)
[![License](https://img.shields.io/npm/l/untube.svg)](LICENSE)

A lightweight, extremely fast YouTube video downloader and metadata scraper for Node.js. Ported from the core extraction logic of [yt-dlp](https://github.com/yt-dlp/yt-dlp).

## Installation

```bash
npm install untube
```

## Quick Start (Downloading Videos)

`untube` provides a readable stream that you can pipe anywhere (e.g., to a file, to `fluent-ffmpeg`, or an HTTP response).

> **⚠️ Important Note on Video & Audio:**  
> YouTube separates high-quality video (1080p, 4K) and audio into different streams (DASH formats). If you choose a high-quality video format (like `highestvideo`), the resulting file will **not have sound**. If you want a single file with both high-quality video and audio, you must download the video and audio streams separately and merge them yourself using a tool like `ffmpeg`.

```typescript
import fs from 'node:fs';
import untube from 'untube';

// Setup AbortController to cancel download if needed
const controller = new AbortController();

// Start downloading a video
const stream = untube('dQw4w9WgXcQ', {
    format: 'highestvideo', // Select highest video quality (will likely be video-only)
    signal: controller.signal, // Pass the abort signal
    // cookie: './cookies.txt', // Optional: avoid age-restrictions
});

// Optional: Listen to events
stream.on('info', (info, format) => {
    console.log(`Downloading: ${info.title}`);
    console.log(`Format: ${format.resolution} (${format.container})`);
    
    // You can also access subtitles/captions
    if (info.captions.length > 0) {
        console.log(`Available Subtitles: ${info.captions.map(c => c.language).join(', ')}`);
    }
});

stream.on('progress', (progress) => {
    const downloadedMb = (progress.downloadedBytes / 1024 / 1024).toFixed(2);
    const totalMb = (progress.totalBytes / 1024 / 1024).toFixed(2);
    console.log(`Progress: ${progress.percent}% (${downloadedMb}MB / ${totalMb}MB)`);
});

stream.on('error', (err) => {
    console.error(`Error: ${err.message}`);
});

// Pipe the stream directly to a file
stream.pipe(fs.createWriteStream('video.mp4'));

// Example: Cancel download after 5 seconds
// setTimeout(() => controller.abort(), 5000);
```

---

## Configuration Options

When calling `untube(id, options)` or `untube.getVideoInfo(id, options)`, you can pass an options object.

### `format` (Quality Selection)
You can easily pick the desired quality using preset strings or specific format IDs (`itag`):

- **Presets:** `'highest'` (default), `'lowest'`, `'highestaudio'`, `'lowestaudio'`, `'highestvideo'`, `'lowestvideo'`.
- **Resolutions:** `'1080p'`, `'720p'`, etc.
- **Format ID / itag:** Use specific itags like `'137'` (1080p video-only), `'140'` (m4a audio), or `'18'` (360p video+audio).

```typescript
// Download exactly 1080p MP4 (Video only)
untube('videoId', { format: '137' });

// Download the best audio available
untube('videoId', { format: 'highestaudio' });
```

### `mode` (Streaming Behavior)
By default, `untube` uses **parallel** downloading to bypass YouTube bandwidth throttling. 

| Mode | Characteristics | Best for |
| :--- | :--- | :--- |
| `'parallel'` (Default) | Incredibly fast. Downloads chunks concurrently into a temp file and streams the result. Emits `progress` events. | Downloading files, massive scrapers. |
| `'sequential'` | Pure RAM streaming. Slower (throttled by YouTube). No temp files used. Start-up time is instant. | Real-time audio playback. |

```typescript
// Use sequential mode for instant start-up time
const stream = untube('videoId', { format: 'highestaudio', mode: 'sequential' });
```

---

## Fetching Metadata

If you only need the video details without downloading the stream, use `untube.getVideoInfo()`:

```typescript
import untube from 'untube';

const info = await untube.getVideoInfo('videoId');

console.log('Title:', info.title);
console.log('Views:', info.view_count);
```

### Format Utilities

`untube` includes powerful utility functions to help you manage and filter formats from the `info` object.

```typescript
const info = await untube.getVideoInfo('videoId');

// 1. Choose a specific format manually
const bestAudio = untube.chooseFormat(info.formats, { quality: 'highestaudio' });

// 2. Filter formats custom logic
const mp4Only = untube.filterFormats(info.formats, format => format.container === 'mp4');

// 3. Filter using presets ('video', 'audio', 'audioandvideo', 'videoonly', 'audioonly')
const videoNoSound = untube.filterFormats(info.formats, 'videoonly');

// 4. Sort formats from highest to lowest quality
const sorted = untube.sortFormats(info.formats);
```

---

## Cookie Handling

Using cookies is highly recommended to avoid rate limits, access age-restricted (NSFW) videos, or videos only available in specific regions.

### 1. Using a File (Netscape format)
1. Install a browser extension like **"Get cookies.txt LOCALLY"** (Chrome/Firefox).
2. Open YouTube and ensure you are logged in.
3. Export the cookies in **Netscape format** and save it as `cookies.txt`.
4. Provide the file path:

```typescript
untube('videoId', { cookie: './cookies.txt' });
```

### 2. Advanced: Remote Storage (Database / Firebase)
If you want to store cookies in a remote database or as a string, use the `RawCookie` class:

```typescript
import untube from 'untube';

const myRawCookie = new untube.RawCookie(
    async () => {
        // Implement read logic (e.g., fetch from DB)
        return await fetchCookiesFromDB(); // Must return Netscape format string
    },
    async (newCookies) => {
        // Implement write logic (called when YouTube refreshes cookies)
        await saveCookiesToDB(newCookies);
    }
);

untube('videoId', { cookie: myRawCookie });
```

> **⚠️ Security:** Never share your cookies with anyone as they contain your login session. Ensure local cookie files are added to your `.gitignore`.

---

## Disclaimer

This project is created for educational and research purposes only. Users are solely responsible for how they use this tool. Ensure you comply with YouTube's Terms of Service and applicable copyright laws in your region. The author is not responsible for any misuse of this tool.

## License

[Unlicense](LICENSE)
