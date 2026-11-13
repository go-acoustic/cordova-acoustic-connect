/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * The page script's recognizer (www/WebGestures.js): which taps and gestures it hands to the plugin, with
 * which element, points and times.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
import { after, element, page } from './fixtures/fake-page';

const { install } = require('../www/WebGestures.js');

const START = 1_800_000_000_000;

describe('WebGestures', () => {
  let sent: Record<string, unknown>[];
  let fake: ReturnType<typeof page>;
  let uninstall: () => void;
  const button = element('BUTTON', { id: 'gesture_double_tap', domClass: 'HTMLButtonElement' });

  beforeEach(() => {
    jest.useFakeTimers({ now: START });
    sent = [];
    fake = page();
    uninstall = install(fake.win, (event: Record<string, unknown>) => sent.push(event));
  });

  afterEach(() => {
    uninstall();
    jest.useRealTimers();
  });

  const kinds = () => sent.map((e) => e.kind);

  it('sends a single tap as a click and a tap once the double-tap window closed', () => {
    fake.pointer('pointerdown', button, 40, 30);
    jest.advanceTimersByTime(80);
    fake.pointer('pointerup', button, 41, 30);
    jest.advanceTimersByTime(299);
    expect(sent).toEqual([]);

    jest.advanceTimersByTime(1);

    expect(kinds()).toEqual(['click', 'tap']);
    expect(sent[0]).toEqual({
      kind: 'click',
      target: { id: 'gesture_double_tap', isDomId: true, type: 'HTMLButtonElement', tlType: 'button',
        bounds: { x: 10, y: 20, width: 100, height: 40 } },
      touches: [[{ x: 40, y: 30 }]],
      viewportWidth: 390,
      touchedAt: START,
    });
    expect(sent[1]).toEqual({ ...sent[0], kind: 'tap' });
  });

  it('sends a double tap alone, timed at the first touch', () => {
    fake.pointer('pointerdown', button, 40, 30);
    fake.pointer('pointerup', button, 40, 30);
    jest.advanceTimersByTime(150);
    fake.pointer('pointerdown', button, 45, 32);
    fake.pointer('pointerup', button, 45, 32);
    jest.advanceTimersByTime(1_000);

    expect(kinds()).toEqual(['doubleTap']);
    expect(sent[0]).toMatchObject({ touches: [[{ x: 40, y: 30 }]], touchedAt: START });
  });

  it('times the double-tap window from the first finger lifting', () => {
    fake.pointer('pointerdown', button, 40, 30);
    jest.advanceTimersByTime(150);
    fake.pointer('pointerup', button, 40, 30);
    jest.advanceTimersByTime(250);
    fake.pointer('pointerdown', button, 42, 31);
    fake.pointer('pointerup', button, 42, 31);
    jest.advanceTimersByTime(1_000);

    expect(kinds()).toEqual(['doubleTap']);
  });

  it.each([
    ['goes away', (p: ReturnType<typeof page>) => p.pageHide()],
    ['is hidden', (p: ReturnType<typeof page>) => p.hide()],
  ])('sends a pending tap at once when the page %s, so a tap that navigates is not lost', (_name, leave) => {
    fake.pointer('pointerdown', button, 40, 30);
    fake.pointer('pointerup', button, 40, 30);
    jest.advanceTimersByTime(50);
    leave(fake);

    expect(kinds()).toEqual(['click', 'tap']);
    jest.advanceTimersByTime(1_000);
    expect(kinds()).toEqual(['click', 'tap']);
  });

  it('sends two taps too far apart as two single taps', () => {
    fake.pointer('pointerdown', button, 40, 30);
    fake.pointer('pointerup', button, 40, 30);
    jest.advanceTimersByTime(150);
    fake.pointer('pointerdown', button, 240, 30);
    fake.pointer('pointerup', button, 240, 30);
    jest.advanceTimersByTime(1_000);

    expect(kinds()).toEqual(['click', 'tap', 'click', 'tap']);
  });

  it('sends a long press once it is held, and nothing when it ends', () => {
    fake.pointer('pointerdown', button, 40, 30);
    jest.advanceTimersByTime(500);
    expect(kinds()).toEqual(['tapHold']);

    jest.advanceTimersByTime(400);
    fake.pointer('pointerup', button, 40, 30);
    jest.advanceTimersByTime(1_000);

    expect(kinds()).toEqual(['tapHold']);
    expect(sent[0]).toMatchObject({ touchedAt: START });
  });

  it('sends a swipe with its direction and velocity', () => {
    fake.pointer('pointerdown', button, 200, 30);
    jest.advanceTimersByTime(100);
    fake.pointer('pointermove', button, 150, 32);
    jest.advanceTimersByTime(100);
    fake.pointer('pointerup', button, 100, 34);
    jest.advanceTimersByTime(1_000);

    expect(sent).toEqual([expect.objectContaining({
      kind: 'swipe', direction: 'left', velocity: { x: -500, y: 20 },
      touches: [[{ x: 200, y: 30 }, { x: 100, y: 34 }]], touchedAt: START,
    })]);
  });

  it('sends a pinch with a row per finger and its direction, no velocity', () => {
    fake.pointer('pointerdown', button, 100, 30, { pointerId: 1 });
    jest.advanceTimersByTime(20);
    fake.pointer('pointerdown', button, 120, 30, { pointerId: 2 });
    fake.pointer('pointermove', button, 60, 30, { pointerId: 1 });
    fake.pointer('pointermove', button, 160, 30, { pointerId: 2 });
    fake.pointer('pointerup', button, 60, 30, { pointerId: 1 });
    fake.pointer('pointerup', button, 160, 30, { pointerId: 2 });
    jest.advanceTimersByTime(1_000);

    expect(sent).toEqual([expect.objectContaining({
      kind: 'pinch', direction: 'open', touchedAt: START,
      touches: [[{ x: 100, y: 30 }, { x: 60, y: 30 }], [{ x: 120, y: 30 }, { x: 160, y: 30 }]],
    })]);
    expect(sent[0]).not.toHaveProperty('velocity');
  });

  it('names the control a touch on its label lands in, and an element without an id by its path', () => {
    const main = element('MAIN', { id: 'content' });
    const first = element('DIV', { parent: main });
    const box = after(first, element('DIV', { parent: main, domClass: 'HTMLDivElement' }));
    const link = element('A', { parent: main, domClass: 'HTMLAnchorElement' });
    const label = element('SPAN', { parent: link });

    for (const target of [box, label]) {
      fake.pointer('pointerdown', target, 40, 30);
      fake.pointer('pointerup', target, 40, 30);
      jest.advanceTimersByTime(400);
    }

    expect(sent[0].target).toMatchObject({ id: '[["content"],["div",1]]', isDomId: false, type: 'HTMLDivElement', tlType: 'canvas' });
    expect(sent[2].target).toMatchObject({ id: '[["content"],["a",0]]', isDomId: false, type: 'HTMLAnchorElement', tlType: 'link' });
  });

  it('forgets a finger whose end it never saw once a new touch begins, so the next tap is no pinch', () => {
    fake.pointer('pointerdown', button, 40, 30, { pointerId: 1, isPrimary: true });
    fake.pointer('pointerdown', button, 80, 30, { pointerId: 7, isPrimary: true });
    fake.pointer('pointerup', button, 80, 30, { pointerId: 7 });
    jest.advanceTimersByTime(1_000);

    expect(kinds()).toEqual(['click', 'tap']);
  });

  it('sends nothing for a scroll the browser took over, a mouse button other than the first, or after uninstall', () => {
    fake.pointer('pointerdown', button, 40, 30);
    fake.pointer('pointercancel', button, 40, 90);
    fake.pointer('pointerdown', button, 40, 30, { pointerType: 'mouse', button: 2 });
    fake.pointer('pointerup', button, 40, 30, { pointerType: 'mouse', button: 2 });
    fake.pointer('pointerdown', button, 40, 30, { pointerId: 3 });
    uninstall();
    expect(fake.listenerCount()).toBe(0);
    jest.advanceTimersByTime(1_000);
    fake.pointer('pointerdown', button, 40, 30);
    fake.pointer('pointerup', button, 40, 30);
    jest.advanceTimersByTime(1_000);

    expect(sent).toEqual([]);
  });
});
