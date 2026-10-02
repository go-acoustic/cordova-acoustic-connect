/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Acoustic Connect Cordova plugin — public JS surface (TypeScript).
 *
 * The plugin clobbers
 * `AcousticConnect` onto `window` at install time via plugin.xml's
 * `<js-module><clobbers target="AcousticConnect" /></js-module>` entry,
 * so the same shape is reachable from `import` / `require` consumers and
 * from the global scope of a Cordova WebView.
 */

declare namespace AcousticConnect {

    type PushMode = 'automatic' | 'manual';

    type LogLevel = 'silent' | 'error' | 'warn' | 'info' | 'verbose';

    interface AcousticError {
        code: string;
        message: string;
    }

    /** Any JSON-representable value. */
    type SignalValue =
        | string
        | number
        | boolean
        | null
        | SignalValue[]
        | { [key: string]: SignalValue };

    /** Payload of {@link logSignal}: a JSON object, nested values allowed. */
    interface SignalValues {
        [key: string]: SignalValue;
    }

    /** Options of {@link logTextChangeEvent}. */
    interface TextChangeOptions {
        /** The text the user entered. */
        text?: string;
        /**
         * Whether to mask the text. Defaults to `true`: every character is
         * replaced with `X` before it leaves JavaScript. Set `false` only for
         * non-sensitive fields.
         */
        masked?: boolean;
    }

    interface EnableOptions {
        /** iOS only. App Group identifier shared with NSE / NCE targets. */
        iosAppGroupIdentifier?: string;
        /** Android only. Drawable resource name for the notification icon. */
        androidIconResName?: string;
    }

    // ── Core ─────────────────────────────────────────────────────────────

    /**
     * Initialise and enable the Connect SDK.
     *
     * @rejects {AcousticError} on invalid arguments or if the native SDK fails
     *   to start. TypeScript does not encode Promise rejection types; catch
     *   handlers should expect `AcousticError | Error`.
     */
    function enable(
        appKey: string,
        postURL: string,
        pushMode?: PushMode,   // defaults to 'automatic'
        options?: EnableOptions
    ): Promise<void>;

    function disable(): Promise<void>;

    function setLogLevel(level: LogLevel): Promise<void>;

    /**
     * Log an identity signal to the Connect SDK.
     *
     * **Native action name**: the Cordova bridge dispatches this to the native
     * action `logIdentificationEvent` (not `logIdentity`). If you call
     * `cordova.exec` directly, use `'logIdentificationEvent'` as the action.
     *
     * Common callers:
     *   logUserLoggedIn   → signalType='loggedIn',           additionalParameters={ loginMethod: 'email' }
     *   logUserRegistered → signalType='accountRegistered',  additionalParameters={ registrationMethod: 'email' }
     *
     * @rejects {AcousticError} when the SDK is not enabled or identifierName/
     *   identifierValue are empty. TypeScript does not encode Promise rejection
     *   types; catch handlers should expect `AcousticError | Error`.
     */
    function logIdentity(
        identifierName: string,
        identifierValue: string,
        signalType?: string,
        additionalParameters?: Record<string, string>
    ): Promise<void>;

    // ── SDK info ─────────────────────────────────────────────────────────

    /**
     * Read the native Connect SDK's own library version (distinct from the
     * Cordova plugin's version).
     */
    function getSdkVersion(): Promise<string>;

    /**
     * Whether the native SDK is currently enabled. Always resolves a strict
     * boolean (iOS bridges native booleans as 1/0; the JS layer normalises).
     */
    function isSdkEnabled(): Promise<boolean>;

    // ── Analytics ────────────────────────────────────────────────────────

    /**
     * Log a named custom event.
     *
     * `values` is deliberately flat (string | number | boolean). The Android
     * SDK's custom-event path is typed `HashMap<String, String>`, so nested
     * structures would be flattened on Android while iOS keeps them.
     *
     * @param level Monitoring level, a non-negative integer. Defaults to 3.
     * @rejects {AcousticError} `ACOUSTIC_INVALID_ARGS` when eventName is empty,
     *   values is not a flat object, or level is not a non-negative integer.
     *   The promise resolving does not mean the collector received the event:
     *   events are queued on device and posted in batches.
     */
    function logCustomEvent(
        eventName: string,
        values?: Record<string, string | number | boolean>,
        level?: number
    ): Promise<void>;

    /**
     * Set the logical screen name that subsequent events are attributed to.
     * Call it on every page / route change.
     *
     * @rejects {AcousticError} `ACOUSTIC_INVALID_ARGS` when name is empty.
     */
    function setCurrentScreenName(name: string): Promise<void>;

    /**
     * Log a click on a UI control, as a `click` custom event carrying the
     * `controlId` (and any extra flat `data`; `controlId` cannot be overridden).
     *
     * Sent as a custom event on both platforms, not as a native control event:
     * the native control-event APIs are not usable from a WebView (iOS rejects
     * them for every view; Android reports the whole WebView as the target).
     *
     * @rejects {AcousticError} `ACOUSTIC_INVALID_ARGS` when controlId is empty
     *   or data is not a flat object.
     */
    function logClickEvent(
        controlId: string,
        data?: Record<string, string | number | boolean>
    ): Promise<void>;

