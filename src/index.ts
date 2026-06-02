import CookieManager, { RawCookie } from './cookie-manager.js'
import jsc from './solver-bundle.js'
import crypto from 'node:crypto'
import { fetch, ProxyAgent } from 'undici'
import { filterFormats, sortFormats, chooseFormat, FilterFunction, FilterString, ChooseFormatQuality, ChooseFormatOptions } from './utils.js'
import { PassThrough, Readable } from 'node:stream'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import { downloadVideoParallel } from './downloader.js'
import { ytmusic, YTMusicSearchResult, SearchYTMusicOptions } from './ytmusic.js'

const globalPreprocessedPlayerCache = new Map<string, any>()

export interface YouTubeFormat {
    asr: number | null
    filesize: number | null
    format_id: string
    format_note: string
    fps: number | null
    audio_channels: number | null
    height: number | null
    width: number | null
    quality: string | number | null
    tbr: number | null
    ext: string
    vcodec: string
    acodec: string
    container: string | null
    url: string
    protocol: string
    audio_ext: string
    video_ext: string
    vbr: number | null
    abr: number | null
    resolution: string
    format: string
    language?: string | null
    language_preference?: number | null
}

export interface YouTubeCaption {
    url: string
    ext: string
    name: string
    language: string
}

export interface VideoInfo {
    id: string
    title: string
    description: string
    channel: string
    uploader: string
    channel_id: string
    channel_url: string | null
    duration: number
    view_count: number
    average_rating: number | null
    age_limit: number
    webpage_url: string
    categories: string[] | null
    playable_in_embed: boolean
    live_status: string
    media_type: string
    thumbnail: string
    thumbnails: any[]
    formats: YouTubeFormat[]
    captions: YouTubeCaption[]
    availability: string
}

export interface GetVideoInfoOptions {
    cookies?: string | RawCookie
    proxy?: string
}

/**
 * Get YouTube video information along with streaming data (CDN URL)
 * that has been automatically decrypted.
 *
 * @param videoId - YouTube video ID
 * @param options - Optional configuration
 * @returns Promise<VideoInfo>
 */
