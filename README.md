# untube

[![npm version](https://img.shields.io/npm/v/untube.svg)](https://www.npmjs.com/package/untube)
[![License](https://img.shields.io/npm/l/untube.svg)](LICENSE)

A lightweight YouTube metadata and streaming URL scraper for Node.js, featuring proxy and cookie support. Ported from [yt-dlp](https://github.com/yt-dlp/yt-dlp).

## Features

- ✅ Fetch complete video metadata.
- ✅ HTTP/HTTPS Proxy support via `undici`.
- ✅ Automatic Cookie management (File or Remote DB).
- ✅ Full TypeScript support.

## Installation

```bash
npm install untube
```

## Usage

```typescript
import { getVideoInfo } from 'untube';

async function main() {
    try {
        const info = await getVideoInfo('videoId', {
            // Optional: Path to cookies file (Netscape format) or RawCookie object
            cookie: './cookies.txt',
            // Optional: Use proxy to avoid rate limits or blocks
            proxy: 'http://user:pass@my-proxy.com:8080'
        });

        console.log('Title:', info.title);
        console.log('Channel:', info.uploader);
        
        // List available video & audio formats
        info.formats.forEach(format => {
            console.log(`[${format.format_id}] ${format.resolution} - ${format.url}`);
        });
    } catch (error) {
        console.error('Failed to fetch info:', error);
    }
}

main();
```

## Cookie Handling

Using cookies is highly recommended to avoid rate limits, access age-restricted (NSFW) videos, or videos only available in specific regions.

### 1. Using a File (Netscape format)
1. Install a browser extension like **"Get cookies.txt LOCALLY"** (available on Chrome Web Store or Firefox Add-ons).
2. Open YouTube and ensure you are logged in (optional, but recommended).
3. Click on the extension and select **"Export as Netscape format"**.
4. Save the file as `cookies.txt` in your project directory.
5. Provide the file path in the `cookie` option.

### 2. Advanced: Remote Storage (Firebase, Database, etc.)
If you want to store cookies in a remote database or as a string, use the `RawCookie` class:

```typescript
import { getVideoInfo, RawCookie } from 'untube';

const myRawCookie = new RawCookie(
    async () => {
        // Implement your own read logic (e.g., from Firebase Realtime DB)
        const cookies = await fetchCookiesFromDB();
        return cookies; // Must return Netscape format string
    },
    async (newCookies) => {
        // Implement your own write logic
        // This is called whenever YouTube sends new cookies
        await saveCookiesToDB(newCookies);
    }
);

const info = await getVideoInfo('videoId', {
    cookie: myRawCookie
});
```

> **⚠️ Security:** Never share your cookies with anyone as they contain your login session. Ensure local cookie files are added to your `.gitignore`.

## Disclaimer

This project is created for educational and research purposes only. Users are solely responsible for how they use this tool. Ensure you comply with YouTube's Terms of Service and applicable copyright laws in your region. The author is not responsible for any misuse of this tool.

## License

[Unlicense](LICENSE)
