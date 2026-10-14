/* URL + blob registry, in the sandbox realm.
 *
 * A vm context has no URL at all, and base.js both constructs one and calls
 * URL.createObjectURL to hand its MediaSource a `blob:` src. The constructor is hand-rolled
 * rather than borrowed from the host realm so that `x instanceof URL` inside the sandbox holds.
 * Ported from ymusic's `installNativeUrl` (engine-js/src/logic/player/boot.ts).
 */
(function () {
  function native(name, impl) {
    return typeof __nativeFn === "function" ? __nativeFn(name, impl, 0) : impl;
  }

  /* Blob URL -> MediaSource. The MSE shim reads this back when the video element is given a
   * `blob:` src, which is how it learns which MediaSource is playing. */
  var blobRegistry = Object.create(null);
  var blobSeq = 0;

  function createObjectURL(obj) {
    var id = "ytapi-" + ++blobSeq;
    blobRegistry[id] = obj;
    return "blob:https://www.youtube.com/" + id;
  }

  function revokeObjectURL(url) {
    var id = String(url == null ? "" : url).replace(/^blob:[^/]*\//, "");
    delete blobRegistry[id];
  }

  function lookupBlob(url) {
    var id = String(url == null ? "" : url).replace(/^blob:[^/]*\//, "");
    return blobRegistry[id] || null;
  }

  function URLImpl(url, base) {
    var o = this && this !== globalThis ? this : {};
    var href = String(url == null ? "" : url);
    var b = "";
    if (base != null) {
      b = typeof base === "string" ? base : String((base && base.href) || "");
    }
    var isBlob = href.indexOf("blob:") === 0;
    if (isBlob) {
      o.href = href;
      o.protocol = "blob:";
      o.host = "";
      o.hostname = "";
      o.port = "";
      o.pathname = href.slice(5);
      o.search = "";
      o.hash = "";
      o.origin = "https://www.youtube.com";
      o.username = "";
      o.password = "";
      o.toString = native("toString", function () {
        return String(o.href);
      });
      o.toJSON = native("toJSON", function () {
        return String(o.href);
      });
      return o;
    }
    if (href.indexOf("://") < 0 && href.indexOf("//") !== 0 && href.charAt(0) !== "/") {
      href = (b || "https://www.youtube.com/") + href;
    } else if (href.indexOf("//") === 0) {
      href = "https:" + href;
    } else if (href.charAt(0) === "/") {
      href = "https://www.youtube.com" + href;
    }

    var protocol = "https:";
    var hostname = "www.youtube.com";
    var pathname = "/";
    var search = "";
    var hash = "";
    var proto = href.indexOf("://");
    if (proto >= 0) {
      protocol = href.slice(0, proto + 1);
      var rest = href.slice(proto + 3);
      var slash = rest.indexOf("/");
      var q = rest.indexOf("?");
      var h = rest.indexOf("#");
      var hostEnd = rest.length;
      if (slash >= 0 && slash < hostEnd) hostEnd = slash;
      if (q >= 0 && q < hostEnd) hostEnd = q;
      if (h >= 0 && h < hostEnd) hostEnd = h;
      hostname = rest.slice(0, hostEnd);
      pathname = slash >= 0 ? rest.slice(slash) : "/";
    } else {
      pathname = href.charAt(0) === "/" ? href : "/" + href;
    }
    var qi = pathname.indexOf("?");
    var hi = pathname.indexOf("#");
    if (hi >= 0) {
      hash = pathname.slice(hi);
      pathname = pathname.slice(0, hi);
    }
    if (qi >= 0) {
      search = pathname.slice(qi);
      pathname = pathname.slice(0, qi);
    }
    o.href = href;
    o.protocol = protocol;
    o.host = hostname;
    o.hostname = hostname;
    o.port = "";
    o.pathname = pathname || "/";
    o.search = search;
    o.hash = hash;
    o.origin = protocol + "//" + hostname;
    o.username = "";
    o.password = "";
    o.toString = native("toString", function () {
      return String(o.href);
    });
    o.toJSON = native("toJSON", function () {
      return String(o.href);
    });
    return o;
  }

  var ctor = native("URL", URLImpl);
  ctor.prototype = URLImpl.prototype || {};
  ctor.createObjectURL = native("createObjectURL", createObjectURL);
  ctor.revokeObjectURL = native("revokeObjectURL", revokeObjectURL);

  globalThis.URL = ctor;
  globalThis.__ytapiLookupBlob = lookupBlob;

  var searchParams = native("URLSearchParams", function (init) {
    var self = this && this !== globalThis ? this : {};
    var pairs = [];
    var s = String(init == null ? "" : init).replace(/^\?/, "");
    if (s) {
      var parts = s.split("&");
      for (var i = 0; i < parts.length; i++) {
        if (!parts[i]) continue;
        var eq = parts[i].indexOf("=");
        var k = eq < 0 ? parts[i] : parts[i].slice(0, eq);
        var v = eq < 0 ? "" : parts[i].slice(eq + 1);
        try {
          pairs.push([decodeURIComponent(k), decodeURIComponent(v.replace(/\+/g, " "))]);
        } catch (e) {
          pairs.push([k, v]);
        }
      }
    }
    function find(key) {
      for (var i = 0; i < pairs.length; i++) if (pairs[i][0] === String(key)) return i;
      return -1;
    }
    self.get = native("get", function (key) {
      var i = find(key);
      return i < 0 ? null : pairs[i][1];
    });
    self.has = native("has", function (key) {
      return find(key) >= 0;
    });
    self.set = native("set", function (key, value) {
      var i = find(key);
      if (i < 0) pairs.push([String(key), String(value)]);
      else pairs[i][1] = String(value);
    });
    self.append = native("append", function (key, value) {
      pairs.push([String(key), String(value)]);
    });
    self["delete"] = native("delete", function (key) {
      var i = find(key);
      if (i >= 0) pairs.splice(i, 1);
    });
    self.toString = native("toString", function () {
      var out = [];
      for (var i = 0; i < pairs.length; i++) {
        out.push(encodeURIComponent(pairs[i][0]) + "=" + encodeURIComponent(pairs[i][1]));
      }
      return out.join("&");
    });
    self.forEach = native("forEach", function (fn, thisArg) {
      for (var i = 0; i < pairs.length; i++) fn.call(thisArg, pairs[i][1], pairs[i][0], self);
    });
    return self;
  });
  globalThis.URLSearchParams = searchParams;
})();
