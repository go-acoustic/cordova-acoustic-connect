/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Taps and gestures on page elements. The Connect SDK cannot tell which element of a page a finger is on, so
 * this script recognises taps and gestures from the page's pointer events and hands each one, with the element,
 * to the plugin, which logs it as the SDK logs one on a native control. Passive capture-phase listeners on the
 * main frame only: nothing is prevented, nothing global is patched, and no text or field value leaves the page.
 * The SDK logs nothing while it is not enabled.
 *
 * The Cordova plugin carries the same script (www/WebGestures.js); web_gestures_parity.test.ts feeds both the
 * same touches and requires the same messages.
 */

const LONG_PRESS_MS = 500;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP = 8; // CSS px a tap may move
const DOUBLE_TAP_SLOP = 100; // CSS px between the two taps of a double tap
const SWIPE_MIN = 48; // CSS px a swipe moves at least
const PINCH_MIN = 16; // CSS px the spread of two fingers changes at least
const MS_PER_SECOND = 1000;
const CONTROLS = 'button, a, input, select, textarea, label, [role="button"]';

/** A point in CSS px of the page's viewport. */
export interface WebPoint {
  x: number;
  y: number;
}

/** The element a tap or gesture began on. */
export interface WebTarget {
  /** The element's DOM id, or its path from the nearest element with one: `[["main"],["div",2]]`. */
  id: string;
  isDomId: boolean;
  /** The element's DOM class, such as HTMLButtonElement. */
  type: string;
  /** button, link, image or canvas. */
  tlType: string;
  /** The element's box (getBoundingClientRect) in CSS px of the viewport. */
  bounds: { x: number; y: number; width: number; height: number };
}

/** A tap or gesture as the plugin's `logWebEvent` takes it. */
export interface WebEvent {
  kind: 'click' | 'tap' | 'doubleTap' | 'tapHold' | 'swipe' | 'pinch';
  target: WebTarget;
  /** Each finger's points, first to last. */
  touches: WebPoint[][];
  /** A swipe's (left, right, up, down) or a pinch's (open, close). */
  direction?: string;
  /** A swipe's velocity in CSS px per second. */
  velocity?: WebPoint;
  /** The viewport's width in CSS px (innerWidth). */
  viewportWidth: number;
  /** When the first finger went down, in ms since the epoch. */
  touchedAt: number;
}

interface PointerState {
  id: number;
  start: WebPoint;
  last: WebPoint;
  at: number;
  target: WebTarget | null;
  held: boolean;
  consumed: boolean;
  longTimer: number | null;
  secondOf: PendingTap | null;
}

interface PendingTap {
  at: number;
  upAt: number;
  point: WebPoint;
  target: WebTarget | null;
  timer: number | null;
}

interface Pinch {
  ids: number[];
  start: WebPoint[];
  last: WebPoint[];
  target: WebTarget | null;
  at: number;
}

function dist(a: WebPoint, b: WebPoint): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function controlId(el: Element): { id: string; isDomId: boolean } {
  if (el.id) {
    return { id: el.id, isDomId: true };
  }
  const steps: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1 && !node.id && node.parentElement) {
    let index = 0;
    let sibling = node.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === node.tagName) {
        index++;
      }
      sibling = sibling.previousElementSibling;
    }
    steps.unshift(JSON.stringify([node.tagName.toLowerCase(), index]));
    node = node.parentElement;
  }
  const head = node?.id ? JSON.stringify([node.id]) : JSON.stringify(['html', 0]);
  return { id: '[' + [head].concat(steps).join(',') + ']', isDomId: false };
}

