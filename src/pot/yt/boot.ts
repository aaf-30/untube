import type { Sandbox } from "../sandbox/context.js";
import { fireWindowResize, installPlayerTree, setHomeLocation, sizeElement } from "../sandbox/env.js";
import type { SandboxHttp } from "../sandbox/net.js";
import { ORIGIN } from "../ua.js";
import { parsePlayerConfig, type PlayerConfig } from "./playerConfig.js";
import { createMinter, type ContentPoMinter } from "./pot.js";
import { installYtcfg } from "./ytcfg.js";

/**
 * Boots YouTube's real player inside the sandbox — the substrate PO minting runs on.
 *
 * The sequence below is load-bearing and mirrors ymusic's `logic/player/boot.ts`: the player
 * state (ytcfg, player tree) must be in place before `base.js` is evaluated, because
 * `Application.create` reads it the moment it runs.
 *
 * Only what the BotGuard minter needs is kept: the homepage config (ytcfg + challenge),
 * a player tree for `Application.create` to attach to, and the `poToken()` mint itself.
 */

export const VIEWPORT_WIDTH = 640;
export const VIEWPORT_HEIGHT = 360;

/** base.js is ~2.6 MB; anything near zero means the fetch silently failed. */
const MIN_BASE_JS_BYTES = 100_000;

export interface BootResult {
  config: PlayerConfig;
  jsUrl: string;
  baseJsBytes: number;
  homepageBytes: number;
}

export class YtPlayer {
  private constructor(
    private readonly sandbox: Sandbox,
    private readonly http: SandboxHttp,
    readonly boot: BootResult,
  ) {}

  static async create(sandbox: Sandbox, http: SandboxHttp): Promise<YtPlayer> {
    const homepage = await fetchHomepage(http);
    const config = parsePlayerConfig(homepage);
    if (!config) {
      throw new Error(
        "untube: the homepage carried no player config (BotGuard program or jsUrl). " +
          "This usually means the request identity was rejected — check the User-Agent.",
      );
    }

    setHomeLocation(sandbox);
    installYtcfg(sandbox, config.ytcfg);
    installPlayerTree(sandbox, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    fireWindowResize(sandbox);

    const baseJs = await fetchText(http, config.jsUrl);
    if (baseJs.length < MIN_BASE_JS_BYTES) {
      throw new Error(
        "untube: base.js came back as " +
          baseJs.length +
          " bytes (expected >" +
          MIN_BASE_JS_BYTES +
          "). The script allowlist or the player URL is wrong.",
      );
    }

    try {
      sandbox.run(baseJs, "base.js");
    } catch (e) {
      throw new Error("untube: base.js failed to evaluate: " + (e instanceof Error ? e.message : String(e)));
    }

    const player = new YtPlayer(sandbox, http, {
      config,
      jsUrl: config.jsUrl,
      baseJsBytes: baseJs.length,
      homepageBytes: homepage.length,
    });
    player.createApplication();
    return player;
  }

  private createApplication(): void {
    const g = this.sandbox.global<Record<string, unknown>>();
    const yt = g["yt"] as Record<string, unknown> | undefined;
    const playerNs = yt ? (yt["player"] as Record<string, unknown> | undefined) : undefined;
    const Application = playerNs
      ? (playerNs["Application"] as Record<string, unknown> | undefined)
      : undefined;
    const create = Application?.["create"];
    if (typeof create !== "function") {
      throw new Error("untube: yt.player.Application.create is missing after base.js evaluated");
    }

    const ytcfg = g["ytcfg"] as Record<string, unknown> | undefined;
    const get = ytcfg?.["get"] as ((k: string) => unknown) | undefined;
    const ctxs = get ? (get("WEB_PLAYER_CONTEXT_CONFIGS") as Record<string, unknown> | undefined) : undefined;
    const ctx = ctxs?.["WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH"];
    if (!ctx) {
      throw new Error("untube: ytcfg is missing WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH");
    }

    const playerVars: Record<string, unknown> = {
      skip_ads: 1,
      // Without this getAvailablePlaybackRates() reports only [1] and setPlaybackRate snaps to 1x.
      enableSpeedOptions: true,
    };
    const param2 = {
      args: playerVars,
      attrs: {
        id: "video-player",
        width: String(VIEWPORT_WIDTH),
        height: String(VIEWPORT_HEIGHT),
      },
      loaded: true,
    };

    const document = g["document"] as Record<string, unknown>;
    const root = (document["getElementById"] as (id: string) => Record<string, unknown> | null).call(
      document,
      "player",
    );
    if (!root) throw new Error("untube: #player was not installed");

    const created = (create as (a: unknown, b: unknown, c: unknown) => unknown).call(
      Application,
      root,
      param2,
      ctx,
    );
    g["__ymPlayer"] = created;
    sizeTree(this.sandbox);
    fireWindowResize(this.sandbox);
  }

  private minter: ContentPoMinter | null = null;

  /**
   * A content PO token for [videoId], minted once per process.
   *
   * The BotGuard interpreter is eval'd into the same sandbox the player runs in — they share the
   * `ytcfg` page state the snapshot is supposed to read — but minting is independent of playback,
   * so this is built on first use rather than during boot.
   */
  async poToken(videoId: string): Promise<string> {
    if (!this.minter) {
      this.minter = await createMinter(this.sandbox, this.http, this.boot.config.bgChallenge, this.boot.config.ytcfg);
    }
    return this.minter.mint(videoId);
  }
}

async function fetchHomepage(http: SandboxHttp): Promise<string> {
  http.jar.ensureConsent();
  return fetchText(http, ORIGIN + "/");
}

/**
 * The homepage reports the player as a path (`/s/player/<hash>/.../base.js`), which `fetch`
 * on the host side has no base to resolve. The page-side shim resolves its own calls; host
 * callers come through here.
 */
export function resolveUrl(url: string): string {
  if (url.includes("://")) return url;
  if (url.startsWith("//")) return "https:" + url;
  if (url.startsWith("/")) return ORIGIN + url;
  return ORIGIN + "/" + url;
}

async function fetchText(http: SandboxHttp, url: string): Promise<string> {
  const abs = resolveUrl(url);
  const res = await http.send({ url: abs, method: "GET", headers: [], bodyB64: null });
  if (res.status < 200 || res.status >= 300) {
    throw new Error("untube: GET " + abs + " -> " + res.status + " " + res.statusText);
  }
  return Buffer.from(res.bodyB64, "base64").toString("utf8");
}

function sizeTree(sandbox: Sandbox): void {
  sandbox.run(
    `(function () {
      function size(el) {
        if (!el) return;
        el.clientWidth = el.offsetWidth = ${VIEWPORT_WIDTH};
        el.clientHeight = el.offsetHeight = ${VIEWPORT_HEIGHT};
      }
      size(document.getElementById("player"));
      size(document.getElementById("movie_player"));
      size(document.getElementById("video-player"));
      var vids = document.getElementsByTagName("video");
      for (var i = 0; i < vids.length; i++) size(vids[i]);
      var cont = document.getElementsByClassName("html5-video-container");
      for (var j = 0; j < cont.length; j++) size(cont[j]);
    })()`,
    "size-tree",
  );
}

export { sizeElement };
