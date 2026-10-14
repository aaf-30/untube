import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function findPackageRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, "package.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("untube: package root not found above " + start);
    dir = parent;
  }
}

/** Resolved from this file, so it holds whether running from `src/` or `dist/`. */
export const PACKAGE_ROOT = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));

/** Copied from ymusic (`:engine-js`); treat as read-only. */
export const VENDOR_DIR = path.join(PACKAGE_ROOT, "assets", "vendor");

/** Our own sandbox-realm scripts, run as source text. */
export const PAGE_DIR = path.join(PACKAGE_ROOT, "assets", "page");

export function readVendor(name: string): string {
  return fs.readFileSync(path.join(VENDOR_DIR, name), "utf8");
}

export function readPage(name: string): string {
  return fs.readFileSync(path.join(PAGE_DIR, name), "utf8");
}
