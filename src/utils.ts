import { YouTubeFormat } from './index.js';

export type FilterFunction = (format: YouTubeFormat) => boolean;
export type FilterString = 'audioandvideo' | 'videoandaudio' | 'video' | 'videoonly' | 'audio' | 'audioonly';

/**
 * Filters formats based on the provided filter string or function.
 *
 * @param formats - An array of YouTubeFormat objects.
 * @param filter - A predefined filter string or a custom filter function.
 * @returns A new array of filtered YouTubeFormat objects.
 */
export function filterFormats(formats: YouTubeFormat[], filter: FilterString | FilterFunction): YouTubeFormat[] {
    if (typeof filter === 'function') {
        return formats.filter(filter);
    }

    switch (filter) {
        case 'audioandvideo':
        case 'videoandaudio':
            return formats.filter((f) => f.vcodec !== 'none' && f.acodec !== 'none');
        case 'video':
            return formats.filter((f) => f.vcodec !== 'none');
        case 'videoonly':
            return formats.filter((f) => f.vcodec !== 'none' && f.acodec === 'none');
        case 'audio':
            return formats.filter((f) => f.acodec !== 'none');
        case 'audioonly':
            return formats.filter((f) => f.acodec !== 'none' && f.vcodec === 'none');
        default:
            return formats;
    }
}

/**
 * Sorts formats from highest quality to lowest quality.
 * Priority: Video Resolution -> Video Bitrate -> Audio Bitrate.
 *
 * @param formats - An array of YouTubeFormat objects.
 * @returns A new, sorted array of YouTubeFormat objects.
 */
export function sortFormats(formats: YouTubeFormat[]): YouTubeFormat[] {
    return [...formats].sort((a, b) => {
        const aRes = a.height || 0;
        const bRes = b.height || 0;
        if (aRes !== bRes) return bRes - aRes;

        const aVbr = a.vbr || 0;
        const bVbr = b.vbr || 0;
        if (aVbr !== bVbr) return bVbr - aVbr;

        const aAbr = a.abr || 0;
        const bAbr = b.abr || 0;
        return bAbr - aAbr;
    });
}

export type ChooseFormatQuality = 'highest' | 'lowest' | 'highestaudio' | 'lowestaudio' | 'highestvideo' | 'lowestvideo' | string;

/**
 * Options for selecting a specific format.
 * `quality` can be one of the predefined strings:
 * - 'highest': Best overall quality (default)
 * - 'lowest': Lowest overall quality
 * - 'highestaudio': Best audio quality
 * - 'lowestaudio': Lowest audio quality
 * - 'highestvideo': Best video quality
 * - 'lowestvideo': Lowest video quality
 * 
 * Or a specific format ID / itag (e.g., '137', '18', '299').
 * Or a specific resolution string (e.g., '1080p', '720p').
 */
export interface ChooseFormatOptions {
    quality?: ChooseFormatQuality;
    filter?: FilterString | FilterFunction;
}

/**
 * Selects a single format based on quality preferences and filters.
 *
 * @param formats - An array of YouTubeFormat objects.
 * @param options - Options for selecting the format (quality, filter).
 * @returns The best matching YouTubeFormat, or throws an Error if none is found.
 */
export function chooseFormat(formats: YouTubeFormat[], options: ChooseFormatOptions = {}): YouTubeFormat {
    let filtered = options.filter ? filterFormats(formats, options.filter) : formats;

    if (filtered.length === 0) {
        throw new Error('No formats found matching the given criteria.');
    }

    const quality = options.quality || 'highest';

    switch (quality) {
        case 'highest':
            filtered = sortFormats(filtered);
            return filtered[0] as YouTubeFormat;
        case 'lowest':
            filtered = sortFormats(filtered).reverse();
            return filtered[0] as YouTubeFormat;
        case 'highestaudio':
            filtered = filterFormats(filtered, 'audio');
            filtered.sort((a, b) => (b.abr || 0) - (a.abr || 0));
            if (filtered.length === 0) throw new Error('No audio formats found.');
            return filtered[0] as YouTubeFormat;
        case 'lowestaudio':
            filtered = filterFormats(filtered, 'audio');
            filtered.sort((a, b) => (a.abr || 0) - (b.abr || 0));
            if (filtered.length === 0) throw new Error('No audio formats found.');
            return filtered[0] as YouTubeFormat;
        case 'highestvideo':
            filtered = filterFormats(filtered, 'video');
            filtered = sortFormats(filtered);
            if (filtered.length === 0) throw new Error('No video formats found.');
            return filtered[0] as YouTubeFormat;
        case 'lowestvideo':
            filtered = filterFormats(filtered, 'video');
            filtered = sortFormats(filtered).reverse();
            if (filtered.length === 0) throw new Error('No video formats found.');
            return filtered[0] as YouTubeFormat;
        default: {
            const exactMatch = filtered.find(
                (f) =>
                    f.format_id === quality ||
                    f.format_note === quality ||
                    (typeof quality === 'string' && f.format_note.includes(quality))
            );
            if (!exactMatch) {
                throw new Error(`No format found matching quality: ${quality}`);
            }
            return exactMatch;
        }
    }
}
