/// <reference types="@capacitor/cli" />

/** Log level of the plugin bridge. */
export type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'verbose';

/** How push is wired: the SDK does it (`automatic`) or the app forwards the events (`manual`, iOS). */
export type PushMode = 'automatic' | 'manual';

/** The error a validation failure rejects with (a native failure keeps its own `code` and `message`). */
export interface AcousticError {
  /** `ACOUSTIC_INVALID_ARGS`, `ACOUSTIC_INTERNAL_ERROR` or `ACOUSTIC_PUSH_MODE_NOT_MANUAL`. */
  code: string;
  message: string;
}

/** A value of a custom event or a config item: no nesting, no `null`. */
export type FlatValue = string | number | boolean;

/** A JSON value, as a signal carries it. */
export type SignalValue = string | number | boolean | null | SignalValue[] | { [key: string]: SignalValue };

/** A signal payload: a JSON object, nested values allowed. */
export type SignalValues = { [key: string]: SignalValue };

export interface EnableOptions {
  /** iOS: the App Group shared with the notification extensions. */
  iosAppGroupIdentifier?: string;
  /** Android: the resource name of the notification icon. */
  androidIconResName?: string;
}

export interface TextChangeOptions {
  /** The text. It is masked (one `X` per character) unless `masked` is `false`. */
  text?: string;
  /** Send the text as typed. Defaults to `true` (masked). */
  masked?: boolean;
}

export interface PushPermissionResult {
  granted: boolean;
  error?: string;
}

/**
 * The native plugin. Capacitor passes one options object per method and resolves an object, so a
 * boolean or a string comes back as `{ value }`. Apps use {@link AcousticConnectApi}, which is
 * built on this and keeps the positional arguments of the Cordova plugin.
 */
export interface AcousticConnectPlugin {
  /** `pushMode` left out takes the value from `capacitor.config`, else `automatic`. */
  enable(options: { appKey: string; postURL: string; pushMode?: PushMode } & EnableOptions): Promise<void>;
  disable(): Promise<void>;
  setLogLevel(options: { level: LogLevel }): Promise<void>;
  logIdentity(options: {
    identifierName: string;
    identifierValue: string;
    signalType: string;
    additionalParameters: Record<string, unknown>;
  }): Promise<void>;
  getSdkVersion(): Promise<{ value: string }>;
  isSdkEnabled(): Promise<{ value: boolean }>;
  flushQueues(): Promise<void>;
  setCurrentScreenName(options: { name: string }): Promise<void>;
  logCustomEvent(options: { eventName: string; values: Record<string, FlatValue>; level: number }): Promise<void>;
  logSignal(options: { values: SignalValues; level: number }): Promise<void>;
  logExceptionEvent(options: { message: string; stackInfo: string; unhandled: boolean }): Promise<void>;
  logScreenViewContextLoad(options: { logicalPageName: string; referrer: string | null }): Promise<void>;
  logScreenViewContextUnload(options: { logicalPageName: string; referrer: string | null }): Promise<void>;
  logScreenLayout(options: { name: string; delayMs?: number }): Promise<void>;
  logLocation(): Promise<void>;
  logLocationUpdate(options: { latitude: number; longitude: number; level: number }): Promise<void>;
  setConfigItem(options: { key: string; value: FlatValue; moduleName: string }): Promise<void>;
  /** Resolves the raw item; the API applies the type of the default. Nothing when it is not set. */
  getConfigItem(options: { key: string; moduleName: string }): Promise<{ value?: FlatValue | null }>;
  pushRequestPermission(): Promise<PushPermissionResult>;
  pushGetPermissionState(): Promise<{ value: boolean | null }>;
  pushDidReceiveAuthorization(options: { granted: boolean; error: string | null }): Promise<{ value: boolean }>;
  pushDidReceiveNotification(options: { userInfo: Record<string, unknown> }): Promise<{ value: boolean }>;
  pushDidReceiveResponse(options: {
    actionIdentifier: string;
    userInfo: Record<string, unknown>;
  }): Promise<{ value: boolean }>;
  /** `token` is the APNs device token as hex digits. */
  pushDidRegisterWithToken(options: { token: string }): Promise<{ value: boolean }>;
  pushDidFailToRegister(options: { error: string | null }): Promise<{ value: boolean }>;
}

