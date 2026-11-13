/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * The page script's recognizer is written twice: www/WebGestures.js in the Cordova plugin, src/web-gestures.ts
 * here. Both get the same touches and must send the same taps and gestures, so a change to one is made to the
 * other. What each sends is the Cordova plugin's WebGestures.test.ts.
 */

/* eslint-disable @typescript-eslint/no-var-requires */
import { after, element, page } from '../../cordova-acoustic-mobile-connect-push/__tests__/fixtures/fake-page';
import { installWebGestures } from '../src/web-gestures';

const cordova = require('../../cordova-acoustic-mobile-connect-push/www/WebGestures.js');

type Fake = ReturnType<typeof page>;
type Install = (win: unknown, send: (e: unknown) => void) => () => void;

const button = element('BUTTON', { id: 'gesture_long_press', domClass: 'HTMLButtonElement' });
const main = element('MAIN', { id: 'content' });
const plain = after(element('DIV', { parent: main }), element('DIV', { parent: main, domClass: 'HTMLDivElement' }));

const scenarios: Record<string, (p: Fake) => void> = {
  'a single tap': (p) => {
    p.pointer('pointerdown', button, 40, 30);
    jest.advanceTimersByTime(60);
    p.pointer('pointerup', button, 41, 31);
  },
  'a double tap': (p) => {
    p.pointer('pointerdown', button, 40, 30);
    p.pointer('pointerup', button, 40, 30);
    jest.advanceTimersByTime(120);
    p.pointer('pointerdown', button, 44, 33);
    p.pointer('pointerup', button, 44, 33);
  },
  'a tap, then a long press near it': (p) => {
    p.pointer('pointerdown', button, 40, 30);
    p.pointer('pointerup', button, 40, 30);
    jest.advanceTimersByTime(100);
    p.pointer('pointerdown', button, 42, 30);
    jest.advanceTimersByTime(700);
    p.pointer('pointerup', button, 42, 30);
  },
  'swipes in four directions': (p) => {
    for (const [dx, dy] of [
      [-90, 5],
      [90, -5],
      [5, -90],
      [-5, 90],
    ]) {
      p.pointer('pointerdown', plain, 200, 200);
      jest.advanceTimersByTime(150);
      p.pointer('pointerup', plain, 200 + dx, 200 + dy);
      jest.advanceTimersByTime(400);
    }
  },
  'a pinch closing, then a third finger': (p) => {
    p.pointer('pointerdown', button, 100, 30, { pointerId: 1 });
    p.pointer('pointerdown', button, 200, 30, { pointerId: 2 });
    p.pointer('pointerdown', button, 300, 30, { pointerId: 3 });
    p.pointer('pointermove', button, 130, 30, { pointerId: 1 });
    p.pointer('pointermove', button, 170, 30, { pointerId: 2 });
    p.pointer('pointerup', button, 130, 30, { pointerId: 1 });
    p.pointer('pointerup', button, 170, 30, { pointerId: 2 });
    p.pointer('pointerup', button, 300, 30, { pointerId: 3 });
  },
  'a slow first tap, then a second one soon after it lifted': (p) => {
    p.pointer('pointerdown', button, 40, 30);
    jest.advanceTimersByTime(200);
    p.pointer('pointerup', button, 40, 30);
    jest.advanceTimersByTime(250);
    p.pointer('pointerdown', button, 41, 30);
    p.pointer('pointerup', button, 41, 30);
  },
  'a tap, then the page goes away': (p) => {
    p.pointer('pointerdown', plain, 40, 30);
    p.pointer('pointerup', plain, 40, 30);
    p.pageHide();
  },
  'a finger whose end was lost, then a new touch': (p) => {
    p.pointer('pointerdown', button, 40, 30, { pointerId: 1, isPrimary: true });
    p.pointer('pointerdown', button, 90, 30, { pointerId: 2, isPrimary: true });
    p.pointer('pointerup', button, 90, 30, { pointerId: 2 });
  },
  'a move short of a swipe, a cancel and a right click': (p) => {
    p.pointer('pointerdown', plain, 40, 30);
    p.pointer('pointerup', plain, 70, 30);
    p.pointer('pointerdown', plain, 40, 30);
    p.pointer('pointercancel', plain, 40, 30);
    p.pointer('pointerdown', plain, 40, 30, { pointerType: 'mouse', button: 2 });
    p.pointer('pointerup', plain, 40, 30, { pointerType: 'mouse', button: 2 });
  },
};

const expectedKinds: Record<string, string[]> = {
  'a single tap': ['click', 'tap'],
  'a double tap': ['doubleTap'],
  'a tap, then a long press near it': ['click', 'tap', 'tapHold'],
  'swipes in four directions': ['swipe', 'swipe', 'swipe', 'swipe'],
  'a pinch closing, then a third finger': ['pinch'],
  'a slow first tap, then a second one soon after it lifted': ['doubleTap'],
  'a tap, then the page goes away': ['click', 'tap'],
  'a finger whose end was lost, then a new touch': ['click', 'tap'],
  'a move short of a swipe, a cancel and a right click': [],
};

function run(install: Install, scenario: (p: Fake) => void): unknown[] {
  jest.useFakeTimers({ now: 1_800_000_000_000 });
  const fake = page();
  const sent: unknown[] = [];
  const uninstall = install(fake.win, (e) => sent.push(e));
  scenario(fake);
  jest.advanceTimersByTime(2_000);
  uninstall();
  jest.useRealTimers();
  return sent;
}

describe('the two copies of the web gesture recognizer', () => {
  it.each(Object.keys(scenarios))('send the same for %s', (name) => {
    const fromCordova = run(cordova.install, scenarios[name]);
    const fromCapacitor = run(installWebGestures as unknown as Install, scenarios[name]);

    expect(fromCordova.map((e) => (e as { kind: string }).kind)).toEqual(expectedKinds[name]);
    expect(fromCapacitor).toEqual(fromCordova);
  });
});
