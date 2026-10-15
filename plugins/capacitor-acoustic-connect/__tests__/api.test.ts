/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Tests for the Cordova-style API on top of the Capacitor plugin: argument checks, the one options
 * object per native method, unwrapping of { value } results and the errors. The behaviour is the
 * one of the Cordova plugin's JavaScript facade, so an app can move between the two.
 */

import { createAcousticConnect } from '../src/api';
import type { AcousticConnectPlugin } from '../src/definitions';

type Mocked = { [K in keyof AcousticConnectPlugin]: jest.Mock };

function makeNative(over: Partial<Mocked> = {}): Mocked {
  const ok = () => jest.fn().mockResolvedValue(undefined);
  return {
    enable: ok(),
    disable: ok(),
    setLogLevel: ok(),
    logIdentity: ok(),
    flushQueues: ok(),
    setCurrentScreenName: ok(),
    logCustomEvent: ok(),
    logSignal: ok(),
    logExceptionEvent: ok(),
    logScreenViewContextLoad: ok(),
    logScreenViewContextUnload: ok(),
    logScreenLayout: ok(),
    setConfigItem: ok(),
    getSdkVersion: jest.fn().mockResolvedValue({ value: '11.0.21-beta' }),
    isSdkEnabled: jest.fn().mockResolvedValue({ value: true }),
    getConfigItem: jest.fn().mockResolvedValue({}),
    pushRequestPermission: jest.fn().mockResolvedValue({ granted: true }),
    pushGetPermissionState: jest.fn().mockResolvedValue({ value: null }),
    pushDidReceiveAuthorization: jest.fn().mockResolvedValue({ value: true }),
    pushDidReceiveNotification: jest.fn().mockResolvedValue({ value: true }),
    pushDidReceiveResponse: jest.fn().mockResolvedValue({ value: true }),
    pushDidRegisterWithToken: jest.fn().mockResolvedValue({ value: true }),
    pushDidFailToRegister: jest.fn().mockResolvedValue({ value: true }),
    ...over,
  } as Mocked;
}

const INVALID = { code: 'ACOUSTIC_INVALID_ARGS' };

describe('enable', () => {
  it('keeps the checked key and URL even when the options of an untyped caller carry others', async () => {
    const native = makeNative();
    await createAcousticConnect(native).enable('key', 'https://x.test/collect', undefined, {
      appKey: '',
      postURL: 'https://other.test',
    } as never);
    expect(native.enable).toHaveBeenCalledWith({ appKey: 'key', postURL: 'https://x.test/collect' });
  });

  it('sends one options object and leaves the push mode to the native default', async () => {
    // Left out, not defaulted here: the native side takes it from capacitor.config before falling back.
    const native = makeNative();
    await createAcousticConnect(native).enable('key', 'https://x.test/collect');
    expect(native.enable).toHaveBeenCalledWith({
      appKey: 'key',
      postURL: 'https://x.test/collect',
    });
  });

  it('carries the push mode and the platform options', async () => {
    const native = makeNative();
    await createAcousticConnect(native).enable('k', 'u', 'manual', {
      iosAppGroupIdentifier: 'group.x',
      androidIconResName: 'ic',
    });
    expect(native.enable).toHaveBeenCalledWith({
      appKey: 'k',
      postURL: 'u',
      pushMode: 'manual',
      iosAppGroupIdentifier: 'group.x',
      androidIconResName: 'ic',
    });
  });

  it.each([[''], ['  '], [undefined], [null], [5]])('rejects ACOUSTIC_INVALID_ARGS for appKey %j', async (appKey) => {
    const native = makeNative();
    await expect(createAcousticConnect(native).enable(appKey as never, 'u')).rejects.toMatchObject(INVALID);
    expect(native.enable).not.toHaveBeenCalled();
  });

  it.each([[''], [undefined], [7]])('rejects ACOUSTIC_INVALID_ARGS for postURL %j', async (postURL) => {
    await expect(createAcousticConnect(makeNative()).enable('k', postURL as never)).rejects.toMatchObject(INVALID);
  });

  it('rejects an unknown push mode', async () => {
    await expect(createAcousticConnect(makeNative()).enable('k', 'u', 'auto' as never)).rejects.toMatchObject(INVALID);
  });
});

