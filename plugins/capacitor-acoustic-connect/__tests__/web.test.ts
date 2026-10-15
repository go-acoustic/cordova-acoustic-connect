/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Tests for the web implementation: an app that runs in a browser (ionic serve, a PWA) calls the same
 * methods. The ones that only record something resolve and do nothing; the ones that need the native
 * SDK report "unavailable", the way Capacitor plugins do.
 */

import { AcousticConnectWeb } from '../src/web';

const DOES_NOTHING: [string, unknown][] = [
  ['enable', { appKey: 'k', postURL: 'u', pushMode: 'automatic' }],
  ['disable', undefined],
  ['setLogLevel', { level: 'info' }],
  ['flushQueues', undefined],
  ['setCurrentScreenName', { name: 'home' }],
  ['logCustomEvent', { eventName: 'e', values: {}, level: 3 }],
  ['logSignal', { values: { a: 1 }, level: 3 }],
  ['logExceptionEvent', { message: 'm', stackInfo: '', unhandled: false }],
  ['logScreenViewContextLoad', { logicalPageName: 'a', referrer: null }],
  ['logScreenViewContextUnload', { logicalPageName: 'a', referrer: null }],
  ['logScreenLayout', { name: 'a' }],
  ['setConfigItem', { key: 'K', value: true, moduleName: 'M' }],
  // an unguarded await in a login flow must not break in a browser, so the identity signal is recorded like the others
  [
    'logIdentity',
    { identifierName: 'Email', identifierValue: 'a@b.test', signalType: 'loggedIn', additionalParameters: {} },
  ],
];

const UNAVAILABLE: [string, unknown][] = [
  ['getSdkVersion', undefined],
  ['getConfigItem', { key: 'K', moduleName: 'M' }],
  ['pushRequestPermission', undefined],
  ['pushGetPermissionState', undefined],
  ['pushDidReceiveAuthorization', { granted: true, error: null }],
  ['pushDidReceiveNotification', { userInfo: {} }],
  ['pushDidReceiveResponse', { actionIdentifier: 'a', userInfo: {} }],
  ['pushDidRegisterWithToken', { token: '0a1b' }],
  ['pushDidFailToRegister', { error: null }],
];

type Loose = Record<string, (options?: unknown) => Promise<unknown>>;

describe('AcousticConnectWeb', () => {
  const web = new AcousticConnectWeb() as unknown as Loose;

  it.each(DOES_NOTHING)('%s resolves and does nothing', async (method, options) => {
    await expect(web[method](options)).resolves.toBeUndefined();
  });

  it('isSdkEnabled says the SDK is not enabled, since there is none', async () => {
    await expect(web.isSdkEnabled()).resolves.toEqual({ value: false });
  });

  it.each(UNAVAILABLE)('%s reports unavailable', async (method, options) => {
    await expect(web[method](options)).rejects.toMatchObject({
      code: 'UNAVAILABLE',
      message: expect.stringContaining(method),
    });
  });

  it('classifies every method of the plugin, so a new native method cannot be forgotten here', () => {
    const covered = new Set([...DOES_NOTHING, ...UNAVAILABLE].map(([name]) => name).concat('isSdkEnabled'));
    const own = Object.getOwnPropertyNames(AcousticConnectWeb.prototype).filter((n) => n !== 'constructor');
    expect(own.sort()).toEqual([...covered].sort());
  });
});
