/* IntersectionObserver shim that always reports "visible".
 *
 * env.raw.js installs IntersectionObserver as an `Illegal constructor` thrower on purpose — it is
 * one of 213 window constructors a bare Chrome page would expose that way. base.js then constructs
 * one, so a real (if trivial) implementation has to go back afterwards.
 *
 * Reporting `isIntersecting: true` unconditionally is the point, not a shortcut: YouTube only lets
 * SABR dial quality up while the player is on screen. An observer that never fires leaves the
 * player stalled on its lowest rung with no error anywhere.
 */
(function () {
  function native(name, impl) {
    return typeof __nativeFn === "function" ? __nativeFn(name, impl, 0) : impl;
  }

  function IntersectionObserver(cb) {
    this._cb = cb;
  }
  IntersectionObserver.prototype.observe = native("observe", function (el) {
    var self = this;
    var rect =
      el && typeof el.getBoundingClientRect === "function"
        ? el.getBoundingClientRect()
        : { x: 0, y: 0, width: 1280, height: 720, top: 0, left: 0, bottom: 720, right: 1280 };
    var w = Number(rect.width) || 1280;
    var h = Number(rect.height) || 720;
    Promise.resolve().then(function () {
      var cb = self._cb;
      if (typeof cb !== "function") return;
      try {
        cb.call(self, [
          {
            target: el,
            isIntersecting: true,
            isVisible: true,
            intersectionRatio: 1,
            time: 0,
            boundingClientRect: rect,
            intersectionRect: { x: 0, y: 0, width: w, height: h, top: 0, left: 0, bottom: h, right: w },
            rootBounds: { x: 0, y: 0, width: 1280, height: 720, top: 0, left: 0, bottom: 720, right: 1280 },
          },
        ], self);
      } catch (e) {
        /* A throwing subscriber is the player's problem, not ours; it must not break the shim. */
      }
    });
  });
  IntersectionObserver.prototype.unobserve = native("unobserve", function () {});
  IntersectionObserver.prototype.disconnect = native("disconnect", function () {});
  IntersectionObserver.prototype.takeRecords = native("takeRecords", function () {
    return [];
  });

  globalThis.IntersectionObserver = native("IntersectionObserver", IntersectionObserver);
})();