describe('simple calls', () => {
  it('disable and flushQueues call the native side with no options', async () => {
    const native = makeNative();
    const api = createAcousticConnect(native);
    await api.disable();
    await api.flushQueues();
    expect(native.disable).toHaveBeenCalledWith();
    expect(native.flushQueues).toHaveBeenCalledWith();
  });

  it.each(['silent', 'error', 'warn', 'info', 'verbose'])('setLogLevel accepts %s', async (level) => {
    const native = makeNative();
    await createAcousticConnect(native).setLogLevel(level as never);
    expect(native.setLogLevel).toHaveBeenCalledWith({ level });
  });

  it.each([['debug'], [''], [undefined], [3]])('setLogLevel rejects %j', async (level) => {
    const native = makeNative();
    await expect(createAcousticConnect(native).setLogLevel(level as never)).rejects.toMatchObject(INVALID);
    expect(native.setLogLevel).not.toHaveBeenCalled();
  });

  it('setCurrentScreenName sends the name and rejects a blank one', async () => {
    const native = makeNative();
    const api = createAcousticConnect(native);
    await api.setCurrentScreenName('home');
    expect(native.setCurrentScreenName).toHaveBeenCalledWith({ name: 'home' });
    await expect(api.setCurrentScreenName(' ')).rejects.toMatchObject(INVALID);
  });
});

describe('unwrapping { value } results', () => {
  it('getSdkVersion returns the string', async () => {
    await expect(createAcousticConnect(makeNative()).getSdkVersion()).resolves.toBe('11.0.21-beta');
  });

  it.each([
    [{ value: true }, true],
    [{ value: false }, false],
    [{ value: 1 }, false],
    [{}, false],
  ])('isSdkEnabled turns %j into %s', async (result, expected) => {
    const native = makeNative({ isSdkEnabled: jest.fn().mockResolvedValue(result) });
    await expect(createAcousticConnect(native).isSdkEnabled()).resolves.toBe(expected);
  });
});

describe('logIdentity', () => {
  it('defaults the signal type to loggedIn and the parameters to {}', async () => {
    const native = makeNative();
    await createAcousticConnect(native).logIdentity('Email', 'a@b.test');
    expect(native.logIdentity).toHaveBeenCalledWith({
      identifierName: 'Email',
      identifierValue: 'a@b.test',
      signalType: 'loggedIn',
      additionalParameters: {},
    });
  });

  it('carries an explicit signal type and parameters, trimming the type', async () => {
    const native = makeNative();
    await createAcousticConnect(native).logIdentity('Email', 'a@b.test', ' accountRegistered ', {
      registrationMethod: 'email',
    });
    expect(native.logIdentity).toHaveBeenCalledWith({
      identifierName: 'Email',
      identifierValue: 'a@b.test',
      signalType: 'accountRegistered',
      additionalParameters: { registrationMethod: 'email' },
    });
  });

  it.each([
    ['', 'v'],
    ['n', ''],
    [' ', 'v'],
    ['n', '   '],
  ])('rejects %j / %j', async (name, value) => {
    const native = makeNative();
    await expect(createAcousticConnect(native).logIdentity(name, value)).rejects.toMatchObject(INVALID);
    expect(native.logIdentity).not.toHaveBeenCalled();
  });
});

