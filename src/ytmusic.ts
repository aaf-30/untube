import { fetch, ProxyAgent } from 'undici';
import CookieManager, { RawCookie } from './cookie-manager.js';

export interface YTMusicSearchResult {
  title: string;
  artist: string;
  videoId?: string;
  type: string;
  duration?: number;
  album?: string;
  thumbnail?: string;
}

export interface SearchYTMusicOptions {
  cookies?: string | RawCookie;
  proxy?: string;
}

function timeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 3) {
    return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  } else if (parts.length === 2) {
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }
  return 0;
}

export async function ytmusic(query: string, options: SearchYTMusicOptions = {}): Promise<YTMusicSearchResult[]> {
  const cm = new CookieManager(options.cookies);
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
    query: query,
    params: 'EgWKAQIIAWoKEAMQBBAJEA4QBQ%3D%3D' // Default filter to specifically return Songs for detailed metadata
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
        let thumbnail = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : undefined;
        if (thumbnail) thumbnail = thumbnail.replace(/=w\d+-h\d+/, '=w512-h512');
        
        const parts = subtitleText.split(' • ');
        const type = parts[0] || 'Unknown';
        const artist = parts[1] || 'Unknown';

        if (title && videoId && type === 'Song') {
          const resultObj: YTMusicSearchResult = { title, artist, videoId, type, thumbnail };
          results.push(resultObj);
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

          const allRuns = flexColumns.flatMap((col: any) => col.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []);
          const fixedColumns = renderer.fixedColumns || [];
          const allFixedRuns = fixedColumns.flatMap((col: any) => col.musicResponsiveListItemFixedColumnRenderer?.text?.runs || []);
          
          let isSong = false;
          let artist = 'Unknown';
          let album: string | undefined = undefined;
          let duration: number | undefined = undefined;
          
          const shelfTitle = section.musicShelfRenderer.title?.runs?.[0]?.text;

          for (const run of allRuns) {
            if (!run || !run.text || run.text === ' • ') continue;
            
            const text = run.text.trim();
            const browseId = run.navigationEndpoint?.browseEndpoint?.browseId;
            const pageType = run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType;
            
            if (text === 'Song' || shelfTitle === 'Songs') {
              isSong = true;
            }
            if (pageType === 'MUSIC_PAGE_TYPE_ARTIST' || pageType === 'MUSIC_PAGE_TYPE_USER_CHANNEL' || browseId?.startsWith('UC')) {
              artist = text;
            } else if (pageType === 'MUSIC_PAGE_TYPE_ALBUM' || browseId?.startsWith('MPR')) {
              album = text;
            }
          }

          const potentialDurationRuns = [...allRuns, ...allFixedRuns];
          for (const run of potentialDurationRuns) {
            if (!run || !run.text) continue;
            const text = run.text.trim();
            if (/^(\d{1,2}:)?\d{1,2}:\d{2}$/.test(text)) {
              duration = timeToSeconds(text);
              break;
            }
          }

          if (artist === 'Unknown' && allRuns.length > 2) {
             const possibleArtist = allRuns.find((r: any) => r.text !== 'Song' && r.text !== ' • ' && r.text !== titleRuns[0].text)?.text;
             if (possibleArtist) artist = possibleArtist;
          }

          const thumbnails = renderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails || [];
          let thumbnail = thumbnails.length > 0 ? thumbnails[thumbnails.length - 1].url : undefined;
          if (thumbnail) thumbnail = thumbnail.replace(/=w\d+-h\d+/, '=w512-h512');

          let videoId = undefined;
          if (renderer.playlistItemData?.videoId) {
            videoId = renderer.playlistItemData.videoId;
          } else if (renderer.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId) {
            videoId = renderer.overlay.musicItemThumbnailOverlayRenderer.content.musicPlayButtonRenderer.playNavigationEndpoint.watchEndpoint.videoId;
          } else if (titleRuns[0]?.navigationEndpoint?.watchEndpoint?.videoId) {
            videoId = titleRuns[0].navigationEndpoint.watchEndpoint.videoId;
          }

          if (title && isSong) {
            const resultObj: YTMusicSearchResult = { title, artist, type: 'Song', videoId, thumbnail };
            if (duration !== undefined) resultObj.duration = duration;
            if (album) resultObj.album = album;
            results.push(resultObj);
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
