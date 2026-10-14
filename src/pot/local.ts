/**
 * PO token minting, in-process.
 *
 * The minter (see `./yt/pot.ts`) runs YouTube's own BotGuard interpreter inside a sandbox and
 * returns a token bound to a content binding — the video ID when YouTube runs the
 * `html5_generate_content_po_token` experiment, the visitor data otherwise.
 *
 * Ported from the author's `ytapi` experiment (GPL-3.0-or-later); `assets/vendor/*.js` come from
 * YMusicV4 (GPL-3.0) and are shipped read-only, which is why this package is GPL-3.0-or-later too.
 *
 * Booting is expensive — a ~2.6 MB `base.js` plus the interpreter, a few seconds — so the session
 * is created once per process and reused. Call `closeMinter()` to release it.
 */
import { YtSession } from './session.js'

/** One session per process. A failed boot must not poison later calls, hence the catch. */
let sessionPromise: Promise<YtSession> | null = null

function getSession(): Promise<YtSession> {
  if (!sessionPromise) {
    sessionPromise = YtSession.create()
    sessionPromise.catch(() => {
      sessionPromise = null
    })
  }
  return sessionPromise
}

/**
 * Mint a PO token for a content binding.
 *
 * @param binding A video ID or a visitor data string.
 * @returns Websafe base64. This matters when the token is used as the `pot=` query parameter of a
 *   CDN URL: the minter hands back standard base64, which YouTube rejects (403) unless `+` and `/`
 *   are swapped for `-` and `_`.
 */
export async function mintLocalPoToken(binding: string): Promise<string> {
  const session = await getSession()
  const token = await session.player.poToken(binding)
  return token.replace(/\+/g, '-').replace(/\//g, '_')
}

/** Release the shared session (BotGuard interpreter and sandbox). */
export function closeMinter(): void {
  const pending = sessionPromise
  sessionPromise = null
  if (pending) {
    void pending.then((session) => session.close()).catch(() => {})
  }
}
