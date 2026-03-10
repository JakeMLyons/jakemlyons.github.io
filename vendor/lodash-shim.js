/**
 * lodash-shim.js — minimal shim providing window._.memoize and window._.throttle
 * for cytoscape-edgehandles, which expects the Lodash global.
 */
(function (root) {
  var _ = {};
  root['_'] = _;

  // memoize: cache results keyed by first argument (string-coerced)
  _.memoize = function (func, resolver) {
    var memoized = function () {
      var cache = memoized.cache;
      var key = resolver ? resolver.apply(this, arguments) : String(arguments[0]);
      if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];
      cache[key] = func.apply(this, arguments);
      return cache[key];
    };
    memoized.cache = Object.create(null);
    return memoized;
  };

  // throttle: invoke at most once per `wait` ms with leading+trailing support
  _.throttle = function (func, wait, options) {
    var leading  = true;
    var trailing = true;
    if (options) {
      if (options.leading  === false) leading  = false;
      if (options.trailing === false) trailing = false;
    }
    var lastTime = 0, timer = null, lastThis, lastArgs, lastResult;

    function invoke() {
      lastTime = Date.now();
      timer = null;
      lastResult = func.apply(lastThis, lastArgs);
    }

    var throttled = function () {
      var now       = Date.now();
      if (!lastTime && !leading) lastTime = now;
      var remaining = wait - (now - lastTime);
      lastThis = this;
      lastArgs = arguments;
      if (remaining <= 0 || remaining > wait) {
        if (timer) { clearTimeout(timer); timer = null; }
        lastTime   = now;
        lastResult = func.apply(this, arguments);
      } else if (!timer && trailing) {
        timer = setTimeout(invoke, remaining);
      }
      return lastResult;
    };

    throttled.cancel = function () {
      clearTimeout(timer);
      timer    = null;
      lastTime = 0;
    };

    return throttled;
  };
}(this));
