/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Where the plugin installs its page script for taps and gestures on page elements: on every native platform, in the app's
 * main frame only. Both SDKs log them (Android 11.1.39-beta and later, iOS 2.2.35 and later).
 */

const installWebGestures = jest.fn();
let platform = 'web';

jest.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platform,
    isNativePlatform: () => platform !== 'web',
  },
  registerPlugin: () => ({ logWebEvent: () => Promise.resolve({ queued: true }) }),
}));
jest.mock('../src/web-gestures', () => ({ installWebGestures }));

/** Loads the plugin's entry point afresh on `on`, in a main frame or a frame of the page. */
function load(on: string, frame: 'main' | 'child' = 'main') {
  platform = on;
  const win: { top?: unknown } = {};
  win.top = frame === 'main' ? win : {};
  (globalThis as { window?: unknown }).window = win;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('../src/index');
  });
  return win;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('the page script for taps and gestures on page elements', () => {
  it.each([['android'], ['ios']])('is installed on %s, in the main frame', (on) => {
    const win = load(on);
    expect(installWebGestures).toHaveBeenCalledTimes(1);
    expect(installWebGestures).toHaveBeenCalledWith(win, expect.any(Function));
  });

  it('is not installed in a browser, where there is no native SDK', () => {
    load('web');
    expect(installWebGestures).not.toHaveBeenCalled();
  });

  it('is not installed in a frame of the page', () => {
    load('ios', 'child');
    expect(installWebGestures).not.toHaveBeenCalled();
  });
});

export {};
