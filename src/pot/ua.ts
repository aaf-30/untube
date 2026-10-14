/**
 * The one User-Agent this process presents, everywhere.
 *
 * YouTube treats the HTTP `User-Agent` and `navigator.userAgent` of the page as one attested
 * identity: a mismatch between the Chrome major the page env claims and the major on the wire
 * gets a stripped homepage back, and session bootstrap then fails with no obvious cause. The
 * value therefore lives here alone; `assets/env.raw.js` carries its own copy (it is a vendored
 * file we do not edit) and `sandbox/env.ts` asserts the two agree at load.
 */
export const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

export const ORIGIN = "https://www.youtube.com";
