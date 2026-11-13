/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Acoustic Connect Cordova plugin — taps and gestures on page elements.
 *
 * The Connect SDK cannot tell which element of a page a finger is on, so this script
 * recognises taps and gestures from the page's pointer events and hands each one, with
 * the element, to the plugin, which logs it as the SDK logs one on a native control.
 * Passive capture-phase listeners on the main frame only: nothing is prevented, nothing
 * global is patched, and no text or field value leaves the page. The SDK logs nothing
 * while it is not enabled.
 *
 * The Capacitor plugin carries a TypeScript copy (src/web-gestures.ts); its
 * web_gestures_parity test feeds both the same touches and requires the same messages.
 */

'use strict';

var LONG_PRESS_MS = 500;
var DOUBLE_TAP_MS = 300;
var TAP_SLOP = 8;           // CSS px a tap may move
var DOUBLE_TAP_SLOP = 100;  // CSS px between the two taps of a double tap
var SWIPE_MIN = 48;         // CSS px a swipe moves at least
var PINCH_MIN = 16;         // CSS px the spread of two fingers changes at least
var MS_PER_SECOND = 1000;
var CONTROLS = 'button, a, input, select, textarea, label, [role="button"]';

function dist(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// A DOM id, or the path from the nearest element with one: [["main"],["div",2]].
function controlId(el) {
    if (el.id) {
        return { id: el.id, isDomId: true };
    }
    var steps = [];
    var node = el;
    while (node && node.nodeType === 1 && !node.id && node.parentElement) {
        var index = 0;
        var sibling = node.previousElementSibling;
        while (sibling) {
            if (sibling.tagName === node.tagName) {
                index++;
            }
            sibling = sibling.previousElementSibling;
        }
        steps.unshift(JSON.stringify([node.tagName.toLowerCase(), index]));
        node = node.parentElement;
    }
    var head = node && node.id ? JSON.stringify([node.id]) : JSON.stringify(['html', 0]);
    return { id: '[' + [head].concat(steps).join(',') + ']', isDomId: false };
}

function tlType(el) {
    var tag = el.tagName;
    if (tag === 'BUTTON' || (tag === 'INPUT' && /^(button|submit|reset)$/i.test(el.type))) {
        return 'button';
    }
    if (tag === 'A') {
        return 'link';
    }
    if (tag === 'IMG') {
        return 'image';
    }
    return 'canvas';
}

// A touch on a button's icon or label names the button, as a native tap names the control.
function target(node) {
    if (!node || node.nodeType !== 1) {
        return null;
    }
    var el = (node.closest && node.closest(CONTROLS)) || node;
    var box = el.getBoundingClientRect();
    var named = controlId(el);
    return {
        id: named.id,
        isDomId: named.isDomId,
        type: (el.constructor && el.constructor.name) || 'HTMLElement',
        tlType: tlType(el),
        bounds: { x: box.left, y: box.top, width: box.width, height: box.height }
    };
}

/**
 * Listens on `win`'s document and calls `send(event)` for each tap and gesture:
 * { kind: click | tap | doubleTap | tapHold | swipe | pinch, target, touches (each finger's
 * points in CSS px of the viewport), direction?, velocity? (a swipe's, CSS px per second),
 * viewportWidth, touchedAt (when the first finger went down, ms since the epoch) }.
 * A single tap's click and tap are sent once the double-tap window closed (300 ms after the
 * finger lifted), or at once when the page goes away; a double tap sends its doubleTap alone.
 * Returns a function that removes the listeners.
 */
function install(win, send) {
    var doc = win.document;
    var pointers = {};
    var pinch = null;
    var pendingTap = null;

    function now() {
        return Date.now();
    }

    function point(e) {
        return { x: e.clientX, y: e.clientY };
    }

    function emit(kind, touchTarget, touches, touchedAt, extra) {
        if (!touchTarget) {
            return;
        }
        var event = {
            kind: kind,
            target: touchTarget,
            touches: touches,
            viewportWidth: win.innerWidth || 0,
            touchedAt: touchedAt
        };
        if (extra) {
            Object.keys(extra).forEach(function (key) {
                event[key] = extra[key];
            });
        }
        send(event);
    }

    function sendTap(tap) {
        if (pendingTap === tap) {
            pendingTap = null;
        }
        win.clearTimeout(tap.timer);
        emit('click', tap.target, [[tap.point]], tap.at);
        emit('tap', tap.target, [[tap.point]], tap.at);
    }

    function clearLongPress(state) {
        if (state.longTimer) {
            win.clearTimeout(state.longTimer);
            state.longTimer = null;
        }
    }

    // The pointer held a pending tap back but did not become its second tap: the tap goes now.
    function releaseHeldTap(state) {
        if (state.secondOf && pendingTap === state.secondOf) {
            sendTap(pendingTap);
        }
        state.secondOf = null;
    }

    function onDown(e) {
        if (e.pointerType === 'mouse' && e.button !== 0) {
            return;
        }
        // The first finger of a new touch: a finger whose end the page never saw is forgotten.
        if (e.isPrimary) {
            Object.keys(pointers).forEach(function (id) {
                clearLongPress(pointers[id]);
            });
            pointers = {};
            pinch = null;
        }
        var state = {
            id: e.pointerId, start: point(e), last: point(e), at: now(),
            target: target(e.target), held: false, consumed: false, longTimer: null, secondOf: null
        };
        pointers[e.pointerId] = state;
        var ids = Object.keys(pointers);
        if (ids.length === 2 && !pinch) {
            var first = pointers[ids[0]];
            var second = pointers[ids[1]];
            [first, second].forEach(function (p) {
                clearLongPress(p);
                p.consumed = true;
                releaseHeldTap(p);
            });
            pinch = { ids: [first.id, second.id], start: [first.last, second.last], last: [first.last, second.last],
                target: first.target, at: first.at };
            return;
        }
        if (ids.length > 2) {
            state.consumed = true;
            return;
        }
        if (pendingTap && state.at - pendingTap.upAt <= DOUBLE_TAP_MS && dist(pendingTap.point, state.start) <= DOUBLE_TAP_SLOP) {
            win.clearTimeout(pendingTap.timer);
            state.secondOf = pendingTap;
        }
        state.longTimer = win.setTimeout(function () {
            state.longTimer = null;
            if (pointers[state.id] === state && !state.consumed && dist(state.start, state.last) <= TAP_SLOP) {
                state.held = true;
                releaseHeldTap(state);
                emit('tapHold', state.target, [[state.start]], state.at);
            }
        }, LONG_PRESS_MS);
    }

    function onMove(e) {
        var state = pointers[e.pointerId];
        if (!state) {
            return;
        }
        state.last = point(e);
        if (dist(state.start, state.last) > TAP_SLOP) {
            clearLongPress(state);
        }
        if (pinch) {
            var finger = pinch.ids.indexOf(e.pointerId);
            if (finger >= 0) {
                pinch.last[finger] = state.last;
            }
        }
    }

    function endPinch() {
        var ended = pinch;
        pinch = null;
        var before = dist(ended.start[0], ended.start[1]);
        var after = dist(ended.last[0], ended.last[1]);
        if (Math.abs(after - before) < PINCH_MIN) {
            return;
        }
        emit('pinch', ended.target, [[ended.start[0], ended.last[0]], [ended.start[1], ended.last[1]]], ended.at,
            { direction: after > before ? 'open' : 'close' });
    }

    function onUp(e) {
        var state = pointers[e.pointerId];
        if (!state) {
            return;
        }
        delete pointers[e.pointerId];
        clearLongPress(state);
        state.last = point(e);
        if (pinch && pinch.ids.indexOf(e.pointerId) >= 0) {
            pinch.last[pinch.ids.indexOf(e.pointerId)] = state.last;
            endPinch();
            return;
        }
        if (state.consumed || state.held) {
            releaseHeldTap(state);
            return;
        }
        var moved = dist(state.start, state.last);
        var heldFor = now() - state.at;
        if (moved >= SWIPE_MIN) {
            releaseHeldTap(state);
            var dx = state.last.x - state.start.x;
            var dy = state.last.y - state.start.y;
            var direction = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
            var seconds = Math.max(heldFor, 1) / MS_PER_SECOND;
            emit('swipe', state.target, [[state.start, state.last]], state.at,
                { direction: direction, velocity: { x: dx / seconds, y: dy / seconds } });
            return;
        }
        if (moved > TAP_SLOP || heldFor >= LONG_PRESS_MS) {
            releaseHeldTap(state);
            return;
        }
        if (state.secondOf && pendingTap === state.secondOf) {
            var firstTap = pendingTap;
            pendingTap = null;
            emit('doubleTap', firstTap.target, [[firstTap.point]], firstTap.at);
            return;
        }
        if (pendingTap) {
            sendTap(pendingTap);
        }
        var tap = { at: state.at, upAt: now(), point: state.start, target: state.target, timer: null };
        tap.timer = win.setTimeout(function () {
            sendTap(tap);
        }, DOUBLE_TAP_MS);
        pendingTap = tap;
    }

    function onCancel(e) {
        var state = pointers[e.pointerId];
        if (!state) {
            return;
        }
        delete pointers[e.pointerId];
        clearLongPress(state);
        releaseHeldTap(state);
        if (pinch && pinch.ids.indexOf(e.pointerId) >= 0) {
            endPinch();
        }
    }

    // A tap that navigates away (a link, a form) would lose its pending click and tap with the page.
    function onPageHide() {
        if (pendingTap) {
            sendTap(pendingTap);
        }
    }

    function onVisibilityChange() {
        if (doc.visibilityState === 'hidden') {
            onPageHide();
        }
    }

    var options = { capture: true, passive: true };
    var listeners = { pointerdown: onDown, pointermove: onMove, pointerup: onUp, pointercancel: onCancel,
        visibilitychange: onVisibilityChange };
    Object.keys(listeners).forEach(function (type) {
        doc.addEventListener(type, listeners[type], options);
    });
    win.addEventListener('pagehide', onPageHide, options);
    return function uninstall() {
        Object.keys(listeners).forEach(function (type) {
            doc.removeEventListener(type, listeners[type], options);
        });
        win.removeEventListener('pagehide', onPageHide, options);
        Object.keys(pointers).forEach(function (id) {
            clearLongPress(pointers[id]);
        });
        pointers = {};
        if (pendingTap) {
            win.clearTimeout(pendingTap.timer);
            pendingTap = null;
        }
    };
}

module.exports = { install: install };

// Cordova runs this module at startup (<runs/> in plugin.xml), in the main frame only.
if (typeof window !== 'undefined' && window.cordova && window.top === window) {
    var exec = require('cordova/exec');
    install(window, function (event) {
        exec(function () {}, function () {}, 'ConnectPlugin', 'logWebEvent', [event]);
    });
}
