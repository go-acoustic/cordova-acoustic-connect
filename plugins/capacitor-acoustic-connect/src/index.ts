import { Capacitor, registerPlugin } from '@capacitor/core';

import { createAcousticConnect } from './api';
import type { AcousticConnectPlugin } from './definitions';
import { installTltStub } from './tlt-stub';
import { installWebGestures } from './web-gestures';

installTltStub(typeof window === 'undefined' ? undefined : window, Capacitor.getPlatform());

/** The native plugin: one options object per method. Most apps use {@link AcousticConnect}. */
const AcousticConnectNative = registerPlugin<AcousticConnectPlugin>('AcousticConnect', {
  web: () => import('./web').then((m) => new m.AcousticConnectWeb()),
});

/** The Cordova plugin's API (positional arguments, plain return values) on the Capacitor plugin. */
const AcousticConnect = createAcousticConnect(AcousticConnectNative);

// Taps and gestures on page elements, logged by the native SDK, in the app's main frame, on Android and iOS. An SDK that cannot log
// them (Android older than 11.1.39-beta, iOS older than 2.2.35) queues nothing.
if (typeof window !== 'undefined' && window.top === window && Capacitor.isNativePlatform()) {
  installWebGestures(window, (event) => {
    AcousticConnectNative.logWebEvent(event).catch(() => undefined);
  });
}

export * from './definitions';
export { AcousticConnect, AcousticConnectNative, createAcousticConnect };