    /**
     * Log a text change on an input control, as a `textChange` custom event.
     *
     * The text is masked by default (each character becomes `X`, only the
     * length is kept) and the plaintext never crosses the bridge. Pass
     * `masked: false` to send it as is. When no text is given only the
     * `controlId` is sent.
     *
     * @rejects {AcousticError} `ACOUSTIC_INVALID_ARGS` when controlId is empty
     *   or options are invalid.
     */
    function logTextChangeEvent(
        controlId: string,
        options?: TextChangeOptions
    ): Promise<void>;

    /**
     * Log a signal. Unlike {@link logCustomEvent}, `values` may be arbitrary
     * JSON: nested objects and arrays are carried through unchanged.
     *
     * Android note: with the plugin's default Android SDK (11.0.21-beta) a
     * number at the top level of the payload is dropped by the native
     * serialiser (checked on an emulator: strings and booleans at the top
     * level arrive, numbers nested inside an object or array are never
     * affected). Nest the number, or set `AndroidVersion` to 11.1.10-beta or
     * later in ConnectConfig.json, where the number arrived. The SDK versions
     * between those two were not checked.
     *
     * @param level Monitoring level, a non-negative integer. Defaults to 3.
     * @rejects {AcousticError} `ACOUSTIC_INVALID_ARGS` when values is not a
     *   JSON-serialisable plain object (functions, `undefined`, `NaN`,
     *   `Infinity`, dates and circular references are rejected) or level is
     *   not a non-negative integer.
     */
    function logSignal(values: SignalValues, level?: number): Promise<void>;

    /**
     * Set a configuration item of a native SDK module at runtime.
     *
     * `moduleName` selects the module on Android ("EOCore", "Tealeaf", "Connect"); iOS has a
     * single config store and ignores it. Most items are read when the SDK starts, so set them
     * before `enable()` where you can.
     *
     * @rejects {AcousticError} `ACOUSTIC_INVALID_ARGS` for an empty key or module name or a
     *   value that is not a boolean, a string or a finite number; `ACOUSTIC_INTERNAL_ERROR`
     *   when the SDK refuses the item.
     */
    function setConfigItem(key: string, value: boolean | string | number, moduleName: string): Promise<void>;

    /**
     * Read a configuration item of a native SDK module. The result has the type of
     * `defaultValue`, which is also returned when the item is not set or does not fit the type.
     *
     * @rejects {AcousticError} `ACOUSTIC_INVALID_ARGS` for an empty key or module name or a
     *   default that is not a boolean, a string or a finite number.
     */
    function getConfigItem(key: string, defaultValue: boolean, moduleName: string): Promise<boolean>;
    function getConfigItem(key: string, defaultValue: string, moduleName: string): Promise<string>;
    function getConfigItem(key: string, defaultValue: number, moduleName: string): Promise<number>;

    /**
     * Log an exception event.
     *
     * @param stackInfo Stack trace text. Defaults to an empty string.
     * @param unhandled Whether the exception was uncaught. Defaults to false.
     * @rejects {AcousticError} `ACOUSTIC_INVALID_ARGS` when message is empty.
     */
    function logExceptionEvent(
        message: string,
        stackInfo?: string,
        unhandled?: boolean
    ): Promise<void>;

    /**
     * Log that a screen was entered (a `LOAD` screen view).
     *
     * @param referrer Name of the screen that led here; empty or `null` means
     *   none.
     * @rejects {AcousticError} `ACOUSTIC_INVALID_ARGS` when logicalPageName is
     *   empty or referrer is not a string.
     */
    function logScreenViewContextLoad(
        logicalPageName: string,
        referrer?: string | null
    ): Promise<void>;

    /**
     * Log that a screen was left (an `UNLOAD` screen view).
     *
     * @param referrer Name of the screen that led here; empty or `null` means
     *   none.
     * @rejects {AcousticError} `ACOUSTIC_INVALID_ARGS` when logicalPageName is
     *   empty or referrer is not a string.
     */
    function logScreenViewContextUnload(
        logicalPageName: string,
        referrer?: string | null
    ): Promise<void>;

    /** Flush buffered events to the collector immediately. */
    function flushQueues(): Promise<void>;

    // ── Push namespace ───────────────────────────────────────────────────

    namespace push {

        function requestPermission(): Promise<{
            granted: boolean;
            error?: string;
        }>;

        function getPermissionState(): Promise<boolean | null>;

        function didReceiveAuthorization(
            granted: boolean | null,
            error?: string
        ): Promise<boolean>;

        // ── Manual mode forwarders ───────────────────────────────────────
        // The bridge has no pub/sub event channel. In automatic mode the
        // SDK handles everything internally; in manual mode the developer
        // wires their own native delegate and forwards via these methods.

        function didReceiveNotification(
            userInfo: Record<string, string | number | boolean>
        ): Promise<boolean>;

        function didReceiveResponse(
            actionIdentifier: string,
            userInfo: Record<string, string | number | boolean>
        ): Promise<boolean>;
    }
}

export = AcousticConnect;
export as namespace AcousticConnect;
