/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Acoustic Connect Cordova plugin — public JS surface (TypeScript).
 *
 * Matches the contract in
 * `idfs/2026-Q2/PES-4040/api-contract.md §8` verbatim. The plugin clobbers
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
