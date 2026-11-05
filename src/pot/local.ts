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
 * is created once per proxy and reused. Call `closeMinter()` to release all sessions.
 */
import { YtSession } from './session.js'

/** Keep direct and proxied attestation sessions separate, including concurrent requests. */
const sessions = new Map<string, Promise<YtSession>>()

function getSession(proxy?: string): Promise<YtSession> {
  const key = proxy || ''
  let pending = sessions.get(key)
  if (!pending) {
    pending = YtSession.create({ proxy })
    sessions.set(key, pending)
    const created = pending
    void pending.catch(() => {
      if (sessions.get(key) === created) sessions.delete(key)
    })
  }
  return pending
}

/**
 * Mint a PO token for a content binding.
 *
 * @param binding A video ID or a visitor data string.
 * @returns Websafe base64. This matters when the token is used as the `pot=` query parameter of a
 *   CDN URL: the minter hands back standard base64, which YouTube rejects (403) unless `+` and `/`
 *   are swapped for `-` and `_`.
 */
export async function mintLocalPoToken(binding: string, proxy?: string): Promise<string> {
  return (await mintLocalPoTokenWithExpiry(binding, proxy)).poToken
}

export async function mintLocalPoTokenWithExpiry(binding: string, proxy?: string): Promise<{ poToken: string; expires: number }> {
  const session = await getSession(proxy)
  const result = await session.player.poTokenWithExpiry(binding)
  return { ...result, poToken: result.poToken.replace(/\+/g, '-').replace(/\//g, '_') }
}

/** Release every shared session (BotGuard interpreter, sandbox and proxy connections). */
export function closeMinter(): void {
  const pendingSessions = [...sessions.values()]
  sessions.clear()
  for (const pending of pendingSessions) {
    void pending.then((session) => session.close()).catch(() => {})
  }
}

/** Discard only the session on the rejected network route. */
export function resetLocalMinter(proxy?: string): void {
  const key = proxy || ''
  const pending = sessions.get(key)
  sessions.delete(key)
  if (pending) void pending.then((session) => session.close()).catch(() => {})
}
