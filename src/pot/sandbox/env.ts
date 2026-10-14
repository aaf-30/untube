import { ORIGIN, UA } from "../ua.js";
import type { Sandbox } from "./context.js";
import { readPage, readVendor } from "./paths.js";

/**
 * Installs the fake page: ymusic's vendored Chrome snapshot, then our own shims on top.
 *
 * Order is load-bearing. `env.raw.js` defines the DOM, and `idl_stubs.raw.js` rewires the IDL
 * prototypes onto the live objects the first file created — reversed, the stubs have nothing to
 * attach to. `url.js` must precede `net.js` because request URLs are resolved through it.
 */
export function installEnvironment(sandbox: Sandbox): void {
  sandbox.run(readVendor("env.raw.js"), "env.raw.js");
  sandbox.run(readVendor("idl_stubs.raw.js"), "idl_stubs.raw.js");
  assertUserAgent(sandbox);

  sandbox.run(readPage("url.js"), "page/url.js");
  sandbox.run(readPage("storage.js"), "page/storage.js");
  sandbox.run(readPage("observer.js"), "page/observer.js");
  sandbox.run(readPage("net.js"), "page/net.js");
  // Must precede any element creation: env.raw.js calls `HTMLMediaElement.attach` from its
  // <video>/<audio> factory the moment one is built.
  sandbox.run(readPage("mse.js"), "page/mse.js");
}

/**
 * The page's `navigator.userAgent` and the `User-Agent` on every request must be one identity.
 *
 * `env.raw.js` carries its own copy of the string rather than importing ours — it is a vendored
 * file we do not edit. This check is what keeps the two from drifting apart silently, which would
 * otherwise show up only as a stripped homepage with no error to explain it.
 */
function assertUserAgent(sandbox: Sandbox): void {
  const actual = sandbox.run<string>("String(navigator.userAgent)", "ua-probe");
  if (actual !== UA) {
    throw new Error(
      "untube: navigator.userAgent disagrees with the HTTP User-Agent.\n" +
        "  env.raw.js: " +
        actual +
        "\n" +
        "  ua.ts:      " +
        UA +
        "\n" +
        "Both must be the same Chrome major; YouTube treats a mismatch as a forged client.",
    );
  }
}

/** Chrome builds `/player`'s originalUrl/currentUrl/graftUrl from the watch URL. */
export function setWatchLocation(sandbox: Sandbox, videoId: string): void {
  setLocation(sandbox, ORIGIN + "/watch?v=" + videoId, "/watch", "?v=" + videoId);
}

export function setHomeLocation(sandbox: Sandbox): void {
  setLocation(sandbox, ORIGIN + "/", "/", "");
}

function setLocation(sandbox: Sandbox, href: string, pathname: string, search: string): void {
  const g = sandbox.global<Record<string, unknown>>();
  const location = g["location"] as Record<string, unknown>;
  location["href"] = href;
  location["protocol"] = "https:";
  location["host"] = "www.youtube.com";
  location["hostname"] = "www.youtube.com";
  location["port"] = "";
  location["pathname"] = pathname;
  location["search"] = search;
  location["hash"] = "";
  location["origin"] = ORIGIN;
  g["origin"] = ORIGIN;

  const doc = g["document"] as Record<string, unknown>;
  doc["URL"] = href;
  doc["documentURI"] = href;
  doc["domain"] = "www.youtube.com";
  doc["location"] = location;
}

/** The element `Application.create` is handed as its parent. */
export function installPlayerTree(sandbox: Sandbox, width: number, height: number): void {
  const g = sandbox.global<Record<string, unknown>>();
  const document = g["document"] as Record<string, unknown>;
  const getById = document["getElementById"] as (id: string) => unknown;
  if (getById.call(document, "player")) return;
  const create = document["createElement"] as (tag: string) => Record<string, unknown>;
  const el = create.call(document, "div");
  el["id"] = "player";
  sizeElement(el, width, height);
  const body = document["body"] as Record<string, unknown>;
  const append = body["appendChild"] as (n: unknown) => unknown;
  append.call(body, el);
}

/** The snapshot has no layout engine, so geometry is written directly onto the elements. */
export function sizeElement(el: Record<string, unknown>, width: number, height: number): void {
  el["clientWidth"] = width;
  el["offsetWidth"] = width;
  el["clientHeight"] = height;
  el["offsetHeight"] = height;
  const style = el["style"] as Record<string, unknown> | undefined;
  if (style) {
    style["width"] = width + "px";
    style["height"] = height + "px";
  }
}

export function fireWindowResize(sandbox: Sandbox): void {
  sandbox.run(
    "(function () { try { if (typeof dispatchEvent === 'function') dispatchEvent({ type: 'resize' }); } catch (e) {} })()",
    "resize",
  );
}
