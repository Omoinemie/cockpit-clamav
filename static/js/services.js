/* ================================================================
 * services.js — ClamAV service management via CockpitBridge
 *
 * Creates ServiceProxy instances for clamav-daemon and clamav-freshclam.
 * Proxy creation is deferred until init() is called (after cockpit ready).
 * ================================================================ */
(function() {
    'use strict';

    // ---- service definitions ----
    var SERVICE_DEFS = [
        { unit: 'clamav-daemon.service',    nameKey: 'svcClamavDaemon', descKey: 'svcClamavDaemonDesc', kind: 'Service' },
        { unit: 'clamav-freshclam.service', nameKey: 'svcFreshclam',    descKey: 'svcFreshclamDesc',    kind: 'Service' },
    ];

    var proxies = {};
    var changeListeners = [];
    var initialized = false;
    var initWaiters = [];

    function whenReady(fn) {
        if (initialized) fn();
        else initWaiters.push(fn);
    }

    function init() {
        var B = window.CockpitBridge;
        SERVICE_DEFS.forEach(function(def) {
            var proxy = new B.ServiceProxy(def.unit, def.kind);
            proxies[def.unit] = { proxy: proxy, def: def };
            proxy.addEventListener('changed', function() {
                changeListeners.forEach(function(fn) { fn(); });
            });
        });
        initialized = true;
        initWaiters.forEach(function(fn) { fn(); });
        initWaiters = [];
    }

    // ---- public API ----
    window.ClamAVServices = {
        init: init,

        DEFS: SERVICE_DEFS,

        getAll: function() {
            return SERVICE_DEFS.map(function(def) {
                var entry = proxies[def.unit];
                return {
                    def:     def,
                    proxy:   entry.proxy,
                    exists:  entry.proxy.exists,
                    state:   entry.proxy.state,
                    enabled: entry.proxy.enabled,
                    unit:    entry.proxy.unit
                };
            });
        },

        get: function(unit) {
            return proxies[unit] ? proxies[unit].proxy : null;
        },

        isClamdRunning: function() {
            var p = proxies['clamav-daemon.service'];
            return p && p.proxy.exists && p.proxy.state === 'running';
        },

        start:   function(unit) { return proxies[unit].proxy.start(); },
        stop:    function(unit) { return proxies[unit].proxy.stop(); },
        restart: function(unit) { return proxies[unit].proxy.restart(); },
        enable:  function(unit) { return proxies[unit].proxy.enable(); },
        disable: function(unit) { return proxies[unit].proxy.disable(); },

        ready: function() {
            var promises = SERVICE_DEFS.map(function(def) {
                return new Promise(function(resolve) {
                    proxies[def.unit].proxy.wait(resolve);
                });
            });
            return Promise.all(promises);
        },

        onChange: function(fn) { changeListeners.push(fn); }
    };
})();
