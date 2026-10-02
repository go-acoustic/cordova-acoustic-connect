/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * DOM side of the Behaviour testing screens: the Actions / Showcase / Verification
 * sub-tabs. The logic lives in behaviour-core.js (unit-tested).
 */

'use strict';

(function () {
    var Core = window.BehaviourCore;
    var state = { chain: [], taps: 0, enabled: false };

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function api() { return window.AcousticConnect; }

    function platform() {
        return (window.cordova && window.cordova.platformId) === 'android' ? 'android' : 'ios';
    }

    function result(line, outcome) {
        line.className = 'result-line ' + (outcome.ok ? 'success' : 'error');
        line.textContent = outcome.ok ? 'Queued' : outcome.message;
    }

    // Wraps one async call: the result line shows "Queued" (the SDK accepted the message) or the error.
    function run(line, call) {
        Promise.resolve()
            .then(function () {
                if (!api() || typeof api().logCustomEvent !== 'function') {
                    throw new Error('This plugin version has no analytics API');
                }
                return call(api());
            })
            .then(function () { result(line, { ok: true }); },
                  function (e) { result(line, { ok: false, message: (e && e.message) || 'failed' }); });
    }

    function button(label, onClick, secondary) {
        var b = el('button', 'action' + (secondary ? ' secondary' : ''), label);
        b.disabled = !state.enabled;
        b.dataset.needsSdk = '1';
        b.addEventListener('click', onClick);
        return b;
    }

    function card(title) {
        var c = el('section', 'card');
        c.appendChild(el('h2', 'card-title', title));
        return c;
    }

    // ── Showcase ────────────────────────────────────────────────────

    function featureBody(id, c) {
        var line = el('p', 'result-line');
        var A = function () { return api(); };
        if (id === 'taps') {
            var count = el('p', 'card-text', 'Taps: 0');
            c.appendChild(count);
            c.appendChild(button('Tap', function () {
                state.taps += 1;
                count.textContent = 'Taps: ' + state.taps;
                run(line, function (a) { return a.logClickEvent('showcase_tap', { count: state.taps }); });
            }));
        } else if (id === 'text') {
            var input = el('input', 'field-input');
            input.type = 'text';
            input.placeholder = 'Type something';
            input.autocomplete = 'off';
            var preview = el('p', 'card-meta', 'Sent as: ');
            input.addEventListener('input', function () { preview.textContent = 'Sent as: ' + Core.maskPreview(input.value); });
            c.appendChild(input);
            c.appendChild(preview);
            c.appendChild(button('Log text (masked)', function () {
                run(line, function (a) { return a.logTextChangeEvent('showcase_txt', { text: input.value }); });
            }));
            c.appendChild(button('Log text (plain)', function () {
                run(line, function (a) { return a.logTextChangeEvent('showcase_txt', { text: input.value, masked: false }); });
            }, true));
        } else if (id === 'custom-event') {
            c.appendChild(el('p', 'card-meta', JSON.stringify(Core.CUSTOM_EVENT.values) + ' · level ' + Core.CUSTOM_EVENT.level));
            c.appendChild(button('Log custom event', function () {
                run(line, function (a) { return a.logCustomEvent(Core.CUSTOM_EVENT.name, Core.CUSTOM_EVENT.values, Core.CUSTOM_EVENT.level); });
            }));
        } else if (id === 'signal') {
            c.appendChild(button('Log nested signal', function () {
                run(line, function (a) { return a.logSignal(Core.NESTED_SIGNAL); });
            }));
            c.appendChild(button('Log flat signal', function () {
                run(line, function (a) { return a.logSignal(Core.FLAT_SIGNAL); });
            }, true));
        } else if (id === 'exception') {
            c.appendChild(button('Log handled exception', function () {
                run(line, function (a) {
                    return a.logExceptionEvent('Showcase handled exception', 'Error: showcase\n    at showcase (behaviour.js)', false);
                });
            }));
        } else if (id === 'screen-view') {
            c.appendChild(button('Open screen view chain', openDetail));
            c.appendChild(button('Direct names', function () { runDirect(c, line); }, true));
        } else if (id === 'config') {
            var keyIn = el('input', 'field-input'); keyIn.type = 'text'; keyIn.value = Core.CONFIG_PROBE.key; keyIn.autocomplete = 'off';
            var valIn = el('input', 'field-input'); valIn.type = 'text'; valIn.value = Core.CONFIG_PROBE.value; valIn.autocomplete = 'off';
            var modIn = el('input', 'field-input'); modIn.type = 'text'; modIn.value = Core.CONFIG_PROBE.module; modIn.autocomplete = 'off';
            c.appendChild(el('p', 'card-meta', 'Key · value · module (iOS ignores the module)'));
            c.appendChild(keyIn); c.appendChild(valIn); c.appendChild(modIn);
            var out = el('p', 'card-meta', '');
            c.appendChild(button('Set item', function () {
                run(line, function (a) { return a.setConfigItem(keyIn.value, valIn.value, modIn.value); });
            }));
            c.appendChild(button('Get item', function () {
                run(line, function (a) {
                    return a.getConfigItem(keyIn.value, '', modIn.value).then(function (v) {
                        out.textContent = 'Value: ' + JSON.stringify(v);
                    });
                });
            }, true));
            c.appendChild(out);
        } else if (id === 'identity') {
            c.appendChild(button('Default signal type', function () {
                run(line, function (a) { return a.logIdentity('Email', 'defaults@example.com'); });
            }));
            c.appendChild(button('Explicit signal type', function () {
                run(line, function (a) {
                    return a.logIdentity('Email', 'explicit@example.com', 'accountRegistered', { registrationMethod: 'email' });
                });
            }, true));
        }
        void A;
        c.appendChild(line);
    }

    function runDirect(c, line) {
        run(line, function (a) {
            return Core.runDirectCases(a).then(function (results) {
                var old = c.querySelector('.result-log');
                if (old) old.remove();
                var list = el('ul', 'result-log');
                results.forEach(function (r) {
                    list.appendChild(el('li', '', (r.ok ? '✓ ' : '✗ ') + r.shown + (r.ok ? '' : ' — ' + r.message)));
                });
                c.appendChild(list);
            });
        });
    }

    function renderShowcase() {
        var list = document.getElementById('showcaseList');
        list.innerHTML = '';
        Core.FEATURES.forEach(function (f) {
            var c = card(f.title);
            c.appendChild(el('p', 'card-text', f.description));
            featureBody(f.id, c);
            list.appendChild(c);
        });
    }

    // Screen view detail: each "next" screen loads with the previous one as referrer.
    function openDetail() {
        var detail = document.getElementById('showcaseDetail');
        document.getElementById('showcaseList').classList.add('hidden');
        detail.classList.remove('hidden');
        state.chain = [];
        renderDetail();
    }

    function closeDetail() {
        var detail = document.getElementById('showcaseDetail');
        detail.classList.add('hidden');
        document.getElementById('showcaseList').classList.remove('hidden');
    }

    function renderDetail() {
        var detail = document.getElementById('showcaseDetail');
        detail.innerHTML = '';
        var c = card('Screen view chain');
        var line = el('p', 'result-line');
        c.appendChild(el('p', 'card-text', state.chain.length ? state.chain.join(' › ') : 'No screen open'));
        c.appendChild(el('p', 'card-meta', 'Depth ' + state.chain.length + ' of ' + Core.MAX_DEPTH));
        c.appendChild(button('Open next screen', function () {
            var r = Core.openScreen(state.chain, 'Screen ' + (state.chain.length + 1));
            if (r.blocked) { result(line, { ok: false, message: 'Maximum depth reached' }); return; }
            state.chain = r.chain;
            run(line, function (a) { return a.logScreenViewContextLoad(r.load.name, r.load.referrer); });
            renderDetailKeep(line);
        }));
        c.appendChild(button('Close top screen', function () {
            var r = Core.closeScreen(state.chain);
            if (!r.unload) { result(line, { ok: false, message: 'No screen to close' }); return; }
            state.chain = r.chain;
            run(line, function (a) { return a.logScreenViewContextUnload(r.unload.name, r.unload.referrer); });
            renderDetailKeep(line);
        }, true));
        var back = el('button', 'action link', '‹ Back to Showcase');
        back.addEventListener('click', closeDetail);
        c.appendChild(back);
        c.appendChild(line);
        detail.appendChild(c);
    }

    // Re-renders the chain text without losing the result line of the call just made.
    function renderDetailKeep(line) {
        var texts = document.querySelectorAll('#showcaseDetail .card-text');
        var metas = document.querySelectorAll('#showcaseDetail .card-meta');
        if (texts[0]) texts[0].textContent = state.chain.length ? state.chain.join(' › ') : 'No screen open';
        if (metas[0]) metas[0].textContent = 'Depth ' + state.chain.length + ' of ' + Core.MAX_DEPTH;
        void line;
    }

    // ── Verification ────────────────────────────────────────────────

    function renderVerification() {
        var list = document.getElementById('verificationList');
        list.innerHTML = '';
        Core.scenariosFor(platform()).forEach(function (s) {
            var c = card(s.title);
            c.appendChild(el('p', 'card-meta', s.key + ' · ' + s.channel + ' · ' + (s.platform === 'both' ? 'iOS + Android' : s.platform)));
            c.appendChild(el('p', 'card-label', 'Do'));
            c.appendChild(el('p', 'card-text', s.action));
            c.appendChild(el('p', 'card-label', 'Expect'));
            c.appendChild(el('p', 'card-text', s.expected));
            var line = el('p', 'result-line');
            c.appendChild(button('Run', function () {
                Core.runScenario(s, api()).then(function (outcome) { result(line, outcome); });
            }));
            c.appendChild(line);
            list.appendChild(c);
        });
    }

    // ── Sub-tab switching and enabling ──────────────────────────────

    function switchSubtab(name) {
        document.querySelectorAll('.subtab-content').forEach(function (n) { n.classList.remove('active'); });
        document.querySelectorAll('.subtab-btn').forEach(function (n) { n.classList.remove('active'); });
        document.getElementById('subtab-' + name).classList.add('active');
        document.querySelector('[data-subtab="' + name + '"]').classList.add('active');
        if (api() && typeof api().setCurrentScreenName === 'function' && state.enabled) {
            api().setCurrentScreenName('behaviour_' + name).catch(function () {});
        }
    }

    function setEnabled(enabled) {
        state.enabled = enabled;
        document.querySelectorAll('[data-needs-sdk]').forEach(function (b) { b.disabled = !enabled; });
    }

    function init() {
        document.querySelectorAll('.subtab-btn').forEach(function (b) {
            b.addEventListener('click', function () { switchSubtab(b.dataset.subtab); });
        });
        renderShowcase();
        renderVerification();
    }

    window.BehaviourUi = { init: init, setEnabled: setEnabled };
}());
