import type { Sandbox } from "../sandbox/context.js";
import type { SandboxHttp } from "../sandbox/net.js";
import { ORIGIN, UA } from "../ua.js";
import type { BgChallenge } from "./playerConfig.js";
import { freezeYtAccessCounts, installYtcfg, resetYtAccessCounts, ytEventIdGets, ytWindowGets } from "./ytcfg.js";

/**
 * Mints a content-bound PO (proof-of-origin) token.
 *
 * Without one googlevideo serves media for roughly a minute and then answers
 * `STREAM_PROTECTION_STATUS = 3` with an empty body — measured, not assumed. A proxy that only
 * holds the first minute is not a proxy.
 *
 * The shape is awkward because BotGuard is awkward: YouTube's own interpreter is eval'd into the
 * sandbox, handed a program blob from the homepage, and asked for an async snapshot. That snapshot
 * goes to the WAA `GenerateIT` RPC in exchange for an integrity token, which the interpreter's
 * `webPo` minter then turns into a token bound to one video id.
 *
 * Ported from ymusic's `logic/player/pot.ts`.
 */

const REQUEST_KEY = "O43z0dpjhgX20SCx4KAo";
const API_KEY = "AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw";
const GIT_URL = "https://jnn-pa.googleapis.com/$rpc/google.internal.waa.v1.Waa/GenerateIT";

/** How long to wait for the interpreter's `setup` callback before giving up on it. */
const SETUP_TIMEOUT_MS = 15_000;

export interface MinterDiagnostics {
  globalName: string;
  programLength: number;
  interpreterBytes: number;
  snapshotLength: number;
  ytGets: number;
  eventIdGets: number;
  generateItStatus: number;
  integrityTokenLength: number;
}

export interface ContentPoMinter {
  mint(videoId: string): Promise<string>;
  readonly diagnostics: MinterDiagnostics;
}

type SandboxFn = (...args: unknown[]) => unknown;

function asRec(v: unknown): Record<string, unknown> | null {
  if (v == null || typeof v !== "object") return null;
  return v as Record<string, unknown>;
}

function absUrl(src: string): string {
  if (src.includes("://")) return src;
  if (src.startsWith("//")) return "https:" + src;
  if (src.startsWith("/")) return ORIGIN + src;
  return src;
}

async function fetchText(http: SandboxHttp, url: string): Promise<string> {
  const res = await http.send({ url, method: "GET", headers: [], bodyB64: null });
  if (res.status < 200 || res.status >= 300) {
    throw new Error("untube: BotGuard interpreter GET -> " + res.status);
  }
  return Buffer.from(res.bodyB64, "base64").toString("utf8");
}

async function waaGenerateIt(botguardResponse: string): Promise<{ status: number; json: unknown }> {
  const res = await fetch(GIT_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json+protobuf",
      "x-goog-api-key": API_KEY,
      "x-user-agent": "grpc-web-javascript/0.1",
      "user-agent": UA,
      origin: ORIGIN,
      referer: ORIGIN + "/",
      accept: "*/*",
    },
    body: JSON.stringify([REQUEST_KEY, botguardResponse]),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) };
  } catch {
    return { status: res.status, json: null };
  }
}

