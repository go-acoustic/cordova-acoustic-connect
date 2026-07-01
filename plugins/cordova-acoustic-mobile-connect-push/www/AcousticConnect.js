/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Acoustic Connect Cordova plugin — public JavaScript surface.
 *
 * Promise façade over `cordova.exec`. Every public method routes through
 * a single private `call(action, args)` helper. The bridge is strictly
 * one-direction (JS -> native); no `keepCallback: true`, no pub/sub.
 *
 * Contract: idfs/2026-Q2/PES-4040/api-contract.md §1-§8.
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
