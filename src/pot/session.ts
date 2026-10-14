import { createSandbox, type Sandbox } from "./sandbox/context.js";
import { installEnvironment } from "./sandbox/env.js";
import { SandboxHttp } from "./sandbox/net.js";
import { YtPlayer } from "./yt/boot.js";

/**
 * One long-lived YouTube session: a sandbox, a booted player, and the identity they share.
 *
 * Everything here is expensive (2.6 MB of base.js, a BotGuard interpreter, a PO mint) and
 * reusable across calls, so a process holds one session and asks it for tokens in turn.
 */

export interface SessionOptions {
  log?: (level: "debug" | "info" | "warn" | "error", message: string) => void;
}

/** Accepts a bare id or any YouTube URL shape. */
export function parseVideoId(input: string): string {
  const s = input.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
  let url: URL;
  try {
    url = new URL(s.includes("://") ? s : "https://" + s);
  } catch {
    throw new Error("untube: cannot read a video id out of " + JSON.stringify(input));
  }
  const v = url.searchParams.get("v");
  if (v) return v;
  const host = url.hostname.replace(/^www\.|^m\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.slice(1).split("/")[0];
    if (id) return id;
  }
  const m = /\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
  if (m) return m[1]!;
  const last = url.pathname.split("/").filter(Boolean).pop();
  if (last && /^[A-Za-z0-9_-]{11}$/.test(last)) return last;
  throw new Error("untube: no video id in " + JSON.stringify(input));
}

export class YtSession {
  private constructor(
    readonly sandbox: Sandbox,
    readonly http: SandboxHttp,
    readonly player: YtPlayer,
  ) {}

  static async create(opts: SessionOptions = {}): Promise<YtSession> {
    const log = opts.log ?? (() => {});
    const http = new SandboxHttp({ log });
    const sandbox = createSandbox({ http });
    installEnvironment(sandbox);
    const player = await YtPlayer.create(sandbox, http);
    return new YtSession(sandbox, http, player);
  }

  close(): void {
    this.sandbox.dispose();
  }
}