describe('logCustomEvent', () => {
  it('sends the values and the default level 3', async () => {
    const native = makeNative();
    await createAcousticConnect(native).logCustomEvent('purchase', { sku: 'A1', qty: 2, gift: true });
    expect(native.logCustomEvent).toHaveBeenCalledWith({
      eventName: 'purchase',
      values: { sku: 'A1', qty: 2, gift: true },
      level: 3,
    });
  });

  it('sends {} when there are no values, and an explicit level', async () => {
    const native = makeNative();
    await createAcousticConnect(native).logCustomEvent('e', undefined, 1);
    expect(native.logCustomEvent).toHaveBeenCalledWith({ eventName: 'e', values: {}, level: 1 });
  });

  it.each([[''], ['  '], [undefined], [4]])('rejects the event name %j', async (name) => {
    await expect(createAcousticConnect(makeNative()).logCustomEvent(name as never)).rejects.toMatchObject(INVALID);
  });

  it.each([
    ['nested object', { a: { b: 1 } }],
    ['array value', { a: [1] }],
    ['null value', { a: null }],
    ['NaN', { a: NaN }],
    ['Infinity', { a: Infinity }],
    ['function', { a: () => 1 }],
    ['array', [1, 2]],
    ['null', null],
    ['string', 'x'],
    ['Date', new Date()],
    ['Map', new Map([['a', 1]])],
    ['Set', new Set([1])],
  ])('rejects values that are %s', async (_label, values) => {
    const native = makeNative();
    await expect(createAcousticConnect(native).logCustomEvent('e', values as never)).rejects.toMatchObject(INVALID);
    expect(native.logCustomEvent).not.toHaveBeenCalled();
  });

  it.each([[-1], [1.5], [NaN], ['3'], [null]])('rejects the level %j', async (level) => {
    await expect(createAcousticConnect(makeNative()).logCustomEvent('e', {}, level as never)).rejects.toMatchObject(
      INVALID,
    );
  });

  it('accepts an object without a prototype', async () => {
    const native = makeNative();
    const bare = Object.create(null) as Record<string, string>;
    bare.a = 'x';
    await createAcousticConnect(native).logCustomEvent('e', bare);
    expect(native.logCustomEvent).toHaveBeenCalledTimes(1);
  });
});

describe('logClickEvent', () => {
  it('is a custom event "click" carrying the control id and the data', async () => {
    const native = makeNative();
    await createAcousticConnect(native).logClickEvent('btnPay', { screen: 'checkout' });
    expect(native.logCustomEvent).toHaveBeenCalledWith({
      eventName: 'click',
      values: { screen: 'checkout', controlId: 'btnPay' },
      level: 3,
    });
  });

  it('the control id wins over a controlId key in the data', async () => {
    const native = makeNative();
    await createAcousticConnect(native).logClickEvent('real', { controlId: 'fake' });
    expect((native.logCustomEvent.mock.calls[0][0] as { values: Record<string, unknown> }).values.controlId).toBe(
      'real',
    );
  });

  it('rejects a blank control id and non-flat data', async () => {
    const api = createAcousticConnect(makeNative());
    await expect(api.logClickEvent('')).rejects.toMatchObject(INVALID);
    await expect(api.logClickEvent('b', { a: { b: 1 } } as never)).rejects.toMatchObject(INVALID);
    await expect(api.logClickEvent('b', new Date() as never)).rejects.toMatchObject(INVALID);
  });
});

describe('logTextChangeEvent', () => {
  it('masks the text with one X per code point by default', async () => {
    const native = makeNative();
    await createAcousticConnect(native).logTextChangeEvent('txt', { text: 'hunter2' });
    expect(native.logCustomEvent).toHaveBeenCalledWith({
      eventName: 'textChange',
      values: { controlId: 'txt', text: 'XXXXXXX', masked: true },
      level: 3,
    });
  });

  it('counts an emoji as one character', async () => {
    const native = makeNative();
    await createAcousticConnect(native).logTextChangeEvent('txt', { text: 'a😀b' });
    expect((native.logCustomEvent.mock.calls[0][0] as { values: { text: string } }).values.text).toBe('XXX');
  });

  it('never lets the plaintext reach the native side when masked', async () => {
    const native = makeNative();
    await createAcousticConnect(native).logTextChangeEvent('txt', { text: 'hunter2-secret' });
    expect(JSON.stringify(native.logCustomEvent.mock.calls)).not.toContain('hunter2');
  });

  it('sends the text as typed with masked: false', async () => {
    const native = makeNative();
    await createAcousticConnect(native).logTextChangeEvent('txt', { text: 'ok', masked: false });
    expect(native.logCustomEvent).toHaveBeenCalledWith({
      eventName: 'textChange',
      values: { controlId: 'txt', text: 'ok', masked: false },
      level: 3,
    });
  });

  it('sends only the control id when there is no text', async () => {
    const native = makeNative();
    await createAcousticConnect(native).logTextChangeEvent('txt');
    expect(native.logCustomEvent).toHaveBeenCalledWith({
      eventName: 'textChange',
      values: { controlId: 'txt' },
      level: 3,
    });
  });

  it('rejects a blank id, options that are not an object, a text that is not a string and masked that is not a boolean', async () => {
    const api = createAcousticConnect(makeNative());
    await expect(api.logTextChangeEvent('')).rejects.toMatchObject(INVALID);
    await expect(api.logTextChangeEvent('t', 'x' as never)).rejects.toMatchObject(INVALID);
    await expect(api.logTextChangeEvent('t', { text: 5 } as never)).rejects.toMatchObject(INVALID);
    await expect(api.logTextChangeEvent('t', { text: 'a', masked: 'yes' } as never)).rejects.toMatchObject(INVALID);
  });
});

