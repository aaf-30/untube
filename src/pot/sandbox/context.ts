import vm from "node:vm";

import type { HttpRequestDescriptor, HttpResponseDescriptor, SandboxHttp } from "./net.js";
import { clearSandboxTimers, installNatives } from "./natives.js";

/**
 * A `vm` context shaped for running YouTube's `base.js`.
 *
 * This is not a security boundary — `base.js` is YouTube's own code and is allowed to do
 * essentially anything inside its realm. The isolation is about *control*: it gives the player
 * its own globals, so the network, storage and DOM it sees are ours, and `globalThis` mutations
 * it makes cannot leak into the host process.
 */
export interface Sandbox {
  readonly context: vm.Context;
  run<T = unknown>(code: string, filename?: string): T;
  global<T = Record<string, unknown>>(): T;
  dispose(): void;
}

function resolveTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export interface SandboxOptions {
  /** The one client every request from the page goes through. */
  http: SandboxHttp;
}

export function createSandbox(opts: SandboxOptions): Sandbox {
  const context = vm.createContext(Object.create(null) as object, {
    name: "ytapi",
    // base.js compiles functions at runtime; strings must stay allowed. WebAssembly is not used
    // by the player and stays off so a wasm blob cannot become an escape hatch.
    codeGeneration: { strings: true, wasm: false },
  });

  installNatives(context, resolveTimeZone());

  const g = vm.runInContext("globalThis", context) as Record<string, unknown>;
  // Returning a host Promise is fine: `await` adopts a cross-realm thenable, so the page-side
  // fetch/XHR stay plain async code with no polling or callback plumbing.
  g["__ytapiHttp"] = (req: HttpRequestDescriptor): Promise<HttpResponseDescriptor> =>
    opts.http.send(req);

  return {
    context,
    run<T>(code: string, filename = "eval"): T {
      return vm.runInContext(code, context, { filename }) as T;
    },
    global<T = Record<string, unknown>>(): T {
      return vm.runInContext("globalThis", context) as T;
    },
    dispose(): void {
      clearSandboxTimers();
    },
  };
}
