import { ORIGIN, UA } from "../ua.js";

/**
 * The host half of `assets/page/net.js`: the only place in this project that opens a socket.
 *
 * Everything the player sends goes through here, which is what makes the two observations this
 * project is built on possible at all — `/youtubei/v1/player` carries the format catalog, and
 * `/videoplayback` carries the signed CDN URL.
 *
 * Cookies are owned here, not in the page: `document.cookie` is a static empty string in
 * `assets/vendor/env.raw.js`, mirroring ymusic's design where the page never touches them.
 */

export interface HttpRequestDescriptor {
  url: string;
  method: string;
  headers: [string, string][];
  /** Base64. Bodies cross the boundary encoded so the sandbox can rebuild its own Uint8Array. */
  bodyB64: string | null;
}

export interface HttpResponseDescriptor {
  url: string;
  status: number;
  statusText: string;
  headers: [string, string][];
  bodyB64: string;
}

export type HttpNext = (req: HttpRequestDescriptor) => Promise<HttpResponseDescriptor>;

export interface HttpInterceptor {
  name: string;
  (req: HttpRequestDescriptor, next: HttpNext): Promise<HttpResponseDescriptor>;
}

/**
 * Script GETs the page is allowed to make. Everything else ending in `.js` gets a synthetic 404.
 *
 * The page runs YouTube's own code, so this is not about trusting the script — it is about the
 * page pulling in anything *other* than the player it is here to run. Ported from ymusic's
 * `logic/yt/jsAllow.ts`, whose suffix test is what accommodates the real path shape
 * `/s/player/<hash>/player_es6.vflset/<locale>/base.js`.
 */
export function isScriptAllowed(url: string): boolean {
  const q = url.indexOf("?");
  const path = (q >= 0 ? url.slice(0, q) : url).toLowerCase();
  if (!path.includes(".js")) return true;
  if (path.includes("/js/th/")) return true;
  if (path.includes("botguard")) return true;
  if (!path.includes("/s/player/")) return false;
  return path.endsWith("/base.js") || path.endsWith("/heartbeat.js");
}

// ---------------------------------------------------------------------------
// Cookie jar
// ---------------------------------------------------------------------------

interface CookieRecord {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number | null;
}

/** Host-only matching plus a one-level-unrestricted suffix walk; enough for YouTube's own jar. */
function domainMatches(cookieDomain: string, host: string): boolean {
  if (cookieDomain === host) return true;
  if (!cookieDomain.startsWith(".")) return false;
  const bare = cookieDomain.slice(1);
  return host === bare || host.endsWith("." + cookieDomain);
}

export class CookieJar {
  private readonly cookies = new Map<string, CookieRecord>();

  private key(c: CookieRecord): string {
    return c.domain + "\u0000" + c.path + "\u0000" + c.name;
  }

  setFromResponse(url: string, setCookieValues: readonly string[]): void {
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return;
    }
    for (const raw of setCookieValues) {
      const parts = raw.split(";");
      const pair = parts.shift();
      if (!pair) continue;
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (!name) continue;

      let domain = host;
      let path = "/";
      let expires: number | null = null;
      for (const attr of parts) {
        const a = attr.trim();
        const i = a.indexOf("=");
        const k = (i < 0 ? a : a.slice(0, i)).toLowerCase();
        const v = i < 0 ? "" : a.slice(i + 1).trim();
        if (k === "domain" && v) domain = v.startsWith(".") ? v : "." + v;
        else if (k === "path" && v) path = v;
        else if (k === "max-age") {
          const n = Number(v);
          if (Number.isFinite(n)) expires = Date.now() + n * 1000;
        } else if (k === "expires") {
          const t = Date.parse(v);
          if (Number.isFinite(t)) expires = t;
        }
      }
      // An empty value is a tombstone, not a cookie.
      const record: CookieRecord = { name, value, domain, path, expires };
      if (value === "") this.cookies.delete(this.key(record));
      else this.cookies.set(this.key(record), record);
    }
  }

  set(domain: string, name: string, value: string, path = "/"): void {
    const d = domain.startsWith(".") ? domain : "." + domain;
    const record: CookieRecord = { name, value, domain: d, path, expires: null };
    this.cookies.set(this.key(record), record);
  }

  get(host: string, name: string): string | undefined {
    const now = Date.now();
    for (const c of this.cookies.values()) {
      if (c.name !== name) continue;
      if (c.expires !== null && c.expires <= now) continue;
      if (domainMatches(c.domain, host)) return c.value;
    }
    return undefined;
  }

  headerFor(url: string): string {
    let host: string;
    let path: string;
    try {
      const u = new URL(url);
      host = u.hostname;
      path = u.pathname || "/";
    } catch {
      return "";
    }
    const now = Date.now();
    const out: string[] = [];
    for (const c of this.cookies.values()) {
      if (c.expires !== null && c.expires <= now) continue;
      if (!domainMatches(c.domain, host)) continue;
      if (!path.startsWith(c.path)) continue;
      out.push(c.name + "=" + c.value);
    }
    return out.join("; ");
  }

  /**
   * YouTube serves a consent wall unless it sees a decision. ymusic cooks these on demand from
   * the same jar (`logic/yt/cookies.ts`); without it the homepage comes back stripped.
   */
  ensureConsent(): void {
    const consent = this.get("www.youtube.com", "CONSENT") ?? "";
    if (!consent.startsWith("YES+")) {
      const n = 100 + Math.floor(Math.random() * 500);
      this.set("youtube.com", "CONSENT", "YES+" + n);
    }
    if ((this.get("www.youtube.com", "SOCS") ?? "") === "") {
      this.set("youtube.com", "SOCS", "CAISNQgQEitib3FfaWRlbnRpdHlmcm9udGVuZHVpc2VydmVyXzIwMjQwNjExLjA3X3AwGgJlbiACGgYIgLC_ugY");
    }
  }

  all(): CookieRecord[] {
    return [...this.cookies.values()];
  }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export interface HttpOptions {
  /** Observe the process's traffic. Retries and redirects are visible here too. */
  interceptors?: HttpInterceptor[];
  log?: (level: "debug" | "info" | "warn" | "error", message: string) => void;
}