describe('logSignal', () => {
  it('carries nested objects, arrays, null and scalars unchanged, with the default level', async () => {
    const native = makeNative();
    const values = {
      signalContent: { signalType: 'pageview' },
      audience: [{ name: 'Account ID', value: '42' }],
      count: 3,
      flag: false,
      nothing: null,
    };
    await createAcousticConnect(native).logSignal(values, 1);
    expect(native.logSignal).toHaveBeenCalledWith({ values, level: 1 });
    await createAcousticConnect(native).logSignal({});
    expect(native.logSignal).toHaveBeenLastCalledWith({ values: {}, level: 3 });
  });

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  it.each([
    ['null', null],
    ['string', 'x'],
    ['array', [1]],
    ['Date', new Date()],
    ['function value', { a: () => 1 }],
    ['undefined value', { a: undefined }],
    ['NaN', { a: NaN }],
    ['nested Infinity', { a: { b: [1, Infinity] } }],
    ['bigint', { a: BigInt(1) }],
    ['symbol', { a: Symbol('s') }],
    ['circular', cyclic],
  ])('rejects %s', async (_label, values) => {
    const native = makeNative();
    await expect(createAcousticConnect(native).logSignal(values as never)).rejects.toMatchObject(INVALID);
    expect(native.logSignal).not.toHaveBeenCalled();
  });

  it.each([[-1], [1.5], [NaN], ['3'], [null]])('rejects the level %j', async (level) => {
    await expect(createAcousticConnect(makeNative()).logSignal({ a: 1 }, level as never)).rejects.toMatchObject(
      INVALID,
    );
  });
});

describe('logExceptionEvent', () => {
  it('sends the message, an empty stack and unhandled false by default', async () => {
    const native = makeNative();
    await createAcousticConnect(native).logExceptionEvent('boom');
    expect(native.logExceptionEvent).toHaveBeenCalledWith({ message: 'boom', stackInfo: '', unhandled: false });
  });

  it('carries the stack and the unhandled flag', async () => {
    const native = makeNative();
    await createAcousticConnect(native).logExceptionEvent('boom', 'Error: boom\n at x', true);
    expect(native.logExceptionEvent).toHaveBeenCalledWith({
      message: 'boom',
      stackInfo: 'Error: boom\n at x',
      unhandled: true,
    });
  });

  it('rejects a blank message, a stack that is not a string and unhandled that is not a boolean', async () => {
    const api = createAcousticConnect(makeNative());
    await expect(api.logExceptionEvent(' ')).rejects.toMatchObject(INVALID);
    await expect(api.logExceptionEvent('m', 5 as never)).rejects.toMatchObject(INVALID);
    await expect(api.logExceptionEvent('m', '', 'no' as never)).rejects.toMatchObject(INVALID);
  });
});

