/* fetch / XMLHttpRequest / Headers / Response, bridged to the host.
 *
 * The host owns the socket: it decides the User-Agent, cooks cookies, follows redirects, and
 * watches every call for the two URLs this whole project exists to observe
 * (`/youtubei/v1/player` and `/videoplayback`). This file only gives base.js the browser-shaped
 * objects it expects to call.
 *
 * Bodies cross the boundary base64-encoded. A Uint8Array built in the host realm would fail
 * `instanceof Uint8Array` inside the sandbox, and base.js does make that check.
 */
(function () {
  function native(name, impl) {
    return typeof __nativeFn === "function" ? __nativeFn(name, impl, 0) : impl;
  }

  var CHUNK = 1 << 16;

  function b64ToBytes(b64) {
    if (!b64) return new Uint8Array(0);
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
    return out;
  }

  function bytesToB64(u8) {
    var s = "";
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }

  function asBytes(body) {
    if (body == null) return null;
    if (typeof body === "string") return new TextEncoder().encode(body);
    if (body instanceof Uint8Array) return body;
    if (body instanceof ArrayBuffer) return new Uint8Array(body);
    if (ArrayBuffer.isView(body)) {
      return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    }
    return null;
  }

  /* A request body may be a stream. Draining it here is acceptable: every caller in the player
   * either sends a string, a Uint8Array, or a small ABR protobuf. */
  function drainStream(stream) {
    var reader = stream.getReader();
    var parts = [];
    var total = 0;
    function step() {
      return reader.read().then(function (r) {
        if (r.done) {
          var out = new Uint8Array(total);
          var off = 0;
          for (var i = 0; i < parts.length; i++) {
            out.set(parts[i], off);
            off += parts[i].length;
          }
          return out;
        }
        var v = r.value instanceof Uint8Array ? r.value : new Uint8Array(r.value);
        parts.push(v);
        total += v.length;
        return step();
      });
    }
    return step();
  }

  function resolveBody(body) {
    if (body && typeof body.getReader === "function") return drainStream(body);
    return Promise.resolve(asBytes(body));
  }

  function HeadersImpl(init) {
    var self = this && this !== globalThis ? this : {};
    var list = [];
    function norm(n) {
      return String(n).toLowerCase();
    }
    if (init) {
      if (typeof init.forEach === "function" && !Array.isArray(init)) {
        init.forEach(function (v, k) {
          list.push([norm(k), String(v)]);
        });
      } else if (Array.isArray(init)) {
        for (var i = 0; i < init.length; i++) {
          if (init[i] && init[i].length >= 2) list.push([norm(init[i][0]), String(init[i][1])]);
        }
      } else if (typeof init === "object") {
        var keys = Object.keys(init);
        for (var j = 0; j < keys.length; j++) list.push([norm(keys[j]), String(init[keys[j]])]);
      }
    }
    self.get = native("get", function (name) {
      var n = norm(name);
      for (var i = 0; i < list.length; i++) if (list[i][0] === n) return list[i][1];
      return null;
    });
    self.set = native("set", function (name, value) {
      var n = norm(name);
      for (var i = 0; i < list.length; i++) {
        if (list[i][0] === n) {
          list[i][1] = String(value);
          return;
        }
      }
      list.push([n, String(value)]);
    });
    self.append = native("append", function (name, value) {
      list.push([norm(name), String(value)]);
    });
    self.has = native("has", function (name) {
      var n = norm(name);
      for (var i = 0; i < list.length; i++) if (list[i][0] === n) return true;
      return false;
    });
    self["delete"] = native("delete", function (name) {
      var n = norm(name);
      for (var i = list.length - 1; i >= 0; i--) if (list[i][0] === n) list.splice(i, 1);
    });
    self.forEach = native("forEach", function (fn, thisArg) {
      for (var i = 0; i < list.length; i++) fn.call(thisArg, list[i][1], list[i][0], self);
    });
    self.entries = native("entries", function () {
      return list.slice();
    });
    self.keys = native("keys", function () {
      var out = [];
      for (var i = 0; i < list.length; i++) out.push(list[i][0]);
      return out;
    });
    self.values = native("values", function () {
      var out = [];
      for (var i = 0; i < list.length; i++) out.push(list[i][1]);
      return out;
    });
    self._list = list;
    return self;
  }
  /* Exposed so the host can hand binary to sandbox code that will type-check it: a Uint8Array
   * built in the host realm fails `instanceof Uint8Array` in here. */
  globalThis.__ytapiB64ToU8 = native("__ytapiB64ToU8", b64ToBytes);
  globalThis.__ytapiU8ToB64 = native("__ytapiU8ToB64", bytesToB64);
  globalThis.__ytapiTextToU8 = native("__ytapiTextToU8", function (s) {
    return new TextEncoder().encode(String(s));
  });

  globalThis.Headers = native("Headers", HeadersImpl);

  function headersToPairs(h) {
    if (!h) return [];
    if (h instanceof HeadersImpl || (h && h._list)) return h._list.slice();
    var out = [];
    if (Array.isArray(h)) {
      for (var i = 0; i < h.length; i++) {
        if (h[i] && h[i].length >= 2) out.push([String(h[i][0]), String(h[i][1])]);
      }
      return out;
    }
    if (typeof h === "object") {
      var keys = Object.keys(h);
      for (var j = 0; j < keys.length; j++) out.push([keys[j], String(h[keys[j]])]);
    }
    return out;
  }

  function makeBodyStream(bytes) {
    var offset = 0;
    var released = false;
    function reader() {
      return {
        read: native("read", function () {
          if (released || offset >= bytes.length) {
            return Promise.resolve({ done: true, value: undefined });
          }
          var end = Math.min(offset + CHUNK, bytes.length);
          var chunk = bytes.subarray(offset, end);
          offset = end;
          return Promise.resolve({ done: false, value: chunk });
        }),
        cancel: native("cancel", function () {
          released = true;
          return Promise.resolve();
        }),
        releaseLock: native("releaseLock", function () {
          released = true;
        }),
        closed: Promise.resolve(),
      };
    }
    return {
      getReader: native("getReader", reader),
      cancel: native("cancel", function () {
        released = true;
        return Promise.resolve();
      }),
      tee: native("tee", function () {
        return [makeBodyStream(bytes), makeBodyStream(bytes)];
      }),
      locked: false,
    };
  }
  globalThis.ReadableStream = native("ReadableStream", function (source) {
    var self = this && this !== globalThis ? this : {};
    var controller = {
      enqueue: function () {},
      close: function () {},
      error: function () {},
    };
    if (source && typeof source.start === "function") {
      try {
        source.start(controller);
      } catch (e) {
        /* A source that throws on start simply produces an empty stream. */
      }
    }
    self.getReader = native("getReader", function () {
      return readerFromController(controller);
    });
    return self;
  });
  function readerFromController() {
    return {
      read: function () {
        return Promise.resolve({ done: true, value: undefined });
      },
      cancel: function () {
        return Promise.resolve();
      },
      releaseLock: function () {},
    };
  }

  function ResponseImpl(url, status, statusText, headerPairs, bytes) {
    var self = this && this !== globalThis ? this : {};
    self.url = url;
    self.status = status;
    self.statusText = statusText || "";
    self.ok = status >= 200 && status < 300;
    self.redirected = false;
    self.type = "basic";
    self.headers = HeadersImpl.call({}, headerPairs);
    self.body = makeBodyStream(bytes);
    self.bodyUsed = false;
    self.text = native("text", function () {
      self.bodyUsed = true;
      return Promise.resolve(new TextDecoder("utf-8").decode(bytes));
    });
    self.json = native("json", function () {
      self.bodyUsed = true;
      return Promise.resolve(JSON.parse(new TextDecoder("utf-8").decode(bytes)));
    });
    self.arrayBuffer = native("arrayBuffer", function () {
      self.bodyUsed = true;
      return Promise.resolve(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    });
    self.blob = native("blob", function () {
      self.bodyUsed = true;
      return Promise.resolve({ size: bytes.length, type: self.headers.get("content-type") || "" });
    });
    self.clone = native("clone", function () {
      return ResponseImpl.call({}, url, status, statusText, headerPairs, bytes);
    });
    return self;
  }
  globalThis.Response = native("Response", ResponseImpl);

  function RequestImpl(input, init) {
    var self = this && this !== globalThis ? this : {};
    var url = typeof input === "string" ? input : String((input && input.url) || "");
    var opts = init || {};
    self.url = url.indexOf("://") < 0 && url.charAt(0) === "/" ? "https://www.youtube.com" + url : url;
    self.method = String(opts.method || (input && input.method) || "GET").toUpperCase();
    self.headers = HeadersImpl.call({}, opts.headers || (input && input.headers) || null);
    self.body = opts.body != null ? opts.body : input && input.body;
    self.credentials = opts.credentials || "same-origin";
    self.mode = opts.mode || "cors";
    self.redirect = opts.redirect || "follow";
    self.signal = opts.signal || null;
    return self;
  }
  globalThis.Request = native("Request", RequestImpl);

  function AbortSignalImpl() {
    var self = this && this !== globalThis ? this : {};
    self.aborted = false;
    self.reason = undefined;
    self._listeners = [];
    self.addEventListener = native("addEventListener", function (type, fn) {
      if (type === "abort" && typeof fn === "function") self._listeners.push(fn);
    });
    self.removeEventListener = native("removeEventListener", function (type, fn) {
      if (type !== "abort") return;
      var i = self._listeners.indexOf(fn);
      if (i >= 0) self._listeners.splice(i, 1);
    });
    self.throwIfAborted = native("throwIfAborted", function () {
      if (self.aborted) throw self.reason || new Error("aborted");
    });
    return self;
  }
  globalThis.AbortSignal = native("AbortSignal", AbortSignalImpl);
  globalThis.AbortController = native("AbortController", function () {
    var self = this && this !== globalThis ? this : {};
    var signal = AbortSignalImpl.call({});
    self.signal = signal;
    self.abort = native("abort", function (reason) {
      signal.aborted = true;
      signal.reason = reason;
      var ls = signal._listeners.slice();
      for (var i = 0; i < ls.length; i++) {
        try {
          ls[i].call(signal, { type: "abort", target: signal });
        } catch (e) {
          /* Listener errors must not break abort propagation. */
        }
      }
    });
    return self;
  });

  /* base.js asks for its own resources by relative path ("/s/player/<hash>/base.js"). The host
   * has no base to resolve against, so it happens here, where `location` lives. */
  function resolveUrl(url) {
    var u = String(url == null ? "" : url);
    if (u.indexOf("://") >= 0 || u.indexOf("blob:") === 0) return u;
    var base = "https://www.youtube.com/";
    try {
      if (typeof location !== "undefined" && location && location.href) base = String(location.href);
    } catch (e) {
      /* Falls back to the origin; a missing location is not worth failing a request over. */
    }
    var m = /^([a-z]+:\/\/[^/]+)/i.exec(base);
    var origin = m ? m[1] : "https://www.youtube.com";
    if (u.indexOf("//") === 0) return "https:" + u;
    if (u.charAt(0) === "/") return origin + u;
    return origin + "/" + u;
  }

  function performFetch(url, method, headerPairs, body) {
    return resolveBody(body).then(function (bytes) {
      var req = {
        url: resolveUrl(url),
        method: String(method || "GET").toUpperCase(),
        headers: headerPairs.map(function (p) {
          return [String(p[0]), String(p[1])];
        }),
        bodyB64: bytes && bytes.length ? bytesToB64(bytes) : null,
      };
      return __ytapiHttp(req);
    }).then(function (r) {
      return ResponseImpl.call(
        {},
        r.url,
        r.status,
        r.statusText,
        r.headers,
        b64ToBytes(r.bodyB64),
      );
    });
  }

  globalThis.fetch = native("fetch", function (input, init) {
    var req = RequestImpl.call({}, input, init);
    return performFetch(req.url, req.method, headersToPairs(req.headers), req.body);
  });

  function XMLHttpRequestImpl() {
    var self = this && this !== globalThis ? this : {};
    self.UNSENT = 0;
    self.OPENED = 1;
    self.HEADERS_RECEIVED = 2;
    self.LOADING = 3;
    self.DONE = 4;
    self.readyState = 0;
    self.status = 0;
    self.statusText = "";
    self.response = null;
    self.responseText = "";
    self.responseType = "";
    self.responseURL = "";
    self.timeout = 0;
    self.withCredentials = false;
    self._url = "";
    self._method = "GET";
    self._headers = [];
    self._listeners = Object.create(null);
    self._responseHeaders = [];

    function fire(type) {
      var ls = self._listeners[type];
      var ev = { type: type, target: self, currentTarget: self };
      if (typeof self["on" + type] === "function") {
        try {
          self["on" + type].call(self, ev);
        } catch (e) {
          /* Handler errors are the caller's; they must not abort the request pipeline. */
        }
      }
      if (!ls) return;
      for (var i = 0; i < ls.length; i++) {
        try {
          ls[i].call(self, ev);
        } catch (e2) {
          /* as above */
        }
      }
    }
    function setState(s) {
      self.readyState = s;
      fire("readystatechange");
    }

    self.open = native("open", function (method, url) {
      self._method = String(method || "GET").toUpperCase();
      self._url = resolveUrl(url);
      setState(1);
    });
    self.setRequestHeader = native("setRequestHeader", function (name, value) {
      self._headers.push([String(name), String(value)]);
    });
    self.getResponseHeader = native("getResponseHeader", function (name) {
      var n = String(name).toLowerCase();
      for (var i = 0; i < self._responseHeaders.length; i++) {
        if (String(self._responseHeaders[i][0]).toLowerCase() === n) return self._responseHeaders[i][1];
      }
      return null;
    });
    self.getAllResponseHeaders = native("getAllResponseHeaders", function () {
      var out = "";
      for (var i = 0; i < self._responseHeaders.length; i++) {
        out += self._responseHeaders[i][0] + ": " + self._responseHeaders[i][1] + "\r\n";
      }
      return out;
    });
    self.addEventListener = native("addEventListener", function (type, fn) {
      if (typeof fn !== "function") return;
      (self._listeners[type] || (self._listeners[type] = [])).push(fn);
    });
    self.removeEventListener = native("removeEventListener", function (type, fn) {
      var ls = self._listeners[type];
      if (!ls) return;
      var i = ls.indexOf(fn);
      if (i >= 0) ls.splice(i, 1);
    });
    self.abort = native("abort", function () {
      self._aborted = true;
    });
    self.send = native("send", function (body) {
      performFetch(self._url, self._method, self._headers, body == null ? null : body).then(
        function (res) {
          if (self._aborted) return;
          self._responseHeaders = res.headers._list || [];
          self.status = res.status;
          self.statusText = res.statusText;
          self.responseURL = res.url;
          setState(2);
          return res.arrayBuffer().then(function (buf) {
            if (self._aborted) return;
            setState(3);
            var bytes = new Uint8Array(buf);
            if (self.responseType === "arraybuffer") self.response = buf;
            else if (self.responseType === "json") {
              try {
                self.response = JSON.parse(new TextDecoder("utf-8").decode(bytes));
              } catch (e) {
                self.response = null;
              }
            } else {
              self.responseText = new TextDecoder("utf-8").decode(bytes);
              self.response = self.responseText;
            }
            setState(4);
            fire("load");
            fire("loadend");
          });
        },
        function (err) {
          if (self._aborted) return;
          self.status = 0;
          setState(4);
          fire("error");
          fire("loadend");
        },
      );
    });
    return self;
  }
  globalThis.XMLHttpRequest = native("XMLHttpRequest", XMLHttpRequestImpl);
})();
