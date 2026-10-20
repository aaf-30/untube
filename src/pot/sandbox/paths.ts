/**
 * Sandbox scripts, inlined at build time by `scripts/generate-assets.js`.
 *
 * They used to be read from `assets/` via a path derived from `import.meta.url`. That holds only
 * while the package runs from its own directory: a bundler that inlines untube into an app bundle
 * rewrites the entry's location, and a container image that ships just the bundle has no `assets/`
 * next to it, so the first PO-token mint failed with ENOENT and silently continued tokenless.
 * Embedding the source text keeps the sandbox independent of the bundler and of the deployed
 * layout.
 */
import { PAGE_ASSETS, VENDOR_ASSETS } from "./assets.generated.js";

function readAsset(
  assets: Readonly<Record<string, string>>,
  kind: string,
  name: string,
): string {
  const source = assets[name];
  if (source === undefined) {
    throw new Error(`untube: unknown ${kind} asset "${name}"`);
  }
  return source;
}

/** Copied from ymusic (`:engine-js`); treat as read-only. */
export function readVendor(name: string): string {
  return readAsset(VENDOR_ASSETS, "vendor", name);
}

/** Our own sandbox-realm scripts, run as source text. */
export function readPage(name: string): string {
  return readAsset(PAGE_ASSETS, "page", name);
}