describe('logScreenLayout', () => {
  it('sends the name alone, or the name and the delay', async () => {
    const native = makeNative();
    const api = createAcousticConnect(native);
    await api.logScreenLayout('Home');
    expect(native.logScreenLayout).toHaveBeenLastCalledWith({ name: 'Home' });
    await api.logScreenLayout('Home', 300);
    expect(native.logScreenLayout).toHaveBeenLastCalledWith({ name: 'Home', delayMs: 300 });
    await api.logScreenLayout('Home', 0);
    expect(native.logScreenLayout).toHaveBeenLastCalledWith({ name: 'Home', delayMs: 0 });
  });

  it.each([[''], ['  '], [undefined], [null], [3]])('rejects the name %j', async (name) => {
    const native = makeNative();
    await expect(createAcousticConnect(native).logScreenLayout(name as never)).rejects.toMatchObject(INVALID);
    expect(native.logScreenLayout).not.toHaveBeenCalled();
  });

  it.each([[-1], [1.5], ['10'], [Number.NaN], [null]])('rejects the delay %j', async (delay) => {
    const native = makeNative();
    await expect(createAcousticConnect(native).logScreenLayout('Home', delay as never)).rejects.toMatchObject(INVALID);
    expect(native.logScreenLayout).not.toHaveBeenCalled();
  });
});

describe('screen view context', () => {
  it('sends the page name and the referrer, null when there is none', async () => {
    const native = makeNative();
    const api = createAcousticConnect(native);
    await api.logScreenViewContextLoad('checkout', 'cart');
    await api.logScreenViewContextUnload('cart');
    expect(native.logScreenViewContextLoad).toHaveBeenCalledWith({ logicalPageName: 'checkout', referrer: 'cart' });
    expect(native.logScreenViewContextUnload).toHaveBeenCalledWith({ logicalPageName: 'cart', referrer: null });
  });

  it.each([[''], ['  '], [undefined], [null], [3]])('rejects the page name %j', async (name) => {
    const api = createAcousticConnect(makeNative());
    await expect(api.logScreenViewContextLoad(name as never)).rejects.toMatchObject(INVALID);
    await expect(api.logScreenViewContextUnload(name as never)).rejects.toMatchObject(INVALID);
  });

  it('treats a blank referrer as none and rejects one that is not a string', async () => {
    const native = makeNative();
    const api = createAcousticConnect(native);
    await api.logScreenViewContextLoad('a', '  ');
    expect(native.logScreenViewContextLoad).toHaveBeenCalledWith({ logicalPageName: 'a', referrer: null });
    await expect(api.logScreenViewContextLoad('a', 5 as never)).rejects.toMatchObject(INVALID);
  });
});

