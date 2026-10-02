/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Acoustic Connect Cordova plugin — public JavaScript surface.
 *
 * Promise façade over `cordova.exec`. Every public method routes through
 * a single private `call(action, args)` helper. The bridge is strictly
 * one-direction (JS -> native); no `keepCallback: true`, no pub/sub.
 */

'use strict';

var exec = require('cordova/exec');

var SERVICE = 'ConnectPlugin';

var VALID_LOG_LEVELS = ['silent', 'error', 'warn', 'info', 'verbose'];
var VALID_PUSH_MODES = ['automatic', 'manual'];

function call(action, args) {
    return new Promise(function (resolve, reject) {
        exec(resolve, reject, SERVICE, action, args || []);
    });
}

function invalidArgs(message) {
    return { code: 'ACOUSTIC_INVALID_ARGS', message: message };
}

function isNonEmptyString(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function isConfigValue(value) {
    return typeof value === 'boolean' || typeof value === 'string' ||
        (typeof value === 'number' && isFinite(value));
}

// Reads a stored config item back as the type of `fallback`. The native side hands over the
// raw item (a string on Android; text, number or boolean on iOS), or nothing when the item
// is not set. A missing item and one that does not fit the type both give `fallback`.
function parseConfigItem(raw, fallback) {
    if (raw === undefined || raw === null || raw === '') return fallback;
    if (typeof fallback === 'boolean') {
        if (typeof raw === 'boolean') return raw;
        var text = String(raw).trim().toLowerCase();
        if (text === 'true') return true;
        if (text === 'false') return false;
        return fallback;
    }
    if (typeof fallback === 'number') {
        var n = typeof raw === 'number' ? raw : Number(String(raw).trim());
        return isFinite(n) ? n : fallback;
    }
    return String(raw);
}

// Native default for logCustomEvent when no level is supplied
// (kEOMonitoringLevelInfo on Android, connectMonitoringLevelWiFi on iOS).
var DEFAULT_EVENT_LEVEL = 3;

function isNonNegativeInteger(value) {
    return typeof value === 'number' && isFinite(value) &&
        Math.floor(value) === value && value >= 0;
}

function isFlatScalarMap(value) {
    // A Date, Map, Set or RegExp has no own enumerable keys, so it would pass the check below and
    // reach the native side as {}. Only a plain object is a map of values.
    if (!isPlainObject(value)) {
        return false;
    }
    return Object.keys(value).every(function (key) {
        var v = value[key];
        return typeof v === 'string' || typeof v === 'boolean' ||
            (typeof v === 'number' && isFinite(v));
    });
}

// Deepest nesting a signal payload may have. Also what stops a circular
// reference from recursing forever.
var MAX_SIGNAL_DEPTH = 32;

function isPlainObject(value) {
    return Object.prototype.toString.call(value) === '[object Object]';
}

// True when `value` survives JSON serialisation unchanged: strings, booleans,
// finite numbers, null, arrays and plain objects of the same.
function isJsonValue(value, depth) {
    if (depth > MAX_SIGNAL_DEPTH) {
        return false;
    }
    if (value === null) {
        return true;
    }
    var type = typeof value;
    if (type === 'string' || type === 'boolean') {
        return true;
    }
    if (type === 'number') {
        return isFinite(value);
    }
    if (Array.isArray(value)) {
        return value.every(function (item) {
            return isJsonValue(item, depth + 1);
        });
    }
    if (isPlainObject(value)) {
        return Object.keys(value).every(function (key) {
            return isJsonValue(value[key], depth + 1);
        });
    }
    return false;
}

// Replaces every character of `text` with 'X', keeping only its length.
// Iterates by code point so an emoji counts as one character.
//
// Why here and not in the native SDKs? They cannot do it for this path, on either platform. They
// mask only native controls (by id, tag or accessibility label, from the MaskValueList /
// MaskIdList rules): Android while capturing a layout (Logger.trimAndMaskValueForControl), iOS in
// the control and layout layer (TLFMaskingManager). logCustomEvent / ConnectCustomEvent.logEvent
// queue the values unchanged, and an input inside the WebView has no native control to match, so
// the text would reach the collector as typed. Masking in JS also means the plaintext never
// crosses the bridge.
function maskText(text) {
    return Array.from(text).map(function () { return 'X'; }).join('');
}

function isOptionalString(value) {
    return value === undefined || value === null || typeof value === 'string';
}

// Builds a screen-view load/unload method. Both share one validation path
// and differ only in the native action name.
function screenViewContext(method, action) {
    return function (logicalPageName, referrer) {
        if (!isNonEmptyString(logicalPageName)) {
            return Promise.reject(invalidArgs(
                method + ': logicalPageName must be a non-empty string'
            ));
        }
        if (!isOptionalString(referrer)) {
            return Promise.reject(
                invalidArgs(method + ': referrer must be a string or null')
            );
        }
        var ref = isNonEmptyString(referrer) ? referrer : null;
        return call(action, [logicalPageName, ref]);
    };
}

var AcousticConnect = {

    /**
     * Initialise the Connect SDK. Must be called in the deviceready
     * handler before any other plugin method.
     * @param {string} appKey
     * @param {string} postURL
     * @param {'automatic'|'manual'} [pushMode='automatic']
     * @param {{ iosAppGroupIdentifier?: string, androidIconResName?: string }} [options]
     * @returns {Promise<void>}
     */
    enable: function (appKey, postURL, pushMode, options) {
        if (!isNonEmptyString(appKey)) {
            return Promise.reject(
                invalidArgs('enable: appKey must be a non-empty string')
            );
        }
        if (!isNonEmptyString(postURL)) {
            return Promise.reject(
                invalidArgs('enable: postURL must be a non-empty string')
            );
        }
        var mode = pushMode || 'automatic';
        if (VALID_PUSH_MODES.indexOf(mode) === -1) {
            return Promise.reject(
                invalidArgs("enable: pushMode must be 'automatic' or 'manual'")
            );
        }
        return call('enable', [
            appKey,
            postURL,
            mode,
            options || null
        ]);
    },

    /**
     * Stop all data capture and push activity.
     * @returns {Promise<void>}
     */
    disable: function () {
        return call('disable', []);
    },

    /**
     * Set the bridge log level. Affects bridge logging only; native SDK
     * log verbosity is fixed at install time via ACOUSTIC_SDK_VARIANT.
     * @param {'silent'|'error'|'warn'|'info'|'verbose'} level
     * @returns {Promise<void>}
     */
    setLogLevel: function (level) {
        if (VALID_LOG_LEVELS.indexOf(level) === -1) {
            return Promise.reject(invalidArgs(
                "setLogLevel: level must be one of " +
                "'silent','error','warn','info','verbose'"
            ));
        }
        return call('setLogLevel', [level]);
    },

    /**
     * Log an identity signal to the Connect SDK.
     *
     * The JS method is named `logIdentity`; it dispatches to the native action
     * `logIdentificationEvent` (the name used by both ConnectPlugin.kt and
     * ConnectPlugin.swift). TypeScript types should declare the public name
     * `logIdentity`, not the internal action name.
     *
     * Common callers:
     *   logUserLoggedIn  → signalType='loggedIn',           additionalParameters={ loginMethod: 'email' }
     *   logUserRegistered → signalType='accountRegistered', additionalParameters={ registrationMethod: 'email' }
     *
     * @param {string} identifierName  e.g. 'email', 'userId'
     * @param {string} identifierValue e.g. 'user@example.com'
     * @param {string} [signalType='loggedIn']
     * @param {Record<string, string>} [additionalParameters={}]
     * @returns {Promise<void>}
     */
    logIdentity: function (identifierName, identifierValue, signalType, additionalParameters) {
        if (!isNonEmptyString(identifierName)) {
            return Promise.reject(
                invalidArgs('logIdentity: identifierName must be a non-empty string')
            );
        }
        if (!isNonEmptyString(identifierValue)) {
            return Promise.reject(
                invalidArgs('logIdentity: identifierValue must be a non-empty string')
            );
        }
        var type   = (typeof signalType === 'string' && signalType.trim()) ? signalType.trim() : 'loggedIn';
        var params = (additionalParameters && typeof additionalParameters === 'object') ? additionalParameters : {};
        return call('logIdentificationEvent', [identifierName, identifierValue, type, params]);
    },

    /**
     * Read the native Connect SDK's own library version — distinct from the
     * Cordova plugin's version (`www/js/connect-config.js`'s `PluginVersion`,
     * generated from this plugin's `package.json`).
     * @returns {Promise<string>}
     */
    getSdkVersion: function () {
        return call('getSdkVersion', []);
    },

    /**
     * Log a named custom event.
     *
     * `values` is deliberately flat (string | number | boolean): the Android
     * SDK's custom-event path is typed `HashMap<String, String>`, so nested
     * structures would be silently flattened there while iOS keeps them.
     *
     * @param {string} eventName
     * @param {Record<string, string|number|boolean>} [values={}]
     * @param {number} [level=3] Monitoring level (non-negative integer).
     * @returns {Promise<void>}
     */
    logCustomEvent: function (eventName, values, level) {
        if (!isNonEmptyString(eventName)) {
            return Promise.reject(
                invalidArgs('logCustomEvent: eventName must be a non-empty string')
            );
        }
        var payload = values === undefined ? {} : values;
        if (!isFlatScalarMap(payload)) {
            return Promise.reject(invalidArgs(
                'logCustomEvent: values must be a flat object of ' +
                'string, number or boolean values'
            ));
        }
        var lvl = level === undefined ? DEFAULT_EVENT_LEVEL : level;
        if (!isNonNegativeInteger(lvl)) {
            return Promise.reject(
                invalidArgs('logCustomEvent: level must be a non-negative integer')
            );
        }
        return call('logCustomEvent', [eventName, payload, lvl]);
    },

    /**
     * Set the logical screen name that subsequent events are attributed to.
     * @param {string} name
     * @returns {Promise<void>}
     */
    setCurrentScreenName: function (name) {
        if (!isNonEmptyString(name)) {
            return Promise.reject(
                invalidArgs('setCurrentScreenName: name must be a non-empty string')
            );
        }
        return call('setCurrentScreenName', [name]);
    },

    /**
     * Log a click on a UI control, as a `click` custom event.
     *
     * Implemented on top of `logCustomEvent` on both platforms: the native
     * control-event APIs are not usable from a WebView (verified on a device:
     * iOS rejects them for every view; Android only reports the whole WebView
     * as the target). The event therefore arrives as a custom event, not a
     * native control event.
     *
     * @param {string} controlId Identifier of the clicked control.
     * @param {Record<string, string|number|boolean>} [data] Extra flat values
     *   merged into the event. `controlId` cannot be overridden.
     * @returns {Promise<void>}
     */
    logClickEvent: function (controlId, data) {
        if (!isNonEmptyString(controlId)) {
            return Promise.reject(invalidArgs(
                'logClickEvent: controlId must be a non-empty string'
            ));
        }
        var extra = data === undefined ? {} : data;
        if (!isFlatScalarMap(extra)) {
            return Promise.reject(invalidArgs(
                'logClickEvent: data must be a flat object of ' +
                'string, number or boolean values'
            ));
        }
        var values = Object.assign({}, extra, { controlId: controlId });
        return AcousticConnect.logCustomEvent('click', values);
    },

    /**
     * Log a text change on an input control, as a `textChange` custom event.
     *
     * The text is MASKED by default: each character is replaced with 'X' in
     * JavaScript, so the plaintext never crosses the bridge. Pass
     * `masked: false` explicitly to send it as is (never do this for
     * passwords or personal data).
     *
     * @param {string} controlId Identifier of the input control.
     * @param {{ text?: string, masked?: boolean }} [options]
     * @returns {Promise<void>}
     */
    logTextChangeEvent: function (controlId, options) {
        if (!isNonEmptyString(controlId)) {
            return Promise.reject(invalidArgs(
                'logTextChangeEvent: controlId must be a non-empty string'
            ));
        }
        var opts = options === undefined ? {} : options;
        if (!isPlainObject(opts)) {
            return Promise.reject(invalidArgs(
                'logTextChangeEvent: options must be an object'
            ));
        }
        if (opts.text !== undefined && typeof opts.text !== 'string') {
            return Promise.reject(
                invalidArgs('logTextChangeEvent: text must be a string')
            );
        }
        if (opts.masked !== undefined && typeof opts.masked !== 'boolean') {
            return Promise.reject(
                invalidArgs('logTextChangeEvent: masked must be a boolean')
            );
        }
        var values = { controlId: controlId };
        if (opts.text !== undefined) {
            var masked = opts.masked !== false;
            values.text = masked ? maskText(opts.text) : opts.text;
            values.masked = masked;
        }
        return AcousticConnect.logCustomEvent('textChange', values);
    },

    /**
     * Log a signal. Unlike `logCustomEvent`, `values` may be arbitrary JSON:
     * nested objects and arrays are carried through unchanged.
     *
     * Android note: with the plugin's default Android SDK (11.0.21-beta) a
     * number at the TOP level of the payload is dropped by the native
     * serialiser (checked on an emulator: strings and booleans at the top
     * level arrive, numbers nested inside an object or array are never
     * affected). Nest the number, or set `AndroidVersion` to 11.1.10-beta or
     * later in ConnectConfig.json, where the number arrived. The SDK versions
     * between those two were not checked.
     *
     * @param {Record<string, unknown>} values JSON-serialisable plain object.
     * @param {number} [level=3] Monitoring level (non-negative integer).
     * @returns {Promise<void>}
     */
    logSignal: function (values, level) {
        if (!isPlainObject(values) || !isJsonValue(values, 0)) {
            return Promise.reject(invalidArgs(
                'logSignal: values must be a JSON-serialisable plain object'
            ));
        }
        var lvl = level === undefined ? DEFAULT_EVENT_LEVEL : level;
        if (!isNonNegativeInteger(lvl)) {
            return Promise.reject(
                invalidArgs('logSignal: level must be a non-negative integer')
            );
        }
        return call('logSignal', [values, lvl]);
    },

    /**
     * Log an exception event.
     * @param {string} message
     * @param {string} [stackInfo=''] Stack trace text.
     * @param {boolean} [unhandled=false] Whether the exception was uncaught.
     * @returns {Promise<void>}
     */
    logExceptionEvent: function (message, stackInfo, unhandled) {
        if (!isNonEmptyString(message)) {
            return Promise.reject(invalidArgs(
                'logExceptionEvent: message must be a non-empty string'
            ));
        }
        var stack = stackInfo === undefined ? '' : stackInfo;
        if (typeof stack !== 'string') {
            return Promise.reject(
                invalidArgs('logExceptionEvent: stackInfo must be a string')
            );
        }
        var isUnhandled = unhandled === undefined ? false : unhandled;
        if (typeof isUnhandled !== 'boolean') {
            return Promise.reject(
                invalidArgs('logExceptionEvent: unhandled must be a boolean')
            );
        }
        return call('logExceptionEvent', [message, stack, isUnhandled]);
    },

    /**
     * Log that a screen was entered (a `LOAD` screen view).
     * @param {string} logicalPageName e.g. 'Login'
     * @param {string|null} [referrer] Name of the screen that led here.
     * @returns {Promise<void>}
     */
    logScreenViewContextLoad:
        screenViewContext('logScreenViewContextLoad', 'logScreenViewContextLoad'),

    /**
     * Log that a screen was left (an `UNLOAD` screen view).
     * @param {string} logicalPageName e.g. 'Login'
     * @param {string|null} [referrer] Name of the screen that led here.
     * @returns {Promise<void>}
     */
    logScreenViewContextUnload:
        screenViewContext('logScreenViewContextUnload', 'logScreenViewContextUnload'),

    /**
     * Flush buffered events to the collector immediately.
     * @returns {Promise<void>}
     */
    flushQueues: function () {
        return call('flushQueues', []);
    },

    /**
     * Whether the native SDK is currently enabled. iOS bridges a native
     * boolean as 1/0, so the result is normalised to a strict boolean.
     * @returns {Promise<boolean>}
     */
    isSdkEnabled: function () {
        return call('isSdkEnabled', []).then(function (value) {
            return value === true || value === 1;
        });
    },

    /**
     * Set a configuration item of a native SDK module at runtime.
     *
     * `moduleName` selects the module on Android ("EOCore" for core settings such as
     * DisplayLogging, "Tealeaf" for capture settings such as LogViewLayoutOnScreenTransition,
     * "Connect"); iOS keeps one config store and ignores it. Most items are read when the SDK
     * starts, so set them before `enable()` where you can; whether a later change takes effect
     * depends on the item.
     *
     * @param {string} key
     * @param {boolean|string|number} value
     * @param {string} moduleName
     * @returns {Promise<void>} Rejects ACOUSTIC_INTERNAL_ERROR when the SDK refuses the item.
     */
    setConfigItem: function (key, value, moduleName) {
        if (!isNonEmptyString(key)) {
            return Promise.reject(invalidArgs('setConfigItem: key must be a non-empty string'));
        }
        if (!isConfigValue(value)) {
            return Promise.reject(invalidArgs(
                'setConfigItem: value must be a boolean, a string or a finite number'
            ));
        }
        if (!isNonEmptyString(moduleName)) {
            return Promise.reject(invalidArgs('setConfigItem: moduleName must be a non-empty string'));
        }
        return call('setConfigItem', [key, value, moduleName]).then(function () {});
    },

    /**
     * Read a configuration item of a native SDK module.
     *
     * The type of the result is the type of `defaultValue` (boolean, string or number). The
     * default is returned when the item is not set or does not fit that type.
     *
     * @param {string} key
     * @param {boolean|string|number} defaultValue
     * @param {string} moduleName See `setConfigItem`.
     * @returns {Promise<boolean|string|number>}
     */
    getConfigItem: function (key, defaultValue, moduleName) {
        if (!isNonEmptyString(key)) {
            return Promise.reject(invalidArgs('getConfigItem: key must be a non-empty string'));
        }
        if (!isConfigValue(defaultValue)) {
            return Promise.reject(invalidArgs(
                'getConfigItem: defaultValue must be a boolean, a string or a finite number'
            ));
        }
        if (!isNonEmptyString(moduleName)) {
            return Promise.reject(invalidArgs('getConfigItem: moduleName must be a non-empty string'));
        }
        return call('getConfigItem', [key, moduleName]).then(function (raw) {
            return parseConfigItem(raw, defaultValue);
        });
    },

    push: {

        /**
         * Present the OS-level push permission dialog.
         * @returns {Promise<{ granted: boolean, error?: string }>}
         */
        requestPermission: function () {
            return call('pushRequestPermission', []);
        },

        /**
         * Read current permission state without prompting.
         * @returns {Promise<boolean|null>} true / false / null tri-state.
         */
        getPermissionState: function () {
            return call('pushGetPermissionState', []);
        },

        /**
         * Forward an externally-obtained permission result to the SDK.
         * `granted === null` (or undefined) short-circuits: the bridge
         * resolves false without crossing to native, because the native
         * SDKs only accept a non-optional Bool.
         * @param {boolean|null} granted
         * @param {string} [error]
         * @returns {Promise<boolean>}
         */
        didReceiveAuthorization: function (granted, error) {
            if (granted === null || granted === undefined) {
                return Promise.resolve(false);
            }
            return call('pushDidReceiveAuthorization', [
                granted,
                error == null ? null : error
            ]);
        },

        /**
         * Manual mode: forward a notification receipt from a
         * developer-owned native delegate.
         * @param {Record<string, string|number|boolean>} userInfo
         * @returns {Promise<boolean>}
         */
        didReceiveNotification: function (userInfo) {
            return call('pushDidReceiveNotification', [userInfo]);
        },

        /**
         * Manual mode: forward a tap response from a developer-owned
         * native delegate.
         * @param {string} actionIdentifier
         * @param {Record<string, string|number|boolean>} userInfo
         * @returns {Promise<boolean>}
         */
        didReceiveResponse: function (actionIdentifier, userInfo) {
            return call('pushDidReceiveResponse', [
                actionIdentifier,
                userInfo
            ]);
        }
    }
};

module.exports = AcousticConnect;
