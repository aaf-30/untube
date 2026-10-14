import vm from "node:vm";

/**
 * The three host globals `assets/env.raw.js` expects, plus the browser builtins Node does not
 * put on a fresh `vm` context.
 *
 * `env.raw.js` was written for QuickJS, where none of this existed and the C host supplied it.
 * Node supplies most of it natively, so the glue is small — but it must be installed *before*
 * the env is eval'd: `env.raw.js` calls `setTimeout` at line 211 while wiring
 * `requestIdleCallback`, and would throw on a bare context.
 */

/** Sandbox functions that must report as V8-native through `Function.prototype.toString`. */
const nativeNames = new WeakMap<object, string>();

const liveTimers = new Set<NodeJS.Timeout>();

export type SandboxLog = (level: "debug" | "info" | "warn" | "error", args: unknown[]) => void;

let logSink: SandboxLog = () => {};

/** Route the sandbox's `console` to the caller's logger. Set before creating a context. */
export function setSandboxLog(sink: SandboxLog): void {
  logSink = sink;
}

function formatArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return a.stack ?? String(a);
  try {
    return JSON.stringify(a) ?? String(a);
  } catch {
    return String(a);
  }
}

export function clearSandboxTimers(): void {
  for (const t of liveTimers) clearTimeout(t);
  liveTimers.clear();
}

function hostTimeout(fn: unknown, ms: unknown, args: unknown[]): number {
  if (typeof fn !== "function") throw new TypeError("setTimeout: callback is not a function");
  const delay = typeof ms === "number" && Number.isFinite(ms) ? Math.max(0, ms) : 0;
  const handle = setTimeout(() => {
    liveTimers.delete(handle);
    try {
      (fn as (...a: unknown[]) => void)(...args);
    } catch (e) {
      // A throw here has no caller to propagate to; a silent swallow would hide real breakage,
      // so it surfaces as an error log rather than vanishing.
      logSink("error", ["uncaught in setTimeout:", e]);
    }
  }, delay);
  liveTimers.add(handle);
  return handle as unknown as number;
}

export function installNatives(ctx: vm.Context, timeZone: string): void {
  const g = vm.runInContext("globalThis", ctx) as Record<string, unknown>;

  const nativeFn = (name: unknown, impl?: unknown): unknown => {
    const fn = (typeof impl === "function" ? impl : function () {}) as object;
    if (typeof name === "string") nativeNames.set(fn, name);
    return fn;
  };

  g["__nativeFn"] = nativeFn;
  g["__timeZone"] = () => timeZone;
  // No decoder exists here, so this reports a capability rather than measuring one. Level 5.2
  // is what a modern desktop Chrome advertises; the value only steers codec selection.
  g["__mseAvcMaxLevel"] = () => 52;

  g["setTimeout"] = (fn: unknown, ms?: unknown, ...args: unknown[]) => hostTimeout(fn, ms, args);
  g["clearTimeout"] = (h: unknown) => {
    if (h !== undefined && h !== null) {
      clearTimeout(h as NodeJS.Timeout);
      liveTimers.delete(h as NodeJS.Timeout);
    }
  };
  g["setInterval"] = (fn: unknown, ms?: unknown, ...args: unknown[]): number => {
    if (typeof fn !== "function") throw new TypeError("setInterval: callback is not a function");
    const delay = typeof ms === "number" && Number.isFinite(ms) ? Math.max(0, ms) : 0;
    const handle = setInterval(() => {
      try {
        (fn as (...a: unknown[]) => void)(...args);
      } catch (e) {
        logSink("error", ["uncaught in setInterval:", e]);
      }
    }, delay);
    liveTimers.add(handle as unknown as NodeJS.Timeout);
    return handle as unknown as number;
  };
  g["clearInterval"] = g["clearTimeout"];

  // A fresh vm context carries only ECMAScript intrinsics (Promise, Map, Intl, console) — none
  // of Node's or the web's globals reach it. Handing the host classes over is enough; nothing
  // here does a cross-realm `instanceof` against them.
  g["TextEncoder"] = TextEncoder;
  g["TextDecoder"] = TextDecoder;
  g["atob"] = atob;
  g["btoa"] = btoa;
  g["structuredClone"] = structuredClone;
  g["queueMicrotask"] = queueMicrotask;
  g["crypto"] = crypto;
  g["performance"] = performance;
  g["URL"] = URL;
  g["URLSearchParams"] = URLSearchParams;

  g["console"] = {
    log: (...a: unknown[]) => logSink("info", a),
    info: (...a: unknown[]) => logSink("info", a),
    debug: (...a: unknown[]) => logSink("debug", a),
    warn: (...a: unknown[]) => logSink("warn", a),
    error: (...a: unknown[]) => logSink("error", a),
    trace: (...a: unknown[]) => logSink("debug", a),
    dir: (...a: unknown[]) => logSink("debug", a),
    assert: (cond: unknown, ...a: unknown[]) => {
      if (!cond) logSink("error", ["assertion failed", ...a]);
    },
  };
  g["__ytapiFormatArg"] = formatArg;

  installFunctionToString(ctx);
}

/**
 * `Function.prototype.toString` reports `[native code]` for anything `__nativeFn` wrapped.
 *
 * YouTube's player sniffs whether helpers are native; under QuickJS this was a real C binding.
 * Patching the prototype (rather than each function) also covers
 * `Function.prototype.toString.call(fn)`, which an own-property override would miss.
 */
function installFunctionToString(ctx: vm.Context): void {
  const original = vm.runInContext("Function.prototype.toString", ctx) as (this: unknown) => string;
  const patched = function (this: unknown): string {
    if (typeof this === "function") {
      const name = nativeNames.get(this as object);
      if (name !== undefined) return "function " + name + "() { [native code] }";
    }
    return original.call(this);
  };
  vm.runInContext("(function (p) { Function.prototype.toString = p; })", ctx)(patched);
}

export { formatArg };