describe('config items', () => {
  it.each([[true], [false], ['text'], [''], [5], [0], [0.5], [-3]])(
    'setConfigItem passes %j through',
    async (value) => {
      const native = makeNative();
      await createAcousticConnect(native).setConfigItem('Key', value, 'EOCore');
      expect(native.setConfigItem).toHaveBeenCalledWith({ key: 'Key', value, moduleName: 'EOCore' });
    },
  );

  it.each([
    ['blank key', '', true, 'M'],
    ['numeric key', 5, true, 'M'],
    ['object value', 'K', { a: 1 }, 'M'],
    ['null value', 'K', null, 'M'],
    ['NaN value', 'K', NaN, 'M'],
    ['Infinity value', 'K', Infinity, 'M'],
    ['missing module', 'K', true, undefined],
    ['blank module', 'K', true, ' '],
  ])('setConfigItem rejects %s', async (_label, key, value, mod) => {
    const native = makeNative();
    await expect(
      createAcousticConnect(native).setConfigItem(key as never, value as never, mod as never),
    ).rejects.toMatchObject(INVALID);
    expect(native.setConfigItem).not.toHaveBeenCalled();
  });

  it('getConfigItem asks for the raw item by key and module', async () => {
    const native = makeNative({ getConfigItem: jest.fn().mockResolvedValue({ value: 'true' }) });
    await createAcousticConnect(native).getConfigItem('K', false, 'EOCore');
    expect(native.getConfigItem).toHaveBeenCalledWith({ key: 'K', moduleName: 'EOCore' });
  });

  const read = (raw: unknown, def: boolean | string | number) =>
    createAcousticConnect(makeNative({ getConfigItem: jest.fn().mockResolvedValue({ value: raw }) })).getConfigItem(
      'K',
      def as never,
      'M',
    );

  it.each([
    ['true', true],
    ['false', false],
    ['TRUE', true],
    ['False', false],
    [true, true],
    [false, false],
  ])('reads boolean %j as %s', async (raw, expected) => {
    await expect(read(raw, !expected)).resolves.toBe(expected);
  });

  it('keeps a stored false although the default is true', async () => {
    await expect(read('false', true)).resolves.toBe(false);
  });

  it.each([
    ['5', 5],
    ['0', 0],
    ['-2', -2],
    ['0.25', 0.25],
    [' 7 ', 7],
    [3, 3],
  ])('reads number %j as %s', async (raw, expected) => {
    await expect(read(raw, 99)).resolves.toBe(expected);
  });

  it('returns a string as stored', async () => {
    await expect(read('https://x.test/a b', 'd')).resolves.toBe('https://x.test/a b');
  });

  it.each([[undefined], [null], ['']])('returns the default when the item is not set (%j)', async (raw) => {
    await expect(read(raw, true)).resolves.toBe(true);
    await expect(read(raw, 12)).resolves.toBe(12);
    await expect(read(raw, 'fallback')).resolves.toBe('fallback');
  });

  it('returns the default when nothing came back at all', async () => {
    const native = makeNative({ getConfigItem: jest.fn().mockResolvedValue({}) });
    await expect(createAcousticConnect(native).getConfigItem('K', 7, 'M')).resolves.toBe(7);
  });

  it.each([
    ['maybe', true, true],
    ['abc', 8, 8],
    ['Infinity', 8, 8],
  ])('returns the default when %j does not fit the type', async (raw, def, expected) => {
    await expect(read(raw, def as never)).resolves.toBe(expected);
  });

  it.each([
    ['blank key', '', true, 'M'],
    ['null default', 'K', null, 'M'],
    ['object default', 'K', {}, 'M'],
    ['NaN default', 'K', NaN, 'M'],
    ['missing module', 'K', true, undefined],
  ])('getConfigItem rejects %s', async (_label, key, def, mod) => {
    await expect(
      createAcousticConnect(makeNative()).getConfigItem(key as never, def as never, mod as never),
    ).rejects.toMatchObject(INVALID);
  });
});

