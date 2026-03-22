import { fetch, ProxyAgent } from 'undici';
import CookieManager, { RawCookie } from './cookie-manager.js';

export interface YTMusicSearchResult {
  title: string;
  artist: string;
  videoId?: string;
  type: string;
  duration?: string;
  album?: string;
  thumbnail?: string;
}

export interface SearchYTMusicOptions {
  cookie?: string | RawCookie;
  proxy?: string;
}

export async function ymusic(query: string, options: SearchYTMusicOptions = {}): Promise<YTMusicSearchResult[]> {
  const cookieSource = options.cookie || './cookies.txt';
  const cm = new CookieManager(cookieSource);
  await cm.load();

  const dispatcher = options.proxy ? new ProxyAgent(options.proxy) : undefined;
  const apiUrl = "https://music.youtube.com/youtubei/v1/search";

  const payload = {
    context: {
      client: {
        clientName: "WEB_REMIX",
        clientVersion: "1.20231211.01.00",
        hl: "en",
        gl: "ID"
      }
    },
    query: query
  };

  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Content-Type': 'application/json',
    'Origin': 'https://music.youtube.com',
    'Cookie': cm.getCookieString(apiUrl) || '',
  };

  const response = await fetch(apiUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    dispatcher
  } as any);

  const setCookies = (response.headers as any).getSetCookie();
  if (setCookies && setCookies.length > 0) {
      setCookies.forEach((cookie: any) => cm.setCookieString(cookie, apiUrl));
      await cm.save();
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch from YouTube Music API: ${response.statusText}`);
  }

  const data: any = await response.json();
  const results: YTMusicSearchResult[] = [];

  try {
    const tabs = data.contents?.tabbedSearchResultsRenderer?.tabs;
    if (!tabs || tabs.length === 0) return [];

    const contents = tabs[0]?.tabRenderer?.content?.sectionListRenderer?.contents;
    if (!contents) return [];

    for (const section of contents) {
      if (section.musicCardShelfRenderer) {
        const title = section.musicCardShelfRenderer.title?.runs?.[0]?.text;
        const videoId = section.musicCardShelfRenderer.onTap?.watchEndpoint?.videoId;
        const subtitleRuns = section.musicCardShelfRenderer.subtitle?.runs || [];
        const subtitleText = subtitleRuns.map((r: any) => r.text).join('');
        const thumbnails = section.musicCardShelfRenderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
        const thumbnail = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : undefined;
        
        const parts = subtitleText.split(' • ');
        const type = parts[0] || 'Unknown';
        const artist = parts[1] || 'Unknown';

        if (title && videoId) {
          results.push({ title, artist, videoId, type, thumbnail });
        }
      }

      if (section.musicShelfRenderer) {
        const items = section.musicShelfRenderer.contents;
        for (const item of items) {
          const renderer = item.musicResponsiveListItemRenderer;
          if (!renderer) continue;

          const flexColumns = renderer.flexColumns;
          if (!flexColumns || flexColumns.length < 2) continue;

          const titleRuns = flexColumns[0].musicResponsiveListItemFlexColumnRenderer?.text?.runs;
          if (!titleRuns) continue;
          const title = titleRuns.map((r: any) => r.text).join('');

          const detailsRuns = flexColumns[1].musicResponsiveListItemFlexColumnRenderer?.text?.runs;
          if (!detailsRuns) continue;
          
          const detailsText = detailsRuns.map((r: any) => r.text).join('');
          const detailsParts = detailsText.split(' • ');
          
          const type = detailsParts[0] || 'Unknown';
          const artist = detailsParts[1] || 'Unknown';
          let album: string | undefined = undefined;
          let duration: string | undefined = undefined;
          
          if (detailsParts.length > 2) {
             const lastPart = detailsParts[detailsParts.length - 1];
             if (lastPart.includes(':')) {
                 duration = lastPart;
                 if (detailsParts.length > 3) {
                     album = detailsParts[2];
                 }
             } else {
                 album = detailsParts[2];
             }
          }

          const thumbnails = renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
          const thumbnail = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : undefined;

          let videoId = undefined;
          if (renderer.playlistItemData?.videoId) {
            videoId = renderer.playlistItemData.videoId;
          } else if (renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId) {
            videoId = renderer.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint.videoId;
          } else if (titleRuns[0]?.navigationEndpoint?.watchEndpoint?.videoId) {
            videoId = titleRuns[0].navigationEndpoint.watchEndpoint.videoId;
          }

          if (title && type === 'Song') {
            results.push({ title, artist, type, videoId, duration, album, thumbnail });
          }
        }
      }
    }
  } catch (err) {
    console.error("Error parsing YouTube Music response:", err);
  }

  const uniqueResults = [];
  const seenIds = new Set();
  for (const r of results) {
    if (r.videoId && !seenIds.has(r.videoId)) {
      seenIds.add(r.videoId);
      uniqueResults.push(r);
    }
  }

  return uniqueResults;
}
