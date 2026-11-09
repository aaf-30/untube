import CookieManager, { RawCookie } from './cookie-manager.js'
import jsc from './solver-bundle.js'
import crypto from 'node:crypto'
import { fetch, ProxyAgent } from 'undici'
import { filterFormats, sortFormats, chooseFormat, extractVideoId, FilterFunction, FilterString, ChooseFormatQuality, ChooseFormatOptions } from './utils.js'
import { PassThrough, Readable } from 'node:stream'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import { downloadVideoParallel } from './downloader.js'
import { ytmusic, YTMusicSearchResult, SearchYTMusicOptions, YTMusicTrackInfo, getTrackInfo } from './ytmusic.js'
import { mintLocalPoTokenWithExpiry, resetLocalMinter, closeMinter } from './pot/local.js'

const globalPreprocessedPlayerCache = new Map<string, any>()

interface CachedPoToken {
    poToken: string
    expires: number
    route?: string
}

/**
 * yt-dlp's test for an authenticated cookie jar: a SAPISID-family cookie plus LOGIN_INFO.
 */
function hasAuthCookiesIn(jar: { getCookiesSync: (url: string) => any[] }, url: string): boolean {
    const names = new Set(jar.getCookiesSync(url).map((c) => c.key))
    return ['SAPISID', '__Secure-1PAPISID', '__Secure-3PAPISID'].some((name) => names.has(name)) && names.has('LOGIN_INFO')
}

interface GvsContentBinding {
    type: 'video' | 'session' | 'visitor'
    value: string
}

const poTokenCache = new Map<string, CachedPoToken>()
const POT_CACHE_TTL_MS = 6 * 60 * 60 * 1000
/** Video-ID-bound tokens (see gvsBindToVideoId) add one entry per video, so bound the cache. */
const POT_CACHE_MAX_ENTRIES = 512

/**
 * bgutil-ytdlp-pot-provider exposes its HTTP API at `/get_pot`.
 * Accept either a base URL (https://host) or the full endpoint.
 */
function resolvePotEndpoint(providerUrl: string): string {
    try {
        const url = new URL(providerUrl)
        if (url.pathname === '' || url.pathname === '/') {
            url.pathname = '/get_pot'
        }
        return url.toString()
    } catch {
        return providerUrl
    }
}

/**
 * Request a PO token from an external provider (e.g. bgutil-ytdlp-pot-provider).
 * The provider must mint for the requested video, account session, or visitor.
 * A returned content binding is never used to change the InnerTube identity.
 */
async function fetchPoToken(
    endpoint: string,
    contentBinding: GvsContentBinding,
    dispatcher: any
): Promise<{ poToken: string } | null> {
    try {
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content_binding: contentBinding.value }),
            dispatcher
        } as any)
        if (!res.ok) {
            console.warn(`PO Token provider returned ${res.status} ${res.statusText}`)
            return null
        }
        const data: any = await res.json()
        const poToken = data?.poToken || data?.po_token
        if (typeof poToken !== 'string' || !poToken) {
            console.warn('PO Token provider response did not contain a token')
            return null
        }
        const echoedBinding = data?.contentBinding ?? data?.content_binding
        const echoedVisitor = data?.visitor_data ?? data?.visitorData
        if ((echoedBinding !== undefined && echoedBinding !== contentBinding.value)
            || (contentBinding.type === 'visitor' && echoedVisitor !== undefined && echoedVisitor !== contentBinding.value)) {
            console.warn('PO Token provider returned a different content binding; refusing a mismatched token')
            return null
        }
        return { poToken: poToken.replace(/\+/g, '-').replace(/\//g, '_') }
    } catch (err) {
        console.warn('Failed to fetch PO Token from provider:', (err as Error).message)
        return null
    }
}

