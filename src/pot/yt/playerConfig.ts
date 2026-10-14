/**
 * The boot fields the WEB player needs, scraped from the youtube.com homepage HTML:
 * `ytcfg`, `EVENT_ID`, the BotGuard program, and the player `jsUrl`.
 *
 * Ported from ymusic's `logic/yt/playerConfig.ts`. The parse is deliberately hand-rolled over
 * `indexOf` rather than regex — the homepage is ~1 MB and a backtracking scan over it is slow.
 */

export interface BgChallenge {
  program: string;
  globalName: string;
  interpreterJavascript?: string;
  interpreterUrl?: string;
}

export interface PlayerConfig {
  ytcfg: Record<string, unknown>;
  eventId: string;
  bgChallenge: BgChallenge;
  jsUrl: string;
  inlineScripts: string[];
}

function asRec(v: unknown): Record<string, unknown> | null {
  if (v == null || typeof v !== "object") return null;
  return v as Record<string, unknown>;
}

function extractBalanced(src: string, start: number): string | null {
  if (src.charAt(start) !== "{") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let q = "";
  for (let i = start; i < src.length; i++) {
    const c = src.charAt(i);
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") {
      inStr = true;
      q = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

export function parseYtcfg(html: string): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  let from = 0;
  for (;;) {
    const i = html.indexOf("ytcfg.set(", from);
    if (i < 0) break;
    let p = i + 10;
    while (p < html.length && html.charAt(p) === " ") p++;
    if (html.charAt(p) === "{") {
      const raw = extractBalanced(html, p);
      if (raw) {
        try {
          const obj = JSON.parse(raw) as Record<string, unknown>;
          for (const k of Object.keys(obj)) merged[k] = obj[k];
        } catch {
          /* A malformed ytcfg.set block is skipped; later ones still merge. */
        }
      }
    }
    from = i + 10;
  }
  return merged;
}

function ytcfgField(html: string, key: string): string {
  const needle = '"' + key + '"';
  const at = html.indexOf(needle);
  if (at < 0) return "";
  const colon = html.indexOf(":", at + needle.length);
  if (colon < 0) return "";
  let i = colon + 1;
  while (i < html.length && (html.charAt(i) === " " || html.charAt(i) === "\n")) i++;
  if (html.charAt(i) === '"') {
    const end = html.indexOf('"', i + 1);
    return end > i ? html.slice(i + 1, end) : "";
  }
  let j = i;
  while (j < html.length && /[0-9A-Za-z._-]/.test(html.charAt(j))) j++;
  return html.slice(i, j);
}

function extractJsQuoted(src: string, start: number): { value: string; end: number } | null {
  const q = src.charAt(start);
  if (q !== "'" && q !== '"') return null;
  let out = "";
  for (let i = start + 1; i < src.length; i++) {
    const c = src.charAt(i);
    if (c === "\\") {
      out += c;
      if (i + 1 < src.length) {
        out += src.charAt(i + 1);
        i++;
      }
      continue;
    }
    if (c === q) return { value: out, end: i + 1 };
    out += c;
  }
  return null;
}

function decodeJsString(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charAt(i);
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = s.charAt(i + 1);
    if (n === "x" && i + 3 < s.length) {
      const h = parseInt(s.slice(i + 2, i + 4), 16);
      if (!isNaN(h)) {
        out += String.fromCharCode(h);
        i += 3;
        continue;
      }
    }
    if (n === "u" && i + 5 < s.length) {
      const h = parseInt(s.slice(i + 2, i + 6), 16);
      if (!isNaN(h)) {
        out += String.fromCharCode(h);
        i += 5;
        continue;
      }
    }
    if (n === "n") {
      out += "\n";
      i++;
      continue;
    }
    if (n === "r") {
      out += "\r";
      i++;
      continue;
    }
    if (n === "t") {
      out += "\t";
      i++;
      continue;
    }
    out += n || "";
    i++;
  }
  return out;
}

/** TrustedResourceUrl / SafeScript wrappers carry the real string under a private key. */
function unwrapTru(v: unknown): string {
  if (typeof v === "string") return v;
  const o = asRec(v);
  if (!o) return "";
  const w =
    o["privateDoNotAccessOrElseTrustedResourceUrlWrappedValue"] ??
    o["privateDoNotAccessOrElseSafeScriptWrappedValue"];
  return typeof w === "string" ? w : "";
}

