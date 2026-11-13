/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * A page with just what the web gesture recognizer reads (www/WebGestures.js, and the Capacitor plugin's
 * src/web-gestures.ts): elements with an id, a tag, a box and a parent, pointer listeners on the document, and
 * the window's timers (Jest's fake ones).
 */

export interface FakeElement {
  nodeType: 1;
  tagName: string;
  id: string;
  type: string;
  role: string;
  constructor: { name: string };
  parentElement: FakeElement | null;
  previousElementSibling: FakeElement | null;
  box: { x: number; y: number; width: number; height: number };
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  closest(selector: string): FakeElement | null;
}

const CONTROL_TAGS = ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA', 'LABEL'];

export function element(
  tagName: string,
  options: { id?: string; parent?: FakeElement; domClass?: string; type?: string; role?: string; x?: number; y?: number } = {},
): FakeElement {
  const parent = options.parent ?? null;
  const el: FakeElement = {
    nodeType: 1,
    tagName,
    id: options.id ?? '',
    type: options.type ?? '',
    role: options.role ?? '',
    constructor: { name: options.domClass ?? 'HTMLElement' },
    parentElement: parent,
    previousElementSibling: null,
    box: { x: options.x ?? 10, y: options.y ?? 20, width: 100, height: 40 },
    getBoundingClientRect() {
      return { left: el.box.x, top: el.box.y, width: el.box.width, height: el.box.height };
    },
    closest(selector: string) {
      expect(selector).toContain('button');
      let node: FakeElement | null = el;
      while (node) {
        if (CONTROL_TAGS.includes(node.tagName) || node.role === 'button') return node;
        node = node.parentElement;
      }
      return null;
    },
  };
  return el;
}

/** Makes `later` the next sibling of `earlier`. */
export function after(earlier: FakeElement, later: FakeElement): FakeElement {
  later.previousElementSibling = earlier;
  return later;
}

type Listener = (e: unknown) => void;

export interface FakePage {
  win: {
    document: {
      addEventListener: (t: string, l: Listener) => void;
      removeEventListener: (t: string, l: Listener) => void;
      visibilityState: string;
    };
    addEventListener: (t: string, l: Listener) => void;
    removeEventListener: (t: string, l: Listener) => void;
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
    innerWidth: number;
  };
  listenerCount(): number;
  /** The page goes away (a navigation): `pagehide` on the window. */
  pageHide(): void;
  /** The page is hidden (the app goes to the background): `visibilitychange` on the document. */
  hide(): void;
  /** A pointer event on `target` at (x, y); finger 1 unless `pointerId` says otherwise. */
  pointer(type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', target: FakeElement, x: number, y: number,
    more?: { pointerId?: number; pointerType?: string; button?: number; isPrimary?: boolean }): void;
}

export function page(innerWidth = 390): FakePage {
  const listeners: Record<string, Listener[]> = {};
  const windowListeners: Record<string, Listener[]> = {};
  const document = {
    addEventListener: (t: string, l: Listener) => (listeners[t] = (listeners[t] ?? []).concat(l)),
    removeEventListener: (t: string, l: Listener) => (listeners[t] = (listeners[t] ?? []).filter((x) => x !== l)),
    visibilityState: 'visible',
  };
  return {
    win: {
      document,
      addEventListener: (t, l) => (windowListeners[t] = (windowListeners[t] ?? []).concat(l)),
      removeEventListener: (t, l) => (windowListeners[t] = (windowListeners[t] ?? []).filter((x) => x !== l)),
      setTimeout: ((fn: () => void, ms: number) => setTimeout(fn, ms)) as typeof setTimeout,
      clearTimeout: ((id: ReturnType<typeof setTimeout>) => clearTimeout(id)) as typeof clearTimeout,
      innerWidth,
    },
    listenerCount: () =>
      [...Object.values(listeners), ...Object.values(windowListeners)].reduce((n, l) => n + l.length, 0),
    pageHide: () => (windowListeners.pagehide ?? []).forEach((l) => l({})),
    hide() {
      document.visibilityState = 'hidden';
      (listeners.visibilitychange ?? []).forEach((l) => l({}));
    },
    pointer(type, target, x, y, more = {}) {
      const event = { target, clientX: x, clientY: y, pointerId: more.pointerId ?? 1,
        pointerType: more.pointerType ?? 'touch', button: more.button ?? 0, isPrimary: more.isPrimary ?? false };
      (listeners[type] ?? []).forEach((l) => l(event));
    },
  };
}