async function getVideoInfo(videoId: string, options: GetVideoInfoOptions = {}): Promise<VideoInfo> {
    const cm = new CookieManager(options.cookies)
    await cm.load()

    const dispatcher = options.proxy ? new ProxyAgent(options.proxy) : undefined

    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`
    const cookieString = cm.getCookieString(watchUrl)

    const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
    }
    if (cookieString) {
        headers['Cookie'] = cookieString
    }

    const pageRes = await fetch(watchUrl, { headers, dispatcher } as any)
    const pageHtml = await (pageRes as any).text()

    const setCookies = (pageRes.headers as any).getSetCookie()
    if (setCookies && setCookies.length > 0) {
        setCookies.forEach((cookie: any) => cm.setCookieString(cookie, watchUrl))
        await cm.save()
    }

    const ytcfgMatch = pageHtml.match(/ytcfg\.set\(\{([\s\S]*?)\}\);/)
    if (!ytcfgMatch) {
        if (pageHtml.includes('g-recaptcha') || pageHtml.includes('unusual traffic')) {
            throw new Error('YouTube blocked the request (CAPTCHA detected). Please provide cookies to bypass this.')
        }
        throw new Error('ytcfg not found in webpage')
    }

    const ytcfg = JSON.parse(`{${ytcfgMatch[1]}}`)
    const apiKey = ytcfg.INNERTUBE_API_KEY
    const sts = ytcfg.STS

    let initialPlayerResponse: any = {}
    const initialPlayerMatch = pageHtml.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\});/)
    if (initialPlayerMatch) {
        try {
            initialPlayerResponse = JSON.parse(initialPlayerMatch[1]!)
        } catch { }
    }

    const apiUrl = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`
    const clientName = 'TVHTML5'
    const clientVersion = '5.20260114'

    const payload = {
        context: {
            client: {
                clientName,
                clientVersion,
                userAgent: 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
                hl: 'en',
                gl: 'US',
            },
        },
        videoId,
        playbackContext: {
            contentPlaybackContext: {
                html5Preference: 'HTML5_PREF_WANTS',
                signatureTimestamp: sts,
            },
        },
    }

    const apiCookieString = cm.getCookieString(apiUrl)

    const apiHeaders: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (ChromiumStylePlatform) Cobalt/Version',
        'Content-Type': 'application/json',
        'X-Youtube-Client-Name': '7',
        'X-Youtube-Client-Version': clientVersion,
        'Origin': 'https://www.youtube.com',
    }
    if (apiCookieString) {
        apiHeaders['Cookie'] = apiCookieString
    }

    const sapisidCookie = cm.jar.getCookiesSync(apiUrl).find((c: any) => c.key === 'SAPISID')
    if (sapisidCookie) {
        const timestamp = Math.floor(Date.now() / 1000).toString()
        const hash = crypto.createHash('sha1').update(`${timestamp} ${sapisidCookie.value} https://www.youtube.com`).digest('hex')
        apiHeaders.Authorization = `SAPISIDHASH ${timestamp}_${hash}`
    }

    const apiRes = await fetch(apiUrl, {
        method: 'POST',
        headers: apiHeaders,
        body: JSON.stringify(payload),
        dispatcher,
    } as any)

    const apiSetCookies = (apiRes.headers as any).getSetCookie()
    if (apiSetCookies && apiSetCookies.length > 0) {
        apiSetCookies.forEach((cookie: any) => cm.setCookieString(cookie, apiUrl))
        await cm.save()
    }

    if (!apiRes.ok) {
        throw new Error(`InnerTube API failed: ${apiRes.status} ${apiRes.statusText}`)
    }

    const json: any = await apiRes.json()

    if (json.playabilityStatus && json.playabilityStatus.status !== 'OK') {
        throw new Error(`YouTube Error: ${json.playabilityStatus.reason || json.playabilityStatus.status}`)
    }

    const getPreprocessedPlayer = async () => {
        const playerUrl = ytcfg.PLAYER_JS_URL ? `https://www.youtube.com${ytcfg.PLAYER_JS_URL}` : 'https://www.youtube.com/s/player/74edf1a3/player_es6.vflset/en_US/base.js'
        if (globalPreprocessedPlayerCache.has(playerUrl)) return globalPreprocessedPlayerCache.get(playerUrl)

        const res = await fetch(playerUrl, { dispatcher } as any)
        const baseJs = await (res as any).text()

        const input = { type: 'player', player: baseJs, requests: [], output_preprocessed: true }
        let result: any
        try {
            result = jsc(input)
        } catch (err: any) {
            throw new Error(`Failed to preprocess YouTube player. ${err.message}`)
        }

        globalPreprocessedPlayerCache.set(playerUrl, result.preprocessed_player)
        return result.preprocessed_player
    }

    const allFormats: any[] = [
        ...(json.streamingData?.formats || []),
        ...(json.streamingData?.adaptiveFormats || []),
    ]

    const sigChallenges: string[] = []
    const nChallenges: string[] = []

    for (const format of allFormats) {
        if (format.signatureCipher) {
            const searchParams = new URLSearchParams(format.signatureCipher)
            const s = searchParams.get('s')
            if (s) sigChallenges.push(s)

            const baseUrl = searchParams.get('url')
            if (baseUrl) {
                const u = new URL(baseUrl)
                const n = u.searchParams.get('n')
                if (n) nChallenges.push(n)
            }
        } else if (format.url) {
            const u = new URL(format.url)
            const n = u.searchParams.get('n')
            if (n) nChallenges.push(n)
        }
    }

    if (sigChallenges.length > 0 || nChallenges.length > 0) {
        const preprocessedPlayer = await getPreprocessedPlayer()
        const requests: any[] = []
        if (sigChallenges.length > 0) requests.push({ type: 'sig', challenges: [...new Set(sigChallenges)] })
        if (nChallenges.length > 0) requests.push({ type: 'n', challenges: [...new Set(nChallenges)] })

        const input = { type: 'preprocessed', preprocessed_player: preprocessedPlayer, requests }
        let result: any
        try {
            result = jsc(input)
        } catch (err: any) {
            throw new Error(`Failed to decrypt YouTube signature. ${err.message}`)
        }

        const sigData = result.responses?.find((r: any) => r.type === 'result' && sigChallenges.includes(Object.keys(r.data || {})[0]!))?.data || {}
        const nData = result.responses?.find((r: any) => r.type === 'result' && nChallenges.includes(Object.keys(r.data || {})[0]!))?.data || {}

        for (const format of allFormats) {
            if (format.signatureCipher) {
                const searchParams = new URLSearchParams(format.signatureCipher)
                const baseUrl = searchParams.get('url')
                const sp = searchParams.get('sp') || 'sig'
                const s = searchParams.get('s')

                if (baseUrl) {
                    const u = new URL(baseUrl)
                    const n = u.searchParams.get('n')

                    if (s && sigData[s]) u.searchParams.set(sp, sigData[s])
                    if (n && nData[n]) u.searchParams.set('n', nData[n])

                    format.url = u.toString()
                }
                delete format.signatureCipher
            } else if (format.url) {
                const u = new URL(format.url)
                const n = u.searchParams.get('n')
                if (n && nData[n]) {
                    u.searchParams.set('n', nData[n])
                    format.url = u.toString()
                }
            }
        }
    }

    json.videoDetails = { ...(initialPlayerResponse.videoDetails || {}), ...(json.videoDetails || {}) }
    json.microformat = initialPlayerResponse.microformat || json.microformat

    return normalizeYtDlp(json)
}