function parseYtAtN(html: string): Record<string, unknown> | null {
  const markers = ["ytAtN({'R':", 'ytAtN({"R":'];
  for (const marker of markers) {
    const i = html.indexOf(marker);
    if (i < 0) continue;
    let p = i + marker.length;
    while (p < html.length && html.charAt(p) === " ") p++;
    const quoted = extractJsQuoted(html, p);
    if (!quoted) continue;
    try {
      const obj = JSON.parse(decodeJsString(quoted.value)) as Record<string, unknown>;
      const bg = asRec(obj["bgChallenge"]);
      if (bg && typeof bg["program"] === "string") return bg;
    } catch {
      /* Try the next marker spelling. */
    }
  }
  return null;
}

/**
 * The player is served from a locale-specific bundle (`player_ias.vflset/id_ID/base.js`).
 * ymusic pins `player_es6` — the same engine under the name the modern WEB client is served —
 * because the legacy `ias` bundle lags behind on the APIs the player relies on.
 */
function iasPlayerUrl(src: string): string {
  return src.replace(/\/player_\w+\.vflset/g, "/player_es6.vflset");
}

function jsUrlFromCtx(ctx: Record<string, unknown> | null): string {
  if (!ctx) return "";
  const trusted = unwrapTru(ctx["trustedJsUrl"]);
  if (trusted) return iasPlayerUrl(trusted);
  return typeof ctx["jsUrl"] === "string" ? iasPlayerUrl(ctx["jsUrl"] as string) : "";
}

function extractJsUrl(ytcfg: Record<string, unknown>, html: string): string {
  const ctxs = asRec(ytcfg["WEB_PLAYER_CONTEXT_CONFIGS"]);
  if (ctxs) {
    const watch = jsUrlFromCtx(asRec(ctxs["WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH"]));
    if (watch) return watch;
    for (const key of Object.keys(ctxs)) {
      const u = jsUrlFromCtx(asRec(ctxs[key]));
      if (u) return u;
    }
  }
  const needle = '"jsUrl"';
  const at = html.indexOf(needle);
  if (at < 0) return "";
  const colon = html.indexOf(":", at + needle.length);
  if (colon < 0) return "";
  let i = colon + 1;
  while (i < html.length && (html.charAt(i) === " " || html.charAt(i) === "\n")) i++;
  const quoted = extractJsQuoted(html, i);
  return quoted ? iasPlayerUrl(quoted.value) : "";
}

const INLINE_SCRIPT_NEEDLES = [
  "ytcfg",
  "ytcsi",
  "PLAYER_VARS",
  "ytAtN",
  "ytAtP",
  "bgChallenge",
  "WIZ_global",
  "yt.player",
];

function extractInlineScripts(html: string): string[] {
  const out: string[] = [];
  const lower = html.toLowerCase();
  let from = 0;
  for (;;) {
    const open = lower.indexOf("<script", from);
    if (open < 0) break;
    const tagEnd = html.indexOf(">", open);
    if (tagEnd < 0) break;
    const attrs = lower.slice(open, tagEnd);
    const close = lower.indexOf("</script>", tagEnd);
    if (close < 0) break;
    from = close + 9;
    if (attrs.includes("src=")) continue;
    const body = html.slice(tagEnd + 1, close).trim();
    if (!body) continue;
    if (INLINE_SCRIPT_NEEDLES.some((n) => body.includes(n))) out.push(body);
  }
  return out;
}

/** Null when the homepage carries no BotGuard program or player jsUrl. */
export function parsePlayerConfig(html: string): PlayerConfig | null {
  const ytcfg = parseYtcfg(html);
  const eventId =
    (typeof ytcfg["EVENT_ID"] === "string" ? (ytcfg["EVENT_ID"] as string) : "") ||
    ytcfgField(html, "EVENT_ID");
  if (eventId && ytcfg["EVENT_ID"] === undefined) ytcfg["EVENT_ID"] = eventId;

  const bg = parseYtAtN(html);
  if (!bg || typeof bg["program"] !== "string") return null;
  const jsUrl = extractJsUrl(ytcfg, html);
  if (!jsUrl || !eventId) return null;

  const challenge: BgChallenge = {
    program: bg["program"] as string,
    globalName: String(bg["globalName"] ?? "trayride"),
  };
  const interpJs = unwrapTru(bg["interpreterJavascript"]);
  const interpUrl = unwrapTru(bg["interpreterUrl"]) || unwrapTru(bg["interpreterSafeUrl"]);
  if (interpJs) challenge.interpreterJavascript = interpJs;
  if (interpUrl) challenge.interpreterUrl = interpUrl;

  return {
    ytcfg,
    eventId,
    bgChallenge: challenge,
    jsUrl,
    inlineScripts: extractInlineScripts(html),
  };
}
