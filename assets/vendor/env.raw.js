(function () {
  function native(name, impl) {
    return __nativeFn(name, impl, 0);
  }
  function hrtime() {
    var p = globalThis.performance;
    if (p && typeof p.now === "function")
      return (typeof p.timeOrigin === "number" ? p.timeOrigin : 0) + p.now();
    return Date.now();
  }

  function unwrapScript(s) {
    if (s != null && typeof s === "object" && typeof s.toString === "function") {
      var t = s.toString();
      if (typeof t === "string" && t.indexOf("[object ") !== 0) return t;
    }
    return s;
  }

  function absScriptUrl(src) {
    src = String(unwrapScript(src) || "");
    if (src.indexOf("://") >= 0) return src;
    if (src.indexOf("//") === 0) return "https:" + src;
    if (src.charAt(0) === "/") return "https://www.youtube.com" + src;
    return src;
  }

  function fireScript(el, type) {
    var ev = { type: type, target: el, currentTarget: el, bubbles: false };
    var fn = el["on" + type];
    var list, i;
    if (typeof fn === "function") {
      try {
        fn.call(el, ev);
      } catch (e) {}
    }
    list = (el._bbd_ls && el._bbd_ls[type]) || [];
    for (i = 0; i < list.length; i++) {
      try {
        list[i].call(el, ev);
      } catch (e2) {}
    }
  }

  /* Chrome: insert <script src> fetches and evals globally, then onload.
   * appendChild alone is not enough. */
  var scriptResult = Object.create(null);

  function runScript(el) {
    var src, code, prev;
    if (!el || String(el.tagName || "").toUpperCase() !== "SCRIPT") return;
    src = el.src ? absScriptUrl(el.src) : "";
    if (src && src !== "about:blank") {
      prev = scriptResult[src];
      if (prev) {
        /* Chrome fires load/error on every inserted <script src>, even if
           the URL was already fetched. */
        el.readyState = prev.ok ? "complete" : el.readyState;
        fireScript(el, prev.ok ? "load" : "error");
        return;
      }
      if (typeof fetch !== "function") {
        fireScript(el, "error");
        return;
      }
      fetch(src)
        .then(function (r) {
          if (!r.ok) throw new Error("script " + r.status);
          return r.text();
        })
        .then(function (body) {
          try {
            (0, eval)(body);
          } catch (e) {
            console.warn("script eval failed " + src + " " + (e && e.message ? e.message : e));
            scriptResult[src] = { ok: false };
            fireScript(el, "error");
            return;
          }
          scriptResult[src] = { ok: true };
          el.readyState = "complete";
          fireScript(el, "load");
        })
        .catch(function (e) {
          console.warn("script fetch failed " + src + " " + (e && e.message ? e.message : e));
          scriptResult[src] = { ok: false };
          fireScript(el, "error");
        });
      return;
    }
    code = unwrapScript(el.textContent || el.innerText || el.text || "");
    if (!code) return;
    el._bbd_ran = true;
    try {
      (0, eval)(String(code));
      fireScript(el, "load");
    } catch (e) {
      console.warn("script eval failed inline " + (e && e.message ? e.message : e));
      fireScript(el, "error");
    }
  }

  function TrustedScript(s) {
    this._s = String(s);
  }
  TrustedScript.prototype.toString = native("toString", function () {
    return this._s;
  });
  TrustedScript.prototype.toJSON = native("toJSON", function () {
    return this._s;
  });
  globalThis.TrustedScript = native("TrustedScript", TrustedScript);
  globalThis.TrustedScript.prototype = TrustedScript.prototype;
  function makeTrustedScript(s) {
    var o = Object.create(TrustedScript.prototype);
    o._s = String(s);
    return o;
  }
  function TrustedHTML(s) {
    this._s = String(s);
  }
  TrustedHTML.prototype.toString = native("toString", function () {
    return this._s;
  });
  TrustedHTML.prototype.toJSON = native("toJSON", function () {
    return this._s;
  });
  globalThis.TrustedHTML = native("TrustedHTML", TrustedHTML);
  globalThis.TrustedHTML.prototype = TrustedHTML.prototype;
  function makeTrustedHTML(s) {
    var o = Object.create(TrustedHTML.prototype);
    o._s = String(s);
    return o;
  }
  function TrustedScriptURL(s) {
    this._s = String(s);
  }
  TrustedScriptURL.prototype.toString = native("toString", function () {
    return this._s;
  });
  TrustedScriptURL.prototype.toJSON = native("toJSON", function () {
    return this._s;
  });
  globalThis.TrustedScriptURL = native("TrustedScriptURL", TrustedScriptURL);
  globalThis.TrustedScriptURL.prototype = TrustedScriptURL.prototype;

  globalThis.window = globalThis;
  var cons = globalThis.console || {};
  function consFn(name, alt) {
    var fn = cons[name];
    if (typeof fn !== "function" && alt) fn = cons[alt];
    if (typeof fn !== "function") fn = function () {};
    return native(name, fn);
  }
  globalThis.console = {
    log: consFn("log"),
    info: consFn("info"),
    warn: consFn("warn"),
    error: consFn("error"),
    debug: consFn("debug", "log"),
    group: consFn("group"),
    groupCollapsed: consFn("groupCollapsed"),
    groupEnd: consFn("groupEnd"),
  };
  globalThis.self = globalThis;
  globalThis.top = globalThis;
  globalThis.parent = globalThis;
  globalThis.frames = globalThis;

  /* Do not replace global eval. Direct eval must stay the builtin.
   * TrustedScript unwrap is C. */

  globalThis.addEventListener = native("addEventListener", function (type, fn) {
    if (!this._bbd_ls) this._bbd_ls = {};
    if (!this._bbd_ls[type]) this._bbd_ls[type] = [];
    if (typeof fn === "function") this._bbd_ls[type].push(fn);
  });
  globalThis.removeEventListener = native("removeEventListener", function (type, fn) {
    var list, i;
    if (!this._bbd_ls || !this._bbd_ls[type]) return;
    list = this._bbd_ls[type];
    i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  });
  globalThis.dispatchEvent = native("dispatchEvent", function (ev) {
    var type, fn, list, i, target;
    if (ev == null || typeof ev !== "object") ev = { type: String(ev == null ? "" : ev) };
    type = String(ev.type || "");
    target = this;
    if (ev.target == null) ev.target = target;
    ev.currentTarget = target;
    fn = target["on" + type];
    if (typeof fn === "function") {
      try {
        fn.call(target, ev);
      } catch (e) {}
    }
    list = (target._bbd_ls && target._bbd_ls[type]) || [];
    for (i = 0; i < list.length; i++) {
      try {
        list[i].call(target, ev);
      } catch (e2) {}
    }
    return !ev.defaultPrevented;
  });
  globalThis.getComputedStyle = native("getComputedStyle", function getComputedStyle(el) {
    if (el && el.style) return el.style;
    return cssStyle();
  });
  globalThis.requestIdleCallback = native("requestIdleCallback", function (fn, opts) {
    return setTimeout(fn, (opts && opts.timeout) || 0);
  });
  globalThis.cancelIdleCallback = native("cancelIdleCallback", function (id) {
    clearTimeout(id);
  });
  if (typeof globalThis.queueMicrotask !== "function") {
    globalThis.queueMicrotask = native("queueMicrotask", function (fn) {
      Promise.resolve().then(fn);
    });
  }
  if (typeof globalThis.requestAnimationFrame !== "function") {
    globalThis.requestAnimationFrame = native("requestAnimationFrame", function (fn) {
      return setTimeout(function () {
        var ts = 0;
        if (globalThis.performance && typeof globalThis.performance.now === "function")
          ts = globalThis.performance.now();
        fn(ts);
      }, 16);
    });
  }
  if (typeof globalThis.cancelAnimationFrame !== "function") {
    globalThis.cancelAnimationFrame = native("cancelAnimationFrame", function (id) {
      clearTimeout(id);
    });
  }

  function locHref() {
    return String(this && this.href != null ? this.href : "");
  }
  globalThis.location = {
    href: "https://www.youtube.com/",
    protocol: "https:",
    host: "www.youtube.com",
    hostname: "www.youtube.com",
    port: "",
    pathname: "/",
    search: "",
    hash: "",
    origin: "https://www.youtube.com",
    ancestorOrigins: { length: 0 },
    toString: native("toString", locHref),
    valueOf: native("valueOf", locHref),
  };

  /* Shape only — EVENT_ID / data_ come from live ytcfg (installYtcfg).
   * Closed-over data_: native() wrap can call set with this=undefined. */
  var eventIdHeld = "";
  var data_ = {};
  Object.defineProperty(data_, "EVENT_ID", {
    configurable: true,
    enumerable: true,
    get: function () {
      return eventIdHeld;
    },
    set: function (v) {
      eventIdHeld = v;
    },
  });
  globalThis.ytcfg = {
    data_: data_,
    set: native("set", function (d) {
      if (!d || typeof d !== "object") return;
      var k;
      for (k in d) if (Object.prototype.hasOwnProperty.call(d, k)) data_[k] = d[k];
    }),
    get: native("get", function (k, fb) {
      return Object.prototype.hasOwnProperty.call(data_, k) ? data_[k] : fb;
    }),
  };
  globalThis.yt = { config_: data_ };

  var origin;
  if (!globalThis.performance || typeof globalThis.performance.now !== "function") {
    origin = hrtime() - 1847.3;
    globalThis.performance = {
      timeOrigin: origin,
      now: native("now", function now() {
        return hrtime() - origin;
      }),
      memory: {
        jsHeapSizeLimit: 4294967296,
        totalJSHeapSize: 19100000,
        usedJSHeapSize: 10200000,
      },
    };
  } else {
    origin = globalThis.performance.timeOrigin || hrtime() - 1847.3;
  }
  if (!globalThis.performance.memory) {
    globalThis.performance.memory = {
      jsHeapSizeLimit: 4294967296,
      totalJSHeapSize: 19100000,
      usedJSHeapSize: 10200000,
    };
  }
  (function attachTiming(perf, navStart) {
    if (!perf.timing) {
      perf.timing = {
        navigationStart: navStart,
        unloadEventStart: 0,
        unloadEventEnd: 0,
        redirectStart: 0,
        redirectEnd: 0,
        fetchStart: navStart + 1,
        domainLookupStart: navStart + 2,
        domainLookupEnd: navStart + 3,
        connectStart: navStart + 4,
        connectEnd: navStart + 5,
        secureConnectionStart: navStart + 5,
        requestStart: navStart + 10,
        responseStart: navStart + 40,
        responseEnd: navStart + 80,
        domLoading: navStart + 81,
        domInteractive: navStart + 100,
        domContentLoadedEventStart: navStart + 110,
        domContentLoadedEventEnd: navStart + 111,
        domComplete: navStart + 120,
        loadEventStart: navStart + 121,
        loadEventEnd: navStart + 122,
      };
    }
    if (!perf.navigation) {
      perf.navigation = { type: 0, redirectCount: 0 };
    }
    if (typeof perf.getEntriesByType !== "function") {
      perf.getEntriesByType = native("getEntriesByType", function () {
        return [];
      });
      perf.getEntriesByName = native("getEntriesByName", function () {
        return [];
      });
      perf.getEntries = native("getEntries", function () {
        return [];
      });
      perf.mark = native("mark", function () {});
      perf.measure = native("measure", function () {});
      perf.clearMarks = native("clearMarks", function () {});
      perf.clearMeasures = native("clearMeasures", function () {});
      perf.clearResourceTimings = native("clearResourceTimings", function () {});
    }
  })(globalThis.performance, Math.floor(origin));

  if (typeof globalThis.Intl !== "object" || globalThis.Intl == null) {
    (function () {
      /* __nativeFn is a C function: `new C()` is the C return value, not
         an auto-created `this`. Must return the instance. */
      function hostTimeZone() {
        if (typeof __timeZone === "function") {
          try {
            var z = __timeZone();
            if (typeof z === "string" && z) return z;
          } catch (e) {}
        }
        var off = 0;
        try {
          off = new Date().getTimezoneOffset();
        } catch (e2) {}
        if (!off) return "UTC";
        var h = Math.round(off / 60);
        return "Etc/GMT" + (h > 0 ? "+" + h : h);
      }
      function resolvedOptions() {
        return {
          locale: "en-US",
          calendar: "gregory",
          numberingSystem: "latn",
          timeZone: hostTimeZone(),
        };
      }
      function ctor(name) {
        var C = native(name, function () {
          var self = {};
          self.format = native("format", function (v) {
            return String(v == null ? "" : v);
          });
          self.formatToParts = native("formatToParts", function () {
            return [];
          });
          self.resolvedOptions = native("resolvedOptions", resolvedOptions);
          self.compare = native("compare", function (a, b) {
            return a < b ? -1 : a > b ? 1 : 0;
          });
          self.select = native("select", function () {
            return "other";
          });
          return self;
        });
        if (!C.prototype) C.prototype = {};
        C.prototype.resolvedOptions = resolvedOptions;
        C.supportedLocalesOf = native("supportedLocalesOf", function () {
          return ["en-US"];
        });
        return C;
      }
      globalThis.Intl = {
        DateTimeFormat: ctor("DateTimeFormat"),
        NumberFormat: ctor("NumberFormat"),
        Collator: ctor("Collator"),
        PluralRules: ctor("PluralRules"),
        RelativeTimeFormat: ctor("RelativeTimeFormat"),
        ListFormat: ctor("ListFormat"),
        DisplayNames: ctor("DisplayNames"),
        Segmenter: ctor("Segmenter"),
      };
    })();
  }

  function asTrusted(kind, v) {
    if (v != null && typeof v === "object") return v;
    if (kind === "script") return makeTrustedScript(v);
    if (kind === "html") return makeTrustedHTML(v);
    return String(v);
  }
  globalThis.trustedTypes = {
    emptyHTML: makeTrustedHTML(""),
    emptyScript: makeTrustedScript(""),
    defaultPolicy: null,
    createPolicy: native("createPolicy", function (name, rules) {
      return {
        name: name,
        createHTML: native("createHTML", function (s) {
          return asTrusted("html", rules && rules.createHTML ? rules.createHTML(s) : s);
        }),
        createScript: native("createScript", function (s) {
          return asTrusted("script", rules && rules.createScript ? rules.createScript(s) : s);
        }),
        createScriptURL: native("createScriptURL", function (s) {
          return asTrusted("url", rules && rules.createScriptURL ? rules.createScriptURL(s) : s);
        }),
      };
    }),
    isHTML: native("isHTML", function (v) {
      return v != null && typeof v === "object" && v instanceof TrustedHTML;
    }),
    isScript: native("isScript", function (v) {
      return v != null && typeof v === "object" && v instanceof TrustedScript;
    }),
    isScriptURL: native("isScriptURL", function (v) {
      return v != null && typeof v === "object" && v instanceof TrustedScriptURL;
    }),
    getAttributeType: native("getAttributeType", function () {
      return null;
    }),
    getPropertyType: native("getPropertyType", function (tagName, prop) {
      if (prop === "innerHTML") return "TrustedHTML";
      if (prop === "src" && String(tagName).toLowerCase() === "script") return "TrustedScriptURL";
      return null;
    }),
  };

  /* Desktop Chrome on youtube.com. */
  globalThis.chrome = {
    app: { isInstalled: false },
    csi: native("csi", function csi() {
      return { startE: origin, onloadT: origin + 80, pageT: hrtime() - origin, tran: 15 };
    }),
    loadTimes: native("loadTimes", function loadTimes() {
      return {};
    }),
    runtime: {
      connect: native("connect", function connect() {
        return {};
      }),
      sendMessage: native("sendMessage", function sendMessage() {}),
    },
    cast: {},
  };

  var nav = {
    /* Same string as DESKTOP_UA in yt/session.ts — HTTP User-Agent and this getter must match. */
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    appVersion:
      "5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36",
    appName: "Netscape",
    appCodeName: "Mozilla",
    product: "Gecko",
    productSub: "20030107",
    vendor: "Google Inc.",
    vendorSub: "",
    platform: "MacIntel",
    language: "en-US",
    languages: ["en-US", "en"],
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webdriver: false,
    cookieEnabled: true,
    onLine: true,
    pdfViewerEnabled: true,
    userAgentData: {
      brands: [
        { brand: "Chromium", version: "151" },
        { brand: "Google Chrome", version: "151" },
        { brand: "Not-A.Brand", version: "99" },
      ],
      mobile: false,
      platform: "macOS",
    },
  };
  nav.userAgentData.getHighEntropyValues = native("getHighEntropyValues", function () {
    var d = nav.userAgentData;
    return Promise.resolve({
      brands: d.brands,
      mobile: false,
      platform: "macOS",
      platformVersion: "15.7.1",
      architecture: "arm",
      bitness: "64",
      model: "",
      uaFullVersion: "151.0.0.0",
      fullVersionList: [
        { brand: "Chromium", version: "151.0.0.0" },
        { brand: "Google Chrome", version: "151.0.0.0" },
        { brand: "Not-A.Brand", version: "10.0.1.4" },
      ],
    });
  });
  nav.connection = {
    effectiveType: "4g",
    downlink: 10,
    rtt: 50,
    saveData: false,
    onchange: null,
    addEventListener: native("addEventListener", function () {}),
    removeEventListener: native("removeEventListener", function () {}),
  };
  nav.userActivation = { hasBeenActive: true, isActive: true };
  (function () {
    function plugin(name, filename, desc) {
      var m0 = { type: "application/pdf", suffixes: "pdf", description: desc, enabledPlugin: null };
      var m1 = { type: "text/pdf", suffixes: "pdf", description: desc, enabledPlugin: null };
      var p = { name: name, filename: filename, description: desc, length: 2, 0: m0, 1: m1 };
      m0.enabledPlugin = p;
      m1.enabledPlugin = p;
      p.item = native("item", function (i) {
        return p[i] || null;
      });
      p.namedItem = native("namedItem", function (n) {
        if (n === "application/pdf") return m0;
        if (n === "text/pdf") return m1;
        return null;
      });
      return p;
    }
    var list = [
      plugin("PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      plugin("Chrome PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      plugin("Chromium PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      plugin("Microsoft Edge PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      plugin("WebKit built-in PDF", "internal-pdf-viewer", "Portable Document Format"),
    ];
    var plugins = { length: list.length };
    var i;
    for (i = 0; i < list.length; i++) plugins[i] = list[i];
    plugins.item = native("item", function (i) {
      return plugins[i] || null;
    });
    plugins.namedItem = native("namedItem", function (n) {
      var j;
      for (j = 0; j < list.length; j++) if (list[j].name === n) return list[j];
      return null;
    });
    nav.plugins = plugins;
    var mt = { length: 2, 0: list[0][0], 1: list[0][1] };
    mt.item = native("item", function (i) {
      return mt[i] || null;
    });
    nav.mimeTypes = mt;
  })();
  nav.mediaDevices = {
    enumerateDevices: native("enumerateDevices", function () {
      return Promise.resolve([]);
    }),
    getUserMedia: native("getUserMedia", function () {
      var e = new Error("Requested device not found");
      e.name = "NotFoundError";
      return Promise.reject(e);
    }),
    getDisplayMedia: native("getDisplayMedia", function () {
      var e = new Error("Permission denied");
      e.name = "NotAllowedError";
      return Promise.reject(e);
    }),
  };
  nav.keyboard = {
    lock: native("lock", function () {
      return Promise.resolve();
    }),
    unlock: native("unlock", function () {}),
    getLayoutMap: native("getLayoutMap", function () {
      return Promise.resolve({
        size: 0,
        get: function () {
          return undefined;
        },
      });
    }),
  };
  nav.gpu = {
    wgslLanguageFeatures: {
      size: 0,
      has: function () {
        return false;
      },
    },
    requestAdapter: native("requestAdapter", function () {
      return Promise.resolve({
        info: { vendor: "apple", architecture: "metal-3", device: "", description: "" },
        features: {
          size: 0,
          has: function () {
            return false;
          },
        },
        limits: {},
        requestDevice: native("requestDevice", function () {
          return Promise.resolve({ queue: { submit: native("submit", function () {}) } });
        }),
      });
    }),
  };
  globalThis.navigator = nav;
  globalThis.length = 0;

  globalThis.screen = {
    width: 1512,
    height: 982,
    availWidth: 1512,
    availHeight: 944,
    colorDepth: 24,
    pixelDepth: 24,
    availLeft: 0,
    availTop: 0,
    orientation: { angle: 0, type: "landscape-primary" },
  };
  /* Chrome window geometry; live Create 9943 read screenY as undefined. */
  globalThis.innerWidth = 1280;
  globalThis.innerHeight = 800;
  globalThis.outerWidth = 1280;
  globalThis.outerHeight = 860;
  globalThis.devicePixelRatio = 2;
  globalThis.screenX = 0;
  globalThis.screenY = 0;
  globalThis.screenLeft = 0;
  globalThis.screenTop = 0;
  globalThis.pageXOffset = 0;
  globalThis.pageYOffset = 0;
  globalThis.scrollX = 0;
  globalThis.scrollY = 0;
  /* Chrome window identity; live Create 10023 read name as undefined. */
  globalThis.name = "";
  globalThis.status = "";
  globalThis.defaultStatus = "";
  globalThis.origin = globalThis.location.origin;
  globalThis.closed = false;
  globalThis.isSecureContext = true;
  globalThis.crossOriginIsolated = false;
  /* Chrome: opener is present and null on a top-level tab (`'opener' in window`). */
  globalThis.opener = null;
  (function () {
    var bars = ["menubar", "toolbar", "locationbar", "personalbar", "scrollbars", "statusbar"];
    var bi;
    for (bi = 0; bi < bars.length; bi++) globalThis[bars[bi]] = { visible: true };
  })();
  /* Chrome window.history; live Create 9959 read it as undefined. */
  globalThis.history = {
    length: 1,
    state: null,
    scrollRestoration: "auto",
    pushState: native("pushState", function () {}),
    replaceState: native("replaceState", function () {}),
    go: native("go", function () {}),
    back: native("back", function () {}),
    forward: native("forward", function () {}),
  };

  /* Illegal constructors. Omit TextEncoder (C native). MSE ctors are
   * hidden before this runs, so the PO snapshot sees throwers instead of engine-js classes. */
  var WINDOW_CTORS = [
    "MutationObserver",
    "IntersectionObserver",
    "ResizeObserver",
    "PerformanceObserver",
    "ReportingObserver",
    "PressureObserver",
    "Worker",
    "SharedWorker",
    "BroadcastChannel",
    "MessageChannel",
    "MessagePort",
    "Image",
    "Audio",
    "Option",
    "WebSocket",
    "Blob",
    "File",
    "FileReader",
    "FormData",
    "URLSearchParams",
    "TextDecoder",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "KeyboardEvent",
    "PointerEvent",
    "TouchEvent",
    "ErrorEvent",
    "PromiseRejectionEvent",
    "DOMParser",
    "XMLSerializer",
    "Notification",
    "OffscreenCanvas",
    "Path2D",
    "ImageData",
    "ImageBitmap",
    "FileList",
    "DataTransfer",
    "ClipboardEvent",
    "StorageEvent",
    "MediaStream",
    "RTCPeerConnection",
    "AudioContext",
    "webkitAudioContext",
    "OfflineAudioContext",
    "AnalyserNode",
    "WebGLRenderingContext",
    "WebGL2RenderingContext",
    "PluginArray",
    "MimeTypeArray",
    "Plugin",
    "MimeType",
    "Screen",
    "Navigator",
    "Location",
    "History",
    "Document",
    "HTMLDocument",
    "Element",
    "HTMLElement",
    "HTMLIFrameElement",
    "HTMLCanvasElement",
    "HTMLImageElement",
    "HTMLMediaElement",
    "HTMLVideoElement",
    "HTMLAudioElement",
    "MediaSource",
    "SourceBuffer",
    "XMLHttpRequest",
    "ReadableStream",
    "ReadableStreamDefaultReader",
    "CanvasRenderingContext2D",
    "ShadowRoot",
    "Node",
    "NodeList",
    "HTMLCollection",
    "NamedNodeMap",
    "CSSStyleDeclaration",
    "DOMTokenList",
    "Range",
    "TreeWalker",
    "XPathResult",
    "XPathEvaluator",
    "MutationRecord",
    "Storage",
    "Headers",
    "Request",
    "Response",
    "AbortController",
    "AbortSignal",
    "CSSMediaRule",
    "Selection",
    "ResizeObserverEntry",
    "IntersectionObserverEntry",
    "PerformanceEntry",
    "PerformanceNavigation",
    "PerformanceTiming",
    "Crypto",
    "SubtleCrypto",
    "IDBFactory",
    "CacheStorage",
    "TouchList",
    "CompressionStream",
    "DecompressionStream",
    "HighlightRegistry",
    "SVGForeignObjectElement",
    "SVGElement",
    "SVGSVGElement",
    "DOMException",
    "OscillatorNode",
    "GainNode",
    "BiquadFilterNode",
    "AudioBuffer",
    "AudioNode",
    "AudioParam",
    "AudioBufferSourceNode",
    "AudioDestinationNode",
    "AudioListener",
    "PeriodicWave",
    "PannerNode",
    "StereoPannerNode",
    "ChannelMergerNode",
    "ChannelSplitterNode",
    "ConstantSourceNode",
    "ConvolverNode",
    "DelayNode",
    "DynamicsCompressorNode",
    "IIRFilterNode",
    "WaveShaperNode",
    "MediaElementAudioSourceNode",
    "MediaStreamAudioSourceNode",
    "MediaStreamAudioDestinationNode",
    "AudioWorkletNode",
    "MediaRecorder",
    "Permissions",
    "PermissionStatus",
    "SpeechSynthesis",
    "SpeechSynthesisUtterance",
    "SpeechSynthesisEvent",
    "SpeechSynthesisErrorEvent",
    "NetworkInformation",
    "HTMLFencedFrameElement",
    "GPU",
    "GPUAdapter",
    "GPUDevice",
    "GPUBindGroup",
    "GPUBindGroupLayout",
    "GPUBuffer",
    "GPUCanvasContext",
    "GPUCommandEncoder",
    "GPUComputePipeline",
    "GPUPipelineLayout",
    "GPUQuerySet",
    "GPUQueue",
    "GPURenderPipeline",
    "GPUSampler",
    "GPUShaderModule",
    "GPUTexture",
    "GPUTextureView",
    "DOMPoint",
    "DOMPointReadOnly",
    "DOMRect",
    "DOMRectReadOnly",
    "DOMMatrix",
    "DOMMatrixReadOnly",
    "DOMQuad",
    "AbstractRange",
    "StaticRange",
    "CSSStyleSheet",
    "FontFace",
    "FontFaceSet",
    "MediaError",
    "VTTCue",
    "TextTrack",
    "TextTrackCue",
    "webkitSpeechRecognition",
    "SpeechRecognition",
    "HTMLFormElement",
    "HTMLAnchorElement",
    "HTMLInputElement",
    "HTMLTextAreaElement",
    "HTMLButtonElement",
    "HTMLDivElement",
    "HTMLSpanElement",
    "HTMLScriptElement",
    "InputEvent",
    "UIEvent",
    "FocusEvent",
    "WheelEvent",
    "CompositionEvent",
    "CSSMatrixComponent",
    "CSSTransformComponent",
    "CSSTranslate",
    "CSSRotate",
    "CSSScale",
    "CSSPerspective",
    "CSSTransformValue",
    "CSSStyleValue",
    "CSSNumericValue",
    "CSSUnitValue",
    "CSSUnparsedValue",
    "CSSKeywordValue",
    "MediaStreamTrack",
    "MediaStreamTrackAudioStats",
    "BarProp",
    "UserActivation",
    "SVGFEColorMatrixElement",
    "SVGFEComponentTransferElement",
    "SVGAnimatedNumberList",
    "XRAnchorSet",
    "XRWebGLBinding",
    "SVGGraphicsElement",
    "SVGComponentTransferFunctionElement",
  ];
  var WINDOW_FUNCS = [
    "alert",
    "confirm",
    "prompt",
    "open",
    "close",
    "focus",
    "blur",
    "print",
    "stop",
    "moveTo",
    "moveBy",
    "resizeTo",
    "resizeBy",
    "scroll",
    "scrollTo",
    "scrollBy",
    "postMessage",
    "getSelection",
    "matchMedia",
    "createImageBitmap",
    "structuredClone",
    "reportError",
    "captureEvents",
    "releaseEvents",
    "webkitRequestAnimationFrame",
    "webkitCancelAnimationFrame",
  ];

  function illegalCtor(name) {
    var fn = globalThis[name];
    var proto;
    if (typeof fn !== "function") {
      fn = native(name, function () {
        throw new TypeError("Illegal constructor");
      });
      globalThis[name] = fn;
    }
    if (
      name !== "HTMLElement" &&
      name !== "Element" &&
      name !== "Node" &&
      name !== "HTMLIFrameElement"
    ) {
      proto = fn.prototype;
      if (!proto || typeof proto !== "object") {
        proto = {};
        fn.prototype = proto;
      }
    }
    return fn;
  }
  var ci;
  for (ci = 0; ci < WINDOW_CTORS.length; ci++) illegalCtor(WINDOW_CTORS[ci]);
  if (globalThis.HTMLMediaElement && globalThis.HTMLMediaElement.prototype) {
    globalThis.HTMLMediaElement.prototype.canPlayType = native("canPlayType", function (type) {
      type = String(type == null ? "" : type).toLowerCase();
      if (!type) return "";
      var avc = /avc1\.([0-9a-f]{6})/i.exec(type);
      if (avc && typeof __mseAvcMaxLevel === "function") {
        var lvl = parseInt(avc[1].slice(4, 6), 16);
        if (lvl > __mseAvcMaxLevel()) return "";
      }
      if (/avc1|mp4a\.40|vp09|vp8|vp9|opus|flac|av01/.test(type)) return "probably";
      if (
        type.indexOf("video/mp4") === 0 ||
        type.indexOf("audio/mp4") === 0 ||
        type.indexOf("video/webm") === 0 ||
        type.indexOf("audio/webm") === 0 ||
        type.indexOf("audio/mpeg") === 0 ||
        type.indexOf("video/ogg") === 0 ||
        type.indexOf("audio/ogg") === 0
      )
        return "maybe";
      return "";
    });
  }
  /* Chrome Event is constructable; illegalCtor would throw on new Event("x"). */
  globalThis.Event = native("Event", function Event(type, init) {
    var o = this && this !== globalThis ? this : {};
    o.type = String(type == null ? "" : type);
    o.bubbles = !!(init && init.bubbles);
    o.cancelable = !!(init && init.cancelable);
    o.defaultPrevented = false;
    o.target = null;
    o.currentTarget = null;
    o.eventPhase = 0;
    o.timeStamp = hrtime();
    o.cancelBubble = false;
    o.returnValue = true;
    o.srcElement = null;
    o.ctrlKey = false;
    o.altKey = false;
    o.shiftKey = false;
    o.metaKey = false;
    o.button = 0;
    o.buttons = 0;
    o.clientX = 0;
    o.clientY = 0;
    o.screenX = 0;
    o.screenY = 0;
    o.pageX = 0;
    o.pageY = 0;
    o.offsetX = 0;
    o.offsetY = 0;
    o.which = 0;
    o.x = 0;
    o.y = 0;
    o.movementX = 0;
    o.movementY = 0;
    o.relatedTarget = null;
    return o;
  });
  if (!globalThis.Event.prototype || typeof globalThis.Event.prototype !== "object")
    globalThis.Event.prototype = {};
  if (typeof globalThis.Event.prototype.preventDefault !== "function") {
    globalThis.Event.prototype.preventDefault = native("preventDefault", function () {
      this.defaultPrevented = true;
    });
    globalThis.Event.prototype.stopPropagation = native("stopPropagation", function () {});
    globalThis.Event.prototype.stopImmediatePropagation = native(
      "stopImmediatePropagation",
      function () {},
    );
  }
  if (typeof globalThis.CustomEvent !== "function") {
    globalThis.CustomEvent = native("CustomEvent", function CustomEvent(type, init) {
      var o = globalThis.Event(type, init);
      o.detail = init && init.detail !== undefined ? init.detail : null;
      return o;
    });
    globalThis.CustomEvent.prototype = globalThis.Event.prototype;
  }
  for (ci = 0; ci < WINDOW_FUNCS.length; ci++) {
    if (typeof globalThis[WINDOW_FUNCS[ci]] !== "function") {
      globalThis[WINDOW_FUNCS[ci]] = native(WINDOW_FUNCS[ci], function () {
        return null;
      });
    }
  }
  globalThis.matchMedia = native("matchMedia", function matchMedia(q) {
    return {
      matches: false,
      media: String(q == null ? "" : q),
      addListener: native("addListener", function () {}),
      removeListener: native("removeListener", function () {}),
      addEventListener: globalThis.addEventListener,
      removeEventListener: globalThis.removeEventListener,
    };
  });

  var htmlElProto = {};
  function ensureCtor(name) {
    if (typeof globalThis[name] !== "function")
      globalThis[name] = native(name, function () {
        throw new TypeError("Illegal constructor");
      });
  }
  ensureCtor("HTMLElement");
  ensureCtor("Element");
  ensureCtor("Node");
  ensureCtor("HTMLIFrameElement");
  globalThis.HTMLElement.prototype = htmlElProto;
  globalThis.Element.prototype = htmlElProto;
  globalThis.Node.prototype = htmlElProto;
  var iframeProto = Object.create(htmlElProto);
  globalThis.HTMLIFrameElement.prototype = iframeProto;

  if (!globalThis.crypto) globalThis.crypto = {};
  if (typeof globalThis.crypto.getRandomValues !== "function") {
    globalThis.crypto.getRandomValues = native("getRandomValues", function (a) {
      var i;
      for (i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 256);
      return a;
    });
  }

  /* Chrome CSSStyleDeclaration is not an Array: join/push are undefined. */
  var NODE_CONST = {
    ELEMENT_NODE: 1,
    ATTRIBUTE_NODE: 2,
    TEXT_NODE: 3,
    CDATA_SECTION_NODE: 4,
    ENTITY_REFERENCE_NODE: 5,
    ENTITY_NODE: 6,
    PROCESSING_INSTRUCTION_NODE: 7,
    COMMENT_NODE: 8,
    DOCUMENT_NODE: 9,
    DOCUMENT_TYPE_NODE: 10,
    DOCUMENT_FRAGMENT_NODE: 11,
    NOTATION_NODE: 12,
    DOCUMENT_POSITION_DISCONNECTED: 1,
    DOCUMENT_POSITION_PRECEDING: 2,
    DOCUMENT_POSITION_FOLLOWING: 4,
    DOCUMENT_POSITION_CONTAINS: 8,
    DOCUMENT_POSITION_CONTAINED_BY: 16,
    DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC: 32,
  };

  function hide(obj, key, val) {
    Object.defineProperty(obj, key, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: val,
    });
  }

  /* Fresh prototype: same behavior as src, but function identity and
   * toString are ours (native trampoline), not QuickJS builtins. */
  function ownNativeProto(src) {
    var p = {},
      names,
      i,
      n,
      orig;
    names = Object.getOwnPropertyNames(src);
    for (i = 0; i < names.length; i++) {
      n = names[i];
      if (n === "constructor" || n === "arguments" || n === "caller") continue;
      orig = src[n];
      if (typeof orig !== "function") continue;
      hide(
        p,
        n,
        native(
          n,
          (function (fn) {
            return function () {
              return fn.apply(this, arguments);
            };
          })(orig),
        ),
      );
    }
    return p;
  }

  (function installElementProto() {
    var n, impl;
    impl = {
      appendChild: function (c) {
        if (!this.children) this.children = [];
        this.children.push(c);
        if (c) c.parentNode = this;
        if (c && c.tagName === "IFRAME" && c.contentWindow && c.contentWindow !== globalThis) {
          globalThis[0] = c.contentWindow;
          globalThis.length = 1;
        }
        runScript(c);
        return c;
      },
      insertBefore: function (c, ref) {
        var i;
        if (!c) return c;
        if (!this.children) this.children = [];
        i = ref ? this.children.indexOf(ref) : -1;
        if (i < 0) this.children.push(c);
        else this.children.splice(i, 0, c);
        c.parentNode = this;
        runScript(c);
        return c;
      },
      removeChild: function (c) {
        var i;
        if (!this.children) return c;
        i = this.children.indexOf(c);
        if (i >= 0) this.children.splice(i, 1);
        if (c) c.parentNode = null;
        return c;
      },
      contains: function (n) {
        var i;
        if (n === this) return true;
        if (!this.children) return false;
        for (i = 0; i < this.children.length; i++) {
          if (this.children[i] === n) return true;
          if (this.children[i].contains && this.children[i].contains(n)) return true;
        }
        return false;
      },
      hasChildNodes: function () {
        return !!(this.children && this.children.length);
      },
      hasAttributes: function () {
        return !!(this.attributes && this.attributes.length);
      },
      setAttribute: function (n, v) {
        this[n] = v;
      },
      setAttributeNS: function (ns, n, v) {
        this[n] = v;
      },
      getAttribute: function (n) {
        return this[n] == null ? null : String(this[n]);
      },
      getAttributeNS: function (ns, n) {
        return this[n] == null ? null : String(this[n]);
      },
      hasAttribute: function (n) {
        return this[n] != null && this[n] !== "";
      },
      hasAttributeNS: function (ns, n) {
        return this[n] != null && this[n] !== "";
      },
      removeAttribute: function (n) {
        delete this[n];
      },
      removeAttributeNS: function (ns, n) {
        delete this[n];
      },
      getBoundingClientRect: function () {
        var w = this.clientWidth || 0,
          h = this.clientHeight || 0;
        return { x: 0, y: 0, width: w, height: h, top: 0, left: 0, bottom: h, right: w };
      },
      getClientRects: function () {
        var r = this.getBoundingClientRect();
        var a = [r];
        a.item = function (i) {
          return this[i];
        };
        return a;
      },
      getElementsByClassName: function (name) {
        var self = this,
          list,
          dummy;
        name = String(name || "");
        list = collectNodes(this, function (n) {
          return n !== self && n.nodeType === 1 && hasClass(n, name);
        });
        if (list.length) return list;
        dummy = element("div");
        dummy.className = name;
        dummy.ownerDocument = document;
        return nodeListFrom([dummy]);
      },
      getElementsByTagName: function (name) {
        var self = this,
          want = String(name || "*").toUpperCase();
        return collectNodes(this, function (n) {
          return n !== self && n.nodeType === 1 && (want === "*" || n.tagName === want);
        });
      },
      querySelector: function (sel) {
        return queryOne(this, sel);
      },
      querySelectorAll: function (sel) {
        return queryAll(this, sel);
      },
      matches: function (sel) {
        return matchSimple(this, sel);
      },
      webkitMatchesSelector: function (sel) {
        return matchSimple(this, sel);
      },
      closest: function (sel) {
        var n = this;
        sel = String(sel || "").trim();
        while (n && n.nodeType === 1) {
          if (matchSimple(n, sel)) return n;
          n = n.parentNode;
        }
        return null;
      },
      getRootNode: function () {
        return document && document.documentElement ? document.documentElement : this;
      },
      addEventListener: globalThis.addEventListener,
      removeEventListener: globalThis.removeEventListener,
      dispatchEvent: globalThis.dispatchEvent,
    };
    for (n in impl) hide(htmlElProto, n, native(n, impl[n]));
    hide(htmlElProto, "constructor", globalThis.HTMLElement);
    Object.defineProperty(htmlElProto, "dataset", {
      configurable: true,
      enumerable: true,
      get: function () {
        if (!this._bbdDataset) this._bbdDataset = {};
        return this._bbdDataset;
      },
    });
    hide(iframeProto, "constructor", globalThis.HTMLIFrameElement);
    Object.defineProperty(htmlElProto, "childNodes", {
      configurable: true,
      enumerable: false,
      get: native("get childNodes", function () {
        return nodeListFrom(this.children || []);
      }),
    });
    Object.defineProperty(htmlElProto, "firstElementChild", {
      configurable: true,
      enumerable: true,
      get: native("get firstElementChild", function () {
        var c = this.children;
        return c && c.length ? c[0] : null;
      }),
    });
    Object.defineProperty(htmlElProto, "lastElementChild", {
      configurable: true,
      enumerable: true,
      get: native("get lastElementChild", function () {
        var c = this.children;
        return c && c.length ? c[c.length - 1] : null;
      }),
    });
    Object.defineProperty(htmlElProto, "childElementCount", {
      configurable: true,
      enumerable: true,
      get: native("get childElementCount", function () {
        return (this.children && this.children.length) || 0;
      }),
    });
    Object.defineProperty(htmlElProto, "parentElement", {
      configurable: true,
      enumerable: true,
      get: native("get parentElement", function () {
        var p = this.parentNode;
        return p && p.nodeType === 1 ? p : null;
      }),
    });
    Object.defineProperty(htmlElProto, "firstChild", {
      configurable: true,
      enumerable: true,
      get: native("get firstChild", function () {
        var c = this.children;
        return c && c.length ? c[0] : null;
      }),
    });
    Object.defineProperty(htmlElProto, "lastChild", {
      configurable: true,
      enumerable: true,
      get: native("get lastChild", function () {
        var c = this.children;
        return c && c.length ? c[c.length - 1] : null;
      }),
    });
    Object.defineProperty(htmlElProto, "previousSibling", {
      configurable: true,
      enumerable: true,
      get: native("get previousSibling", function () {
        return siblingAt(this, -1);
      }),
    });
    Object.defineProperty(htmlElProto, "nextSibling", {
      configurable: true,
      enumerable: true,
      get: native("get nextSibling", function () {
        return siblingAt(this, 1);
      }),
    });
    Object.defineProperty(htmlElProto, "previousElementSibling", {
      configurable: true,
      enumerable: true,
      get: native("get previousElementSibling", function () {
        return siblingAt(this, -1);
      }),
    });
    Object.defineProperty(htmlElProto, "nextElementSibling", {
      configurable: true,
      enumerable: true,
      get: native("get nextElementSibling", function () {
        return siblingAt(this, 1);
      }),
    });
  })();

  function ownNativeStatic(dst, src) {
    var names, i, n, orig;
    names = Object.getOwnPropertyNames(src);
    for (i = 0; i < names.length; i++) {
      n = names[i];
      if (
        n === "prototype" ||
        n === "length" ||
        n === "name" ||
        n === "caller" ||
        n === "arguments"
      )
        continue;
      orig = src[n];
      if (typeof orig !== "function") continue;
      hide(
        dst,
        n,
        native(
          n,
          (function (fn) {
            return function () {
              return fn.apply(src, arguments);
            };
          })(orig),
        ),
      );
    }
  }

  /* Unset camelCase / vendor CSS is "" and `in` is true (Chrome CSSOM). join/push stay absent. */
  var CSS_DENY = {
    concat: 1,
    join: 1,
    push: 1,
    pop: 1,
    splice: 1,
    slice: 1,
    shift: 1,
    unshift: 1,
    indexOf: 1,
    lastIndexOf: 1,
    map: 1,
    filter: 1,
    forEach: 1,
    reduce: 1,
    reduceRight: 1,
    some: 1,
    every: 1,
    find: 1,
    findIndex: 1,
    includes: 1,
    fill: 1,
    copyWithin: 1,
    entries: 1,
    keys: 1,
    values: 1,
    flat: 1,
    flatMap: 1,
    toString: 1,
    valueOf: 1,
    constructor: 1,
    then: 1,
    toJSON: 1,
    hasOwnProperty: 1,
    propertyIsEnumerable: 1,
    isPrototypeOf: 1,
    toLocaleString: 1,
    item: 1,
    getPropertyValue: 1,
    setProperty: 1,
    removeProperty: 1,
    getPropertyPriority: 1,
    parentRule: 1,
    cssText: 1,
    length: 1,
    apply: 1,
    call: 1,
    bind: 1,
    name: 1,
    prototype: 1,
    arguments: 1,
    caller: 1,
  };
  function cssIndexKey(k) {
    var i;
    if (typeof k !== "string" || !k) return false;
    for (i = 0; i < k.length; i++) {
      var c = k.charCodeAt(i);
      if (c < 48 || c > 57) return false;
    }
    return true;
  }
  function looksLikeCss(k) {
    var i, hasUpper, c;
    if (typeof k !== "string" || !k || k.charAt(0) === "_") return false;
    if (CSS_DENY[k]) return false;
    if (
      k.indexOf("webkit") === 0 ||
      k.indexOf("Webkit") === 0 ||
      k.indexOf("moz") === 0 ||
      k.indexOf("Moz") === 0 ||
      k.indexOf("ms") === 0
    )
      return true;
    hasUpper = false;
    for (i = 0; i < k.length; i++) {
      c = k.charCodeAt(i);
      if (c >= 65 && c <= 90) hasUpper = true;
      else if (!((c >= 97 && c <= 122) || (c >= 48 && c <= 57))) return false;
    }
    return hasUpper;
  }
  function cssStyle() {
    var s = { cssText: "", length: 0 };
    s.setProperty = native("setProperty", function (n, v) {
      n = String(n == null ? "" : n);
      v = String(v == null ? "" : v);
      this[n] = v;
    });
    s.removeProperty = native("removeProperty", function (n) {
      n = String(n == null ? "" : n);
      var old = this[n];
      delete this[n];
      return old == null ? "" : String(old);
    });
    s.getPropertyValue = native("getPropertyValue", function (n) {
      n = String(n == null ? "" : n);
      var v = this[n];
      return v == null ? "" : String(v);
    });
    return new Proxy(s, {
      get: function (t, k) {
        if (Object.prototype.hasOwnProperty.call(t, k)) return t[k];
        if (typeof k !== "string") return t[k];
        if (cssIndexKey(k)) return undefined;
        if (looksLikeCss(k)) return "";
        return t[k];
      },
      has: function (t, k) {
        if (Object.prototype.hasOwnProperty.call(t, k)) return true;
        if (typeof k !== "string") return k in t;
        if (cssIndexKey(k)) return false;
        if (looksLikeCss(k)) return true;
        return k in t;
      },
    });
  }

  /* Chrome canvas.getContext('webgl'|'webgl2'): fingerprint via getExtension. */
  function webglContext(canvas, version) {
    var gl = { canvas: canvas };
    var debugInfo = { UNMASKED_VENDOR_WEBGL: 37445, UNMASKED_RENDERER_WEBGL: 37446 };
    var extMap = {
      WEBGL_debug_renderer_info: debugInfo,
      WEBGL_debug_shaders: {},
      EXT_texture_filter_anisotropic: { MAX_TEXTURE_MAX_ANISOTROPY_EXT: 34047 },
      OES_texture_float: {},
      OES_standard_derivatives: {},
      WEBGL_lose_context: {
        loseContext: native("loseContext", function () {}),
        restoreContext: native("restoreContext", function () {}),
      },
    };
    gl.VENDOR = 7936;
    gl.RENDERER = 7937;
    gl.VERSION = 7938;
    gl.SHADING_LANGUAGE_VERSION = 35724;
    gl.MAX_TEXTURE_SIZE = 3379;
    gl.VERTEX_SHADER = 35633;
    gl.FRAGMENT_SHADER = 35632;
    gl.HIGH_FLOAT = 36338;
    gl.MEDIUM_FLOAT = 36337;
    gl.LOW_FLOAT = 36336;
    gl.HIGH_INT = 36341;
    gl.MEDIUM_INT = 36340;
    gl.LOW_INT = 36339;
    gl.getExtension = native("getExtension", function (name) {
      name = String(name == null ? "" : name);
      return Object.prototype.hasOwnProperty.call(extMap, name) ? extMap[name] : null;
    });
    gl.getSupportedExtensions = native("getSupportedExtensions", function () {
      return Object.keys(extMap);
    });
    gl.getParameter = native("getParameter", function (pname) {
      if (pname === 37445) return "Google Inc. (Apple)";
      if (pname === 37446)
        return "ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)";
      if (pname === 7936) return "WebKit";
      if (pname === 7937) return "WebKit WebGL";
      if (pname === 7938)
        return version === 2
          ? "WebGL 2.0 (OpenGL ES 3.0 Chromium)"
          : "WebGL 1.0 (OpenGL ES 2.0 Chromium)";
      if (pname === 35724)
        return version === 2
          ? "WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Chromium)"
          : "WebGL GLSL ES 1.0 (OpenGL ES GLSL ES 1.0 Chromium)";
      if (pname === 3379 || pname === 34076 || pname === 34024) return 16384;
      if (pname === 34921 || pname === 34930 || pname === 35660) return 16;
      if (pname === 36347) return 4095;
      if (pname === 36348 || pname === 36349) return 1024;
      if (pname === 35661) return 32;
      if (pname === 3386) return new Int32Array([16384, 16384]);
      if (pname === 2978) return new Int32Array([0, 0, canvas.width || 300, canvas.height || 150]);
      return null;
    });
    gl.getContextAttributes = native("getContextAttributes", function () {
      return {
        alpha: true,
        antialias: true,
        depth: true,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        failIfMajorPerformanceCaveat: false,
        powerPreference: "default",
        desynchronized: false,
        xrCompatible: false,
      };
    });
    gl.getShaderPrecisionFormat = native("getShaderPrecisionFormat", function () {
      return { rangeMin: 127, rangeMax: 127, precision: 23 };
    });
    return gl;
  }

  function nodeListFrom(arr) {
    var nl = { length: arr.length };
    var i;
    for (i = 0; i < arr.length; i++) nl[i] = arr[i];
    nl.item = native("item", function (i) {
      return i >= 0 && i < this.length ? this[i] : null;
    });
    return nl;
  }

  function hasClass(n, name) {
    return (" " + String((n && n.className) || "") + " ").indexOf(" " + name + " ") >= 0;
  }

  function siblingAt(n, dir) {
    var p, kids, i;
    p = n && n.parentNode;
    kids = p && p.children;
    if (!kids) return null;
    i = kids.indexOf(n);
    if (i < 0) return null;
    i += dir;
    return i >= 0 && i < kids.length ? kids[i] : null;
  }

  function attrOf(n, name) {
    if (!n) return null;
    if (typeof n.getAttribute === "function") {
      var v = n.getAttribute(name);
      if (v != null) return v;
    }
    if (n[name] == null) return null;
    return String(n[name]);
  }

  function matchSimple(n, sel) {
    var i, tag, rest, m, re, have;
    if (!n || n.nodeType !== 1) return false;
    sel = String(sel || "").trim();
    if (!sel) return false;
    i = 0;
    tag = "";
    if (sel.charAt(0) !== "." && sel.charAt(0) !== "#" && sel.charAt(0) !== "[") {
      while (i < sel.length && /[A-Za-z0-9_-]/.test(sel.charAt(i))) i++;
      tag = sel.slice(0, i).toUpperCase();
      if (tag && n.tagName !== tag) return false;
    }
    rest = sel.slice(i);
    re = /([.#])([A-Za-z0-9_-]+)/g;
    while ((m = re.exec(rest))) {
      if (m[1] === "#" && n.id !== m[2]) return false;
      if (m[1] === "." && !hasClass(n, m[2])) return false;
    }
    re = /\[([A-Za-z0-9_-]+)(?:([~|^$*]?=)"([^"]*)")?\]/g;
    while ((m = re.exec(rest))) {
      have = attrOf(n, m[1]);
      if (!m[2]) {
        if (have == null || have === "") return false;
      } else if (String(have) !== m[3]) return false;
    }
    return true;
  }

  function queryAll(root, sel) {
    var parts, i;
    sel = String(sel || "").trim();
    parts = sel.split(",");
    return collectNodes(root, function (n) {
      if (n === root || !n || n.nodeType !== 1) return false;
      for (i = 0; i < parts.length; i++) {
        if (matchSimple(n, parts[i].trim())) return true;
      }
      return false;
    });
  }

  function queryOne(root, sel) {
    var found = null,
      parts,
      i;
    sel = String(sel || "").trim();
    parts = sel.split(",");
    collectNodes(root, function (n) {
      if (found || n === root || !n || n.nodeType !== 1) return false;
      for (i = 0; i < parts.length; i++) {
        if (matchSimple(n, parts[i].trim())) {
          found = n;
          return false;
        }
      }
      return false;
    });
    if (found) return found;
    found = element("div");
    found.ownerDocument = document;
    return found;
  }

  function collectNodes(root, pred) {
    var out = [];
    function walk(n) {
      var i, kids;
      if (!n) return;
      if (pred(n)) out.push(n);
      kids = n.children || [];
      for (i = 0; i < kids.length; i++) walk(kids[i]);
    }
    walk(root);
    return nodeListFrom(out);
  }

  /* Chrome: iframe.contentWindow !== window, own Array/eval, own document.
   * YouTube Trusted Types: iframe.eval(string) throws EvalError. */
  function makeIframeWindow() {
    var inner = {};
    var innerDoc;
    inner.window = inner;
    inner.self = inner;
    inner.parent = globalThis;
    inner.top = globalThis;
    inner.frames = inner;
    inner.length = 0;
    inner.innerWidth = 1280;
    inner.innerHeight = 800;
    inner.outerWidth = 1280;
    inner.outerHeight = 860;
    inner.devicePixelRatio = 2;
    inner.screenX = 0;
    inner.screenY = 0;
    inner.screenLeft = 0;
    inner.screenTop = 0;
    inner.pageXOffset = 0;
    inner.pageYOffset = 0;
    inner.scrollX = 0;
    inner.scrollY = 0;
    inner.name = "";
    inner.status = "";
    inner.defaultStatus = "";
    inner.closed = false;
    inner.opener = null;
    inner.menubar = globalThis.menubar;
    inner.toolbar = globalThis.toolbar;
    inner.locationbar = globalThis.locationbar;
    inner.personalbar = globalThis.personalbar;
    inner.scrollbars = globalThis.scrollbars;
    inner.statusbar = globalThis.statusbar;
    inner.isSecureContext = true;
    inner.crossOriginIsolated = false;
    inner.screen = globalThis.screen;
    inner.location = {
      href: "about:blank",
      protocol: "about:",
      host: "",
      hostname: "",
      pathname: "blank",
      search: "",
      hash: "",
      origin: "null",
      toString: native("toString", locHref),
      valueOf: native("valueOf", locHref),
    };
    inner.origin = inner.location.origin;
    inner.history = globalThis.history;
    inner.Array = native("Array", function Array() {
      if (arguments.length === 1 && typeof arguments[0] === "number")
        return new Array(arguments[0]);
      return Array.prototype.slice.call(arguments);
    });
    inner.Array.prototype = ownNativeProto(Array.prototype);
    inner.Array.prototype.constructor = inner.Array;
    ownNativeStatic(inner.Array, Array);
    inner.Object = native("Object", function Object() {
      return {};
    });
    inner.String = native("String", function String(v) {
      return "" + v;
    });
    inner.String.prototype = ownNativeProto(String.prototype);
    inner.String.prototype.constructor = inner.String;
    ownNativeStatic(inner.String, String);
    inner.Number = native("Number", function Number(v) {
      return +v;
    });
    inner.Boolean = native("Boolean", function Boolean(v) {
      return !!v;
    });
    inner.Error = native("Error", function Error(m) {
      return new Error(m);
    });
    inner.Function = native("Function", function Function() {
      throw new EvalError(
        "Evaluating a string as JavaScript violates this document's Trusted Type assignment requirements.",
      );
    });
    inner.eval = native("eval", function (code) {
      var src, g;
      if (typeof code === "string") {
        throw new EvalError(
          "Evaluating a string as JavaScript violates this document's Trusted Type assignment requirements.",
        );
      }
      src = unwrapScript(code);
      if (typeof src !== "string") return code;
      if (src === "this") return inner;
      g = inner;
      return function () {
        with (this) {
          return eval(src);
        }
      }.call(g);
    });
    inner.addEventListener = globalThis.addEventListener;
    inner.removeEventListener = globalThis.removeEventListener;
    inner.dispatchEvent = globalThis.dispatchEvent;
    inner.setTimeout = globalThis.setTimeout;
    inner.clearTimeout = globalThis.clearTimeout;
    inner.requestIdleCallback = globalThis.requestIdleCallback;
    inner.performance = globalThis.performance;
    inner.trustedTypes = globalThis.trustedTypes;
    inner.btoa = globalThis.btoa;
    inner.atob = globalThis.atob;
    innerDoc = {
      nodeType: 9,
      readyState: "complete",
      hidden: false,
      visibilityState: "visible",
      body: null,
      documentElement: null,
      defaultView: inner,
      cookie: "",
      URL: "about:blank",
      documentURI: "about:blank",
    };
    inner.document = innerDoc;
    innerDoc.defaultView = inner;
    /* Same-origin about:blank iframe: Web IDL constructors exist (typeof
     * function). Identity may match the parent; Array/eval stay separate. */
    (function copyIdl(dst) {
      var names = Object.getOwnPropertyNames(globalThis);
      var i, n, ch;
      for (i = 0; i < names.length; i++) {
        n = names[i];
        if (!n) continue;
        ch = n.charCodeAt(0);
        if (ch < 65 || ch > 90) continue;
        if (dst[n] != null) continue;
        if (typeof globalThis[n] === "function") dst[n] = globalThis[n];
      }
    })(inner);
    return inner;
  }

  function element(tagName) {
    var t = String(tagName || "div").toUpperCase();
    if (t === "VIDEO") {
      var H = globalThis.HTMLMediaElement;
      if (H && H.main) return H.main;
    }
    var kids = [];
    var hostName =
      t === "IFRAME"
        ? "HTMLIFrameElement"
        : t === "IMG"
          ? "HTMLImageElement"
          : t === "INPUT"
            ? "HTMLInputElement"
            : t === "TEXTAREA"
              ? "HTMLTextAreaElement"
              : t === "VIDEO"
                ? "HTMLVideoElement"
                : t === "AUDIO"
                  ? "HTMLAudioElement"
                  : t === "CANVAS"
                    ? "HTMLCanvasElement"
                    : "Element";
    var el = Object.create(t === "IFRAME" ? iframeProto : htmlElProto);
    el.tagName = t;
    el.nodeName = t;
    el.nodeType = 1;
    el.children = kids;
    el.className = "";
    el.id = "";
    el.name = "";
    el.innerHTML = "";
    el.textContent = "";
    el.style = cssStyle();
    el.attributes = {
      length: 0,
      item: native("item", function () {
        return null;
      }),
    };
    el.ownerDocument = null;
    el.parentNode = null;
    el.dir = "";
    el.scrollTop = 0;
    el.scrollLeft = 0;
    el.scrollWidth = 0;
    el.scrollHeight = 0;
    el.clientWidth = 0;
    el.clientHeight = 0;
    el.offsetWidth = 0;
    el.offsetHeight = 0;
    el.offsetTop = 0;
    el.offsetLeft = 0;
    el.tabIndex = -1;
    if (typeof Symbol === "function" && Symbol.toStringTag) {
      Object.defineProperty(el, Symbol.toStringTag, {
        configurable: true,
        enumerable: false,
        value: hostName,
      });
    }
    if (t === "STYLE" || t === "LINK") {
      el.type = t === "STYLE" ? "text/css" : "";
      el.rel = t === "LINK" ? "" : undefined;
      el.sheet = {
        type: "text/css",
        href: null,
        disabled: false,
        cssRules: {
          length: 0,
          item: native("item", function () {
            return null;
          }),
        },
        rules: {
          length: 0,
          item: native("item", function () {
            return null;
          }),
        },
        insertRule: native("insertRule", function () {
          return 0;
        }),
        deleteRule: native("deleteRule", function () {}),
      };
    }
    if (t === "SCRIPT") {
      el.type = "";
      var scriptSrc = "";
      Object.defineProperty(el, "src", {
        configurable: true,
        enumerable: true,
        get: function () {
          return scriptSrc;
        },
        set: function (v) {
          scriptSrc = absScriptUrl(v);
          if (el.parentNode) runScript(el);
        },
      });
    }
    if (t === "IFRAME") {
      var cw = makeIframeWindow();
      el.src = "about:blank";
      el.contentWindow = cw;
      el.contentDocument = cw.document;
      hide(el, "longDesc", "");
      hide(el, "vspace", 0);
      hide(el, "hspace", 0);
      el.sandbox = {
        length: 0,
        value: "",
        supports: native("supports", function () {
          return true;
        }),
        add: native("add", function (tok) {
          if (!this.value) this.value = String(tok);
          else this.value += " " + tok;
        }),
        remove: native("remove", function () {}),
        contains: native("contains", function () {
          return false;
        }),
        toString: native("toString", function () {
          return this.value || "";
        }),
      };
    }
    if (t === "IMG") {
      el.complete = true;
      el.naturalWidth = 0;
      el.naturalHeight = 0;
      el.width = 0;
      el.height = 0;
      el.src = "";
      el.alt = "";
      el.currentSrc = "";
      hide(el, "longDesc", "");
      hide(el, "vspace", 0);
      hide(el, "hspace", 0);
      hide(el, "isMap", false);
      hide(el, "useMap", "");
      hide(el, "align", "");
      hide(el, "border", "");
    }
    if (t === "INPUT" || t === "TEXTAREA" || t === "SELECT") {
      el.value = "";
      el.defaultValue = "";
      el.type = t === "INPUT" ? "text" : t.toLowerCase();
      el.checked = false;
      el.disabled = false;
    }
    el.classList = {
      add: native("add", function () {
        var i,
          s = String(el.className || "");
        for (i = 0; i < arguments.length; i++) {
          if (s.indexOf(arguments[i]) < 0) s += (s ? " " : "") + arguments[i];
        }
        el.className = s;
      }),
      remove: native("remove", function () {
        var i,
          s = " " + String(el.className || "") + " ";
        for (i = 0; i < arguments.length; i++) s = s.split(" " + arguments[i] + " ").join(" ");
        el.className = s.replace(/^\s+|\s+$/g, "");
      }),
      contains: native("contains", function (c) {
        return (" " + String(el.className || "") + " ").indexOf(" " + c + " ") >= 0;
      }),
      toggle: native("toggle", function (c) {
        if (this.contains(c)) this.remove(c);
        else this.add(c);
      }),
      toString: native("toString", function () {
        return String(el.className || "");
      }),
    };
    if (
      (t === "VIDEO" || t === "AUDIO") &&
      globalThis.HTMLMediaElement &&
      typeof globalThis.HTMLMediaElement.attach === "function"
    ) {
      globalThis.HTMLMediaElement.attach(el);
      if (t === "VIDEO") globalThis.HTMLMediaElement.main = el;
    }
    if (t === "CANVAS") {
      el.width = 300;
      el.height = 150;
      el.getContext = native("getContext", function (kind) {
        kind = String(kind == null ? "2d" : kind).toLowerCase();
        if (kind === "webgl" || kind === "experimental-webgl") return webglContext(el, 1);
        if (kind === "webgl2") return webglContext(el, 2);
        var ctx = { canvas: el };
        ctx.fillRect = native("fillRect", function () {});
        ctx.fillText = native("fillText", function () {});
        ctx.getImageData = native("getImageData", function () {
          return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
        });
        ctx.measureText = native("measureText", function () {
          return { width: 0 };
        });
        return ctx;
      });
      el.toDataURL = native("toDataURL", function () {
        return "data:image/png;base64,";
      });
    }
    return el;
  }

  var html = element("html");
  var head = element("head");
  var body = element("body");
  html.appendChild(head);
  html.appendChild(body);

  var document = {
    nodeType: 9,
    readyState: "complete",
    hidden: false,
    visibilityState: "visible",
    cookie: "",
    referrer: "https://www.youtube.com/",
    title: "YouTube",
    domain: "www.youtube.com",
    URL: "https://www.youtube.com/",
    documentURI: "https://www.youtube.com/",
    characterSet: "UTF-8",
    charset: "UTF-8",
    defaultCharset: "windows-1252",
    compatMode: "CSS1Compat",
    contentType: "text/html",
    documentElement: html,
    head: head,
    body: body,
    location: globalThis.location,
    defaultView: globalThis,
  };
  var dk;
  for (dk in NODE_CONST) hide(document, dk, NODE_CONST[dk]);
  html.ownerDocument = document;
  head.ownerDocument = document;
  body.ownerDocument = document;
  hide(
    document,
    "createElement",
    native("createElement", function (name) {
      var el = element(name);
      el.ownerDocument = document;
      return el;
    }),
  );
  /* Chrome Image/Audio/Option are constructable; illegalCtor would throw. */
  globalThis.Image = native("Image", function Image(w, h) {
    var el = element("img");
    el.ownerDocument = document;
    if (w != null) el.width = +w;
    if (h != null) el.height = +h;
    return el;
  });
  globalThis.Audio = native("Audio", function Audio(src) {
    var el = element("audio");
    el.ownerDocument = document;
    if (src != null) el.src = String(src);
    return el;
  });
  hide(
    document,
    "createEvent",
    native("createEvent", function (type) {
      var t = String(type == null ? "" : type);
      var ev = {
        type: t,
        bubbles: false,
        cancelable: false,
        defaultPrevented: false,
        target: null,
        currentTarget: null,
        eventPhase: 0,
        timeStamp: hrtime(),
      };
      ev.cancelBubble = false;
      ev.returnValue = true;
      ev.srcElement = null;
      ev.ctrlKey = false;
      ev.altKey = false;
      ev.shiftKey = false;
      ev.metaKey = false;
      ev.button = 0;
      ev.clientX = 0;
      ev.clientY = 0;
      ev.screenX = 0;
      ev.screenY = 0;
      ev.pageX = 0;
      ev.pageY = 0;
      ev.offsetX = 0;
      ev.offsetY = 0;
      ev.which = 0;
      ev.x = 0;
      ev.y = 0;
      ev.movementX = 0;
      ev.movementY = 0;
      ev.buttons = 0;
      ev.relatedTarget = null;
      ev.view = null;
      ev.detail = 0;
      hide(
        ev,
        "initEvent",
        native("initEvent", function (ty, b, c) {
          this.type = String(ty == null ? "" : ty);
          this.bubbles = !!b;
          this.cancelable = !!c;
        }),
      );
      hide(
        ev,
        "initMouseEvent",
        native(
          "initMouseEvent",
          function (
            ty,
            bubbles,
            cancelable,
            view,
            detail,
            screenX,
            screenY,
            clientX,
            clientY,
            ctrlKey,
            altKey,
            shiftKey,
            metaKey,
            button,
            relatedTarget,
          ) {
            this.type = String(ty == null ? this.type : ty);
            this.bubbles = !!bubbles;
            this.cancelable = !!cancelable;
            this.view = view || null;
            this.detail = detail || 0;
            this.screenX = screenX || 0;
            this.screenY = screenY || 0;
            this.clientX = clientX || 0;
            this.clientY = clientY || 0;
            this.pageX = this.clientX;
            this.pageY = this.clientY;
            this.which = this.button + 1;
            this.x = this.clientX;
            this.y = this.clientY;
            this.ctrlKey = !!ctrlKey;
            this.altKey = !!altKey;
            this.shiftKey = !!shiftKey;
            this.metaKey = !!metaKey;
            this.button = button || 0;
            this.relatedTarget = relatedTarget || null;
          },
        ),
      );
      hide(
        ev,
        "initUIEvent",
        native("initUIEvent", function (ty, b, c, view, detail) {
          this.type = String(ty == null ? this.type : ty);
          this.bubbles = !!b;
          this.cancelable = !!c;
          this.view = view || null;
          this.detail = detail || 0;
        }),
      );
      hide(
        ev,
        "preventDefault",
        native("preventDefault", function () {
          this.defaultPrevented = true;
        }),
      );
      hide(
        ev,
        "stopPropagation",
        native("stopPropagation", function () {}),
      );
      hide(
        ev,
        "stopImmediatePropagation",
        native("stopImmediatePropagation", function () {}),
      );
      return ev;
    }),
  );
  hide(
    document,
    "createElementNS",
    native("createElementNS", function (ns, name) {
      return document.createElement(name);
    }),
  );
  hide(
    document,
    "createTextNode",
    native("createTextNode", function (s) {
      return {
        nodeType: 3,
        data: String(s == null ? "" : s),
        textContent: String(s == null ? "" : s),
      };
    }),
  );
  hide(
    document,
    "getElementById",
    native("getElementById", function (id) {
      id = String(id == null ? "" : id);
      var found = null;
      collectNodes(html, function (n) {
        if (!found && n && n.id === id) found = n;
        return false;
      });
      return found;
    }),
  );
  hide(
    document,
    "getElementsByTagName",
    native("getElementsByTagName", function (name) {
      name = String(name || "*").toUpperCase();
      return collectNodes(html, function (n) {
        return n && n.nodeType === 1 && (name === "*" || n.tagName === name);
      });
    }),
  );
  hide(
    document,
    "getElementsByClassName",
    native("getElementsByClassName", function (name) {
      name = String(name || "");
      return collectNodes(html, function (n) {
        return n && n.nodeType === 1 && hasClass(n, name);
      });
    }),
  );
  hide(
    document,
    "querySelector",
    native("querySelector", function (sel) {
      return queryOne(html, sel);
    }),
  );
  hide(
    document,
    "querySelectorAll",
    native("querySelectorAll", function (sel) {
      return queryAll(html, sel);
    }),
  );
  hide(document, "styleSheets", {
    length: 0,
    item: native("item", function () {
      return null;
    }),
  });
  hide(document, "children", html.children);
  hide(document, "firstElementChild", html);
  hide(document, "lastElementChild", html);
  hide(document, "childElementCount", 1);
  hide(document, "addEventListener", globalThis.addEventListener);
  hide(document, "removeEventListener", globalThis.removeEventListener);
  hide(
    document,
    "hasFocus",
    native("hasFocus", function () {
      return true;
    }),
  );
  html.clientWidth = html.offsetWidth = 1280;
  html.clientHeight = html.offsetHeight = 720;
  body.clientWidth = body.offsetWidth = 1280;
  body.clientHeight = body.offsetHeight = 720;
  globalThis.focus = native("focus", function () {
    return true;
  });
  globalThis.CLOSURE_FLAGS = globalThis.CLOSURE_FLAGS || {};
  globalThis.document = document;

  /* Chrome MessageChannel is constructable. illegalCtor left a thrower; YouTube live
   * schedules playVideo via port1.onmessage (DDy/mF). If `new MessageChannel` throws,
   * heartbeat onload never reaches Y3Q/ge/`new MediaSource`. */
  function MessagePort() {
    var o = this && this !== globalThis ? this : {};
    o._peer = null;
    o._closed = false;
    o.onmessage = null;
    return o;
  }
  MessagePort.prototype.postMessage = native("postMessage", function (data) {
    var peer = this._peer;
    if (!peer || this._closed || peer._closed) return;
    setTimeout(function () {
      var ev, fn;
      if (peer._closed) return;
      ev = { type: "message", data: data };
      fn = peer.onmessage;
      if (typeof fn === "function") {
        try {
          fn.call(peer, ev);
        } catch (e) {}
      }
    }, 0);
  });
  MessagePort.prototype.start = native("start", function () {});
  MessagePort.prototype.close = native("close", function () {
    this._closed = true;
  });
  function MessageChannel() {
    var o = this && this !== globalThis ? this : {};
    var a = new MessagePort();
    var b = new MessagePort();
    a._peer = b;
    b._peer = a;
    o.port1 = a;
    o.port2 = b;
    return o;
  }
  globalThis.MessagePort = native("MessagePort", MessagePort);
  globalThis.MessagePort.prototype = MessagePort.prototype;
  globalThis.MessageChannel = native("MessageChannel", MessageChannel);
  globalThis.MessageChannel.prototype = MessageChannel.prototype;
})();
