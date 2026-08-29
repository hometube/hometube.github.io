try {
  self["workbox:core:7.3.0"] && _();
} catch {
}
const D = (n, ...e) => {
  let t = n;
  return e.length > 0 && (t += ` :: ${JSON.stringify(e)}`), t;
}, j = D;
class f extends Error {
  /**
   *
   * @param {string} errorCode The error code that
   * identifies this particular error.
   * @param {Object=} details Any relevant arguments
   * that will help developers identify issues should
   * be added as a key on the context object.
   */
  constructor(e, t) {
    const s = j(e, t);
    super(s), this.name = e, this.details = t;
  }
}
const d = {
  googleAnalytics: "googleAnalytics",
  precache: "precache-v2",
  prefix: "workbox",
  runtime: "runtime",
  suffix: typeof registration < "u" ? registration.scope : ""
}, P = (n) => [d.prefix, n, d.suffix].filter((e) => e && e.length > 0).join("-"), H = (n) => {
  for (const e of Object.keys(d))
    n(e);
}, T = {
  updateDetails: (n) => {
    H((e) => {
      typeof n[e] == "string" && (d[e] = n[e]);
    });
  },
  getGoogleAnalyticsName: (n) => n || P(d.googleAnalytics),
  getPrecacheName: (n) => n || P(d.precache),
  getPrefix: () => d.prefix,
  getRuntimeName: (n) => n || P(d.runtime),
  getSuffix: () => d.suffix
};
function q(n, e) {
  const t = e();
  return n.waitUntil(t), t;
}
try {
  self["workbox:precaching:7.3.0"] && _();
} catch {
}
const F = "__WB_REVISION__";
function B(n) {
  if (!n)
    throw new f("add-to-cache-list-unexpected-type", { entry: n });
  if (typeof n == "string") {
    const r = new URL(n, location.href);
    return {
      cacheKey: r.href,
      url: r.href
    };
  }
  const { revision: e, url: t } = n;
  if (!t)
    throw new f("add-to-cache-list-unexpected-type", { entry: n });
  if (!e) {
    const r = new URL(t, location.href);
    return {
      cacheKey: r.href,
      url: r.href
    };
  }
  const s = new URL(t, location.href), a = new URL(t, location.href);
  return s.searchParams.set(F, e), {
    cacheKey: s.href,
    url: a.href
  };
}
class $ {
  constructor() {
    this.updatedURLs = [], this.notUpdatedURLs = [], this.handlerWillStart = async ({ request: e, state: t }) => {
      t && (t.originalRequest = e);
    }, this.cachedResponseWillBeUsed = async ({ event: e, state: t, cachedResponse: s }) => {
      if (e.type === "install" && t && t.originalRequest && t.originalRequest instanceof Request) {
        const a = t.originalRequest.url;
        s ? this.notUpdatedURLs.push(a) : this.updatedURLs.push(a);
      }
      return s;
    };
  }
}
class V {
  constructor({ precacheController: e }) {
    this.cacheKeyWillBeUsed = async ({ request: t, params: s }) => {
      const a = (s == null ? void 0 : s.cacheKey) || this._precacheController.getCacheKeyForURL(t.url);
      return a ? new Request(a, { headers: t.headers }) : t;
    }, this._precacheController = e;
  }
}
let y;
function z() {
  if (y === void 0) {
    const n = new Response("");
    if ("body" in n)
      try {
        new Response(n.body), y = !0;
      } catch {
        y = !1;
      }
    y = !1;
  }
  return y;
}
async function G(n, e) {
  let t = null;
  if (n.url && (t = new URL(n.url).origin), t !== self.location.origin)
    throw new f("cross-origin-copy-response", { origin: t });
  const s = n.clone(), r = {
    headers: new Headers(s.headers),
    status: s.status,
    statusText: s.statusText
  }, o = z() ? s.body : await s.blob();
  return new Response(o, r);
}
const J = (n) => new URL(String(n), location.href).href.replace(new RegExp(`^${location.origin}`), "");
function x(n, e) {
  const t = new URL(n);
  for (const s of e)
    t.searchParams.delete(s);
  return t.href;
}
async function Q(n, e, t, s) {
  const a = x(e.url, t);
  if (e.url === a)
    return n.match(e, s);
  const r = Object.assign(Object.assign({}, s), { ignoreSearch: !0 }), o = await n.keys(e, r);
  for (const c of o) {
    const i = x(c.url, t);
    if (a === i)
      return n.match(c, s);
  }
}
class X {
  /**
   * Creates a promise and exposes its resolve and reject functions as methods.
   */
  constructor() {
    this.promise = new Promise((e, t) => {
      this.resolve = e, this.reject = t;
    });
  }
}
const Y = /* @__PURE__ */ new Set();
async function Z() {
  for (const n of Y)
    await n();
}
function ee(n) {
  return new Promise((e) => setTimeout(e, n));
}
try {
  self["workbox:strategies:7.3.0"] && _();
} catch {
}
function b(n) {
  return typeof n == "string" ? new Request(n) : n;
}
class te {
  /**
   * Creates a new instance associated with the passed strategy and event
   * that's handling the request.
   *
   * The constructor also initializes the state that will be passed to each of
   * the plugins handling this request.
   *
   * @param {workbox-strategies.Strategy} strategy
   * @param {Object} options
   * @param {Request|string} options.request A request to run this strategy for.
   * @param {ExtendableEvent} options.event The event associated with the
   *     request.
   * @param {URL} [options.url]
   * @param {*} [options.params] The return value from the
   *     {@link workbox-routing~matchCallback} (if applicable).
   */
  constructor(e, t) {
    this._cacheKeys = {}, Object.assign(this, t), this.event = t.event, this._strategy = e, this._handlerDeferred = new X(), this._extendLifetimePromises = [], this._plugins = [...e.plugins], this._pluginStateMap = /* @__PURE__ */ new Map();
    for (const s of this._plugins)
      this._pluginStateMap.set(s, {});
    this.event.waitUntil(this._handlerDeferred.promise);
  }
  /**
   * Fetches a given request (and invokes any applicable plugin callback
   * methods) using the `fetchOptions` (for non-navigation requests) and
   * `plugins` defined on the `Strategy` object.
   *
   * The following plugin lifecycle methods are invoked when using this method:
   * - `requestWillFetch()`
   * - `fetchDidSucceed()`
   * - `fetchDidFail()`
   *
   * @param {Request|string} input The URL or request to fetch.
   * @return {Promise<Response>}
   */
  async fetch(e) {
    const { event: t } = this;
    let s = b(e);
    if (s.mode === "navigate" && t instanceof FetchEvent && t.preloadResponse) {
      const o = await t.preloadResponse;
      if (o)
        return o;
    }
    const a = this.hasCallback("fetchDidFail") ? s.clone() : null;
    try {
      for (const o of this.iterateCallbacks("requestWillFetch"))
        s = await o({ request: s.clone(), event: t });
    } catch (o) {
      if (o instanceof Error)
        throw new f("plugin-error-request-will-fetch", {
          thrownErrorMessage: o.message
        });
    }
    const r = s.clone();
    try {
      let o;
      o = await fetch(s, s.mode === "navigate" ? void 0 : this._strategy.fetchOptions);
      for (const c of this.iterateCallbacks("fetchDidSucceed"))
        o = await c({
          event: t,
          request: r,
          response: o
        });
      return o;
    } catch (o) {
      throw a && await this.runCallbacks("fetchDidFail", {
        error: o,
        event: t,
        originalRequest: a.clone(),
        request: r.clone()
      }), o;
    }
  }
  /**
   * Calls `this.fetch()` and (in the background) runs `this.cachePut()` on
   * the response generated by `this.fetch()`.
   *
   * The call to `this.cachePut()` automatically invokes `this.waitUntil()`,
   * so you do not have to manually call `waitUntil()` on the event.
   *
   * @param {Request|string} input The request or URL to fetch and cache.
   * @return {Promise<Response>}
   */
  async fetchAndCachePut(e) {
    const t = await this.fetch(e), s = t.clone();
    return this.waitUntil(this.cachePut(e, s)), t;
  }
  /**
   * Matches a request from the cache (and invokes any applicable plugin
   * callback methods) using the `cacheName`, `matchOptions`, and `plugins`
   * defined on the strategy object.
   *
   * The following plugin lifecycle methods are invoked when using this method:
   * - cacheKeyWillBeUsed()
   * - cachedResponseWillBeUsed()
   *
   * @param {Request|string} key The Request or URL to use as the cache key.
   * @return {Promise<Response|undefined>} A matching response, if found.
   */
  async cacheMatch(e) {
    const t = b(e);
    let s;
    const { cacheName: a, matchOptions: r } = this._strategy, o = await this.getCacheKey(t, "read"), c = Object.assign(Object.assign({}, r), { cacheName: a });
    s = await caches.match(o, c);
    for (const i of this.iterateCallbacks("cachedResponseWillBeUsed"))
      s = await i({
        cacheName: a,
        matchOptions: r,
        cachedResponse: s,
        request: o,
        event: this.event
      }) || void 0;
    return s;
  }
  /**
   * Puts a request/response pair in the cache (and invokes any applicable
   * plugin callback methods) using the `cacheName` and `plugins` defined on
   * the strategy object.
   *
   * The following plugin lifecycle methods are invoked when using this method:
   * - cacheKeyWillBeUsed()
   * - cacheWillUpdate()
   * - cacheDidUpdate()
   *
   * @param {Request|string} key The request or URL to use as the cache key.
   * @param {Response} response The response to cache.
   * @return {Promise<boolean>} `false` if a cacheWillUpdate caused the response
   * not be cached, and `true` otherwise.
   */
  async cachePut(e, t) {
    const s = b(e);
    await ee(0);
    const a = await this.getCacheKey(s, "write");
    if (!t)
      throw new f("cache-put-with-no-response", {
        url: J(a.url)
      });
    const r = await this._ensureResponseSafeToCache(t);
    if (!r)
      return !1;
    const { cacheName: o, matchOptions: c } = this._strategy, i = await self.caches.open(o), l = this.hasCallback("cacheDidUpdate"), u = l ? await Q(
      // TODO(philipwalton): the `__WB_REVISION__` param is a precaching
      // feature. Consider into ways to only add this behavior if using
      // precaching.
      i,
      a.clone(),
      ["__WB_REVISION__"],
      c
    ) : null;
    try {
      await i.put(a, l ? r.clone() : r);
    } catch (h) {
      if (h instanceof Error)
        throw h.name === "QuotaExceededError" && await Z(), h;
    }
    for (const h of this.iterateCallbacks("cacheDidUpdate"))
      await h({
        cacheName: o,
        oldResponse: u,
        newResponse: r.clone(),
        request: a,
        event: this.event
      });
    return !0;
  }
  /**
   * Checks the list of plugins for the `cacheKeyWillBeUsed` callback, and
   * executes any of those callbacks found in sequence. The final `Request`
   * object returned by the last plugin is treated as the cache key for cache
   * reads and/or writes. If no `cacheKeyWillBeUsed` plugin callbacks have
   * been registered, the passed request is returned unmodified
   *
   * @param {Request} request
   * @param {string} mode
   * @return {Promise<Request>}
   */
  async getCacheKey(e, t) {
    const s = `${e.url} | ${t}`;
    if (!this._cacheKeys[s]) {
      let a = e;
      for (const r of this.iterateCallbacks("cacheKeyWillBeUsed"))
        a = b(await r({
          mode: t,
          request: a,
          event: this.event,
          // params has a type any can't change right now.
          params: this.params
          // eslint-disable-line
        }));
      this._cacheKeys[s] = a;
    }
    return this._cacheKeys[s];
  }
  /**
   * Returns true if the strategy has at least one plugin with the given
   * callback.
   *
   * @param {string} name The name of the callback to check for.
   * @return {boolean}
   */
  hasCallback(e) {
    for (const t of this._strategy.plugins)
      if (e in t)
        return !0;
    return !1;
  }
  /**
   * Runs all plugin callbacks matching the given name, in order, passing the
   * given param object (merged ith the current plugin state) as the only
   * argument.
   *
   * Note: since this method runs all plugins, it's not suitable for cases
   * where the return value of a callback needs to be applied prior to calling
   * the next callback. See
   * {@link workbox-strategies.StrategyHandler#iterateCallbacks}
   * below for how to handle that case.
   *
   * @param {string} name The name of the callback to run within each plugin.
   * @param {Object} param The object to pass as the first (and only) param
   *     when executing each callback. This object will be merged with the
   *     current plugin state prior to callback execution.
   */
  async runCallbacks(e, t) {
    for (const s of this.iterateCallbacks(e))
      await s(t);
  }
  /**
   * Accepts a callback and returns an iterable of matching plugin callbacks,
   * where each callback is wrapped with the current handler state (i.e. when
   * you call each callback, whatever object parameter you pass it will
   * be merged with the plugin's current state).
   *
   * @param {string} name The name fo the callback to run
   * @return {Array<Function>}
   */
  *iterateCallbacks(e) {
    for (const t of this._strategy.plugins)
      if (typeof t[e] == "function") {
        const s = this._pluginStateMap.get(t);
        yield (r) => {
          const o = Object.assign(Object.assign({}, r), { state: s });
          return t[e](o);
        };
      }
  }
  /**
   * Adds a promise to the
   * [extend lifetime promises]{@link https://w3c.github.io/ServiceWorker/#extendableevent-extend-lifetime-promises}
   * of the event associated with the request being handled (usually a
   * `FetchEvent`).
   *
   * Note: you can await
   * {@link workbox-strategies.StrategyHandler~doneWaiting}
   * to know when all added promises have settled.
   *
   * @param {Promise} promise A promise to add to the extend lifetime promises
   *     of the event that triggered the request.
   */
  waitUntil(e) {
    return this._extendLifetimePromises.push(e), e;
  }
  /**
   * Returns a promise that resolves once all promises passed to
   * {@link workbox-strategies.StrategyHandler~waitUntil}
   * have settled.
   *
   * Note: any work done after `doneWaiting()` settles should be manually
   * passed to an event's `waitUntil()` method (not this handler's
   * `waitUntil()` method), otherwise the service worker thread may be killed
   * prior to your work completing.
   */
  async doneWaiting() {
    for (; this._extendLifetimePromises.length; ) {
      const e = this._extendLifetimePromises.splice(0), s = (await Promise.allSettled(e)).find((a) => a.status === "rejected");
      if (s)
        throw s.reason;
    }
  }
  /**
   * Stops running the strategy and immediately resolves any pending
   * `waitUntil()` promises.
   */
  destroy() {
    this._handlerDeferred.resolve(null);
  }
  /**
   * This method will call cacheWillUpdate on the available plugins (or use
   * status === 200) to determine if the Response is safe and valid to cache.
   *
   * @param {Request} options.request
   * @param {Response} options.response
   * @return {Promise<Response|undefined>}
   *
   * @private
   */
  async _ensureResponseSafeToCache(e) {
    let t = e, s = !1;
    for (const a of this.iterateCallbacks("cacheWillUpdate"))
      if (t = await a({
        request: this.request,
        response: t,
        event: this.event
      }) || void 0, s = !0, !t)
        break;
    return s || t && t.status !== 200 && (t = void 0), t;
  }
}
class se {
  /**
   * Creates a new instance of the strategy and sets all documented option
   * properties as public instance properties.
   *
   * Note: if a custom strategy class extends the base Strategy class and does
   * not need more than these properties, it does not need to define its own
   * constructor.
   *
   * @param {Object} [options]
   * @param {string} [options.cacheName] Cache name to store and retrieve
   * requests. Defaults to the cache names provided by
   * {@link workbox-core.cacheNames}.
   * @param {Array<Object>} [options.plugins] [Plugins]{@link https://developers.google.com/web/tools/workbox/guides/using-plugins}
   * to use in conjunction with this caching strategy.
   * @param {Object} [options.fetchOptions] Values passed along to the
   * [`init`](https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Parameters)
   * of [non-navigation](https://github.com/GoogleChrome/workbox/issues/1796)
   * `fetch()` requests made by this strategy.
   * @param {Object} [options.matchOptions] The
   * [`CacheQueryOptions`]{@link https://w3c.github.io/ServiceWorker/#dictdef-cachequeryoptions}
   * for any `cache.match()` or `cache.put()` calls made by this strategy.
   */
  constructor(e = {}) {
    this.cacheName = T.getRuntimeName(e.cacheName), this.plugins = e.plugins || [], this.fetchOptions = e.fetchOptions, this.matchOptions = e.matchOptions;
  }
  /**
   * Perform a request strategy and returns a `Promise` that will resolve with
   * a `Response`, invoking all relevant plugin callbacks.
   *
   * When a strategy instance is registered with a Workbox
   * {@link workbox-routing.Route}, this method is automatically
   * called when the route matches.
   *
   * Alternatively, this method can be used in a standalone `FetchEvent`
   * listener by passing it to `event.respondWith()`.
   *
   * @param {FetchEvent|Object} options A `FetchEvent` or an object with the
   *     properties listed below.
   * @param {Request|string} options.request A request to run this strategy for.
   * @param {ExtendableEvent} options.event The event associated with the
   *     request.
   * @param {URL} [options.url]
   * @param {*} [options.params]
   */
  handle(e) {
    const [t] = this.handleAll(e);
    return t;
  }
  /**
   * Similar to {@link workbox-strategies.Strategy~handle}, but
   * instead of just returning a `Promise` that resolves to a `Response` it
   * it will return an tuple of `[response, done]` promises, where the former
   * (`response`) is equivalent to what `handle()` returns, and the latter is a
   * Promise that will resolve once any promises that were added to
   * `event.waitUntil()` as part of performing the strategy have completed.
   *
   * You can await the `done` promise to ensure any extra work performed by
   * the strategy (usually caching responses) completes successfully.
   *
   * @param {FetchEvent|Object} options A `FetchEvent` or an object with the
   *     properties listed below.
   * @param {Request|string} options.request A request to run this strategy for.
   * @param {ExtendableEvent} options.event The event associated with the
   *     request.
   * @param {URL} [options.url]
   * @param {*} [options.params]
   * @return {Array<Promise>} A tuple of [response, done]
   *     promises that can be used to determine when the response resolves as
   *     well as when the handler has completed all its work.
   */
  handleAll(e) {
    e instanceof FetchEvent && (e = {
      event: e,
      request: e.request
    });
    const t = e.event, s = typeof e.request == "string" ? new Request(e.request) : e.request, a = "params" in e ? e.params : void 0, r = new te(this, { event: t, request: s, params: a }), o = this._getResponse(r, s, t), c = this._awaitComplete(o, r, s, t);
    return [o, c];
  }
  async _getResponse(e, t, s) {
    await e.runCallbacks("handlerWillStart", { event: s, request: t });
    let a;
    try {
      if (a = await this._handle(t, e), !a || a.type === "error")
        throw new f("no-response", { url: t.url });
    } catch (r) {
      if (r instanceof Error) {
        for (const o of e.iterateCallbacks("handlerDidError"))
          if (a = await o({ error: r, event: s, request: t }), a)
            break;
      }
      if (!a)
        throw r;
    }
    for (const r of e.iterateCallbacks("handlerWillRespond"))
      a = await r({ event: s, request: t, response: a });
    return a;
  }
  async _awaitComplete(e, t, s, a) {
    let r, o;
    try {
      r = await e;
    } catch {
    }
    try {
      await t.runCallbacks("handlerDidRespond", {
        event: a,
        request: s,
        response: r
      }), await t.doneWaiting();
    } catch (c) {
      c instanceof Error && (o = c);
    }
    if (await t.runCallbacks("handlerDidComplete", {
      event: a,
      request: s,
      response: r,
      error: o
    }), t.destroy(), o)
      throw o;
  }
}
class p extends se {
  /**
   *
   * @param {Object} [options]
   * @param {string} [options.cacheName] Cache name to store and retrieve
   * requests. Defaults to the cache names provided by
   * {@link workbox-core.cacheNames}.
   * @param {Array<Object>} [options.plugins] {@link https://developers.google.com/web/tools/workbox/guides/using-plugins|Plugins}
   * to use in conjunction with this caching strategy.
   * @param {Object} [options.fetchOptions] Values passed along to the
   * {@link https://developer.mozilla.org/en-US/docs/Web/API/WindowOrWorkerGlobalScope/fetch#Parameters|init}
   * of all fetch() requests made by this strategy.
   * @param {Object} [options.matchOptions] The
   * {@link https://w3c.github.io/ServiceWorker/#dictdef-cachequeryoptions|CacheQueryOptions}
   * for any `cache.match()` or `cache.put()` calls made by this strategy.
   * @param {boolean} [options.fallbackToNetwork=true] Whether to attempt to
   * get the response from the network if there's a precache miss.
   */
  constructor(e = {}) {
    e.cacheName = T.getPrecacheName(e.cacheName), super(e), this._fallbackToNetwork = e.fallbackToNetwork !== !1, this.plugins.push(p.copyRedirectedCacheableResponsesPlugin);
  }
  /**
   * @private
   * @param {Request|string} request A request to run this strategy for.
   * @param {workbox-strategies.StrategyHandler} handler The event that
   *     triggered the request.
   * @return {Promise<Response>}
   */
  async _handle(e, t) {
    const s = await t.cacheMatch(e);
    return s || (t.event && t.event.type === "install" ? await this._handleInstall(e, t) : await this._handleFetch(e, t));
  }
  async _handleFetch(e, t) {
    let s;
    const a = t.params || {};
    if (this._fallbackToNetwork) {
      const r = a.integrity, o = e.integrity, c = !o || o === r;
      s = await t.fetch(new Request(e, {
        integrity: e.mode !== "no-cors" ? o || r : void 0
      })), r && c && e.mode !== "no-cors" && (this._useDefaultCacheabilityPluginIfNeeded(), await t.cachePut(e, s.clone()));
    } else
      throw new f("missing-precache-entry", {
        cacheName: this.cacheName,
        url: e.url
      });
    return s;
  }
  async _handleInstall(e, t) {
    this._useDefaultCacheabilityPluginIfNeeded();
    const s = await t.fetch(e);
    if (!await t.cachePut(e, s.clone()))
      throw new f("bad-precaching-response", {
        url: e.url,
        status: s.status
      });
    return s;
  }
  /**
   * This method is complex, as there a number of things to account for:
   *
   * The `plugins` array can be set at construction, and/or it might be added to
   * to at any time before the strategy is used.
   *
   * At the time the strategy is used (i.e. during an `install` event), there
   * needs to be at least one plugin that implements `cacheWillUpdate` in the
   * array, other than `copyRedirectedCacheableResponsesPlugin`.
   *
   * - If this method is called and there are no suitable `cacheWillUpdate`
   * plugins, we need to add `defaultPrecacheCacheabilityPlugin`.
   *
   * - If this method is called and there is exactly one `cacheWillUpdate`, then
   * we don't have to do anything (this might be a previously added
   * `defaultPrecacheCacheabilityPlugin`, or it might be a custom plugin).
   *
   * - If this method is called and there is more than one `cacheWillUpdate`,
   * then we need to check if one is `defaultPrecacheCacheabilityPlugin`. If so,
   * we need to remove it. (This situation is unlikely, but it could happen if
   * the strategy is used multiple times, the first without a `cacheWillUpdate`,
   * and then later on after manually adding a custom `cacheWillUpdate`.)
   *
   * See https://github.com/GoogleChrome/workbox/issues/2737 for more context.
   *
   * @private
   */
  _useDefaultCacheabilityPluginIfNeeded() {
    let e = null, t = 0;
    for (const [s, a] of this.plugins.entries())
      a !== p.copyRedirectedCacheableResponsesPlugin && (a === p.defaultPrecacheCacheabilityPlugin && (e = s), a.cacheWillUpdate && t++);
    t === 0 ? this.plugins.push(p.defaultPrecacheCacheabilityPlugin) : t > 1 && e !== null && this.plugins.splice(e, 1);
  }
}
p.defaultPrecacheCacheabilityPlugin = {
  async cacheWillUpdate({ response: n }) {
    return !n || n.status >= 400 ? null : n;
  }
};
p.copyRedirectedCacheableResponsesPlugin = {
  async cacheWillUpdate({ response: n }) {
    return n.redirected ? await G(n) : n;
  }
};
class ne {
  /**
   * Create a new PrecacheController.
   *
   * @param {Object} [options]
   * @param {string} [options.cacheName] The cache to use for precaching.
   * @param {string} [options.plugins] Plugins to use when precaching as well
   * as responding to fetch events for precached assets.
   * @param {boolean} [options.fallbackToNetwork=true] Whether to attempt to
   * get the response from the network if there's a precache miss.
   */
  constructor({ cacheName: e, plugins: t = [], fallbackToNetwork: s = !0 } = {}) {
    this._urlsToCacheKeys = /* @__PURE__ */ new Map(), this._urlsToCacheModes = /* @__PURE__ */ new Map(), this._cacheKeysToIntegrities = /* @__PURE__ */ new Map(), this._strategy = new p({
      cacheName: T.getPrecacheName(e),
      plugins: [
        ...t,
        new V({ precacheController: this })
      ],
      fallbackToNetwork: s
    }), this.install = this.install.bind(this), this.activate = this.activate.bind(this);
  }
  /**
   * @type {workbox-precaching.PrecacheStrategy} The strategy created by this controller and
   * used to cache assets and respond to fetch events.
   */
  get strategy() {
    return this._strategy;
  }
  /**
   * Adds items to the precache list, removing any duplicates and
   * stores the files in the
   * {@link workbox-core.cacheNames|"precache cache"} when the service
   * worker installs.
   *
   * This method can be called multiple times.
   *
   * @param {Array<Object|string>} [entries=[]] Array of entries to precache.
   */
  precache(e) {
    this.addToCacheList(e), this._installAndActiveListenersAdded || (self.addEventListener("install", this.install), self.addEventListener("activate", this.activate), this._installAndActiveListenersAdded = !0);
  }
  /**
   * This method will add items to the precache list, removing duplicates
   * and ensuring the information is valid.
   *
   * @param {Array<workbox-precaching.PrecacheController.PrecacheEntry|string>} entries
   *     Array of entries to precache.
   */
  addToCacheList(e) {
    const t = [];
    for (const s of e) {
      typeof s == "string" ? t.push(s) : s && s.revision === void 0 && t.push(s.url);
      const { cacheKey: a, url: r } = B(s), o = typeof s != "string" && s.revision ? "reload" : "default";
      if (this._urlsToCacheKeys.has(r) && this._urlsToCacheKeys.get(r) !== a)
        throw new f("add-to-cache-list-conflicting-entries", {
          firstEntry: this._urlsToCacheKeys.get(r),
          secondEntry: a
        });
      if (typeof s != "string" && s.integrity) {
        if (this._cacheKeysToIntegrities.has(a) && this._cacheKeysToIntegrities.get(a) !== s.integrity)
          throw new f("add-to-cache-list-conflicting-integrities", {
            url: r
          });
        this._cacheKeysToIntegrities.set(a, s.integrity);
      }
      if (this._urlsToCacheKeys.set(r, a), this._urlsToCacheModes.set(r, o), t.length > 0) {
        const c = `Workbox is precaching URLs without revision info: ${t.join(", ")}
This is generally NOT safe. Learn more at https://bit.ly/wb-precache`;
        console.warn(c);
      }
    }
  }
  /**
   * Precaches new and updated assets. Call this method from the service worker
   * install event.
   *
   * Note: this method calls `event.waitUntil()` for you, so you do not need
   * to call it yourself in your event handlers.
   *
   * @param {ExtendableEvent} event
   * @return {Promise<workbox-precaching.InstallResult>}
   */
  install(e) {
    return q(e, async () => {
      const t = new $();
      this.strategy.plugins.push(t);
      for (const [r, o] of this._urlsToCacheKeys) {
        const c = this._cacheKeysToIntegrities.get(o), i = this._urlsToCacheModes.get(r), l = new Request(r, {
          integrity: c,
          cache: i,
          credentials: "same-origin"
        });
        await Promise.all(this.strategy.handleAll({
          params: { cacheKey: o },
          request: l,
          event: e
        }));
      }
      const { updatedURLs: s, notUpdatedURLs: a } = t;
      return { updatedURLs: s, notUpdatedURLs: a };
    });
  }
  /**
   * Deletes assets that are no longer present in the current precache manifest.
   * Call this method from the service worker activate event.
   *
   * Note: this method calls `event.waitUntil()` for you, so you do not need
   * to call it yourself in your event handlers.
   *
   * @param {ExtendableEvent} event
   * @return {Promise<workbox-precaching.CleanupResult>}
   */
  activate(e) {
    return q(e, async () => {
      const t = await self.caches.open(this.strategy.cacheName), s = await t.keys(), a = new Set(this._urlsToCacheKeys.values()), r = [];
      for (const o of s)
        a.has(o.url) || (await t.delete(o), r.push(o.url));
      return { deletedURLs: r };
    });
  }
  /**
   * Returns a mapping of a precached URL to the corresponding cache key, taking
   * into account the revision information for the URL.
   *
   * @return {Map<string, string>} A URL to cache key mapping.
   */
  getURLsToCacheKeys() {
    return this._urlsToCacheKeys;
  }
  /**
   * Returns a list of all the URLs that have been precached by the current
   * service worker.
   *
   * @return {Array<string>} The precached URLs.
   */
  getCachedURLs() {
    return [...this._urlsToCacheKeys.keys()];
  }
  /**
   * Returns the cache key used for storing a given URL. If that URL is
   * unversioned, like `/index.html', then the cache key will be the original
   * URL with a search parameter appended to it.
   *
   * @param {string} url A URL whose cache key you want to look up.
   * @return {string} The versioned URL that corresponds to a cache key
   * for the original URL, or undefined if that URL isn't precached.
   */
  getCacheKeyForURL(e) {
    const t = new URL(e, location.href);
    return this._urlsToCacheKeys.get(t.href);
  }
  /**
   * @param {string} url A cache key whose SRI you want to look up.
   * @return {string} The subresource integrity associated with the cache key,
   * or undefined if it's not set.
   */
  getIntegrityForCacheKey(e) {
    return this._cacheKeysToIntegrities.get(e);
  }
  /**
   * This acts as a drop-in replacement for
   * [`cache.match()`](https://developer.mozilla.org/en-US/docs/Web/API/Cache/match)
   * with the following differences:
   *
   * - It knows what the name of the precache is, and only checks in that cache.
   * - It allows you to pass in an "original" URL without versioning parameters,
   * and it will automatically look up the correct cache key for the currently
   * active revision of that URL.
   *
   * E.g., `matchPrecache('index.html')` will find the correct precached
   * response for the currently active service worker, even if the actual cache
   * key is `'/index.html?__WB_REVISION__=1234abcd'`.
   *
   * @param {string|Request} request The key (without revisioning parameters)
   * to look up in the precache.
   * @return {Promise<Response|undefined>}
   */
  async matchPrecache(e) {
    const t = e instanceof Request ? e.url : e, s = this.getCacheKeyForURL(t);
    if (s)
      return (await self.caches.open(this.strategy.cacheName)).match(s);
  }
  /**
   * Returns a function that looks up `url` in the precache (taking into
   * account revision information), and returns the corresponding `Response`.
   *
   * @param {string} url The precached URL which will be used to lookup the
   * `Response`.
   * @return {workbox-routing~handlerCallback}
   */
  createHandlerBoundToURL(e) {
    const t = this.getCacheKeyForURL(e);
    if (!t)
      throw new f("non-precached-url", { url: e });
    return (s) => (s.request = new Request(e), s.params = Object.assign({ cacheKey: t }, s.params), this.strategy.handle(s));
  }
}
let S;
const I = () => (S || (S = new ne()), S);
try {
  self["workbox:routing:7.3.0"] && _();
} catch {
}
const N = "GET", C = (n) => n && typeof n == "object" ? n : { handle: n };
class m {
  /**
   * Constructor for Route class.
   *
   * @param {workbox-routing~matchCallback} match
   * A callback function that determines whether the route matches a given
   * `fetch` event by returning a non-falsy value.
   * @param {workbox-routing~handlerCallback} handler A callback
   * function that returns a Promise resolving to a Response.
   * @param {string} [method='GET'] The HTTP method to match the Route
   * against.
   */
  constructor(e, t, s = N) {
    this.handler = C(t), this.match = e, this.method = s;
  }
  /**
   *
   * @param {workbox-routing-handlerCallback} handler A callback
   * function that returns a Promise resolving to a Response
   */
  setCatchHandler(e) {
    this.catchHandler = C(e);
  }
}
class re extends m {
  /**
   * If the regular expression contains
   * [capture groups]{@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/RegExp#grouping-back-references},
   * the captured values will be passed to the
   * {@link workbox-routing~handlerCallback} `params`
   * argument.
   *
   * @param {RegExp} regExp The regular expression to match against URLs.
   * @param {workbox-routing~handlerCallback} handler A callback
   * function that returns a Promise resulting in a Response.
   * @param {string} [method='GET'] The HTTP method to match the Route
   * against.
   */
  constructor(e, t, s) {
    const a = ({ url: r }) => {
      const o = e.exec(r.href);
      if (o && !(r.origin !== location.origin && o.index !== 0))
        return o.slice(1);
    };
    super(a, t, s);
  }
}
class ae {
  /**
   * Initializes a new Router.
   */
  constructor() {
    this._routes = /* @__PURE__ */ new Map(), this._defaultHandlerMap = /* @__PURE__ */ new Map();
  }
  /**
   * @return {Map<string, Array<workbox-routing.Route>>} routes A `Map` of HTTP
   * method name ('GET', etc.) to an array of all the corresponding `Route`
   * instances that are registered.
   */
  get routes() {
    return this._routes;
  }
  /**
   * Adds a fetch event listener to respond to events when a route matches
   * the event's request.
   */
  addFetchListener() {
    self.addEventListener("fetch", (e) => {
      const { request: t } = e, s = this.handleRequest({ request: t, event: e });
      s && e.respondWith(s);
    });
  }
  /**
   * Adds a message event listener for URLs to cache from the window.
   * This is useful to cache resources loaded on the page prior to when the
   * service worker started controlling it.
   *
   * The format of the message data sent from the window should be as follows.
   * Where the `urlsToCache` array may consist of URL strings or an array of
   * URL string + `requestInit` object (the same as you'd pass to `fetch()`).
   *
   * ```
   * {
   *   type: 'CACHE_URLS',
   *   payload: {
   *     urlsToCache: [
   *       './script1.js',
   *       './script2.js',
   *       ['./script3.js', {mode: 'no-cors'}],
   *     ],
   *   },
   * }
   * ```
   */
  addCacheListener() {
    self.addEventListener("message", (e) => {
      if (e.data && e.data.type === "CACHE_URLS") {
        const { payload: t } = e.data, s = Promise.all(t.urlsToCache.map((a) => {
          typeof a == "string" && (a = [a]);
          const r = new Request(...a);
          return this.handleRequest({ request: r, event: e });
        }));
        e.waitUntil(s), e.ports && e.ports[0] && s.then(() => e.ports[0].postMessage(!0));
      }
    });
  }
  /**
   * Apply the routing rules to a FetchEvent object to get a Response from an
   * appropriate Route's handler.
   *
   * @param {Object} options
   * @param {Request} options.request The request to handle.
   * @param {ExtendableEvent} options.event The event that triggered the
   *     request.
   * @return {Promise<Response>|undefined} A promise is returned if a
   *     registered route can handle the request. If there is no matching
   *     route and there's no `defaultHandler`, `undefined` is returned.
   */
  handleRequest({ request: e, event: t }) {
    const s = new URL(e.url, location.href);
    if (!s.protocol.startsWith("http"))
      return;
    const a = s.origin === location.origin, { params: r, route: o } = this.findMatchingRoute({
      event: t,
      request: e,
      sameOrigin: a,
      url: s
    });
    let c = o && o.handler;
    const i = e.method;
    if (!c && this._defaultHandlerMap.has(i) && (c = this._defaultHandlerMap.get(i)), !c)
      return;
    let l;
    try {
      l = c.handle({ url: s, request: e, event: t, params: r });
    } catch (h) {
      l = Promise.reject(h);
    }
    const u = o && o.catchHandler;
    return l instanceof Promise && (this._catchHandler || u) && (l = l.catch(async (h) => {
      if (u)
        try {
          return await u.handle({ url: s, request: e, event: t, params: r });
        } catch (W) {
          W instanceof Error && (h = W);
        }
      if (this._catchHandler)
        return this._catchHandler.handle({ url: s, request: e, event: t });
      throw h;
    })), l;
  }
  /**
   * Checks a request and URL (and optionally an event) against the list of
   * registered routes, and if there's a match, returns the corresponding
   * route along with any params generated by the match.
   *
   * @param {Object} options
   * @param {URL} options.url
   * @param {boolean} options.sameOrigin The result of comparing `url.origin`
   *     against the current origin.
   * @param {Request} options.request The request to match.
   * @param {Event} options.event The corresponding event.
   * @return {Object} An object with `route` and `params` properties.
   *     They are populated if a matching route was found or `undefined`
   *     otherwise.
   */
  findMatchingRoute({ url: e, sameOrigin: t, request: s, event: a }) {
    const r = this._routes.get(s.method) || [];
    for (const o of r) {
      let c;
      const i = o.match({ url: e, sameOrigin: t, request: s, event: a });
      if (i)
        return c = i, (Array.isArray(c) && c.length === 0 || i.constructor === Object && // eslint-disable-line
        Object.keys(i).length === 0 || typeof i == "boolean") && (c = void 0), { route: o, params: c };
    }
    return {};
  }
  /**
   * Define a default `handler` that's called when no routes explicitly
   * match the incoming request.
   *
   * Each HTTP method ('GET', 'POST', etc.) gets its own default handler.
   *
   * Without a default handler, unmatched requests will go against the
   * network as if there were no service worker present.
   *
   * @param {workbox-routing~handlerCallback} handler A callback
   * function that returns a Promise resulting in a Response.
   * @param {string} [method='GET'] The HTTP method to associate with this
   * default handler. Each method has its own default.
   */
  setDefaultHandler(e, t = N) {
    this._defaultHandlerMap.set(t, C(e));
  }
  /**
   * If a Route throws an error while handling a request, this `handler`
   * will be called and given a chance to provide a response.
   *
   * @param {workbox-routing~handlerCallback} handler A callback
   * function that returns a Promise resulting in a Response.
   */
  setCatchHandler(e) {
    this._catchHandler = C(e);
  }
  /**
   * Registers a route with the router.
   *
   * @param {workbox-routing.Route} route The route to register.
   */
  registerRoute(e) {
    this._routes.has(e.method) || this._routes.set(e.method, []), this._routes.get(e.method).push(e);
  }
  /**
   * Unregisters a route with the router.
   *
   * @param {workbox-routing.Route} route The route to unregister.
   */
  unregisterRoute(e) {
    if (!this._routes.has(e.method))
      throw new f("unregister-route-but-not-found-with-method", {
        method: e.method
      });
    const t = this._routes.get(e.method).indexOf(e);
    if (t > -1)
      this._routes.get(e.method).splice(t, 1);
    else
      throw new f("unregister-route-route-not-registered");
  }
}
let w;
const oe = () => (w || (w = new ae(), w.addFetchListener(), w.addCacheListener()), w);
function ce(n, e, t) {
  let s;
  if (typeof n == "string") {
    const r = new URL(n, location.href), o = ({ url: c }) => c.href === r.href;
    s = new m(o, e, t);
  } else if (n instanceof RegExp)
    s = new re(n, e, t);
  else if (typeof n == "function")
    s = new m(n, e, t);
  else if (n instanceof m)
    s = n;
  else
    throw new f("unsupported-route-type", {
      moduleName: "workbox-routing",
      funcName: "registerRoute",
      paramName: "capture"
    });
  return oe().registerRoute(s), s;
}
function ie(n, e = []) {
  for (const t of [...n.searchParams.keys()])
    e.some((s) => s.test(t)) && n.searchParams.delete(t);
  return n;
}
function* le(n, { ignoreURLParametersMatching: e = [/^utm_/, /^fbclid$/], directoryIndex: t = "index.html", cleanURLs: s = !0, urlManipulation: a } = {}) {
  const r = new URL(n, location.href);
  r.hash = "", yield r.href;
  const o = ie(r, e);
  if (yield o.href, t && o.pathname.endsWith("/")) {
    const c = new URL(o.href);
    c.pathname += t, yield c.href;
  }
  if (s) {
    const c = new URL(o.href);
    c.pathname += ".html", yield c.href;
  }
  if (a) {
    const c = a({ url: r });
    for (const i of c)
      yield i.href;
  }
}
class he extends m {
  /**
   * @param {PrecacheController} precacheController A `PrecacheController`
   * instance used to both match requests and respond to fetch events.
   * @param {Object} [options] Options to control how requests are matched
   * against the list of precached URLs.
   * @param {string} [options.directoryIndex=index.html] The `directoryIndex` will
   * check cache entries for a URLs ending with '/' to see if there is a hit when
   * appending the `directoryIndex` value.
   * @param {Array<RegExp>} [options.ignoreURLParametersMatching=[/^utm_/, /^fbclid$/]] An
   * array of regex's to remove search params when looking for a cache match.
   * @param {boolean} [options.cleanURLs=true] The `cleanURLs` option will
   * check the cache for the URL with a `.html` added to the end of the end.
   * @param {workbox-precaching~urlManipulation} [options.urlManipulation]
   * This is a function that should take a URL and return an array of
   * alternative URLs that should be checked for precache matches.
   */
  constructor(e, t) {
    const s = ({ request: a }) => {
      const r = e.getURLsToCacheKeys();
      for (const o of le(a.url, t)) {
        const c = r.get(o);
        if (c) {
          const i = e.getIntegrityForCacheKey(c);
          return { cacheKey: c, integrity: i };
        }
      }
    };
    super(s, e.strategy);
  }
}
function ue(n) {
  const e = I(), t = new he(e, n);
  ce(t);
}
function fe(n) {
  I().precache(n);
}
function de(n, e) {
  fe(n), ue(e);
}
console.log("[SW] Service Worker loading...");
de([{"revision":"1872c500de691dce40960bb85481de07","url":"registerSW.js"},{"revision":"929f870b21e1730b8812b506ffeb45d7","url":"index.html"},{"revision":"8beeb000d62a6290e5bd6028146e5a89","url":"assets/index-D_D3imkp.js"},{"revision":"a5ac14fefbe2466bd533d1e22571851f","url":"assets/index-DM-DuhyI.css"},{"revision":"616e1671cda20ac612792c6420bbc8f3","url":"icon-64.png"},{"revision":"7e7e83d1c14f0a0d6a3a8238e2dac9b1","url":"icon-128.png"},{"revision":"ff15e6a00e4f45859d57b3906cec6b90","url":"icon-256.png"},{"revision":"5476f0d9fbfb165c4e2954cf3fe39441","url":"icon-512.png"},{"revision":"891ce30bff94570f42aa09f81b3f7f5b","url":"manifest.json"}]);
let L = null, U = null;
const R = {};
let k = null;
const E = indexedDB.open("request-cache", 4);
E.onupgradeneeded = (n) => {
  const e = n.target.result;
  e.objectStoreNames.contains("requests") || e.createObjectStore("requests", { keyPath: "id" });
};
E.onsuccess = (n) => {
  k = n.target.result;
};
E.onerror = (n) => {
  console.error("[SW] Error opening cache database:", n.target.error);
};
async function M(n) {
  return new Promise((e, t) => {
    const r = k.transaction("requests", "readonly").objectStore("requests").get(n);
    r.onsuccess = () => {
      e(r.result);
    }, r.onerror = () => {
      t(r.error);
    };
  });
}
async function K(n, e) {
  return e instanceof Response ? K(n, {
    body: await e.clone().arrayBuffer(),
    headers: Object.fromEntries(e.headers.entries()),
    timestamp: Date.now()
  }) : new Promise(async (t, s) => {
    const o = k.transaction("requests", "readwrite").objectStore("requests").put({ id: n, ...e, timestamp: Date.now() });
    o.onsuccess = () => {
      t(o.result);
    }, o.onerror = () => {
      s(o.error);
    };
  });
}
let v = !1;
async function pe() {
  if (v) return;
  v = !0;
  const n = await M("!cache-rules");
  n && Object.assign(R, n.rules);
}
function A() {
  return new Promise((n, e) => {
    const t = self.indexedDB.open("hometube-local", 2);
    t.onsuccess = () => n(t.result), t.onerror = () => e(t.error);
  });
}
function g(n, e, t) {
  return new Promise((s, a) => {
    const c = n.transaction(e, "readonly").objectStore(e).get(t);
    c.onsuccess = () => s(c.result || null), c.onerror = () => a(c.error);
  });
}
function O(n, e) {
  const t = n.type || "audio/mpeg", s = n.size, a = e.headers.get("range");
  if (a) {
    const r = a.match(/bytes=(\d+)-(\d*)/);
    if (r) {
      const o = parseInt(r[1]), c = r[2] ? parseInt(r[2]) : s - 1, i = n.slice(o, c + 1);
      return new Response(i, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${o}-${c}/${s}`,
          "Content-Type": t,
          "Content-Length": String(i.size),
          "Accept-Ranges": "bytes"
        }
      });
    }
  }
  return new Response(n, {
    headers: {
      "Content-Type": t,
      "Content-Length": String(s),
      "Accept-Ranges": "bytes"
    }
  });
}
async function ge(n, e) {
  const t = n.pathname.match(/\/api\/local\/music\/(\d+)\/file$/);
  if (t)
    return ye(parseInt(t[1]), e);
  const s = n.pathname.match(/\/api\/local\/video\/(\d+)\/file$/);
  return s ? we(parseInt(s[1]), e) : new Response("Not found", { status: 404 });
}
async function ye(n, e) {
  try {
    const t = await A(), s = await g(t, "music", n);
    if (!s) return new Response("Music not found", { status: 404 });
    let a = null;
    if (s.filename)
      a = `music_${s.filename}`;
    else if (s.video_id) {
      const o = ["mp3", "webm", "m4a", "ogg", "flac", "wav"];
      for (const c of o) {
        const i = `music_${s.video_id}.${c}`;
        if (await g(t, "files", i)) {
          a = i;
          break;
        }
      }
    }
    if (!a) return new Response("File not found", { status: 404 });
    const r = await g(t, "files", a);
    return r != null && r.blob ? O(r.blob, e) : new Response("File not found", { status: 404 });
  } catch (t) {
    return console.error("[SW] Error serving local music:", t), new Response("Internal error", { status: 500 });
  }
}
async function we(n, e) {
  try {
    const t = await A(), s = await g(t, "videos", n);
    if (!s) return new Response("Video not found", { status: 404 });
    const a = s.video_id ? String(s.video_id) : String(s.id);
    let r = await g(t, "files", `video_${a}.mp4`);
    return r || (r = await g(t, "files", `video_${a}.webm`)), r != null && r.blob ? O(r.blob, e) : new Response("File not found", { status: 404 });
  } catch (t) {
    return console.error("[SW] Error serving local video:", t), new Response("Internal error", { status: 500 });
  }
}
self.addEventListener("install", () => {
  console.log("[SW] Installing..."), self.skipWaiting();
});
self.addEventListener("activate", (n) => {
  console.log("[SW] Activating..."), n.waitUntil(self.clients.claim());
});
self.addEventListener("message", (n) => {
  var e, t, s, a;
  if (console.log("[SW] Message received:", n.data), ((e = n.data) == null ? void 0 : e.type) === "SET_JWT" && (L = n.data.token, console.log("[SW] JWT updated:", L ? "present" : "empty")), ((t = n.data) == null ? void 0 : t.type) === "SET_BACKEND_URL" && (U = n.data.url, console.log("[SW] Backend URL updated:", U)), ((s = n.data) == null ? void 0 : s.type) === "SET_CACHE_RULE" && (R[n.data.path] = n.data.options, K("!cache-rules", { rules: R }), console.log("[SW] Cache rules updated:", R)), ((a = n.data) == null ? void 0 : a.type) === "CHECK_CACHE") {
    const r = n.data.paths, c = k.transaction("requests", "readonly").objectStore("requests");
    Promise.all(r.map((i) => new Promise((l) => {
      const u = c.get(i);
      u.onsuccess = () => l({ path: i, found: !!u.result }), u.onerror = () => l({ path: i, found: !1 });
    }))).then((i) => {
      const l = {};
      i.forEach((u) => l[u.path] = u.found), n.ports[0] && n.ports[0].postMessage({ type: "CACHE_STATUS", status: l });
    });
  }
});
self.addEventListener("fetch", (n) => {
  const e = new URL(n.request.url);
  if (e.pathname.startsWith("/api/local/")) {
    n.respondWith(ge(e, n.request));
    return;
  }
  pe(), e.pathname.startsWith("/api/") && (console.log("[SW] Intercepted API request:", e.pathname + e.search), L && U && n.respondWith(new Promise(async (t, s) => {
    const a = R[e.pathname];
    let r = null;
    if (a)
      if (r = await M(e.pathname + e.search), !r)
        console.log("[SW] No cached response found, fetching new one.");
      else if (a.refetch)
        console.log("[SW] attempting to refetch response for:", e.pathname + e.search);
      else if (a.ttl && Date.now() > r.timestamp + a.ttl)
        console.log("[SW] Cached response expired, attempting to fetch new one.");
      else
        return console.log("[SW] Returning cached response:", r), t(new Response(r.body, { headers: r.headers }));
    const o = new Headers(n.request.headers);
    o.set("Authorization", `Bearer ${L}`), o.set("ngrok-skip-browser-warning", "true");
    const c = new URL(U), i = new URL(n.request.url);
    i.protocol = c.protocol, i.host = c.host, i.port = c.port;
    const l = !["GET", "HEAD"].includes(n.request.method) && n.request.body !== null, u = new Request(i.toString(), {
      method: n.request.method,
      headers: o,
      body: l ? n.request.body : null,
      ...l ? { duplex: "half" } : {},
      mode: "cors",
      credentials: "omit"
    });
    try {
      const h = await fetch(u);
      h.ok && a && (console.log("[SW] Caching response for:", e.pathname + e.search), K(e.pathname + e.search, h)), t(h);
    } catch (h) {
      console.error("[SW] Fetch failed:", h), r ? (console.log("[SW] Error, returning cached response"), t(new Response(r.body, { headers: r.headers }))) : s(h);
    }
  })));
});