function tlType(el: Element): string {
  const tag = el.tagName;
  if (tag === 'BUTTON' || (tag === 'INPUT' && /^(button|submit|reset)$/i.test((el as HTMLInputElement).type))) {
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

/** A touch on a button's icon or label names the button, as a native tap names the control. */
function target(node: EventTarget | null): WebTarget | null {
  if (!node || (node as Node).nodeType !== 1) {
    return null;
  }
  const touched = node as Element;
  const el = touched.closest?.(CONTROLS) || touched;
  const box = el.getBoundingClientRect();
  const named = controlId(el);
  return {
    id: named.id,
    isDomId: named.isDomId,
    type: el.constructor?.name || 'HTMLElement',
    tlType: tlType(el),
    bounds: { x: box.left, y: box.top, width: box.width, height: box.height },
  };
}

/**
 * Listens on `win`'s document and calls `send` for each tap and gesture. A single tap's click and tap are sent
 * once the double-tap window closed (300 ms after the finger lifted), or at once when the page goes away; a
 * double tap sends its doubleTap alone. Returns a function that removes the listeners.
 */
export function installWebGestures(win: Window, send: (event: WebEvent) => void): () => void {
  const doc = win.document;
  const pointers: Record<number, PointerState> = {};
  let pinch: Pinch | null = null;
  let pendingTap: PendingTap | null = null;

  const now = () => Date.now();
  const point = (e: PointerEvent): WebPoint => ({ x: e.clientX, y: e.clientY });

  function emit(
    kind: WebEvent['kind'],
    touchTarget: WebTarget | null,
    touches: WebPoint[][],
    touchedAt: number,
    extra?: Pick<WebEvent, 'direction' | 'velocity'>,
  ): void {
    if (!touchTarget) {
      return;
    }
    const event: WebEvent = { kind, target: touchTarget, touches, viewportWidth: win.innerWidth || 0, touchedAt };
    send(extra ? { ...event, ...extra } : event);
  }

  function sendTap(tap: PendingTap): void {
    if (pendingTap === tap) {
      pendingTap = null;
    }
    if (tap.timer) {
      win.clearTimeout(tap.timer);
    }
    emit('click', tap.target, [[tap.point]], tap.at);
    emit('tap', tap.target, [[tap.point]], tap.at);
  }

  function clearLongPress(state: PointerState): void {
    if (state.longTimer) {
      win.clearTimeout(state.longTimer);
      state.longTimer = null;
    }
  }

  /** The pointer held a pending tap back but did not become its second tap: the tap goes now. */
  function releaseHeldTap(state: PointerState): void {
    if (state.secondOf && pendingTap === state.secondOf) {
      sendTap(pendingTap);
    }
    state.secondOf = null;
  }

  function onDown(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return;
    }
    // The first finger of a new touch: a finger whose end the page never saw is forgotten.
    if (e.isPrimary) {
      Object.keys(pointers).forEach((id) => {
        clearLongPress(pointers[Number(id)]);
        delete pointers[Number(id)];
      });
      pinch = null;
    }
    const state: PointerState = {
      id: e.pointerId,
      start: point(e),
      last: point(e),
      at: now(),
      target: target(e.target),
      held: false,
      consumed: false,
      longTimer: null,
      secondOf: null,
    };
    pointers[e.pointerId] = state;
    const ids = Object.keys(pointers);
    if (ids.length === 2 && !pinch) {
      const first = pointers[Number(ids[0])];
      const second = pointers[Number(ids[1])];
      [first, second].forEach((p) => {
        clearLongPress(p);
        p.consumed = true;
        releaseHeldTap(p);
      });
      pinch = {
        ids: [first.id, second.id],
        start: [first.last, second.last],
        last: [first.last, second.last],
        target: first.target,
        at: first.at,
      };
      return;
    }
    if (ids.length > 2) {
      state.consumed = true;
      return;
    }
    if (
      pendingTap &&
      state.at - pendingTap.upAt <= DOUBLE_TAP_MS &&
      dist(pendingTap.point, state.start) <= DOUBLE_TAP_SLOP
    ) {
      if (pendingTap.timer) {
        win.clearTimeout(pendingTap.timer);
      }
      state.secondOf = pendingTap;
    }
    state.longTimer = win.setTimeout(() => {
      state.longTimer = null;
      if (pointers[state.id] === state && !state.consumed && dist(state.start, state.last) <= TAP_SLOP) {
        state.held = true;
        releaseHeldTap(state);
        emit('tapHold', state.target, [[state.start]], state.at);
      }
    }, LONG_PRESS_MS);
  }

  function onMove(e: PointerEvent): void {
    const state = pointers[e.pointerId];
    if (!state) {
      return;
    }
    state.last = point(e);
    if (dist(state.start, state.last) > TAP_SLOP) {
      clearLongPress(state);
    }
    if (pinch) {
      const finger = pinch.ids.indexOf(e.pointerId);
      if (finger >= 0) {
        pinch.last[finger] = state.last;
      }
    }
  }

  function endPinch(): void {
    const ended = pinch as Pinch;
    pinch = null;
    const before = dist(ended.start[0], ended.start[1]);
    const after = dist(ended.last[0], ended.last[1]);
    if (Math.abs(after - before) < PINCH_MIN) {
      return;
    }
    emit(
      'pinch',
      ended.target,
      [
        [ended.start[0], ended.last[0]],
        [ended.start[1], ended.last[1]],
      ],
      ended.at,
      { direction: after > before ? 'open' : 'close' },
    );
  }

  function onUp(e: PointerEvent): void {
    const state = pointers[e.pointerId];
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
    const moved = dist(state.start, state.last);
    const heldFor = now() - state.at;
    if (moved >= SWIPE_MIN) {
      releaseHeldTap(state);
      const dx = state.last.x - state.start.x;
      const dy = state.last.y - state.start.y;
      const direction = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      const seconds = Math.max(heldFor, 1) / MS_PER_SECOND;
      emit('swipe', state.target, [[state.start, state.last]], state.at, {
        direction,
        velocity: { x: dx / seconds, y: dy / seconds },
      });
      return;
    }
    if (moved > TAP_SLOP || heldFor >= LONG_PRESS_MS) {
      releaseHeldTap(state);
      return;
    }
    if (state.secondOf && pendingTap === state.secondOf) {
      const firstTap = pendingTap;
      pendingTap = null;
      emit('doubleTap', firstTap.target, [[firstTap.point]], firstTap.at);
      return;
    }
    if (pendingTap) {
      sendTap(pendingTap);
    }
    const tap: PendingTap = { at: state.at, upAt: now(), point: state.start, target: state.target, timer: null };
    tap.timer = win.setTimeout(() => sendTap(tap), DOUBLE_TAP_MS);
    pendingTap = tap;
  }

  function onCancel(e: PointerEvent): void {
    const state = pointers[e.pointerId];
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

  /** A tap that navigates away (a link, a form) would lose its pending click and tap with the page. */
  function onPageHide(): void {
    if (pendingTap) {
      sendTap(pendingTap);
    }
  }

  function onVisibilityChange(): void {
    if (doc.visibilityState === 'hidden') {
      onPageHide();
    }
  }

  const options: AddEventListenerOptions = { capture: true, passive: true };
  const listeners: [string, (e: PointerEvent) => void][] = [
    ['pointerdown', onDown],
    ['pointermove', onMove],
    ['pointerup', onUp],
    ['pointercancel', onCancel],
  ];
  listeners.forEach(([type, listener]) => doc.addEventListener(type, listener as EventListener, options));
  doc.addEventListener('visibilitychange', onVisibilityChange, options);
  win.addEventListener('pagehide', onPageHide, options);
  return () => {
    listeners.forEach(([type, listener]) => doc.removeEventListener(type, listener as EventListener, options));
    doc.removeEventListener('visibilitychange', onVisibilityChange, options);
    win.removeEventListener('pagehide', onPageHide, options);
    Object.keys(pointers).forEach((id) => {
      clearLongPress(pointers[Number(id)]);
      delete pointers[Number(id)];
    });
    if (pendingTap?.timer) {
      win.clearTimeout(pendingTap.timer);
    }
    pendingTap = null;
  };
}