function headerLookup(headers: readonly [string, string][], name: string): string | undefined {
  const n = name.toLowerCase();
  for (const [k, v] of headers) if (k.toLowerCase() === n) return v;
  return undefined;
}

function stripHeaders(headers: readonly [string, string][], names: readonly string[]): [string, string][] {
  const deny = new Set(names.map((n) => n.toLowerCase()));
  return headers.filter(([k]) => !deny.has(k.toLowerCase()));
}

export class SandboxHttp {
  readonly jar = new CookieJar();

  private readonly interceptors: HttpInterceptor[];
  private readonly log: (level: "debug" | "info" | "warn" | "error", message: string) => void;

  constructor(opts: HttpOptions = {}) {
    this.interceptors = opts.interceptors ? [...opts.interceptors] : [];
    this.log = opts.log ?? (() => {});
  }

  use(interceptor: HttpInterceptor): void {
    this.interceptors.push(interceptor);
  }

  async send(req: HttpRequestDescriptor): Promise<HttpResponseDescriptor> {
    let index = -1;
    const dispatch = async (r: HttpRequestDescriptor): Promise<HttpResponseDescriptor> => {
      index += 1;
      const next = this.interceptors[index];
      if (next) return next(r, dispatch);
      return this.perform(r);
    };
    try {
      return await dispatch(req);
    } finally {
      index = -1;
    }
  }

  private async perform(req: HttpRequestDescriptor): Promise<HttpResponseDescriptor> {
    const url = req.url;

    if (!isScriptAllowed(url)) {
      this.log("debug", "untube: script blocked by allowlist " + url);
      return {
        url,
        status: 404,
        statusText: "Not Found",
        headers: [["content-type", "text/plain"]],
        bodyB64: "",
      };
    }

    this.jar.ensureConsent();

    const headers = new Headers();
    for (const [k, v] of stripHeaders(req.headers, ["host", "cookie", "content-length", "connection"])) {
      // A page may claim any UA it likes; the wire identity is ours and must stay consistent
      // with what `env.raw.js` attests.
      if (k.toLowerCase() === "user-agent") continue;
      try {
        headers.set(k, v);
      } catch {
        /* A malformed header from the page is dropped rather than failing the request. */
      }
    }
    headers.set("user-agent", UA);
    const cookie = this.jar.headerFor(url);
    if (cookie) headers.set("cookie", cookie);

    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      /* Left empty; fetch will reject a malformed URL anyway. */
    }
    if (host.endsWith("youtube.com") || host.endsWith("google.com")) {
      if (!headers.has("origin")) headers.set("origin", ORIGIN);
      if (!headers.has("referer")) headers.set("referer", ORIGIN + "/");
    }

    const init: RequestInit = {
      method: req.method,
      headers,
      redirect: "follow",
    };
    if (req.bodyB64 !== null && req.bodyB64 !== "") {
      init.body = Buffer.from(req.bodyB64, "base64");
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log("warn", "untube: " + req.method + " " + url + " failed: " + msg);
      throw new Error("network: " + msg);
    }

    const setCookies = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    if (setCookies.length) this.jar.setFromResponse(res.url || url, setCookies);

    const buf = Buffer.from(await res.arrayBuffer());
    const outHeaders: [string, string][] = [];
    res.headers.forEach((v, k) => {
      outHeaders.push([k, v]);
    });

    this.log("debug", "untube: " + req.method + " " + res.status + " " + url);

    return {
      url: res.url || url,
      status: res.status,
      statusText: res.statusText,
      headers: outHeaders,
      bodyB64: buf.toString("base64"),
    };
  }
}

export { headerLookup };