/** The SDK's screen-capture rules: the sections the native SDKs read, as JSON. */
export interface LayoutConfig {
  AutoLayout?: Record<string, unknown>;
  AppendMapIds?: Record<string, unknown>;
}

/**
 * The `plugins.AcousticConnect` block of `capacitor.config.ts`. `cap sync` copies it into the native
 * projects, where the plugin reads it when it loads. Every key is optional.
 *
 * With `appKey` and `postMessageUrl` set the SDK starts when the plugin loads, before the first screen
 * resumes, so that screen's automatic screen view and layout are captured; `enable()` from JavaScript
 * then resolves without starting it again. Without them, call `enable()` yourself.
 */
export interface AcousticConnectConfig {
  appKey?: string;
  /** The collector's post URL. */
  postMessageUrl?: string;
  /** Set `false` to start the SDK from JavaScript only, even when the two keys above are set. Defaults to `true`. */
  autoEnable?: boolean;
  /**
   * `true` in production builds: turns the native SDK's own logging off and, on Android, builds against Maven
   * Central only and rejects `-beta` SDK versions (set a release `connectSdkVersion` first). Defaults to `false`.
   */
  useRelease?: boolean;
  /**
   * Pins another Connect Android SDK than the plugin's default, as `x.y.z` or `x.y.z-beta` (the Cordova plugin's `AndroidVersion`). Empty or
   * left out keeps the default. The Gradle property `connectSdkVersion` wins over it. It has to be in the supported range (11.0.21 up to 12);
   * a wrong value stops the build. Read when Android builds.
   */
  androidVersion?: string;
  /**
   * Pins another Connect iOS SDK than the plugin's, as `x.y.z` (the Cordova plugin's `iOSVersion`), not below the plugin's own pin. Empty or left
   * out keeps the pin. Read when `pod install` runs, so it applies to an app that uses CocoaPods; with Swift Package Manager the plugin's
   * `Package.swift` fixes the version and this has no effect.
   */
  iosVersion?: string;
  /** The SDK's remote kill switch. Off unless set: the SDKs ship with it on. */
  killSwitchEnabled?: boolean;
  killSwitchUrl?: string;
  /** `null` or left out keeps the SDK's own default; only an explicit value acts. */
  locationLoggingEnabled?: boolean | null;
  /** `false` turns automatic layout and screenshot capture off (screen views keep flowing). `null` or left out keeps the SDK default. */
  screenCaptureEnabled?: boolean | null;
  /**
   * Push is opt-in. Off (the default), the Android build uses the analytics-only Connect artifact and pulls
   * in no Firebase, and iOS runs the SDK without push. On, Android builds with the FCM push artifact (the app
   * needs its `google-services.json`) and iOS uses `iosPushMode`. Android reads it when it builds, so after
   * changing it run `npx cap sync` and rebuild.
   */
  pushEnabled?: boolean;
  /** Android: the drawable name of the push notification's small icon. Used when `pushEnabled` is on. */
  androidNotificationIconResName?: string;
  /** iOS: `automatic` or `manual`. Defaults to `automatic`. Used when `pushEnabled` is on. */
  iosPushMode?: PushMode;
  /** iOS: the App Group shared with the notification extensions. */
  iosAppGroupIdentifier?: string;
  /** iOS: the Team ID of your Apple developer account. Only `npx acoustic-connect setup-ios-push` reads it, to set the team on the app and the extensions. */
  iosDevelopmentTeam?: string;
  /** Screen-capture rules for both platforms. */
  layoutConfig?: LayoutConfig;
  /** Merged over `layoutConfig` on iOS. */
  layoutConfigIos?: LayoutConfig;
  /**
   * Merged over `layoutConfig` on Android and written, at build time, to the `ConnectLayoutConfig.json` asset the
   * SDK reads. The file replaces the SDK's own as a whole, so give a complete block (with
   * `AutoLayout.GlobalScreenSettings`); the build warns when it is missing.
   */
  layoutConfigAndroid?: LayoutConfig;
}

declare module '@capacitor/cli' {
  export interface PluginsConfig {
    AcousticConnect?: AcousticConnectConfig;
  }
}

