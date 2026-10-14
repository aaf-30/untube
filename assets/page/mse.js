/* MediaSource / SourceBuffer / HTMLMediaElement, state only.
 *
 * base.js talks to these as if this were Chrome, and ymusic's own shim (protocol/mse.ts, 1547
 * lines) forwards every call to C trampolines that decode for real. Nothing here decodes: there is
 * no picture to show and no audio to hear. What this file must do is keep the player's state
 * machine satisfied for long enough that it issues the `/videoplayback` request — which is the
 * single thing we are here to observe.
 *
 * Two behaviours are not optional, because the player stalls silently without them:
 *   - assigning a `blob:` src must open the MediaSource and fire `sourceopen`;
 *   - `appendBuffer` must post `updateend` asynchronously and `buffered` must grow, or the ABR
 *     loop decides there is nothing to fetch and stops.
 *
 * Ranges come from parsing the UMP `MEDIA_HEADER` (part 20) of what was appended, so `buffered`
 * reflects what the server actually sent rather than a fabricated clock.
 */
(function () {
  function native(name, impl) {
    return typeof __nativeFn === "function" ? __nativeFn(name, impl, 0) : impl;
  }

  var lastMs = null;
  var activeMedia = null;

  // ---------------------------------------------------------------------------
  // TimeRanges
  // ---------------------------------------------------------------------------
  function liveTimeRanges(get) {
    var self = {};
    Object.defineProperty(self, "length", {
      get: native("get length", function () {
        return get().length;
      }),
    });
    self.start = native("start", function (i) {
      return get()[i][0];
    });
    self.end = native("end", function (i) {
      return get()[i][1];
    });
    return self;
  }

  function emptyRanges() {
    return liveTimeRanges(function () {
      return [];
    });
  }

  // ---------------------------------------------------------------------------
  // UMP: pull playback ranges out of an appended segment
  // ---------------------------------------------------------------------------
  /* UMP framing uses its own varint, not protobuf's: the leading bits of byte 0 give the width. */
  function readUmpVarint(b, i) {
    var b0 = b[i];
    if (b0 === undefined) return null;
    if (b0 < 0x80) return { v: b0, i: i + 1 };
    if (b0 < 0xc0) return b[i + 1] === undefined ? null : { v: (b0 & 0x3f) | (b[i + 1] << 6), i: i + 2 };
    if (b0 < 0xe0)
      return b[i + 2] === undefined
        ? null
        : { v: (b0 & 0x1f) | (b[i + 1] << 5) | (b[i + 2] << 13), i: i + 3 };
    if (b0 < 0xf0)
      return b[i + 3] === undefined
        ? null
        : { v: (b0 & 0x0f) | (b[i + 1] << 4) | (b[i + 2] << 12) | (b[i + 3] << 20), i: i + 4 };
    return b[i + 4] === undefined
      ? null
      : { v: (b[i + 1] | (b[i + 2] << 8) | (b[i + 3] << 16) | (b[i + 4] << 24)) >>> 0, i: i + 5 };
  }

  /* MEDIA_HEADER fields, by protobuf number: 3 itag, 8 is_init_seg, 11 start_ms, 12 duration_ms. */
  function readMediaHeader(payload) {
    var i = 0;
    var out = { itag: 0, isInit: false, startMs: null, durationMs: null };
    while (i < payload.length) {
      var key = 0;
      var shift = 0;
      for (;;) {
        var kb = payload[i++];
        if (kb === undefined) return null;
        key += (kb & 0x7f) * Math.pow(2, shift);
        if ((kb & 0x80) === 0) break;
        shift += 7;
        if (shift > 56) return null;
      }
      var field = key >>> 3;
      var wire = key & 7;
      if (wire === 0) {
        var v = 0;
        var s = 0;
        for (;;) {
          var vb = payload[i++];
          if (vb === undefined) return null;
          v += (vb & 0x7f) * Math.pow(2, s);
          if ((vb & 0x80) === 0) break;
          s += 7;
          if (s > 56) return null;
        }
        if (field === 3) out.itag = v;
        else if (field === 8) out.isInit = v === 1;
        else if (field === 11) out.startMs = v;
        else if (field === 12) out.durationMs = v;
      } else if (wire === 2) {
        var len = 0;
        var ls = 0;
        for (;;) {
          var lb = payload[i++];
          if (lb === undefined) return null;
          len += (lb & 0x7f) * Math.pow(2, ls);
          if ((lb & 0x80) === 0) break;
          ls += 7;
          if (ls > 56) return null;
        }
        i += len;
      } else if (wire === 1) {
        i += 8;
      } else if (wire === 5) {
        i += 4;
      } else {
        return null;
      }
    }
    return out;
  }

  /* Walks a whole UMP body and returns every media (non-init) header it carries. */
  function mediaHeadersOf(bytes) {
    var out = [];
    var i = 0;
    while (i < bytes.length) {
      var id = readUmpVarint(bytes, i);
      if (!id) break;
      var size = readUmpVarint(bytes, id.i);
      if (!size) break;
      var start = size.i;
      if (start + size.v > bytes.length) break;
      if (id.v === 20) {
        var mh = readMediaHeader(bytes.subarray(start, start + size.v));
        if (mh && !mh.isInit && mh.startMs !== null && mh.durationMs !== null) out.push(mh);
      }
      i = start + size.v;
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Event plumbing
  // ---------------------------------------------------------------------------
  function fire(target, type) {
    var ls = target._listeners[type];
    var ev = { type: type, target: target, currentTarget: target };
    var inline = target["on" + type];
    if (typeof inline === "function") {
      try {
        inline.call(target, ev);
      } catch (e) {
        /* A throwing handler is the player's bug, not a reason to abort our own dispatch. */
      }
    }
    if (!ls) return;
    var copy = ls.slice();
    for (var i = 0; i < copy.length; i++) {
      try {
        copy[i].call(target, ev);
      } catch (e2) {
        /* as above */
      }
    }
  }

  function addListener(target, type, fn) {
    var bag = target._listeners;
    (bag[type] || (bag[type] = [])).push(fn);
    /* Chrome replays `sourceopen` to a listener attached after the source already opened —
     * which happens whenever the player reloads or switches to audio-only. */
    if (
      type === "sourceopen" &&
      target.readyState === "open" &&
      target._openFired &&
      target.sourceBuffers.length === 0
    ) {
      Promise.resolve().then(function () {
        if (target.sourceBuffers.length) return;
        try {
          fn.call(target, { type: "sourceopen", target: target, currentTarget: target });
        } catch (e) {
          /* as above */
        }
      });
    }
  }

  function removeListener(target, type, fn) {
    var list = target._listeners[type];
    if (!list) return;
    var i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }

  function invalidState(msg) {
    var e = new Error(msg);
    e.name = "InvalidStateError";
    return e;
  }

  // ---------------------------------------------------------------------------
  // SourceBuffer
  // ---------------------------------------------------------------------------
  function SourceBuffer(mime, ms) {
    var self = this;
    self._listeners = Object.create(null);
    self._ms = ms;
    self._mime = String(mime || "");
    self._ranges = [];
    self.mode = "segments";
    self.updating = false;
    self.timestampOffset = 0;
    self.appendWindowStart = 0;
    self.appendWindowEnd = Infinity;
    self.audioTracks = [];
    self.videoTracks = [];
    self.textTracks = [];
    self.buffered = liveTimeRanges(function () {
      return self._ranges;
    });
    self.addEventListener = native("addEventListener", function (t, fn) {
      addListener(self, t, fn);
    });
    self.removeEventListener = native("removeEventListener", function (t, fn) {
      removeListener(self, t, fn);
    });
    return self;
  }

  SourceBuffer.prototype.addRange = function (start, end) {
    if (!(end > start)) return;
    var rs = this._ranges;
    var lo = start;
    var hi = end;
    var merged = [];
    var placed = false;
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      if (r[1] < lo - 0.001) {
        merged.push(r);
        continue;
      }
      if (r[0] > hi + 0.001) {
        if (!placed) {
          merged.push([lo, hi]);
          placed = true;
        }
        merged.push(r);
        continue;
      }
      lo = Math.min(lo, r[0]);
      hi = Math.max(hi, r[1]);
    }
    if (!placed) merged.push([lo, hi]);
    this._ranges = merged;
  };

  SourceBuffer.prototype["appendBuffer"] = native("appendBuffer", function (data) {
    var self = this;
    if (self._ms === null) throw invalidState("SourceBuffer.appendBuffer: removed from MediaSource");
    if (self.updating) throw invalidState("SourceBuffer.appendBuffer: updating");
    var bytes = null;
    if (data instanceof Uint8Array) bytes = data;
    else if (data instanceof ArrayBuffer) bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data)) bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

    self.updating = true;
    var headers = bytes ? mediaHeadersOf(bytes) : [];
    Promise.resolve().then(function () {
      for (var i = 0; i < headers.length; i++) {
        var h = headers[i];
        var start = h.startMs / 1000 + self.timestampOffset;
        self.addRange(start, start + h.durationMs / 1000);
      }
      self.updating = false;
      fire(self, "update");
      fire(self, "updateend");
    });
  });

  SourceBuffer.prototype["abort"] = native("abort", function () {
    this.updating = false;
  });
  SourceBuffer.prototype["remove"] = native("remove", function (start, end) {
    var self = this;
    self.updating = true;
    Promise.resolve().then(function () {
      var kept = [];
      for (var i = 0; i < self._ranges.length; i++) {
        var r = self._ranges[i];
        if (r[1] <= start || r[0] >= end) kept.push(r);
        else {
          if (r[0] < start) kept.push([r[0], start]);
          if (r[1] > end) kept.push([end, r[1]]);
        }
      }
      self._ranges = kept;
      self.updating = false;
      fire(self, "updateend");
    });
  });
  SourceBuffer.prototype["changeType"] = native("changeType", function (mime) {
    this._mime = String(mime || "");
  });

  // ---------------------------------------------------------------------------
  // MediaSource
  // ---------------------------------------------------------------------------
  function MediaSource() {
    var self = this;
    self._listeners = Object.create(null);
    self.readyState = "closed";
    self.sourceBuffers = [];
    self._duration = NaN;
    self._openFired = false;
    self._id = ++msSeq;
    lastMs = self;
    return self;
  }

  var msSeq = 0;

  Object.defineProperty(MediaSource.prototype, "duration", {
    get: native("get duration", function () {
      return this._duration;
    }),
    set: native("set duration", function (v) {
      this._duration = v;
    }),
  });
  Object.defineProperty(MediaSource.prototype, "activeSourceBuffers", {
    get: native("get activeSourceBuffers", function () {
      return this.sourceBuffers;
    }),
  });
  Object.defineProperty(MediaSource.prototype, "handle", {
    get: native("get handle", function () {
      return this;
    }),
  });

  MediaSource.isTypeSupported = native("isTypeSupported", function (mime) {
    var m = String(mime || "").toLowerCase();
    return (
      m.indexOf("audio/webm") === 0 ||
      m.indexOf("video/webm") === 0 ||
      m.indexOf("audio/mp4") === 0 ||
      m.indexOf("video/mp4") === 0 ||
      m.indexOf("audio/mpeg") === 0
    );
  });

  MediaSource.prototype.open = function () {
    if (this.readyState !== "closed") return;
    this.readyState = "open";
    this._openFired = true;
    fire(this, "sourceopen");
    fire(this, "webkitsourceopen");
  };

  MediaSource.prototype["addSourceBuffer"] = native("addSourceBuffer", function (mime) {
    if (this.readyState !== "open") throw invalidState("MediaSource.addSourceBuffer: not open");
    var sb = new SourceBuffer(mime, this);
    this.sourceBuffers.push(sb);
    return sb;
  });
  MediaSource.prototype["removeSourceBuffer"] = native("removeSourceBuffer", function (sb) {
    var i = this.sourceBuffers.indexOf(sb);
    if (i < 0) throw invalidState("MediaSource.removeSourceBuffer: not in sourceBuffers");
    if (sb.updating) sb["abort"]();
    this.sourceBuffers.splice(i, 1);
    sb._ms = null;
  });
  MediaSource.prototype["endOfStream"] = native("endOfStream", function () {
    if (this.readyState !== "open") throw invalidState("MediaSource.endOfStream: not open");
    this.readyState = "ended";
    fire(this, "sourceended");
  });
  MediaSource.prototype["addEventListener"] = native("addEventListener", function (t, fn) {
    addListener(this, t, fn);
  });
  MediaSource.prototype["removeEventListener"] = native("removeEventListener", function (t, fn) {
    removeListener(this, t, fn);
  });

  // ---------------------------------------------------------------------------
  // HTMLMediaElement
  // ---------------------------------------------------------------------------
  function HTMLMediaElement() {
    var self = this;
    self._listeners = Object.create(null);
    self._ms = null;
    self._src = "";
    self._currentTime = 0;
    self._duration = NaN;
    self._paused = true;
    self._seeking = false;
    self._ended = false;
    self._playbackRate = 1;
    self._tick = null;
    self._ranges = [];
    return self;
  }

  function defineProps(proto) {
    function prop(name, get, set) {
      Object.defineProperty(proto, name, {
        get: native("get " + name, get),
        set: set ? native("set " + name, set) : undefined,
        configurable: true,
      });
    }
    prop("currentTime", function () {
      return this._currentTime;
    }, function (v) {
      var t = Number(v);
      if (!isFinite(t) || t < 0) return;
      this._currentTime = t;
      this._ended = false;
    });
    prop("duration", function () {
      return this._ms && isFinite(this._ms._duration) ? this._ms._duration : this._duration;
    });
    prop("paused", function () {
      return this._paused;
    });
    prop("ended", function () {
      return this._ended;
    });
    prop("seeking", function () {
      return this._seeking;
    });
    prop("readyState", function () {
      if (!this._ms || this._ms.readyState === "closed") return 0;
      return this._ms.sourceBuffers.length ? 4 : 1;
    });
    prop("buffered", function () {
      var self = this;
      return liveTimeRanges(function () {
        if (self._ms && self._ms.sourceBuffers.length) return self._ms.sourceBuffers[0]._ranges;
        return [];
      });
    });
    prop("seekable", function () {
      var self = this;
      return liveTimeRanges(function () {
        if (self._ms && self._ms.sourceBuffers.length) return self._ms.sourceBuffers[0]._ranges;
        return [];
      });
    });
    prop("played", function () {
      var self = this;
      return liveTimeRanges(function () {
        return self._currentTime > 0 ? [[0, self._currentTime]] : [];
      });
    });
    prop("playbackRate", function () {
      return this._playbackRate;
    }, function (v) {
      var r = Number(v);
      if (isFinite(r) && r > 0) this._playbackRate = r;
    });
    prop("defaultPlaybackRate", function () {
      return this._playbackRate;
    });
    prop("src", function () {
      return this._src;
    }, function (v) {
      assignSrc(this, String(v == null ? "" : v));
    });
    prop("currentSrc", function () {
      return this._src;
    });
    prop("volume", function () {
      return this._volume === undefined ? 1 : this._volume;
    }, function (v) {
      this._volume = Number(v);
    });
    prop("muted", function () {
      return !!this._muted;
    }, function (v) {
      this._muted = !!v;
    });
    prop("loop", function () {
      return !!this._loop;
    }, function (v) {
      this._loop = !!v;
    });
    // Geometry comes from the viewport: the snapshot has no layout engine to measure with.
    prop("videoWidth", function () {
      return this._videoWidth || 640;
    }, function (v) {
      this._videoWidth = v;
    });
    prop("videoHeight", function () {
      return this._videoHeight || 360;
    }, function (v) {
      this._videoHeight = v;
    });
  }
  defineProps(HTMLMediaElement.prototype);

  HTMLMediaElement.prototype["play"] = native("play", function () {
    var self = this;
    self._paused = false;
    self._ended = false;
    fire(self, "play");
    fire(self, "playing");
    startClock(self);
    return Promise.resolve();
  });
  HTMLMediaElement.prototype["pause"] = native("pause", function () {
    this._paused = true;
    stopClock(this);
    fire(this, "pause");
  });
  HTMLMediaElement.prototype["load"] = native("load", function () {
    var self = this;
    self._currentTime = 0;
    self._ended = false;
    stopClock(self);
    fire(self, "emptied");
    fire(self, "loadstart");
    fire(self, "loadedmetadata");
    fire(self, "canplay");
  });
  HTMLMediaElement.prototype["canPlayType"] = native("canPlayType", function (type) {
    var m = String(type || "").toLowerCase();
    return m.indexOf("video/mp4") === 0 || m.indexOf("audio/mp4") === 0 || m.indexOf("webm") >= 0
      ? "probably"
      : "";
  });
  HTMLMediaElement.prototype["fastSeek"] = native("fastSeek", function (t) {
    this.currentTime = Number(t) || 0;
  });
  HTMLMediaElement.prototype["setPlaybackRate"] = native("setPlaybackRate", function (r) {
    this.playbackRate = r;
  });
  HTMLMediaElement.prototype["addEventListener"] = native("addEventListener", function (t, fn) {
    addListener(this, t, fn);
  });
  HTMLMediaElement.prototype["removeEventListener"] = native("removeEventListener", function (t, fn) {
    removeListener(this, t, fn);
  });

  /* Nothing decodes, so the clock is the only thing that moves. Without it the ABR loop sees a
   * playhead frozen at zero, concludes it is fully buffered ahead, and stops asking for media. */
  function startClock(el) {
    if (el._tick) return;
    var last = Date.now();
    el._tick = setInterval(function () {
      var now = Date.now();
      var dt = (now - last) / 1000;
      last = now;
      if (el._paused) return;
      var dur = el._ms && isFinite(el._ms._duration) ? el._ms._duration : Infinity;
      el._currentTime = Math.min(el._currentTime + dt * el._playbackRate, dur);
      fire(el, "timeupdate");
      fire(el, "progress");
      if (isFinite(dur) && el._currentTime >= dur) {
        el._ended = true;
        stopClock(el);
        fire(el, "ended");
      }
    }, 250);
  }

  function stopClock(el) {
    if (!el._tick) return;
    clearInterval(el._tick);
    el._tick = null;
  }

  function assignSrc(el, url) {
    el._src = url;
    var ms = url && url.indexOf("blob:") === 0 ? globalThis.__ytapiLookupBlob(url) : null;
    el._ms = ms;
    if (ms) {
      ms.open();
      activeMedia = el;
    }
    fire(el, "loadstart");
    fire(el, "loadedmetadata");
    fire(el, "canplay");
  }

  function attachHtmlMedia(el) {
    if (el._mseAttached) {
      activeMedia = el;
      return;
    }
    el._mseAttached = 1;
    HTMLMediaElement.call(el);
    activeMedia = el;

    var proto = HTMLMediaElement.prototype;
    var members = [
      "play", "pause", "load", "canPlayType", "fastSeek", "setPlaybackRate",
      "addEventListener", "removeEventListener",
    ];
    for (var i = 0; i < members.length; i++) {
      var n = members[i];
      if (typeof proto[n] === "function") el[n] = proto[n];
    }
    var props = [
      "src", "currentSrc", "currentTime", "duration", "buffered", "seekable", "played",
      "videoWidth", "videoHeight", "playbackRate", "defaultPlaybackRate", "paused", "ended",
      "seeking", "muted", "volume", "readyState", "loop",
    ];
    for (var j = 0; j < props.length; j++) {
      var d = Object.getOwnPropertyDescriptor(proto, props[j]);
      if (d) Object.defineProperty(el, props[j], d);
    }

    /* YouTube sets src through setAttribute at least as often as through the property. */
    var protoSet = el.setAttribute;
    el.setAttribute = function (name, value) {
      if (String(name).toLowerCase() === "src") {
        assignSrc(el, String(value == null ? "" : value));
        return;
      }
      if (typeof protoSet === "function") protoSet.call(el, name, value);
      else el[name] = value;
    };
    var protoRemove = el.removeAttribute;
    el.removeAttribute = function (name) {
      if (String(name).toLowerCase() === "src") {
        assignSrc(el, "");
        return;
      }
      if (typeof protoRemove === "function") protoRemove.call(el, name);
      else delete el[name];
    };
  }

  // ---------------------------------------------------------------------------
  // Install
  // ---------------------------------------------------------------------------
  HTMLMediaElement.attach = native("attach", attachHtmlMedia);
  HTMLMediaElement.main = null;

  var g = globalThis;
  g.MediaSource = native("MediaSource", MediaSource);
  g.SourceBuffer = native("SourceBuffer", SourceBuffer);
  g.HTMLMediaElement = native("HTMLMediaElement", HTMLMediaElement);
  g.HTMLVideoElement = g.HTMLMediaElement;
  g.HTMLAudioElement = g.HTMLMediaElement;

  /* env.raw.js replaced URL.createObjectURL with its own registry; point it at the one that
   * also knows how to open the MediaSource it hands out. */
  (function () {
    var registry = Object.create(null);
    var seq = 0;
    var Url = g.URL;
    function create(obj) {
      var id = "ytapi-ms-" + ++seq;
      registry[id] = obj;
      var url = "blob:https://www.youtube.com/" + id;
      var el = activeMedia;
      /* Attach the source on the first MediaSource, but never steal an element that is already
       * playing one — that would detach the leftover the player is still draining. */
      if (el && obj && obj !== el._ms && !(el._ms && el._ms.sourceBuffers.length > 0)) {
        assignSrc(el, url);
      }
      return url;
    }
    function revoke(url) {
      delete registry[String(url == null ? "" : url).replace(/^blob:[^/]*\//, "")];
    }
    function lookup(url) {
      return registry[String(url == null ? "" : url).replace(/^blob:[^/]*\//, "")] || null;
    }
    g.__ytapiLookupBlob = lookup;
    if (typeof Url === "function") {
      Url.createObjectURL = native("createObjectURL", create);
      Url.revokeObjectURL = native("revokeObjectURL", revoke);
    } else {
      g.URL = { createObjectURL: create, revokeObjectURL: revoke };
    }
  })();
})();