async function getPoToken(
    providerUrl: string,
    contentBinding: GvsContentBinding,
    dispatcher: any,
    proxy?: string
): Promise<CachedPoToken | null> {
    const endpoint = resolvePotEndpoint(providerUrl)
    const cacheKey = JSON.stringify([endpoint, proxy || '', contentBinding.type, contentBinding.value])
    const cached = poTokenCache.get(cacheKey)
    if (cached && cached.expires > Date.now()) return cached

    const fresh = await fetchPoToken(endpoint, contentBinding, dispatcher)
    if (!fresh) return null

    const entry: CachedPoToken = { ...fresh, expires: Date.now() + POT_CACHE_TTL_MS, route: proxy || '' }
    cachePoToken(cacheKey, entry)
    return entry
}

function cachePoToken(cacheKey: string, entry: CachedPoToken): void {
    poTokenCache.set(cacheKey, entry)
    // Map preserves insertion order, so this evicts the oldest entry first
    while (poTokenCache.size > POT_CACHE_MAX_ENTRIES) {
        const oldest = poTokenCache.keys().next().value
        if (oldest === undefined) break
        poTokenCache.delete(oldest)
    }
}

/** Mint locally and never cache beyond the underlying integrity token's lifetime. */
async function getLocalPoToken(contentBinding: GvsContentBinding, proxy?: string): Promise<string> {
    const cacheKey = JSON.stringify(['local', proxy || '', contentBinding.type, contentBinding.value])
    const cached = poTokenCache.get(cacheKey)
    if (cached && cached.expires > Date.now()) return cached.poToken

    try {
        const result = await mintLocalPoTokenWithExpiry(contentBinding.value, proxy)
        cachePoToken(cacheKey, { ...result, expires: Math.min(result.expires, Date.now() + POT_CACHE_TTL_MS), route: proxy || '' })
        return result.poToken
    } catch (cause) {
        throw new Error('Failed to mint a required GVS PO token for mweb', { cause })
    }
}

function invalidatePoTokens(proxy?: string): void {
    for (const [key, entry] of poTokenCache) {
        if (entry.route === (proxy || '')) poTokenCache.delete(key)
    }
    resetLocalMinter(proxy)
}

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
    /** YouTube's own view of the session that served the request (watch-page ytcfg `LOGGED_IN`). `null` when YouTube did not report it. */
    logged_in: boolean | null
    /**
     * Whether the cookie jar held YouTube auth cookies (`SAPISID` family + `LOGIN_INFO`).
     * `has_auth_cookies && !logged_in` means YouTube ignored them: the session expired
     * or was rotated, so export the cookies again.
     */
    has_auth_cookies: boolean
    _client?: string
}

export interface InnerTubeClientConfig {
    name: string
    clientName: string
    clientVersion: string
    clientId: string
    userAgent: string
    origin: string
    deviceMake?: string
    deviceModel?: string
    osName?: string
    osVersion?: string
}

export const CLIENT_CONFIGS: Record<string, InnerTubeClientConfig> = {
    visionos: {
        name: 'visionos',
        clientName: 'VISIONOS',
        clientVersion: '1.02',
        clientId: '101',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
        origin: 'https://www.youtube.com',
        deviceMake: 'Apple',
        deviceModel: 'RealityDevice17,1',
        osName: 'visionOS',
        osVersion: '26.5.23O471'
    },
    mweb: {
        name: 'mweb',
        clientName: 'MWEB',
        clientVersion: '2.20241029.07.00',
        clientId: '2',
        userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        origin: 'https://m.youtube.com'
    }
}

export interface GetVideoInfoOptions {
    cookies?: string | RawCookie
    proxy?: string
    client?: 'visionos' | 'mweb' | string
    potProviderUrl?: string
}

/**
 * Get YouTube video information along with streaming data (CDN URL)
 * that has been automatically decrypted.
 *
 * @param idOrUrl - A YouTube video ID or a video URL
 * @param options - Optional configuration
 * @returns Promise<VideoInfo>
 */
async function getVideoInfo(idOrUrl: string, options: GetVideoInfoOptions = {}): Promise<VideoInfo> {
    const dispatcher = options.proxy ? new ProxyAgent(options.proxy) : undefined
    try {
        return await getVideoInfoAttempt(idOrUrl, options, { refreshed: new Set(), rejected: new Set() }, dispatcher)
    } finally {
        await dispatcher?.destroy().catch(() => {})
    }
}