export async function createMinter(
  sandbox: Sandbox,
  http: SandboxHttp,
  challenge: BgChallenge,
  ytcfg: Record<string, unknown>,
): Promise<ContentPoMinter> {
  const globalName = challenge.globalName || "trayride";
  const program = challenge.program;

  // The interpreter reads EVENT_ID off the live page while snapshotting; install the real one.
  installYtcfg(sandbox, ytcfg);

  const g = sandbox.global<Record<string, unknown>>();
  let vm = asRec(g[globalName]);
  let interpreterBytes = 0;

  if (!vm || typeof vm["a"] !== "function") {
    let js = challenge.interpreterJavascript ?? "";
    const interpUrl = challenge.interpreterUrl ?? "";
    if (!js && interpUrl) js = await fetchText(http, absUrl(interpUrl));
    if (!js) {
      throw new Error(
        "untube: the homepage BotGuard challenge carried neither interpreterJavascript nor an " +
          "interpreterUrl, so no PO token can be minted.",
      );
    }
    // A leading `//# sourceURL` comment would otherwise become the script's first statement line.
    if (js.startsWith("//#")) js = js.slice(js.indexOf("\n") + 1);
    interpreterBytes = js.length;
    sandbox.run(js, "botguard-interpreter.js");
    vm = asRec(sandbox.global<Record<string, unknown>>()[globalName]);
  }

  const vmA = vm?.["a"];
  if (typeof vmA !== "function") {
    throw new Error("untube: BotGuard VM global '" + globalName + "' has no .a() after eval");
  }

  const fns: Record<string, unknown> = {};
  let setupDone: () => void = () => {};
  const setupWait = new Promise<void>((resolve) => {
    setupDone = resolve;
  });

  const setup: SandboxFn = (asyncSnap, shutdown, passEvent, checkCamera) => {
    fns["asyncSnap"] = asyncSnap;
    fns["shutdown"] = shutdown;
    fns["passEvent"] = passEvent;
    fns["checkCamera"] = checkCamera;
    setupDone();
  };
  const nop: SandboxFn = () => {};

  // These must be sandbox-realm arrays: the interpreter writes its minter into `webPo` and
  // checks the argument shapes it was handed.
  const webPo = sandbox.run<unknown[]>("[]");
  const extra = sandbox.run<unknown[]>("[[], []]");
  const fns5 = sandbox.run<unknown[]>("[0,0,0,0,0].map(function(){ return function(){}; })");

  resetYtAccessCounts();

  let ret = (vmA as SandboxFn).call(vm, program, setup, true, undefined, nop, extra, undefined, false, fns5);
  if (ret && typeof (ret as Promise<unknown>).then === "function") {
    ret = await (ret as Promise<unknown>);
  }

  if (typeof fns["asyncSnap"] !== "function") {
    await Promise.race([
      setupWait,
      new Promise<void>((resolve) => setTimeout(resolve, SETUP_TIMEOUT_MS)),
    ]);
  }
  const asyncSnap = fns["asyncSnap"];
  if (typeof asyncSnap !== "function") {
    throw new Error(
      "untube: the BotGuard VM never handed back an asyncSnapshot function — the interpreter did " +
        "not initialize against this page.",
    );
  }
  await new Promise<void>((r) => setTimeout(r, 50));

  const snapshot = await new Promise<unknown>((resolve, reject) => {
    try {
      (asyncSnap as SandboxFn).call(vm, (resp: unknown) => resolve(resp), [
        undefined,
        undefined,
        webPo,
        undefined,
      ]);
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });

  const snapshotLength = typeof snapshot === "string" ? snapshot.length : 0;
  const gets = ytWindowGets();
  const eventGets = ytEventIdGets();
  freezeYtAccessCounts();

  if (gets === 0) {
    throw new Error(
      "untube: the BotGuard snapshot never read window.yt (snapshot=" +
        snapshotLength +
        "B). The token would be worthless, so it is not minted.",
    );
  }
  if (typeof webPo[0] !== "function") {
    throw new Error(
      "untube: BotGuard snapshot produced no webPo minter (snapshot=" +
        snapshotLength +
        "B, ytGets=" +
        eventGets +
        ")",
    );
  }

  const git = await waaGenerateIt(String(snapshot));
  const arr = Array.isArray(git.json) ? (git.json as unknown[]) : [];
  const integrityToken = arr[0];
  if (typeof integrityToken !== "string" || !integrityToken) {
    throw new Error("untube: GenerateIT returned no integrity token (HTTP " + git.status + ")");
  }

  let mintCallback = (webPo[0] as SandboxFn)(sandbox.run(`__ytapiB64ToU8(${JSON.stringify(integrityToken)})`));
  if (
    mintCallback &&
    typeof mintCallback !== "function" &&
    typeof (mintCallback as Promise<unknown>).then === "function"
  ) {
    mintCallback = await (mintCallback as Promise<unknown>);
  }
  if (typeof mintCallback !== "function") {
    throw new Error("untube: the integrity token was rejected by the webPo minter (APF:Failed)");
  }
  const mint = mintCallback as SandboxFn;

  const diagnostics: MinterDiagnostics = {
    globalName,
    programLength: program.length,
    interpreterBytes,
    snapshotLength,
    ytGets: gets,
    eventIdGets: eventGets,
    generateItStatus: git.status,
    integrityTokenLength: integrityToken.length,
  };

  // The call and its unwrapping both happen in the sandbox realm. A token that comes back as a
  // sandbox Uint8Array would fail the host's `instanceof`, and a Promise needs the sandbox's own
  // `then`; converting to a base64 string inside makes the boundary crossing trivial.
  g["__ytapiMint"] = mint;

  return {
    diagnostics,
    async mint(videoId: string): Promise<string> {
      const token = await sandbox.run<unknown>(
        `(function () {
          var t = __ytapiMint(__ytapiTextToU8(${JSON.stringify(videoId)}));
          function conv(x) {
            if (typeof x === "string") return x;
            if (x && typeof x.byteLength === "number") return __ytapiU8ToB64(x);
            if (x instanceof Uint8Array) return __ytapiU8ToB64(x);
            return "";
          }
          if (t && typeof t.then === "function") return t.then(conv);
          return conv(t);
        })()`,
        "pot-mint",
      );
      if (typeof token !== "string" || token.length < 20) {
        throw new Error(
          "untube: the webPo minter returned no usable token for " +
            videoId +
            " (" +
            (typeof token === "string" ? token.length + " chars" : typeof token) +
            ")",
        );
      }
      return token;
    },
  };
}