describe('push', () => {
  it('requestPermission returns the native result', async () => {
    const native = makeNative({
      pushRequestPermission: jest.fn().mockResolvedValue({ granted: false, error: 'denied' }),
    });
    await expect(createAcousticConnect(native).push.requestPermission()).resolves.toEqual({
      granted: false,
      error: 'denied',
    });
  });

  it.each([[true], [false], [null]])('getPermissionState unwraps %j', async (state) => {
    const native = makeNative({ pushGetPermissionState: jest.fn().mockResolvedValue({ value: state }) });
    await expect(createAcousticConnect(native).push.getPermissionState()).resolves.toBe(state);
  });

  it('didReceiveAuthorization resolves false without calling the native side when granted is null or undefined', async () => {
    const native = makeNative();
    const api = createAcousticConnect(native);
    await expect(api.push.didReceiveAuthorization(null)).resolves.toBe(false);
    await expect(api.push.didReceiveAuthorization(undefined as never)).resolves.toBe(false);
    expect(native.pushDidReceiveAuthorization).not.toHaveBeenCalled();
  });

  it('didReceiveAuthorization sends the flag and the error, null when there is none', async () => {
    const native = makeNative();
    await createAcousticConnect(native).push.didReceiveAuthorization(true);
    await createAcousticConnect(native).push.didReceiveAuthorization(false, 'denied');
    expect(native.pushDidReceiveAuthorization).toHaveBeenNthCalledWith(1, { granted: true, error: null });
    expect(native.pushDidReceiveAuthorization).toHaveBeenNthCalledWith(2, { granted: false, error: 'denied' });
  });

  it('didReceiveNotification and didReceiveResponse unwrap the boolean', async () => {
    const native = makeNative({
      pushDidReceiveNotification: jest.fn().mockResolvedValue({ value: false }),
      pushDidReceiveResponse: jest.fn().mockResolvedValue({ value: true }),
    });
    const api = createAcousticConnect(native);
    await expect(api.push.didReceiveNotification({ k: 'v' })).resolves.toBe(false);
    await expect(api.push.didReceiveResponse('open', { k: 'v' })).resolves.toBe(true);
    expect(native.pushDidReceiveNotification).toHaveBeenCalledWith({ userInfo: { k: 'v' } });
    expect(native.pushDidReceiveResponse).toHaveBeenCalledWith({ actionIdentifier: 'open', userInfo: { k: 'v' } });
  });

  // manual mode on iOS: the app got the APNs token (or the error) from the system and hands it over
  describe('didRegisterWithToken', () => {
    it.each([['0a1b2c3d'.repeat(8)], ['ABCDEF0123456789'.repeat(4)], ['a'.repeat(64)], ['b'.repeat(200)]])(
      'sends the hex token %s',
      async (token) => {
        const native = makeNative();
        await expect(createAcousticConnect(native).push.didRegisterWithToken(token)).resolves.toBe(true);
        expect(native.pushDidRegisterWithToken).toHaveBeenCalledWith({ token });
      },
    );

    it('unwraps the answer of the native side', async () => {
      const native = makeNative({ pushDidRegisterWithToken: jest.fn().mockResolvedValue({ value: false }) });
      await expect(createAcousticConnect(native).push.didRegisterWithToken('0a1b'.repeat(16))).resolves.toBe(false);
    });

    it.each([
      [''],
      ['  '],
      ['xyz'],
      ['abc'],
      ['0a 1b'],
      ['0a'],
      ['0a1b2c3d'],
      ['a'.repeat(62)],
      [undefined],
      [null],
      [12],
      [{}],
    ])('rejects %j before it reaches the native side: a token is at least 32 bytes, as hex digits', async (token) => {
      const native = makeNative();
      await expect(createAcousticConnect(native).push.didRegisterWithToken(token as never)).rejects.toMatchObject(
        INVALID,
      );
      expect(native.pushDidRegisterWithToken).not.toHaveBeenCalled();
    });
  });

  describe('didFailToRegister', () => {
    it('sends the error text, null when there is none', async () => {
      const native = makeNative();
      const api = createAcousticConnect(native);
      await expect(api.push.didFailToRegister('no network')).resolves.toBe(true);
      await api.push.didFailToRegister();
      await api.push.didFailToRegister(null);
      expect(native.pushDidFailToRegister).toHaveBeenNthCalledWith(1, { error: 'no network' });
      expect(native.pushDidFailToRegister).toHaveBeenNthCalledWith(2, { error: null });
      expect(native.pushDidFailToRegister).toHaveBeenNthCalledWith(3, { error: null });
    });

    it.each([[12], [{}], [true]])('rejects %j: the error is a string', async (error) => {
      const native = makeNative();
      await expect(createAcousticConnect(native).push.didFailToRegister(error as never)).rejects.toMatchObject(INVALID);
      expect(native.pushDidFailToRegister).not.toHaveBeenCalled();
    });
  });
});

describe('errors', () => {
  it('passes a native rejection through untouched', async () => {
    const nativeError = { code: 'ACOUSTIC_INTERNAL_ERROR', message: 'SDK not enabled' };
    const native = makeNative({ logCustomEvent: jest.fn().mockRejectedValue(nativeError) });
    await expect(createAcousticConnect(native).logCustomEvent('e')).rejects.toBe(nativeError);
  });

  it("a validation error is a plain { code, message } object, like the Cordova plugin's", async () => {
    const error = await createAcousticConnect(makeNative())
      .logCustomEvent('')
      .catch((e) => e);
    expect(Object.keys(error).sort()).toEqual(['code', 'message']);
    expect(error.message).toContain('logCustomEvent');
  });

  it('never calls the native side for an invalid call', async () => {
    const native = makeNative();
    await createAcousticConnect(native)
      .logSignal(null as never)
      .catch(() => undefined);
    for (const fn of Object.values(native))
      expect(fn).not.toHaveBeenCalledWith(expect.objectContaining({ values: expect.anything() }));
  });
});
