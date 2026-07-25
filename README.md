# untube

[![npm version](https://img.shields.io/npm/v/untube.svg)](https://www.npmjs.com/package/untube)
[![npm downloads](https://img.shields.io/npm/dm/untube.svg)](https://www.npmjs.com/package/untube)
[![node version](https://img.shields.io/node/v/untube.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-Ready-blue.svg)](https://www.typescriptlang.org/)
[![Socket Badge](https://socket.dev/api/badge/npm/package/untube)](https://socket.dev/npm/package/untube)
[![License](https://img.shields.io/npm/l/untube.svg)](LICENSE)

A lightweight, extremely fast YouTube video downloader and metadata scraper for Node.js. Ported from the core extraction logic of [yt-dlp](https://github.com/yt-dlp/yt-dlp).

---

## Table of Contents
- [Installation](#installation)
- [Fetching Metadata (Basic Usage)](#fetching-metadata-basic-usage)
- [Downloading Videos (Streaming)](#downloading-videos-streaming)
- [Configuration Options](#configuration-options)
- [Format Selection & Merging](#format-selection--merging)
- [Format Utilities](#format-utilities)
- [YouTube Music Search](#youtube-music-search)
- [Cookie Handling](#cookie-handling)
- [API Reference](#api-reference)
- [Disclaimer & License](#disclaimer--license)

---

## Installation

**npm**
```bash
npm install untube
```

**pnpm**
```bash
pnpm add untube
```

**yarn**
```bash
yarn add untube
```

**bun**
```bash
bun add untube
```

---

## Fetching Metadata (Basic Usage)

If you only need video details without downloading the stream, use `untube.getVideoInfo()`. This is the fastest way to get metadata.

```typescript
import untube from 'untube';

// Basic usage
const info = await untube.getVideoInfo('dQw4w9WgXcQ');

console.log('Title:', info.title);
console.log('Views:', info.view_count);
console.log('Duration:', info.duration, 'seconds');

// With options (e.g., proxy or cookies)
const infoWithProxy = await untube.getVideoInfo('dQw4w9WgXcQ', {
    proxy: 'http://user:pass@host:port',
    cookies: './cookies.txt'
});
```

---

## Downloading Videos (Streaming)

`untube` provides a readable stream that you can pipe anywhere (e.g., to a file, to `fluent-ffmpeg`, or an HTTP response).

```typescript
import fs from 'node:fs';
import untube from 'untube';

// Setup AbortController to cancel download if needed
const controller = new AbortController();

// Start downloading a video
const stream = untube('dQw4w9WgXcQ', {
    format: 'highestvideo', // Select quality
    signal: controller.signal, // Optional: pass the abort signal
});

// Listen to events
stream.on('info', (info, format) => {
    console.log(`Downloading: ${info.title}`);
    console.log(`Selected Format: ${format.resolution} (${format.container})`);
});

stream.on('progress', (progress) => {
    // Progress event is only available in 'parallel' mode (default)
    console.log(`Progress: ${progress.percent}% (${progress.downloadedBytes} bytes)`);
});

stream.on('error', (err) => {
    console.error(`Error: ${err.message}`);
});

// Pipe the stream directly to a file
stream.pipe(fs.createWriteStream('video.mp4'));
```

---

## Configuration Options

### `untube(id, options)`
| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `format` | `string` | `'highest'` | Quality preset (e.g., `'highestaudio'`, `'1080p'`) or specific `itag`. |
| `filter` | `string \| function` | `undefined` | Filter formats (e.g., `'audioonly'`, `'videoonly'`). |
| `mode` | `'parallel' \| 'sequential'` | `'parallel'` | Download strategy. `'parallel'` is faster; `'sequential'` is better for live playback. |
| `proxy` | `string` | `undefined` | Proxy URL (HTTP/HTTPS). |
| `cookies` | `string \| RawCookie` | `undefined` | Path to Netscape cookie file or `RawCookie` instance. |
| `signal` | `AbortSignal` | `undefined` | Signal to abort the download. |

### `untube.getVideoInfo(id, options)`
| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `proxy` | `string` | `undefined` | Proxy URL (HTTP/HTTPS). |
| `cookies` | `string \| RawCookie` | `undefined` | Path to Netscape cookie file or `RawCookie` instance. |

---

## Format Selection & Merging

> **⚠️ Important Note on Video & Audio:**  
> YouTube separates most video and audio into different streams (DASH formats). 
> 
> - If you choose a video-only format (like `highestvideo`), the resulting file will **not have sound**. 
> - If you want a single file with both video and audio, you must download the video and audio streams separately and merge them yourself using a tool like **ffmpeg**.

### Common Presets
- **Presets:** `'highest'`, `'lowest'`, `'highestaudio'`, `'lowestaudio'`, `'highestvideo'`, `'lowestvideo'`.
- **Resolutions:** `'1080p'`, `'720p'`, etc.
- **Format ID / itag:** Use specific itags like `'137'` (1080p video-only) or `'140'` (m4a audio).

---

## Format Utilities

`untube` includes utility functions to help you manage and filter formats from the `info` object.

```typescript
const info = await untube.getVideoInfo('videoId');

// 1. Filter formats using presets
// Available presets: 'audioandvideo', 'video', 'videoonly', 'audio', 'audioonly'
const audioOnly = untube.filterFormats(info.formats, 'audioonly');

// 2. Filter using custom logic
const mp4Only = untube.filterFormats(info.formats, f => f.container === 'mp4');

// 3. Choose a specific format manually
const bestAudio = untube.chooseFormat(info.formats, { quality: 'highestaudio' });

// 4. Sort formats from highest to lowest quality
const sorted = untube.sortFormats(info.formats);
```

---

### `untube.ytmusic(query, options)`
Search for songs or videos directly from YouTube Music.

```typescript
import untube from 'untube';

// Basic usage
const results = await untube.ytmusic('Never gonna give you up');

// With options (e.g., proxy or cookies)
const resultsWithProxy = await untube.ytmusic('Never gonna give you up', {
    proxy: 'http://user:pass@host:port',
    cookies: './cookies.txt'
});

console.log('Top Result:', results[0].title);
console.log('Artist:', results[0].artist);
console.log('Album:', results[0].album);
console.log('Duration:', results[0].duration, 'seconds');
```

### `untube.ytmusic.getTrackInfo(idOrUrl, options)`
Fetch detailed track metadata (title, artist, album, duration, thumbnails) directly from YouTube Music by track video ID or URL.

```typescript
import untube from 'untube';
// or import { getTrackInfo } from 'untube';

// Fetch track metadata by YouTube Music URL or ID
const track = await untube.ytmusic.getTrackInfo('https://music.youtube.com/watch?v=dQw4w9WgXcQ');

console.log('Title:', track.title);
console.log('Artist:', track.artist);
console.log('Album:', track.album);
console.log('Duration:', track.duration, 'seconds (', track.duration_string, ')');
console.log('Thumbnail:', track.thumbnail);
```

---

## Cookie Handling

Using cookies is highly recommended to avoid rate limits, access age-restricted videos, or bypass regional restrictions.

### 1. Using a File (Netscape format)
Export cookies in **Netscape format** from your browser (e.g., using "Get cookies.txt LOCALLY" extension) and provide the file path:
```typescript
untube('videoId', { cookies: './cookies.txt' });
```

### 2. Advanced: Remote Storage (Database)
Use the `RawCookie` class for custom read/write logic (e.g., storing in a database):
```typescript
const myRawCookie = new untube.RawCookie(
    async () => await fetchFromDB(), // Must return Netscape string
    async (newCookies) => await saveToDB(newCookies)
);
untube('videoId', { cookies: myRawCookie });
```

---

## API Reference

### `VideoInfo`
| Property | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | Video ID. |
| `title` | `string` | Video title. |
| `description` | `string` | Video description. |
| `duration` | `number` | Duration in seconds. |
| `view_count` | `number` | Total views. |
| `uploader` | `string` | Channel name. |
| `thumbnail` | `string` | Highest resolution thumbnail URL. |
| `formats` | `YouTubeFormat[]` | Array of available formats. |
| `captions` | `YouTubeCaption[]` | Array of available subtitles. |

### `YouTubeFormat`
| Property | Type | Description |
| :--- | :--- | :--- |
| `format_id` | `string` | The itag of the format. |
| `ext` | `string` | File extension (e.g., `'mp4'`, `'webm'`). |
| `resolution` | `string` | e.g., `'1080p'`, `'audio only'`. |
| `vcodec` | `string` | Video codec. `'none'` for audio-only. |
| `acodec` | `string` | Audio codec. `'none'` for video-only. |
| `filesize` | `number \| null` | File size in bytes. |
| `url` | `string` | Direct streaming URL (decrypted). |

### `YTMusicTrackInfo`
| Property | Type | Description |
| :--- | :--- | :--- |
| `id` | `string` | YouTube Music track video ID. |
| `title` | `string` | Track title. |
| `artist` | `string` | Artist name. |
| `album` | `string \| undefined` | Album title if available. |
| `duration` | `number \| undefined` | Track duration in seconds. |
| `duration_string` | `string \| undefined` | Formatted duration string (e.g., `'3:34'`). |
| `thumbnail` | `string` | Highest resolution thumbnail URL. |
| `thumbnails` | `any[]` | Array of available thumbnail objects. |
| `webpage_url` | `string` | Full YouTube Music webpage URL. |

---

## Disclaimer

This project is created for educational purposes only. Users are responsible for complying with YouTube's Terms of Service and local copyright laws.

## License

This project is licensed under the [Unlicense](LICENSE) (Public Domain).

**Note:** While the core codebase is released under the Unlicense, this project relies on open-source dependencies (e.g., `tough-cookie`, `meriyah`, `astring`, etc.) which have their own respective licenses (such as MIT, BSD, etc.). Please ensure compliance with the licenses of these dependencies if you intend to distribute or use this module in a commercial product.
