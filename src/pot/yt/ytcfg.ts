import type { Sandbox } from "../sandbox/context.js";

/**
 * `ytcfg` and its `yt.config_` alias, as base.js and the BotGuard interpreter expect to find them.
 *
 * The access counters are not diagnostics. The BotGuard snapshot is supposed to read
 * `yt.config_.EVENT_ID` from the live page while it runs; if nothing reads it, the snapshot was
 * taken against a page the interpreter did not really see, and the token it produces is worthless.
 * ymusic asserts on exactly this (`pot.ts`), and the check only means something if reads are
 * counted somewhere — so they are counted here.
 */

interface AccessCounts { eventIdGets: number; ytGets: number; counting: boolean }
const accessCounts = new WeakMap<Sandbox, AccessCounts>();

export function ytWindowGets(sandbox: Sandbox): number {
  return accessCounts.get(sandbox)?.ytGets ?? 0;
}

export function ytEventIdGets(sandbox: Sandbox): number {
  return accessCounts.get(sandbox)?.eventIdGets ?? 0;
}

export function freezeYtAccessCounts(sandbox: Sandbox): void {
  const counts = accessCounts.get(sandbox);
  if (counts) counts.counting = false;
}

export function resetYtAccessCounts(sandbox: Sandbox): void {
  accessCounts.set(sandbox, { eventIdGets: 0, ytGets: 0, counting: true });
}

export function installYtcfg(sandbox: Sandbox, data: Record<string, unknown>): void {
  const g = sandbox.global<Record<string, unknown>>();
  const data_: Record<string, unknown> = {};

  for (const k of Object.keys(data)) data_[k] = data[k];

  const cfg: Record<string, unknown> = {
    data_,
    set: (d: unknown) => {
      if (d == null || typeof d !== "object") return;
      const rec = d as Record<string, unknown>;
      for (const k of Object.keys(rec)) data_[k] = rec[k];
    },
    get: (k: string, fb?: unknown) =>
      Object.prototype.hasOwnProperty.call(data_, k) ? data_[k] : fb,
  };

  g["ytcfg"] = cfg;
  g["yt"] = { config_: data_ };

  resetYtAccessCounts(sandbox);

  let held = data_["EVENT_ID"];
  Object.defineProperty(data_, "EVENT_ID", {
    configurable: true,
    enumerable: true,
    get: () => {
      const counts = accessCounts.get(sandbox);
      if (counts?.counting) {
        counts.eventIdGets++;
        counts.ytGets++;
      }
      return held;
    },
    set: (v: unknown) => {
      held = v;
    },
  });
}
