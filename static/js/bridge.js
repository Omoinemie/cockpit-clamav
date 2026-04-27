/* ================================================================
 * bridge.js — Cockpit systemd D-Bus bridge
 *
 * Replicates the pattern from cockpit/pkg/lib/service.js:
 *   - Persistent read-only client (no superuser)
 *   - Temporary action clients (superuser: "try")
 *   - Manager proxy + Subscribe for signals
 *   - Unit proxy via LoadUnit → proxy → wait_valid
 *   - Properties refreshed via Properties.GetAll
 *   - Actions tracked via JobRemoved subscription
 * ================================================================ */
(function() {
    'use strict';

    // ---- constants ----
    var BUS_NAME   = 'org.freedesktop.systemd1';
    var OBJ_ROOT   = '/org/freedesktop/systemd1';
    var I_MANAGER  = 'org.freedesktop.systemd1.Manager';
    var I_UNIT     = 'org.freedesktop.systemd1.Unit';
    var I_PROPS    = 'org.freedesktop.DBus.Properties';

    // ---- state ----
    var readClient = null;
    var manager    = null;
    var managerReady = false;
    var managerWaiters = [];
    var cockpitRef = null;

    function waitValid(proxy, cb) {
        proxy.wait(function() {
            if (proxy.valid) cb();
        });
    }

    function ensureManager(done) {
        if (!readClient) {
            readClient = cockpitRef.dbus(BUS_NAME);
            manager = readClient.proxy(I_MANAGER, OBJ_ROOT);
            waitValid(manager, function() {
                managerReady = true;
                manager.Subscribe().catch(function() {});
                var flush = managerWaiters.slice();
                managerWaiters = [];
                flush.forEach(function(fn) { fn(); });
            });
        }
        if (managerReady) {
            done();
        } else {
            managerWaiters.push(done);
        }
    }

    // ================================================================
    // ServiceProxy — mirrors cockpit/pkg/lib/service.js proxy()
    // ================================================================
    function ServiceProxy(name, kind) {
        var self = this;
        if (name.indexOf('.') === -1) name = name + '.service';
        if (!kind) kind = 'Service';

        self.name    = name;
        self.exists  = null;
        self.state   = null;
        self.enabled = null;
        self.unit    = null;
        self.details = null;

        var listeners = {};
        self.addEventListener    = function(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); };
        self.removeEventListener = function(ev, fn) { if (listeners[ev]) listeners[ev] = listeners[ev].filter(function(f){return f!==fn;}); };
        function dispatch(ev) { (listeners[ev] || []).forEach(function(fn) { fn({type: ev}); }); }

        var readyResolve;
        var readyPromise = new Promise(function(r) { readyResolve = r; });
        self.wait = function(cb) { readyPromise.then(cb); };

        var unitProxy    = null;
        var detailsProxy = null;

        function updateFromUnit() {
            if (!unitProxy) return;
            self.exists = (unitProxy.LoadState !== 'not-found' || unitProxy.ActiveState !== 'inactive');

            var as = unitProxy.ActiveState;
            if (as === 'activating')                self.state = 'starting';
            else if (as === 'deactivating')          self.state = 'stopping';
            else if (as === 'active' || as === 'reloading') self.state = 'running';
            else if (as === 'failed')                self.state = 'failed';
            else if (as === 'inactive' && self.exists) self.state = 'stopped';
            else                                     self.state = undefined;

            var ufs = unitProxy.UnitFileState;
            if (ufs === 'enabled' || ufs === 'linked')         self.enabled = true;
            else if (ufs === 'disabled' || ufs === 'masked')   self.enabled = false;
            else                                                self.enabled = undefined;

            self.unit = {
                ActiveState:   unitProxy.ActiveState,
                SubState:      unitProxy.SubState,
                LoadState:     unitProxy.LoadState,
                UnitFileState: unitProxy.UnitFileState,
                Description:   unitProxy.Description,
                Id:            unitProxy.Id
            };

            dispatch('changed');
            readyResolve();
        }

        function updateFromDetails() {
            self.details = detailsProxy;
            dispatch('changed');
        }

        function refresh() {
            if (!unitProxy) return Promise.resolve();

            function refreshIface(path, iface) {
                return readClient.call(path, I_PROPS, 'GetAll', [iface])
                    .then(function(result) {
                        var raw = result[0], props = {};
                        for (var p in raw) {
                            if (raw.hasOwnProperty(p))
                                props[p] = (raw[p] && typeof raw[p] === 'object' && 'v' in raw[p]) ? raw[p].v : raw[p];
                        }
                        readClient.notify({});
                    })
                    .catch(function() {});
            }

            return Promise.allSettled([
                refreshIface(unitProxy.path, I_UNIT),
                detailsProxy ? refreshIface(detailsProxy.path, I_MANAGER + '.' + kind) : Promise.resolve()
            ]);
        }

        function onJobEvent(ev, number, path, unitId) {
            if (unitId === name) refresh();
        }

        // ---- init ----
        ensureManager(function() {
            manager.LoadUnit(name)
                .then(function(path) {
                    unitProxy = readClient.proxy(I_UNIT, path);
                    unitProxy.addEventListener('changed', updateFromUnit);
                    waitValid(unitProxy, updateFromUnit);

                    detailsProxy = readClient.proxy(I_MANAGER + '.' + kind, path);
                    detailsProxy.addEventListener('changed', updateFromDetails);
                    waitValid(detailsProxy, updateFromDetails);
                })
                .catch(function() {
                    self.exists = false;
                    dispatch('changed');
                });

            manager.addEventListener('Reloading', function(ev, reloading) {
                if (!reloading) refresh();
            });
            manager.addEventListener('JobNew', onJobEvent);
            manager.addEventListener('JobRemoved', onJobEvent);
        });

        // ---- actions ----
        function callManager(dbus, method, args) {
            return dbus.call(OBJ_ROOT, I_MANAGER, method, args);
        }

        function callManagerWithJob(method, args) {
            return new Promise(function(resolve, reject) {
                var dbus = cockpitRef.dbus(BUS_NAME, { superuser: 'try' });
                var pendingJobPath;

                var subscription = dbus.subscribe(
                    { interface: I_MANAGER, member: 'JobRemoved' },
                    function(_path, _iface, _signal, data) {
                        var path = data[1], unitId = data[2], result = data[3];
                        if (path === pendingJobPath) {
                            subscription.remove();
                            dbus.close();
                            refresh().then(function() {
                                if (result === 'done') resolve();
                                else reject(new Error('systemd job ' + method + ' failed: ' + result));
                            });
                        }
                    });

                callManager(dbus, method, args)
                    .then(function(result) { pendingJobPath = result[0]; })
                    .catch(function(ex) { dbus.close(); reject(ex); });
            });
        }

        function callManagerWithReload(method, args) {
            var dbus = cockpitRef.dbus(BUS_NAME, { superuser: 'try' });
            return callManager(dbus, method, args)
                .then(function() { return callManager(dbus, 'Reload', []); })
                .then(refresh)
                .finally(function() { dbus.close(); });
        }

        self.start   = function() { return callManagerWithJob('StartUnit', [name, 'replace']); };
        self.stop    = function() { return callManagerWithJob('StopUnit',  [name, 'replace']); };
        self.restart = function() { return callManagerWithJob('RestartUnit', [name, 'replace']); };
        self.enable  = function() { return callManagerWithReload('EnableUnitFiles',  [[name], false, false]); };
        self.disable = function() { return callManagerWithReload('DisableUnitFiles', [[name], false]); };
    }

    // ================================================================
    // spawn helpers
    // ================================================================
    function spawn(args, opts) {
        opts = Object.assign({ err: 'out' }, opts || {});
        return cockpitRef.spawn(args, opts);
    }

    function spawnSuper(args, opts) {
        opts = Object.assign({ err: 'out', superuser: 'try' }, opts || {});
        return cockpitRef.spawn(args, opts);
    }

    // ================================================================
    // init — called once cockpit object is available
    // ================================================================
    function init(cockpitObj) {
        cockpitRef = cockpitObj;
    }

    // ================================================================
    // public API
    // ================================================================
    window.CockpitBridge = {
        init:          init,
        ServiceProxy:  ServiceProxy,
        spawn:         spawn,
        spawnSuper:    spawnSuper,
        ensureManager: ensureManager,
        readClient:    function() { return readClient; },
        manager:       function() { return manager; }
    };
})();
