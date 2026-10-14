/* localStorage / sessionStorage over an in-memory map.
 *
 * base.js probes both; neither needs to survive the process. Persisting the player's localStorage
 * would carry a visitor identity across runs, which is the opposite of what a fresh session wants.
 */
(function () {
  function native(name, impl) {
    return typeof __nativeFn === "function" ? __nativeFn(name, impl, 0) : impl;
  }

  function makeStorage() {
    var map = Object.create(null);
    var self = {};
    self.getItem = native("getItem", function (k) {
      var key = String(k);
      return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
    });
    self.setItem = native("setItem", function (k, v) {
      map[String(k)] = String(v);
    });
    self.removeItem = native("removeItem", function (k) {
      delete map[String(k)];
    });
    self.clear = native("clear", function () {
      map = Object.create(null);
    });
    self.key = native("key", function (i) {
      var keys = Object.keys(map);
      var n = Number(i);
      return n >= 0 && n < keys.length ? keys[n] : null;
    });
    Object.defineProperty(self, "length", {
      get: native("get length", function () {
        return Object.keys(map).length;
      }),
    });
    return self;
  }

  globalThis.localStorage = makeStorage();
  globalThis.sessionStorage = makeStorage();
})();
