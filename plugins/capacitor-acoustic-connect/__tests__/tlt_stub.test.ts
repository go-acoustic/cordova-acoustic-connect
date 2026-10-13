import { installTltStub } from '../src/tlt-stub';

describe('the TLT stand-in for the SDK of Android', () => {
  it('defines what the DOM capture script of the SDK calls, on Android', () => {
    const win: { TLT?: any } = {};
    installTltStub(win, 'android');
    expect(win.TLT.isInitialized()).toBe(false);
    expect(win.TLT.logDOMCapture({}, {})).toBeNull();
    expect(() => {
      win.TLT.registerBridgeCallbacks([]);
      win.TLT.destroy();
    }).not.toThrow();
  });

  it('keeps a TLT the page already has', () => {
    const real = { real: true };
    const win: { TLT?: unknown } = { TLT: real };
    installTltStub(win, 'android');
    expect(win.TLT).toBe(real);
  });

  it.each(['ios', 'web'])('leaves the page alone on %s', (platform) => {
    const win: { TLT?: unknown } = {};
    installTltStub(win, platform);
    expect(win.TLT).toBeUndefined();
  });

  it('does nothing without a window', () => {
    expect(() => installTltStub(undefined, 'android')).not.toThrow();
  });

  it('does not throw when the page cannot take a TLT', () => {
    const frozen = Object.freeze({});
    expect(() => installTltStub(frozen, 'android')).not.toThrow();
    const guarded = Object.defineProperty({}, 'TLT', {
      get: () => undefined,
      set: () => {
        throw new Error('blocked');
      },
    });
    expect(() => installTltStub(guarded, 'android')).not.toThrow();
  });
});