interface ExtractionAttempts {
    refreshed: Set<string>
    rejected: Set<string>
    hasAuthCookies?: boolean
}

async function getVideoInfoAttempt(idOrUrl: string, options: GetVideoInfoOptions, attempts: ExtractionAttempts, dispatcher?: ProxyAgent): Promise<VideoInfo> {
    const videoId = extractVideoId(idOrUrl)
    if (!videoId) {
        throw new Error(/(?:\/playlist|\blist=)/.test(idOrUrl)
            ? 'That URL points to a playlist, not to a single video. Pass a video ID or a video URL.'
            : 'Invalid YouTube video ID or URL.')
    }

    const cm = new CookieManager(options.cookies)
    await cm.load()
    // Snapshot taken *before* any request: YouTube answers an expired session with
    // Set-Cookie that clears the auth cookies, and those are saved back to the file.
    // Reading it up front is what makes `has_auth_cookies && !logged_in` mean "expired"
    // rather than "no cookies were provided".
    const hasAuthCookies = attempts.hasAuthCookies ??= hasAuthCookiesIn(cm.jar, 'https://www.youtube.com')

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
    const visitorData = ytcfg.VISITOR_DATA

    // YouTube's own view of the session, straight from the watch page config.
    const loggedIn: boolean | null = typeof ytcfg.LOGGED_IN === 'boolean' ? ytcfg.LOGGED_IN : null

    // When YouTube runs the `html5_generate_content_po_token` experiment, the GVS PO token
    // has to be bound to the video ID instead of the visitor data or the CDN answers 403.
    // yt-dlp detects the same flag and calls it gvs_bind_to_video_id.
    const gvsBindToVideoId = Object.values((ytcfg.WEB_PLAYER_CONTEXT_CONFIGS || {}) as Record<string, any>).some((cfg) => {
        const flags = cfg?.serializedExperimentFlags
        return typeof flags === 'string' && new URLSearchParams(flags).get('html5_generate_content_po_token') === 'true'
    })

    let initialPlayerResponse: any = {}
    const initialPlayerMatch = pageHtml.match(/ytInitialPlayerResponse\s*=\s*(\{.*?\});/)
    if (initialPlayerMatch) {
        try {
            initialPlayerResponse = JSON.parse(initialPlayerMatch[1]!)
        } catch { }
    }

    // Keep the full Data Sync ID (including ||) as the account token binding.
    const dataSyncId = [
        ytcfg.DATASYNC_ID,
        ytcfg.responseContext?.mainAppWebResponseContext?.datasyncId,
        initialPlayerResponse.responseContext?.mainAppWebResponseContext?.datasyncId
    ].find((value): value is string => typeof value === 'string' && value.length > 0)
    const authenticated = loggedIn ?? hasAuthCookies

    const apiUrl = `https://www.youtube.com/youtubei/v1/player?key=${apiKey}&prettyPrint=false`
    const apiCookieString = cm.getCookieString(apiUrl)
    const sapisidCookie = cm.jar.getCookiesSync(apiUrl).find((c: any) => c.key === 'SAPISID')

    let candidateClientNames: string[]
    if (options.client) {
        if (!CLIENT_CONFIGS[options.client]) {
            throw new Error(`Unknown InnerTube client "${options.client}". Available clients: ${Object.keys(CLIENT_CONFIGS).join(', ')}`)
        }
        candidateClientNames = [options.client]
    } else {
        // visionos needs no cookies/PO token and returns the full format ladder;
        // mweb unlocks logged-in content but needs a GVS PO token.
        // (The `web` and `web_embedded` clients were removed: YouTube forces SABR on
        // `web` -- it only ever yielded the muxed itag 18 even with a correctly bound
        // PO token -- and `web_embedded` replies "This video is unavailable" unless the
        // request carries the embed page's session-bound encrypted context.)
        candidateClientNames = ['visionos', 'mweb']
    }

    let json: any = null
    let lastError: any = null
    let generatedPoToken: string | undefined = undefined
    let successfulClient: string = ''

    for (const clientKey of candidateClientNames.filter((name) => !attempts.rejected.has(name))) {
        generatedPoToken = undefined;
        const clientConfig = CLIENT_CONFIGS[clientKey]!
        const clientVersion = (clientKey === 'mweb' && ytcfg.INNERTUBE_CLIENT_VERSION) ? ytcfg.INNERTUBE_CLIENT_VERSION : clientConfig.clientVersion

        const clientPayload: any = {
            clientName: clientConfig.clientName,
            clientVersion,
            userAgent: clientConfig.userAgent,
            hl: 'en',
            gl: 'US'
        }
        if (clientConfig.deviceMake) clientPayload.deviceMake = clientConfig.deviceMake
        if (clientConfig.deviceModel) clientPayload.deviceModel = clientConfig.deviceModel
        if (clientConfig.osName) clientPayload.osName = clientConfig.osName
        if (clientConfig.osVersion) clientPayload.osVersion = clientConfig.osVersion

        const payload: any = {
            context: {
                client: clientPayload
            },
            videoId,
            racyCheckOk: true,
            contentCheckOk: true,
            playbackContext: {
                contentPlaybackContext: {
                    html5Preference: 'HTML5_PREF_WANTS',
                    signatureTimestamp: sts
                }
            }
        }
        const clientVisitorData: string | undefined = visitorData
        if (clientKey !== 'visionos') {
            // GVS tokens use the video ID during the experiment, the account Data Sync
            // ID when authenticated, and visitor data for guests. Cookies alone do not
            // make a visitor-bound token valid for an account session.
            // (A player-context token is a different thing: it goes in
            //  `serviceIntegrityDimensions`. No remaining client needs one.)
            const binding: GvsContentBinding = gvsBindToVideoId
                ? { type: 'video', value: videoId }
                : authenticated
                    ? { type: 'session', value: dataSyncId || '' }
                    : { type: 'visitor', value: visitorData || '' }
            if (!binding.value) {
                throw new Error(authenticated && !gvsBindToVideoId
                    ? 'A GVS PO token for logged-in mweb requires an account Data Sync ID, but YouTube did not provide one'
                    : 'A GVS PO token for guest mweb requires visitor data, but YouTube did not provide it')
            }
            if (options.potProviderUrl) {
                const pot = await getPoToken(options.potProviderUrl, binding, dispatcher, options.proxy)
                if (pot) {
                    generatedPoToken = pot.poToken
                }
            } else {
                generatedPoToken = await getLocalPoToken(binding, options.proxy)
            }
        }
        if (clientKey === 'mweb' && !generatedPoToken) {
            throw new Error('A GVS PO token is required for mweb, but the provider returned no token or the content binding is missing')
        }
        if (clientVisitorData) {
            clientPayload.visitorData = clientVisitorData
        }

        const apiHeaders: Record<string, string> = {
            'User-Agent': clientConfig.userAgent,
            'Content-Type': 'application/json',
            'X-Youtube-Client-Name': clientConfig.clientId,
            'X-Youtube-Client-Version': clientVersion,
            'Origin': clientConfig.origin
        }
        if (clientVisitorData) {
            apiHeaders['X-Goog-Visitor-Id'] = clientVisitorData
        }
        if (clientKey !== 'visionos') {
            if (apiCookieString) {
                apiHeaders['Cookie'] = apiCookieString
            }
            if (authenticated) {
                const [firstSessionId, secondSessionId] = dataSyncId?.split('||') || []
                const delegatedSessionId = ytcfg.DELEGATED_SESSION_ID || (secondSessionId ? firstSessionId : undefined)
                if (delegatedSessionId) apiHeaders['X-Goog-PageId'] = delegatedSessionId
                if (ytcfg.SESSION_INDEX != null || delegatedSessionId) {
                    apiHeaders['X-Goog-AuthUser'] = String(ytcfg.SESSION_INDEX ?? 0)
                }
            }
            if (sapisidCookie) {
                const timestamp = Math.floor(Date.now() / 1000).toString()
                const hash = crypto.createHash('sha1').update(`${timestamp} ${sapisidCookie.value} ${clientConfig.origin}`).digest('hex')
                apiHeaders.Authorization = `SAPISIDHASH ${timestamp}_${hash}`
            }
        }

        try {
            const apiRes = await fetch(apiUrl, {
                method: 'POST',
                headers: apiHeaders,
                body: JSON.stringify(payload),
                dispatcher
            } as any)

            const apiSetCookies = (apiRes.headers as any).getSetCookie()
            if (apiSetCookies && apiSetCookies.length > 0 && clientKey !== 'visionos') {
                apiSetCookies.forEach((cookie: any) => cm.setCookieString(cookie, apiUrl))
                await cm.save()
            }

            if (!apiRes.ok) {
                lastError = new Error(`InnerTube API failed (${clientKey}): ${apiRes.status} ${apiRes.statusText}`)
                continue
            }

            const resJson: any = await apiRes.json()
            if (resJson.playabilityStatus && resJson.playabilityStatus.status !== 'OK') {
                const reason = resJson.playabilityStatus.reason || resJson.playabilityStatus.status
                // A "Sign in..." reason while the jar holds auth cookies means YouTube no
                // longer accepts that session, which usually means it has expired.
                const hint = hasAuthCookies && clientKey !== 'visionos' && /sign in/i.test(String(reason))
                    ? ' -- the provided cookies look authenticated but YouTube rejected them; they have probably expired or been rotated. Re-export them.'
                    : ''
                lastError = new Error(`YouTube Error (${clientKey}): ${reason}${hint}`)
                continue
            }

            const fmts = [
                ...(resJson.streamingData?.formats || []),
                ...(resJson.streamingData?.adaptiveFormats || [])
            ]
            
            const usableFmts = fmts.filter((f: any) => f.url || f.signatureCipher || f.cipher)
            if (usableFmts.length === 0) {
                lastError = new Error(`No usable streaming formats returned for client ${clientKey}`)
                continue
            }

            const adaptiveFmts = resJson.streamingData?.adaptiveFormats || []
            if (adaptiveFmts.length > 0) {
                const usableAdaptive = adaptiveFmts.filter((f: any) => f.url || f.signatureCipher || f.cipher)
                // Some clients (e.g. web/mweb during YouTube's SABR-only experiment) return
                // adaptive formats without any URL or cipher. Treat a mostly-unusable list as
                // a soft-block and fall back to another client instead of exposing dead formats.
                if (usableAdaptive.length * 2 < adaptiveFmts.length) {
                    lastError = new Error(`YouTube Error (${clientKey}): Soft-block detected (${usableAdaptive.length}/${adaptiveFmts.length} adaptive formats usable; SABR-only response)`)
                    continue
                }
            }

            json = resJson
            successfulClient = clientKey
            break
        } catch (err: any) {
            lastError = err
        }
    }

    if (!json) {
        throw (lastError || new Error('Failed to retrieve video information from any InnerTube client.'))
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
        const cipher = format.signatureCipher || format.cipher
        if (cipher) {
            const searchParams = new URLSearchParams(cipher)
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
            const cipher = format.signatureCipher || format.cipher
            if (cipher) {
                const searchParams = new URLSearchParams(cipher)
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
                delete format.cipher
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
    
    // Append the GVS PO Token to format URLs if generated
    if (generatedPoToken) {
        if (json.streamingData?.formats) {
            for (const format of json.streamingData.formats) {
                if (format.url) {
                    const u = new URL(format.url);
                    u.searchParams.set('pot', generatedPoToken);
                    format.url = u.toString();
                }
            }
        }
        if (json.streamingData?.adaptiveFormats) {
            for (const format of json.streamingData.adaptiveFormats) {
                if (format.url) {
                    const u = new URL(format.url);
                    u.searchParams.set('pot', generatedPoToken);
                    format.url = u.toString();
                }
            }
        }
    }

    // Probe only the final URL, after both signature/n solving and PO token attachment.
    const probeFormat = allFormats.find((f) => f.itag === 140 && f.url) || allFormats.find((f) => f.url)
    let cdnForbidden = false
    if (probeFormat) {
        try {
            const probe = await fetch(probeFormat.url, {
                method: 'GET',
                headers: {
                    Range: 'bytes=0-0',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    Origin: 'https://www.youtube.com',
                    Referer: 'https://www.youtube.com/'
                },
                dispatcher,
                signal: AbortSignal.timeout(10_000)
            })
            cdnForbidden = probe.status === 403
            await probe.body?.cancel()
        } catch {
            // A timeout or unsupported probe must not hide otherwise available metadata.
        }
    }
    if (cdnForbidden) {
        if (successfulClient === 'mweb' && !attempts.refreshed.has(successfulClient)) {
            attempts.refreshed.add(successfulClient)
            invalidatePoTokens(options.proxy)
            return getVideoInfoAttempt(idOrUrl, options, attempts, dispatcher)
        }
        attempts.rejected.add(successfulClient)
        if (!options.client && Object.keys(CLIENT_CONFIGS).some((name) => !attempts.rejected.has(name))) {
            return getVideoInfoAttempt(idOrUrl, options, attempts, dispatcher)
        }
        throw new Error(`YouTube CDN returned 403 Forbidden (${successfulClient}) after URL decryption${attempts.refreshed.has(successfulClient) ? ' and one PO token refresh' : ''}`)
    }

    json.videoDetails = { ...(initialPlayerResponse.videoDetails || {}), ...(json.videoDetails || {}) }
    json.microformat = initialPlayerResponse.microformat || json.microformat

    const result: VideoInfo = {
        ...normalizeYtDlp(json),
        _client: successfulClient,
        logged_in: loggedIn,
        has_auth_cookies: hasAuthCookies
    }
    return result
}

// The session fields are filled in by getVideoInfo, which is where the watch page
// config and the cookie jar are in scope.
function normalizeYtDlp(json: any): Omit<VideoInfo, 'logged_in' | 'has_auth_cookies'> {
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
                url: track.baseUrl?.startsWith('http') ? track.baseUrl : `https://www.youtube.com${track.baseUrl}`,
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
 * @param idOrUrl - A YouTube video ID or a video URL
 * @param options - Options for fetching info and selecting format
 * @returns A PassThrough stream containing the downloaded video/audio data
 */
function untube(idOrUrl: string, options: UntubeOptions = {}): PassThrough {
    const stream = new PassThrough();

    (async () => {
        try {
            const info = await getVideoInfo(idOrUrl, options);
            const format = chooseFormat(info.formats, {
                quality: options.format,
                filter: options.filter
            });

            stream.emit('info', info, format);

            const baseHeaders: Record<string, string> = {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Origin': 'https://www.youtube.com',
                'Referer': 'https://www.youtube.com/'
            };

            if (options.mode === 'sequential' || format.url.includes('.m3u8')) {
                const dispatcher = options.proxy ? new ProxyAgent(options.proxy) : undefined;
                const requestHeaders: Record<string, string> = { ...baseHeaders };

                if (!format.url.includes('.m3u8')) {
                    requestHeaders.Range = 'bytes=0-';
                }
                const fetchOptions: any = { headers: requestHeaders, dispatcher, signal: options.signal };

                const response = await fetch(format.url, fetchOptions);
                if (!response.ok || !response.body) {
                    throw new Error(`Failed to fetch video stream: ${response.status}`);
                }
                const webStream = Readable.fromWeb(response.body as any);
                webStream.on('error', (err) => stream.emit('error', err));
                webStream.pipe(stream);
            } else {
                const tempFile = await downloadVideoParallel(
                    format.url,
                    options.proxy,
                    options.signal,
                    (percent) => {
                        stream.emit('progress', percent);
                    },
                    baseHeaders
                );

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
untube.extractVideoId = extractVideoId;
untube.closeMinter = closeMinter;
untube.ytmusic = ytmusic;
untube.getTrackInfo = getTrackInfo;

export { getVideoInfo, RawCookie, filterFormats, sortFormats, chooseFormat, extractVideoId, closeMinter, FilterFunction, FilterString, ChooseFormatQuality, ChooseFormatOptions, ytmusic, YTMusicSearchResult, SearchYTMusicOptions, YTMusicTrackInfo, getTrackInfo }
export default untube;