function normalizeYtDlp(json: any): VideoInfo {
    const vd = json.videoDetails || {}
    const mf = json.microformat?.playerMicroformatRenderer || {}
    const formats: YouTubeFormat[] = []

    const mapFormat = (f: any): YouTubeFormat => {
        let vcodec = 'none'
        let acodec = 'none'

        let ext = f.mimeType ? f.mimeType.split(';')[0].split('/')[1] : 'unknown'
        if (ext === 'x-flv') ext = 'flv'
        if (ext === 'vnd.apple.mpegurl') ext = 'mp4'

        if (f.mimeType) {
            const match = f.mimeType.match(/codecs="(.*?)"/)
            if (match) {
                const codecs = match[1].split(',').map((c: string) => c.trim())
                if (f.mimeType.startsWith('audio/')) {
                    acodec = codecs[0]
                } else if (f.mimeType.startsWith('video/')) {
                    vcodec = codecs[0]
                    if (codecs.length > 1) {
                        acodec = codecs[1]
                    }
                }
            }
        }

        let container = ext
        if (f.mimeType?.includes('mp4')) container = 'mp4'
        else if (f.mimeType?.includes('webm')) container = 'webm'
        else if (f.mimeType?.includes('3gpp')) container = '3gp'
        else if (f.mimeType?.includes('x-flv')) container = 'flv'

        let resolution = 'audio only'
        if (f.width && f.height) {
            resolution = `${f.width}x${f.height}`
        } else if (f.height) {
            resolution = `${f.height}p`
        } else if (f.width) {
            resolution = `${f.width}w`
        }

        const format = f.qualityLabel ? `${f.itag} - ${f.qualityLabel}` : `${f.itag} - ${resolution}`

        let language: string | null = null
        let language_preference: number | null = null
        let format_note = f.qualityLabel || f.quality || ''

        if (f.audioTrack) {
            language = f.audioTrack.id?.split('.')[0] || null
            language_preference = -1

            const trackName = f.audioTrack.displayName || 'Unknown Track';

            let trackLabel = trackName;

            if (trackName.toLowerCase().includes('original')) {
                language_preference = 1;
            } else if (f.audioTrack.audioIsDefault) {
                language_preference = 0;
                trackLabel = `${trackName} (default)`;
            }

            format_note = `${trackLabel}, ${format_note}`;
        }

        return {
            asr: f.audioSampleRate ? Number.parseInt(f.audioSampleRate, 10) : null,
            filesize: f.contentLength ? Number.parseInt(f.contentLength, 10) : null,
            format_id: f.itag ? f.itag.toString() : '',
            format_note: format_note,
            fps: f.fps || null,
            audio_channels: f.audioChannels || null,
            height: f.height || null,
            width: f.width || null,
            quality: f.quality || f.qualityLabel || null,
            tbr: f.bitrate ? Math.round(f.bitrate / 1000) : null,
            ext,
            vcodec,
            acodec,
            container,
            url: f.url,
            protocol: f.url?.startsWith('https') ? 'https' : 'http',
            audio_ext: acodec !== 'none' ? (container === 'webm' ? 'webm' : 'm4a') : 'none',
            video_ext: vcodec !== 'none' ? ext : 'none',
            vbr: f.averageBitrate ? Math.round(f.averageBitrate / 1000) : null,
            abr: f.audioSampleRate ? Math.round(Number.parseInt(f.audioSampleRate, 10) / 1000) : null,
            resolution,
            format,
            language,
            language_preference
        }
    }

    if (json.streamingData?.formats) {
        formats.push(...json.streamingData.formats.map(mapFormat))
    }
    if (json.streamingData?.adaptiveFormats) {
        formats.push(...json.streamingData.adaptiveFormats.map(mapFormat))
    }

    const duration = Number.parseInt(vd.lengthSeconds || mf.lengthSeconds || '0', 10)
    const view_count = Number.parseInt(vd.viewCount || mf.viewCount || '0', 10)
    const isLive = vd.isLiveContent || false

    const captions: YouTubeCaption[] = []
    if (json.captions?.playerCaptionsTracklistRenderer?.captionTracks) {
        for (const track of json.captions.playerCaptionsTracklistRenderer.captionTracks) {
            captions.push({
                url: track.baseUrl,
                ext: 'vtt', // Default format for YouTube captions
                name: track.name?.simpleText || track.languageCode,
                language: track.languageCode,
            })
        }
    }

    return {
        id: vd.videoId,
        title: vd.title || mf.title?.simpleText,
        description: vd.shortDescription || mf.description?.simpleText || '',
        channel: vd.author || mf.ownerChannelName,
        uploader: vd.author || mf.ownerChannelName,
        channel_id: vd.channelId || mf.externalChannelId,
        channel_url: vd.channelId || mf.externalChannelId ? `https://www.youtube.com/channel/${vd.channelId || mf.externalChannelId}` : null,
        duration,
        view_count,
        average_rating: Number.parseFloat(vd.averageRating || '0') || null,
        age_limit: (mf.isFamilySafe === false) ? 18 : (json.playabilityStatus?.status === 'AGE_VERIFICATION_REQUIRED' ? 18 : 0),
        webpage_url: `https://www.youtube.com/watch?v=${vd.videoId}`,
        categories: mf.category ? [mf.category] : null,
        playable_in_embed: mf.isUnlisted === undefined ? true : !mf.isUnlisted,
        live_status: isLive ? 'is_live' : 'not_live',
        media_type: isLive ? 'livestream' : (mf.isShortsEligible ? 'short' : 'video'),
        thumbnail: mf.thumbnail?.thumbnails?.[mf.thumbnail.thumbnails.length - 1]?.url || vd.thumbnail?.thumbnails?.[vd.thumbnail.thumbnails.length - 1]?.url || '',
        thumbnails: mf.thumbnail?.thumbnails || vd.thumbnail?.thumbnails || [],
        formats,
        captions,
        availability: json.playabilityStatus?.status || 'OK',
    }
}

