import { Capacitor, registerPlugin } from '@capacitor/core';

import { createAcousticConnect } from './api';
import type { AcousticConnectPlugin } from './definitions';
import { installTltStub } from './tlt-stub';

installTltStub(typeof window === 'undefined' ? undefined : window, Capacitor.getPlatform());

/** The native plugin: one options object per method. Most apps use {@link AcousticConnect}. */
const AcousticConnectNative = registerPlugin<AcousticConnectPlugin>('AcousticConnect', {
  web: () => import('./web').then((m) => new m.AcousticConnectWeb()),
});

/** The Cordova plugin's API (positional arguments, plain return values) on the Capacitor plugin. */
const AcousticConnect = createAcousticConnect(AcousticConnectNative);

export * from './definitions';
export { AcousticConnect, AcousticConnectNative, createAcousticConnect };