/** The API apps call: the Cordova plugin's, with promises and plain return values. */
export interface AcousticConnectApi {
  enable(appKey: string, postURL: string, pushMode?: PushMode, options?: EnableOptions): Promise<void>;
  disable(): Promise<void>;
  setLogLevel(level: LogLevel): Promise<void>;
  logIdentity(
    identifierName: string,
    identifierValue: string,
    signalType?: string,
    additionalParameters?: Record<string, unknown>,
  ): Promise<void>;
  getSdkVersion(): Promise<string>;
  isSdkEnabled(): Promise<boolean>;
  flushQueues(): Promise<void>;
  setCurrentScreenName(name: string): Promise<void>;
  logCustomEvent(eventName: string, values?: Record<string, FlatValue>, level?: number): Promise<void>;
  logClickEvent(controlId: string, data?: Record<string, FlatValue>): Promise<void>;
  logTextChangeEvent(controlId: string, options?: TextChangeOptions): Promise<void>;
  logSignal(values: SignalValues, level?: number): Promise<void>;
  logExceptionEvent(message: string, stackInfo?: string, unhandled?: boolean): Promise<void>;
  logScreenViewContextLoad(logicalPageName: string, referrer?: string | null): Promise<void>;
  logScreenViewContextUnload(logicalPageName: string, referrer?: string | null): Promise<void>;
  /**
   * Asks the native SDK to capture the layout of the screen on display, under `name`.
   *
   * @param name Screen name, e.g. `'Login'`. Rejects with `ACOUSTIC_INVALID_ARGS` when empty.
   * @param delayMs Milliseconds to wait before capturing (a non-negative integer); omitted means now.
   */
  logScreenLayout(name: string, delayMs?: number): Promise<void>;
  /**
   * Logs the device's current location, as the native SDK reads it. Subject to the app's location permission and `locationLoggingEnabled`.
   */
  logLocation(): Promise<void>;
  /**
   * Logs a location the app already has.
   *
   * @param latitude -90 to 90.
   * @param longitude -180 to 180.
   * @param level Monitoring level, a non-negative integer; the default is 3.
   */
  logLocationUpdate(latitude: number, longitude: number, level?: number): Promise<void>;
  /** Logs that a dialog was shown, as a `DialogShowEvent` custom event (`dialogId`, `dialogTitle`, `dialogType`, `eventType`, `timestamp`). */
  logDialogShowEvent(dialogId: string, dialogTitle: string, dialogType: string): Promise<void>;
  /** Logs that a dialog was dismissed, as a `DialogDismissEvent` custom event; `dismissReason` is e.g. `'cancel'`, `'outside_touch'`, `'back'`. */
  logDialogDismissEvent(dialogId: string, dismissReason: string): Promise<void>;
  /** Logs a tap on a dialog button, as a `DialogButtonClickEvent` custom event; `buttonIndex` is the position of the button (a non-negative integer). */
  logDialogButtonClickEvent(dialogId: string, buttonText: string, buttonIndex: number): Promise<void>;
  /** Logs your own event for a dialog, as a `DialogCustomEvent` custom event; `eventName` travels as `customEventName`, `values` are extra flat values. */
  logDialogCustomEvent(dialogId: string, eventName: string, values?: Record<string, FlatValue>): Promise<void>;
  setConfigItem(key: string, value: FlatValue, moduleName: string): Promise<void>;
  getConfigItem(key: string, defaultValue: boolean, moduleName: string): Promise<boolean>;
  getConfigItem(key: string, defaultValue: string, moduleName: string): Promise<string>;
  getConfigItem(key: string, defaultValue: number, moduleName: string): Promise<number>;
  push: {
    requestPermission(): Promise<PushPermissionResult>;
    getPermissionState(): Promise<boolean | null>;
    didReceiveAuthorization(granted: boolean | null, error?: string | null): Promise<boolean>;
    didReceiveNotification(userInfo: Record<string, unknown>): Promise<boolean>;
    didReceiveResponse(actionIdentifier: string, userInfo: Record<string, unknown>): Promise<boolean>;
    /**
     * iOS `manual` push mode: hands the SDK the APNs device token that the app got from the system, as hex digits (the bytes of
     * `didRegisterForRemoteNotificationsWithDeviceToken`). Resolves `false` when the SDK does not take it. Rejects with
     * `ACOUSTIC_PUSH_MODE_NOT_MANUAL` in any other mode, and on Android.
     */
    didRegisterWithToken(token: string): Promise<boolean>;
    /**
     * iOS `manual` push mode: tells the SDK that registering for remote notifications failed
     * (`didFailToRegisterForRemoteNotificationsWithError`), with the error text if there is one.
     */
    didFailToRegister(error?: string | null): Promise<boolean>;
  };
}