export interface UntubeOptions extends GetVideoInfoOptions {
    /**
     * Quality selection. Can be one of:
     * 'highest', 'lowest', 'highestaudio', 'lowestaudio', 'highestvideo', 'lowestvideo'.
     * Or a specific format ID / itag (e.g., '137', '18', '299').
     */
    format?: ChooseFormatQuality;
    filter?: FilterString | FilterFunction;
    mode?: 'parallel' | 'sequential';
    signal?: AbortSignal;
}

/**
 * Downloads a YouTube video and returns a readable stream.
 * Emits 'info' with VideoInfo and the selected format.
 * Emits 'progress' with download percentage (only available in 'parallel' mode).
 * 
 * @param id - YouTube video ID
 * @param options - Options for fetching info and selecting format
 * @returns A PassThrough stream containing the downloaded video/audio data
 */
function untube(id: string, options: UntubeOptions = {}): PassThrough {
    const stream = new PassThrough();

    (async () => {
        try {
            const info = await getVideoInfo(id, options);
            const format = chooseFormat(info.formats, {
                quality: options.format,
                filter: options.filter
            });

            stream.emit('info', info, format);

            if (options.mode === 'sequential' || format.url.includes('.m3u8')) {
                const dispatcher = options.proxy ? new ProxyAgent(options.proxy) : undefined;
                const fetchOptions: any = { dispatcher, signal: options.signal };

                if (!format.url.includes('.m3u8')) {
                    fetchOptions.headers = { Range: 'bytes=0-' };
                }

                const response = await fetch(format.url, fetchOptions);
                if (!response.ok || !response.body) {
                    throw new Error(`Failed to fetch video stream: ${response.status}`);
                }
                const webStream = Readable.fromWeb(response.body as any);
                webStream.on('error', (err) => stream.emit('error', err));
                webStream.pipe(stream);
            } else {
                const tempFile = await downloadVideoParallel(format.url, options.proxy, options.signal, (percent) => {
                    stream.emit('progress', percent);
                });

                if (!tempFile) {
                    throw new Error('Download failed, no file returned.');
                }

                const readStream = createReadStream(tempFile);

                readStream.on('error', (err) => {
                    stream.emit('error', err);
                    fs.unlink(tempFile).catch(() => { });
                });

                readStream.on('end', () => {
                    fs.unlink(tempFile).catch(() => { });
                });

                readStream.pipe(stream);
            }

        } catch (err) {
            stream.emit('error', err);
        }
    })();

    return stream;
}

untube.getVideoInfo = getVideoInfo;
untube.RawCookie = RawCookie;
untube.filterFormats = filterFormats;
untube.sortFormats = sortFormats;
untube.chooseFormat = chooseFormat;
untube.ytmusic = ytmusic;

export { getVideoInfo, RawCookie, filterFormats, sortFormats, chooseFormat, FilterFunction, FilterString, ChooseFormatQuality, ChooseFormatOptions, ytmusic, YTMusicSearchResult, SearchYTMusicOptions }
export default untube;
