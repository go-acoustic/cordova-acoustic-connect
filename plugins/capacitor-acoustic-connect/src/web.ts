import { WebPlugin } from '@capacitor/core';

import type { AcousticConnectPlugin } from './definitions';

/**
 * The web implementation, for an app that runs in a browser (`ionic serve`, a PWA). There is no native
 * SDK there: the calls that only record something resolve and do nothing, so the same code runs
 * unchanged; the ones that need the SDK report "unavailable", as Capacitor plugins do.
 */
export class AcousticConnectWeb extends WebPlugin implements AcousticConnectPlugin {
  async enable(): Promise<void> {
    // Nothing to record without the native SDK.
  }
  async disable(): Promise<void> {
    // Nothing to record without the native SDK.
  }
  async setLogLevel(): Promise<void> {
    // Nothing to record without the native SDK.
  }
  async flushQueues(): Promise<void> {
    // Nothing to record without the native SDK.
  }
  async setCurrentScreenName(): Promise<void> {
    // Nothing to record without the native SDK.
  }
  async logCustomEvent(): Promise<void> {
    // Nothing to record without the native SDK.
  }
  async logSignal(): Promise<void> {
    // Nothing to record without the native SDK.
  }
  async logExceptionEvent(): Promise<void> {
    // Nothing to record without the native SDK.
  }
  async logScreenViewContextLoad(): Promise<void> {
    // Nothing to record without the native SDK.
  }
  async logScreenViewContextUnload(): Promise<void> {
    // Nothing to record without the native SDK.
  }
  async logScreenLayout(): Promise<void> {
    // Nothing to record without the native SDK.
  }
  async setConfigItem(): Promise<void> {
    // Nothing to record without the native SDK.
  }

  async isSdkEnabled(): Promise<{ value: boolean }> {
    return { value: false };
  }

  async logIdentity(): Promise<void> {
    // Nothing to record without the native SDK.
  }
  async getSdkVersion(): Promise<{ value: string }> {
    throw this.unavailable('getSdkVersion is unavailable on the web: there is no native SDK.');
  }
  async getConfigItem(): Promise<{ value?: string | number | boolean | null }> {
    throw this.unavailable('getConfigItem is unavailable on the web: there is no native SDK.');
  }
  async pushRequestPermission(): Promise<{ granted: boolean; error?: string }> {
    throw this.unavailable('pushRequestPermission is unavailable on the web.');
  }
  async pushGetPermissionState(): Promise<{ value: boolean | null }> {
    throw this.unavailable('pushGetPermissionState is unavailable on the web.');
  }
  async pushDidReceiveAuthorization(): Promise<{ value: boolean }> {
    throw this.unavailable('pushDidReceiveAuthorization is unavailable on the web.');
  }
  async pushDidReceiveNotification(): Promise<{ value: boolean }> {
    throw this.unavailable('pushDidReceiveNotification is unavailable on the web.');
  }
  async pushDidReceiveResponse(): Promise<{ value: boolean }> {
    throw this.unavailable('pushDidReceiveResponse is unavailable on the web.');
  }
  async pushDidRegisterWithToken(): Promise<{ value: boolean }> {
    throw this.unavailable('pushDidRegisterWithToken is unavailable on the web.');
  }
  async pushDidFailToRegister(): Promise<{ value: boolean }> {
    throw this.unavailable('pushDidFailToRegister is unavailable on the web.');
  }
}
