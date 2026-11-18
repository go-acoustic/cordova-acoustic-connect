/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * DOM side of the Behaviour testing screens: the Actions / Showcase / Verification
 * sub-tabs. The logic lives in behaviour-core.js (unit-tested).
 */

'use strict';

(function () {
    var Core = window.BehaviourCore;
    var state = { taps: 0, enabled: false, gesturesLine: null, caseLoad: null };

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

    var screens = Core.createPageScreens(api);

    function showTab(tab) {
        screens.showTab(tab);
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

    // The outcome of a call ({ ok } or { ok: false, message }), with the check that the plugin has the analytics API.
    function attemptCall(call) {
        return Core.attempt(function () {
            if (!api() || typeof api().logCustomEvent !== 'function') {
                throw new Error('This plugin version has no analytics API');
            }
            return call(api());
        });
    }

    // Runs a call and shows its outcome, worded by `lineOf`, on the result line `show` writes.
    function send(show, lineOf, call) {
        return attemptCall(call).then(function (outcome) { show(lineOf(outcome), outcome.ok); });
    }

    // A result line with the id the sample UI contract names, added to the card by the first outcome it shows.
    function resultLine(c, id) {
        var node = null;
        return function (text, ok) {
            if (!node) {
                node = el('p', 'result-line');
                node.id = id;
                c.appendChild(node);
            }
            node.className = 'result-line ' + (ok ? 'success' : 'error');
            node.textContent = text;
        };
    }

    function button(label, onClick, secondary, id) {
        var b = el('button', 'action' + (secondary ? ' secondary' : ''), label);
        if (id) b.id = id;
        b.disabled = !state.enabled;
        b.dataset.needsSdk = '1';
        b.addEventListener('click', onClick);
        return b;
    }

    // A button that makes no SDK call, so it works whatever the SDK is doing.
    function plainButton(label, id, onClick, secondary) {
        var b = el('button', 'action' + (secondary ? ' secondary' : ''), label);
        b.id = id;
        b.addEventListener('click', onClick);
        return b;
    }

    function textField(id, label, placeholder) {
        var field = el('div', 'text-field');
        var caption = el('label', 'field-label', label);
        caption.htmlFor = id;
        var input = el('input', 'field-input');
        input.id = id;
        input.type = 'text';
        input.placeholder = placeholder;
        input.autocomplete = 'off';
        field.appendChild(caption);
        field.appendChild(input);
        return field;
    }

    function card(title) {
        var c = el('section', 'card');
        c.appendChild(el('h2', 'card-title', title));
        return c;
    }

    // ── Showcase ────────────────────────────────────────────────────

    function featureBody(id, c) {
        var line = el('p', 'result-line');
        if (id === 'taps') {
            // The page logs nothing: the plugin's page script logs the tap with the element's id.
            var count = el('p', 'card-text', Core.tapsLine(state.taps));
            count.id = 'txt_showcase_taps';
            c.appendChild(plainButton('Tap me', Core.TAP_CONTROL_ID, function () {
                state.taps += 1;
                count.textContent = Core.tapsLine(state.taps);
            }));
            c.appendChild(count);
        } else if (id === 'gestures') {
            var openButton = button('Open Gestures', openGestures, true);
            openButton.id = 'btn_open_gestures';
            c.appendChild(openButton);
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
        } else if (id === 'text-capture') {
            c.appendChild(textField('field_showcase_note', 'Plain field', 'Anything you type is captured'));
            c.appendChild(textField('field_showcase_secret', 'Masked field', 'SECRET-1234'));
        } else if (id === 'custom-event') {
            customEventBody(c);
        } else if (id === 'signal') {
            signalBody(c);
        } else if (id === 'exception') {
            var showException = resultLine(c, 'txt_showcase_exception_result');
            c.appendChild(button('Log a handled exception', function () {
                var report = Core.handledException();
                send(showException, Core.exceptionLine, function (a) { return a.logExceptionEvent(report.message, report.stack, false); });
            }, false, 'btn_showcase_exception'));
        } else if (id === 'screen-view') {
            c.appendChild(plainButton('Open a detail screen', 'btn_showcase_open_detail', openDetail));
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
        } else if (id === 'capture') {
            var showCapture = resultLine(c, 'txt_capture_state');
            c.appendChild(plainButton('Disable SDK', 'btn_capture_disable', function () { captureControl('disable', showCapture); }));
            c.appendChild(plainButton('Re-enable SDK', 'btn_capture_enable', function () { captureControl('enable', showCapture); }));
        }
        c.appendChild(line);
    }

    // The bodies the Showcase and the Verification sub-tab share.

    function customEventBody(c) {
        c.appendChild(el('p', 'card-meta', JSON.stringify(Core.CUSTOM_EVENT.values) + ' · level ' + Core.CUSTOM_EVENT.level));
        var show = resultLine(c, 'txt_custom_event_result');
        c.appendChild(button('Send custom event', function () {
            send(show, Core.customEventLine, function (a) {
                return a.logCustomEvent(Core.CUSTOM_EVENT.name, Core.CUSTOM_EVENT.values, Core.CUSTOM_EVENT.level);
            });
        }, false, 'btn_send_custom_event'));
    }

    function signalBody(c) {
        var show = resultLine(c, 'txt_signal_result');
        function sendSignal(label, payload) {
            send(show, function (outcome) { return Core.signalLine(label, payload, outcome); },
                 function (a) { return a.logSignal(payload, Core.SIGNAL_LEVEL); });
        }
        c.appendChild(button('Send nested signal', function () { sendSignal('nested', Core.NESTED_SIGNAL); }, false, 'btn_send_nested_signal'));
        c.appendChild(button('Send flat signal', function () { sendSignal('flat', Core.FLAT_SIGNAL); }, true, 'btn_send_flat_signal'));
    }

    // The first button leaves out both optional arguments, so the plugin's own defaults are under test.
    function identityDefaultsBody(c) {
        var show = resultLine(c, 'txt_identity_defaults_result');
        c.appendChild(button('Log identity — omit both optional args', function () {
            send(show, function (outcome) { return Core.identityLine('defaulted', outcome); },
                 function (a) { return a.logIdentity('Email', 'defaults@example.com'); });
        }, false, 'btn_identity_defaulted'));
        c.appendChild(button('Log accountRegistered — explicit', function () {
            send(show, function (outcome) { return Core.identityLine('explicit', outcome); }, function (a) {
                return a.logIdentity('Email', 'explicit@example.com', 'accountRegistered', { registrationMethod: 'email' });
            });
        }, true, 'btn_identity_explicit'));
    }

    // Starts the SDK again the way js/index.js does at launch, from the page's connect-config.js.
    function enableSdk(A) {
        var config = window.ConnectBasicConfig || {};
        var android = platform() === 'android';
        var pushMode = !android && config.iOSPushMode === 'manual' ? 'manual' : 'automatic';
        var options = android
            ? { androidIconResName: config.AndroidIconResName || null }
            : { iosAppGroupIdentifier: config.iOSAppGroupIdentifier || null };
        return A.enable(config.AppKey, config.PostMessageUrl, pushMode, options);
    }

    // The page's screen tracker follows the SDK, so the screens left while it is off are not logged, and the one on display is
    // logged again once it is back.
    function captureControl(method, show) {
        Core.attempt(function () {
            var A = api();
            if (!A || typeof A[method] !== 'function') throw new Error('This plugin version has no ' + method);
            return method === 'enable' ? enableSdk(A) : A.disable();
        }).then(function (outcome) {
            if (outcome.ok) screens.setEnabled(method === 'enable');
            show(Core.captureLine(method, outcome), outcome.ok);
        });
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

    // ── Views opened on Showcase and on Verification ────────────────
    //
    // Each sub-tab has a stack of view names kept by the page's screens (behaviour-core.js): the Gestures screen, the detail
    // chain, Screen Views and its case views. Opening or leaving a view logs the screen move; the view on top is what shows.

    function byId(id) { return document.getElementById(id); }

    function setHidden(id, hidden) { byId(id).classList.toggle('hidden', hidden); }

    function showViews(subtab) {
        var stack = screens.stack(subtab);
        var view = stack.length ? Core.viewFor(stack[stack.length - 1]) : null;
        if (subtab === 'showcase') {
            setHidden('showcaseList', view !== null);
            setHidden('showcaseDetail', !view || view.kind !== 'detail');
            setHidden('showcaseGestures', !view || view.kind !== 'gestures');
            if (view && view.kind === 'detail') renderDetail(view.depth);
            if (view && view.kind === 'gestures') renderGestures();
        } else {
            setHidden('verificationIntro', view !== null);
            setHidden('verificationList', view !== null);
            setHidden('verificationView', view === null);
            if (view && view.kind === 'screen-views') renderScreenViews();
            if (view && view.kind === 'case') renderCase(view.testCase);
        }
    }

    function openView(subtab, name) {
        var steps = screens.open(subtab, name);
        showViews(subtab);
        return steps;
    }

    function closeView(subtab) {
        var steps = screens.back(subtab);
        showViews(subtab);
        return steps;
    }

    function viewHeader(title, backId, onBack) {
        var header = el('div', 'view-header');
        var back = el('button', 'action link', '‹ Back');
        back.id = backId;
        back.addEventListener('click', onBack);
        header.appendChild(back);
        header.appendChild(el('h2', 'card-title', title));
        return header;
    }

    // The detail chain: Showcase detail, then Showcase detail 2 to 5, each loaded with the previous one as referrer.
    function openDetail() {
        openView('showcase', Core.detailScreen(1));
    }

    function renderDetail(depth) {
        var detail = byId('showcaseDetail');
        detail.innerHTML = '';
        var logged = card(Core.detailScreen(depth));
        logged.appendChild(el('p', 'card-text', 'Opening this screen logged a screen view named:'));
        logged.appendChild(el('p', 'card-text mono', Core.detailScreen(depth)));
        logged.appendChild(el('p', 'card-text', 'The referrer is the screen you navigated from. Going back logs the previous screen again, with this one as its referrer.'));
        detail.appendChild(logged);

        var chain = card('Referrer chain');
        var atCap = depth >= Core.MAX_DEPTH;
        chain.appendChild(el('p', 'card-text', 'Push another detail screen to see the chain advance by one, then pop back through it. Depth ' + depth + ' of ' + Core.MAX_DEPTH + '.'));
        var push = plainButton(atCap ? 'Chain limit reached' : 'Push another', 'btn_showcase_push_detail', function () {
            if (!atCap) openView('showcase', Core.detailScreen(depth + 1));
        });
        push.disabled = atCap;
        chain.appendChild(push);
        chain.appendChild(plainButton('Back', 'btn_showcase_back', function () { closeView('showcase'); }, true));
        detail.appendChild(chain);
    }

    function openGestures() {
        var load = openView('showcase', Core.GESTURE_SCREEN).load;
        if (load) load.then(function (outcome) { result(state.gesturesLine, outcome); });
    }

    function closeGestures() {
        var unload = closeView('showcase').unload;
        if (unload) unload.then(function (outcome) { result(state.gesturesLine, outcome); });
    }

    // Screen Views, opened from Verification: a view per navigable case, and direct screen views with exact names.
    function openScreenViews() {
        openView('verification', Core.SCREEN_VIEWS_SCREEN);
    }

    // A case view is opened through the screen tracker, so a name the plugin refuses still opens it, with the refusal shown.
    function enterCase(name) {
        var steps = openView('verification', name);
        var show = state.caseLoad;
        if (steps.load) steps.load.then(function (outcome) { show(Core.loggedLine(outcome), outcome.ok); });
    }

    function renderScreenViews() {
        var view = byId('verificationView');
        view.innerHTML = '';
        view.appendChild(viewHeader('Screen Views', 'btn_screen_views_back', function () { closeView('verification'); }));

        var navigate = card('Navigate — real integration path');
        navigate.appendChild(el('p', 'card-text', 'Opens a view named exactly as the case, logged through the page\'s screen tracker with the screen left as referrer. Go back and re-enter to produce repeat views.'));
        Core.NAV_CASES.forEach(function (testCase) {
            var block = el('div', 'case-block');
            block.appendChild(plainButton(testCase.label, 'btn_navigate_' + testCase.id, function () { enterCase(testCase.name); }, true));
            block.appendChild(el('p', 'card-meta', 'logs: ' + Core.describeName(testCase.name)));
            navigate.appendChild(block);
        });
        view.appendChild(navigate);

        var direct = card('Screen view — exact name');
        direct.appendChild(el('p', 'card-text', 'Sends a screen view with exactly the name below, with the referrer "Screen View Diagnostics", straight to the plugin. The empty and the null name are only reachable here; the plugin refuses blank and null names, and the refusal is the result.'));
        var log = [];
        var logBox = el('div', 'result-log');
        function showEntry(entry) {
            log = Core.addScreenViewEntry(log, entry);
            logBox.innerHTML = '';
            log.forEach(function (logged, index) {
                var line = el('p', 'result-line ' + (logged.ok ? 'success' : 'error'), Core.screenViewLine(logged));
                if (index === 0) line.id = 'txt_screenview_result';
                logBox.appendChild(line);
            });
        }
        direct.appendChild(button('Send all ' + Core.DIRECT_SCREEN_CASES.length + ' names', function () {
            Core.sendAllScreenViews(api() || {}, showEntry);
        }, false, 'btn_screenview_send_all'));
        Core.DIRECT_SCREEN_CASES.forEach(function (testCase) {
            direct.appendChild(button(testCase.label, function () {
                Core.sendScreenView(api() || {}, testCase).then(showEntry);
            }, true, 'btn_screenview_' + testCase.id));
        });
        direct.appendChild(logBox);
        view.appendChild(direct);
    }

    function renderCase(testCase) {
        var view = byId('verificationView');
        view.innerHTML = '';
        view.appendChild(viewHeader(Core.describeName(testCase.name), 'btn_case_back', function () { closeView('verification'); }));

        var shown = card('Logged screen name');
        shown.appendChild(el('p', 'card-text mono', Core.describeName(testCase.name)));
        shown.appendChild(el('p', 'card-meta', testCase.name.length + ' characters · the name of this view'));
        state.caseLoad = resultLine(shown, 'txt_case_load_result');
        view.appendChild(shown);

        var repeat = card('Repeat');
        repeat.appendChild(el('p', 'card-text', 'Re-send the same name straight to the plugin, to compare the navigation-driven message against an explicit one.'));
        var relogged = resultLine(repeat, 'txt_case_relog_result');
        repeat.appendChild(button('Log this name directly', function () {
            send(relogged, Core.reloggedLine, function (a) { return a.logScreenViewContextLoad(testCase.name, 'Screen Views'); });
        }, false, 'btn_case_relog'));
        var next = Core.nextCase(testCase.id);
        repeat.appendChild(plainButton('Push deeper — ' + next.label, 'btn_case_push_next', function () { enterCase(next.name); }, true));
        view.appendChild(repeat);
    }

    function onPointer(target, handlers) {
        ['down', 'move', 'up', 'cancel'].forEach(function (kind) {
            target.addEventListener('pointer' + kind, function (e) {
                if (kind === 'down') {
                    try { target.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
                }
                e.preventDefault();
                if (handlers[kind]) handlers[kind](e);
            });
        });
        target.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    }

    function point(e) { return { x: e.clientX, y: e.clientY }; }

    function wireLongPress(target, show) {
        var press = null;
        function cancel() {
            if (press) clearTimeout(press.timer);
            press = null;
        }
        onPointer(target, {
            down: function (e) {
                if (!e.isPrimary) return;
                cancel();
                var current = { from: point(e), at: e.timeStamp, long: false };
                current.timer = setTimeout(function () { current.long = true; show('longPress'); }, Core.LONG_PRESS_MS);
                press = current;
            },
            move: function (e) {
                if (!e.isPrimary) return;
                if (press && Core.distance(press.from, point(e)) > Core.TAP_SLOP) cancel();
            },
            up: function (e) {
                if (!e.isPrimary || !press) return;
                if (!press.long) show(Core.pressName(e.timeStamp - press.at));
                cancel();
            },
            cancel: cancel
        });
    }

    function wireDoubleTap(target, show) {
        var down = null;
        var previousUpAt = null;
        onPointer(target, {
            down: function (e) {
                if (e.isPrimary) down = { from: point(e), at: e.timeStamp };
            },
            move: function (e) {
                if (!e.isPrimary) return;
                if (down && Core.distance(down.from, point(e)) > Core.TAP_SLOP) {
                    down = null;
                    previousUpAt = null;
                }
            },
            up: function (e) {
                if (!e.isPrimary || !down) return;
                var tap = Core.pressName(e.timeStamp - down.at) === 'tap';
                var second = tap && Core.isDoubleTap(previousUpAt, down.at);
                previousUpAt = tap && !second ? e.timeStamp : null;
                down = null;
                if (second) show('doubleTap');
            },
            cancel: function () {
                down = null;
                previousUpAt = null;
            }
        });
    }

    function wireSwipe(target, show) {
        var from = null;
        onPointer(target, {
            down: function (e) {
                if (e.isPrimary) from = point(e);
            },
            up: function (e) {
                if (!e.isPrimary || !from) return;
                var name = Core.swipeName(e.clientX - from.x, e.clientY - from.y);
                from = null;
                if (name) show(name);
            },
            cancel: function () { from = null; }
        });
    }

    function wirePinch(target, zoomed, show) {
        var touches = {};
        var spread = null;
        var zoom = 1;
        function measure() {
            var ids = Object.keys(touches);
            return ids.length === 2 ? Core.distance(touches[ids[0]], touches[ids[1]]) : null;
        }
        function release(e) {
            delete touches[e.pointerId];
            spread = measure();
        }
        onPointer(target, {
            down: function (e) {
                touches[e.pointerId] = point(e);
                spread = measure();
            },
            move: function (e) {
                if (!touches[e.pointerId]) return;
                touches[e.pointerId] = point(e);
                var now = measure();
                var name = now === null ? null : Core.pinchName(spread, now);
                if (name) {
                    zoom = Core.clampZoom(zoom, now / spread);
                    zoomed.style.transform = 'scale(' + zoom + ')';
                    show(name);
                }
                spread = now;
            },
            up: release,
            cancel: release
        });
    }

    function renderGestures() {
        var screen = document.getElementById('showcaseGestures');
        screen.innerHTML = '';
        var c = card('Gestures');
        var last = el('p', 'card-text', Core.gestureLabel());
        last.id = 'tv_gestures_last';
        function show(name) { last.textContent = Core.gestureLabel(name); }
        c.appendChild(last);

        function makeTarget(id, classes, text) {
            var t = el('div', 'gesture-surface ' + classes, text);
            t.id = id;
            c.appendChild(t);
            return t;
        }
        wireLongPress(makeTarget('gesture_long_press', 'gesture-target gesture-taps', 'Long press me'), show);
        wireDoubleTap(makeTarget('gesture_double_tap', 'gesture-target gesture-taps', 'Double tap me'), show);
        wireSwipe(makeTarget('gesture_swipe', 'gesture-target gesture-claims', 'Swipe me — any direction'), show);
        var pinch = makeTarget('gesture_pinch_zoom', 'gesture-pinch gesture-claims');
        var zoomed = el('div', 'gesture-pinch-inner', 'Pinch to zoom');
        pinch.appendChild(zoomed);
        wirePinch(pinch, zoomed, show);

        var list = el('ul', 'gesture-list');
        list.id = 'gesture_scroll_list';
        Core.gestureRows().forEach(function (row) {
            var item = el('li', 'gesture-row', row.text);
            item.id = row.id;
            list.appendChild(item);
        });
        c.appendChild(list);

        var back = el('button', 'action link', '‹ Back to Showcase');
        back.id = 'btn_gestures_back';
        back.addEventListener('click', closeGestures);
        c.appendChild(back);
        state.gesturesLine = el('p', 'result-line');
        c.appendChild(state.gesturesLine);
        screen.appendChild(c);
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

        // The controls of the sample UI contract (the same ids as on the React Native samples' Verification screen).
        var screenViews = card('Screen Views');
        screenViews.appendChild(el('p', 'card-text', 'Direct and navigated screen views, with the referrers they log.'));
        screenViews.appendChild(plainButton('Open Screen Views', 'btn_open_screen_views', openScreenViews, true));
        list.appendChild(screenViews);

        var customEvent = card('Custom event');
        customEventBody(customEvent);
        list.appendChild(customEvent);

        var signal = card('Log Signal');
        signalBody(signal);
        list.appendChild(signal);

        var identity = card('Identity defaults');
        identityDefaultsBody(identity);
        list.appendChild(identity);
    }

    // ── Sub-tab switching and enabling ──────────────────────────────

    function switchSubtab(name) {
        document.querySelectorAll('.subtab-content').forEach(function (n) { n.classList.remove('active'); });
        document.querySelectorAll('.subtab-btn').forEach(function (n) { n.classList.remove('active'); });
        document.getElementById('subtab-' + name).classList.add('active');
        document.querySelector('[data-subtab="' + name + '"]').classList.add('active');
        screens.showSubtab(name);
    }

    function setEnabled(enabled) {
        state.enabled = enabled;
        document.querySelectorAll('[data-needs-sdk]').forEach(function (b) { b.disabled = !enabled; });
        screens.setEnabled(enabled);
    }

    function init() {
        document.querySelectorAll('.subtab-btn').forEach(function (b) {
            b.addEventListener('click', function () { switchSubtab(b.dataset.subtab); });
        });
        renderShowcase();
        renderVerification();
        screens.showSubtab(document.querySelector('.subtab-btn.active').dataset.subtab);
        showTab(document.querySelector('.tab-btn.active').dataset.tab);
    }

    // showTab: the page's tab switcher (js/index.js) reports each tab shown, so the screen views follow it.
    window.BehaviourUi = { init: init, setEnabled: setEnabled, showTab: showTab };
}());
