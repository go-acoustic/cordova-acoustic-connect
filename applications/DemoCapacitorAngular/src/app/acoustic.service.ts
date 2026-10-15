import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import type { FlatValue, SignalValues, TextChangeOptions } from 'capacitor-acoustic-connect';
import { AcousticConnect } from 'capacitor-acoustic-connect';
import { DEMO_ENABLE } from './acoustic-demo.config';

const SDK_WAIT_TRIES = 30;
const SDK_WAIT_MS = 1000;

/**
 * The one place where the app talks to the Acoustic Connect plugin: a thin method per call of the plugin that returns the plugin's promise
 * (it resolves when the SDK has queued the message and rejects with `{ code, message }`). The screens decide how to show the result.
 * tests/angular_demo_parity.test.ts in the plugin checks that every public call of the plugin has a method here.
 */
@Injectable({ providedIn: 'root' })
export class AcousticService {
  readonly platform = Capacitor.getPlatform();
  readonly sdkEnabled = signal(false);
  readonly sdkNotStarted = signal(false);
  readonly versionInfo = signal('capacitor-acoustic-connect');
  /** The plugin itself, for code that takes it as an argument (behaviour-core.ts). */
  readonly plugin = AcousticConnect;

  /** The plugin starts the SDK from capacitor.config.json when the app launches; wait until it reports enabled. */
  async waitForSdk(): Promise<void> {
    for (let i = 0; i < SDK_WAIT_TRIES; i++) {
      try {
        if (await AcousticConnect.isSdkEnabled()) {
          this.sdkEnabled.set(true);
          return;
        }
      } catch {
        // not up yet, or not available in a browser
      }
      await new Promise((resolve) => setTimeout(resolve, SDK_WAIT_MS));
    }
    this.sdkNotStarted.set(true);
  }

  /** The plugin and, under it, the native Connect SDK's own version for the running platform. */
  showVersionInfo(): void {
    const label = this.platform === 'android' ? 'Android' : this.platform === 'ios' ? 'iOS' : 'web';
    this.versionInfo.set('capacitor-acoustic-connect');
    AcousticConnect.getSdkVersion()
      .then((version) => this.versionInfo.set(`capacitor-acoustic-connect · ${label} SDK v${version}`))
      .catch(() => undefined); // the native version is a bonus, and unavailable in a browser
  }

  // SDK
  enable = () => AcousticConnect.enable(DEMO_ENABLE.appKey, DEMO_ENABLE.postURL);
  disable = () => AcousticConnect.disable();
  getSdkVersion = () => AcousticConnect.getSdkVersion();
  isSdkEnabled = () => AcousticConnect.isSdkEnabled();
  setLogLevel = (level: 'silent' | 'error' | 'warn' | 'info' | 'verbose') => AcousticConnect.setLogLevel(level);
  flushQueues = () => AcousticConnect.flushQueues();

  // Screens
  setCurrentScreenName = (name: string) => AcousticConnect.setCurrentScreenName(name);
  screenLoad = (name: string, referrer: string | null) => AcousticConnect.logScreenViewContextLoad(name, referrer);
  screenUnload = (name: string, referrer: string | null) => AcousticConnect.logScreenViewContextUnload(name, referrer);
  screenLayout = (name: string, delayMs?: number) => AcousticConnect.logScreenLayout(name, delayMs);

  // Events
  customEvent = (name: string, values: Record<string, FlatValue>, level?: number) => AcousticConnect.logCustomEvent(name, values, level);
  click = (controlId: string, data?: Record<string, FlatValue>) => AcousticConnect.logClickEvent(controlId, data);
  /** Masked by default: the SDK sends one X per character. Pass `masked: false` to send the text as typed. */
  textChange = (controlId: string, options: TextChangeOptions) => AcousticConnect.logTextChangeEvent(controlId, options);
  signal = (values: SignalValues, level?: number) => AcousticConnect.logSignal(values, level);
  identity = (name: string, value: string, signalType?: string, additionalParameters?: Record<string, unknown>) =>
    AcousticConnect.logIdentity(name, value, signalType, additionalParameters);
  exception = (message: string, stackInfo?: string, unhandled?: boolean) => AcousticConnect.logExceptionEvent(message, stackInfo, unhandled);

  // Settings. The module name on Android is "EOCore"; iOS ignores it.
  setConfigItem = (key: string, value: FlatValue, module: string) => AcousticConnect.setConfigItem(key, value, module);
  getConfigItem = (key: string, defaultValue: string, module: string) => AcousticConnect.getConfigItem(key, defaultValue, module);

  // Push. Tapping a notification is handled by the SDK. The calls after the first two are for the iOS `manual` push mode
  // (iosPushMode: 'manual'): the app hands the SDK what the system gives it; in any other mode, and on Android, they reject
  // with ACOUSTIC_PUSH_MODE_NOT_MANUAL.
  pushPermissionState = () => AcousticConnect.push.getPermissionState();
  pushRequestPermission = () => AcousticConnect.push.requestPermission();
  pushDidReceiveAuthorization = () => AcousticConnect.push.didReceiveAuthorization(true, null);
  pushDidRegisterWithToken = () => AcousticConnect.push.didRegisterWithToken('00112233445566778899aabbccddeeff');
  pushDidFailToRegister = () => AcousticConnect.push.didFailToRegister('sample error');
  pushDidReceiveNotification = () =>
    AcousticConnect.push.didReceiveNotification({ aps: { alert: { title: 'Sample', body: 'Sample push' } } });
  pushDidReceiveResponse = () =>
    AcousticConnect.push.didReceiveResponse('com.apple.UNNotificationDefaultActionIdentifier', { aps: { alert: 'Sample' } });
}
