import { TAP_SLOP, LONG_PRESS_MS, Point, clampZoom, distance, isDoubleTap, pinchName, pressName, swipeName } from '../behaviour-core';

export interface PointerHandlers {
  down(e: PointerEvent): void;
  move(e: PointerEvent): void;
  up(e: PointerEvent): void;
  cancel(e: PointerEvent): void;
}

export interface GestureHandlers {
  longPress: PointerHandlers;
  doubleTap: PointerHandlers;
  swipe: PointerHandlers;
  pinch: PointerHandlers;
}

const point = (e: PointerEvent): Point => ({ x: e.clientX, y: e.clientY });

function guarded(handlers: Partial<PointerHandlers>): PointerHandlers {
  return {
    down: (e) => {
      if (e.currentTarget instanceof Element) {
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
      }
      e.preventDefault();
      handlers.down?.(e);
    },
    move: (e) => { e.preventDefault(); handlers.move?.(e); },
    up: (e) => { e.preventDefault(); handlers.up?.(e); },
    cancel: (e) => { e.preventDefault(); handlers.cancel?.(e); }
  };
}

function longPress(show: (name: string) => void): Partial<PointerHandlers> {
  let press: { from: Point; at: number; long: boolean; timer?: ReturnType<typeof setTimeout> } | null = null;
  const cancel = () => {
    if (press) clearTimeout(press.timer);
    press = null;
  };
  return {
    down: (e) => {
      if (!e.isPrimary) return;
      cancel();
      const current: NonNullable<typeof press> = { from: point(e), at: e.timeStamp, long: false };
      current.timer = setTimeout(() => { current.long = true; show('longPress'); }, LONG_PRESS_MS);
      press = current;
    },
    move: (e) => {
      if (!e.isPrimary) return;
      if (press && distance(press.from, point(e)) > TAP_SLOP) cancel();
    },
    up: (e) => {
      if (!e.isPrimary || !press) return;
      if (!press.long) show(pressName(e.timeStamp - press.at));
      cancel();
    },
    cancel
  };
}

function doubleTap(show: (name: string) => void): Partial<PointerHandlers> {
  let down: { from: Point; at: number } | null = null;
  let previousUpAt: number | null = null;
  return {
    down: (e) => {
      if (e.isPrimary) down = { from: point(e), at: e.timeStamp };
    },
    move: (e) => {
      if (!e.isPrimary) return;
      if (down && distance(down.from, point(e)) > TAP_SLOP) {
        down = null;
        previousUpAt = null;
      }
    },
    up: (e) => {
      if (!e.isPrimary || !down) return;
      const tap = pressName(e.timeStamp - down.at) === 'tap';
      const second = tap && isDoubleTap(previousUpAt, down.at);
      previousUpAt = tap && !second ? e.timeStamp : null;
      down = null;
      if (second) show('doubleTap');
    },
    cancel: () => {
      down = null;
      previousUpAt = null;
    }
  };
}

function swipe(show: (name: string) => void): Partial<PointerHandlers> {
  let from: Point | null = null;
  return {
    down: (e) => {
      if (e.isPrimary) from = point(e);
    },
    up: (e) => {
      if (!e.isPrimary || !from) return;
      const name = swipeName(e.clientX - from.x, e.clientY - from.y);
      from = null;
      if (name) show(name);
    },
    cancel: () => { from = null; }
  };
}

function pinch(show: (name: string) => void, setZoom: (zoom: number) => void): Partial<PointerHandlers> {
  const touches = new Map<number, Point>();
  let spread: number | null = null;
  let zoom = 1;
  const measure = (): number | null => {
    if (touches.size !== 2) return null;
    const [a, b] = Array.from(touches.values());
    return distance(a, b);
  };
  const release = (e: PointerEvent) => {
    touches.delete(e.pointerId);
    spread = measure();
  };
  return {
    down: (e) => {
      touches.set(e.pointerId, point(e));
      spread = measure();
    },
    move: (e) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, point(e));
      const now = measure();
      const name = now === null ? null : pinchName(spread, now);
      if (name && now !== null && spread !== null) {
        zoom = clampZoom(zoom, now / spread);
        setZoom(zoom);
        show(name);
      }
      spread = now;
    },
    up: release,
    cancel: release
  };
}

export function createGestureHandlers(show: (name: string) => void, setZoom: (zoom: number) => void): GestureHandlers {
  return {
    longPress: guarded(longPress(show)),
    doubleTap: guarded(doubleTap(show)),
    swipe: guarded(swipe(show)),
    pinch: guarded(pinch(show, setZoom))
  };
}
