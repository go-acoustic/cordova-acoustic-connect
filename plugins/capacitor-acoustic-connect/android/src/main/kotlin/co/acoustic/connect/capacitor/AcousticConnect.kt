/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * NOTICE: This file contains material that is confidential and proprietary
 * to Acoustic, L.P. and/or other developers. No license is granted under any
 * intellectual or industrial property rights of Acoustic, L.P. except as may
 * be provided in an agreement with Acoustic, L.P. Any unauthorized copying
 * or distribution of content from this file is prohibited.
 */

package co.acoustic.connect.capacitor

import android.util.Log
import org.json.JSONObject

/**
 * The bridge logic of the Capacitor plugin: one method per plugin method, each taking the options
 * object of the call and answering through a [Reply]. The TypeScript API (src/api.ts) validates first; the
 * checks here keep the native side safe on its own and use the same error codes.
 *
 * Connect SDK calls run on the main thread through [ui].
 */
class AcousticConnect(
    private val sdk: ConnectSdk,
    private val ui: UiRunner,
    private val config: NativeConfig = NativeConfig(),
    private val warn: (String) -> Unit = { Log.w(TAG, it) },
) {
    /** What the SDK was started with, to say what a later `enable()` could not change. */
    private data class Started(val appKey: String, val postURL: String, val iconName: String?)

    @Volatile
    private var started: Started? = null

    @Volatile
    internal var logLevel: String = LOG_LEVEL_DEFAULT
        private set

    fun enable(data: JSONObject, reply: Reply) {
        val appKey = text(data, "appKey")
        val postURL = text(data, "postURL")
        if (appKey.isBlank()) return reply.reject(CODE_INVALID_ARGS, "enable: appKey is empty")
        if (postURL.isBlank()) return reply.reject(CODE_INVALID_ARGS, "enable: postURL is empty")
        // Android's SDK delivers push itself (FCM); there is nothing for the app to forward.
        val pushMode = text(data, "pushMode").ifEmpty { PUSH_MODE_AUTOMATIC }
        if (pushMode != PUSH_MODE_AUTOMATIC) {
            return reply.reject(CODE_INVALID_ARGS, "enable: pushMode must be 'automatic' (Android only supports automatic mode)")
        }
        val iconName = text(data, "androidIconResName").ifEmpty { config.notificationIconResName }
        onUi(reply, "enable: no host activity") {
            try {
                // A second enable (a racing auto-init, a hot reload) must not set up push again: that
                // registers a second lifecycle callback and receiver in the SDK and asks for the
                // notification permission twice.
                if (sdk.isEnabled()) {
                    noteWhatEnableCannotChange(appKey, postURL, iconName)
                    return@onUi reply.resolve()
                }
                sdk.init()
                applyConfigBeforeEnable()
                sdk.enable(appKey, postURL)
                started = Started(appKey, postURL, iconName)
                if (config.pushEnabled) startPush(iconName)
                reply.resolve()
            } catch (t: Throwable) {
                reply.reject(CODE_INTERNAL_ERROR, t.message ?: "enable failed")
            }
        }
    }

    /**
     * Once the SDK runs, a call to `enable()` changes nothing. Say so when it asked for something else, so a developer who
     * expected the call to win is told where the setting comes from.
     */
    private fun noteWhatEnableCannotChange(appKey: String, postURL: String, iconName: String?) {
        val was = started ?: return
        val ignored = buildList {
            if (appKey != was.appKey) add("appKey")
            if (postURL != was.postURL) add("postURL")
            if (config.pushEnabled && iconName != was.iconName) add("androidIconResName")
        }
        if (ignored.isEmpty()) return
        warn(
            "enable: the SDK is already running, so ${ignored.joinToString(", ")} from this call is ignored and the plugin config " +
                "stays in effect; set autoEnable to false to start the SDK from JavaScript with your own values",
        )
    }

    /**
     * Starts the SDK from the config when the plugin loads, so it is up before the first activity
     * resumes and that screen's automatic screen view and layout are captured. A later `enable()`
     * from JavaScript then resolves without repeating the setup. Does nothing unless both keys are
     * set and `autoEnable` is not off.
     */
    fun autoEnable(reply: Reply) {
        val appKey = config.appKey ?: return
        val postURL = config.postMessageUrl ?: return
        if (!config.autoEnable) return
        enable(JSONObject().put("appKey", appKey).put("postURL", postURL).put("pushMode", PUSH_MODE_AUTOMATIC), reply)
    }

    /**
     * Settings that only count when set before `Connect.enable`: the SDK reads location logging once
     * inside enable, and layout capture is read at the first screen transition.
     */
    private fun applyConfigBeforeEnable() {
        // Mirrors useRelease: native SDK logging off in production builds.
        setting("DisplayLogging", (!config.useRelease).toString(), EOCORE_CONFIG_MODULE)
        // The SDK would inject its own WebViewClient and a tlBridge script into the page. On 11.0.21-beta
        // that script fails ("tlBridge is not defined") and the WebView ends up on chrome-error://, so
        // no later call from the page ran. The page is reported as a single WebView control either way.
        setting("GoogleWebViewEnabled", "false", TEALEAF_CONFIG_MODULE)
        // Set here and then the SDK enabled without arguments (see ConnectSdkImpl.enable): that path never
        // reaches the two-argument enable's own delayed `KillSwitchEnabled=true`, so the value sticks, and
        // the SDK is up at once instead of after the kill-switch round trip, which is what lets it capture
        // the screen that is resuming right now.
        setting("KillSwitchEnabled", config.killSwitchEnabled.toString(), TEALEAF_CONFIG_MODULE)
        if (config.killSwitchEnabled) config.killSwitchUrl?.let { setting("KillSwitchUrl", it, TEALEAF_CONFIG_MODULE) }
        config.locationLoggingEnabled?.let { setting("LogLocationEnabled", it.toString(), TEALEAF_CONFIG_MODULE) }
        if (layoutCaptureOff()) setting("LogViewLayoutOnScreenTransition", "false", TEALEAF_CONFIG_MODULE)
    }

    /**
     * The app's choice wins. Without one, layout capture is off on an SDK older than 11.1.10: the layout of a
     * WebView screen waits for a script from the SDK's own page injection, which the plugin keeps out of the
     * page (it replaces Capacitor's WebViewClient and the page ends on chrome-error://). The layout never
     * completes and every message queued after it is held back, so nothing but the first screen reaches the
     * collector. Later SDKs send the WebView layout without that script.
     */
    private fun layoutCaptureOff(): Boolean =
        config.screenCaptureEnabled?.not() ?: SdkVersion.isOlderThan(sdk.libraryVersion(), LAYOUT_FIXED_IN)

    /** A setting the SDK refuses leaves its default in place; it never fails the call. */
    private fun setting(key: String, value: String, module: String) {
        try {
            if (!sdk.updateConfig(key, value, module)) Log.w(TAG, "$key was not applied: module \"$module\" is not registered")
        } catch (t: Throwable) {
            Log.w(TAG, "$key was not applied: ${t.message}")
        }
    }

    /**
     * Push is best effort: nothing here can fail `enable()`, because the SDK is
     * already capturing. A failure is logged for the developer, who asked for push and has to see why it is
     * not running.
     */
    private fun startPush(iconName: String?) {
        if (!sdk.pushAvailable()) {
            Log.e(TAG, "pushEnabled is true but the push transport (connect-push-fcm) is not in the app: " +
                "run `npx cap sync` and rebuild so the Android build includes it")
            return
        }
        try {
            // A failing push.enable is not fatal: turnOnPush is the authoritative result.
            sdk.pushEnable(sdk.resolveIconRes(iconName)) { Log.w(TAG, "push.enable warning: ${it.message}") }
            sdk.turnOnPush(
                onSuccess = {
                    // Events queued before enable(), such as a push_received logged while the app was killed.
                    sdk.flushQueues()
                    if (sdk.notificationPermissionNeeded()) askForNotificationPermission()
                },
                onFailure = { Log.w(TAG, "push could not start: ${it.message}") },
            )
        } catch (t: Throwable) {
            Log.w(TAG, "push could not start: ${t.message}")
        }
    }

    private fun askForNotificationPermission() {
        ui.run {
            try {
                sdk.requestNotificationPermission { }
            } catch (t: Throwable) {
                Log.w(TAG, "notification permission request failed: ${t.message}")
            }
        }
    }

    fun disable(reply: Reply) {
        onUi(reply, "disable: no host activity") {
            try {
                sdk.disable()
                reply.resolve()
            } catch (t: Throwable) {
                reply.reject(CODE_INTERNAL_ERROR, t.message ?: "disable failed")
            }
        }
    }

    fun setLogLevel(data: JSONObject, reply: Reply) {
        val level = text(data, "level")
        if (level !in VALID_LOG_LEVELS) {
            return reply.reject(CODE_INVALID_ARGS, "setLogLevel: level must be one of $VALID_LOG_LEVELS")
        }
        logLevel = level
        reply.resolve()
    }

    fun logIdentity(data: JSONObject, reply: Reply) {
        val name = text(data, "identifierName").trim()
        val value = text(data, "identifierValue").trim()
        val signalType = text(data, "signalType").trim().ifBlank { "loggedIn" }
        val params = data.optJSONObject("additionalParameters")?.let { stringMap(it) } ?: emptyMap()
        if (name.isBlank() || value.isBlank()) {
            return reply.reject(CODE_INVALID_ARGS, "logIdentity: identifierName and identifierValue are required")
        }
        onUi(reply, "logIdentity: no host activity") {
            try {
                if (sdk.logIdentification(name, value, signalType, params)) {
                    // Post now, so the server sees the identity without waiting for the next batch.
                    sdk.flushImmediately()
                    reply.resolve()
                } else {
                    reply.reject(CODE_INTERNAL_ERROR, "logIdentity returned false — SDK may not be enabled")
                }
            } catch (t: Throwable) {
                reply.reject(CODE_INTERNAL_ERROR, t.message ?: "logIdentity failed")
            }
        }
    }

    fun getSdkVersion(reply: Reply) = reply.resolve(JSONObject().put("value", sdk.libraryVersion()))

    fun isSdkEnabled(reply: Reply) = reply.resolve(JSONObject().put("value", sdk.isEnabled()))

    /** Never fails: a flush that cannot run only delays the upload. */
    fun flushQueues(reply: Reply) {
        if (sdk.isEnabled()) {
            ui.run { runCatching { sdk.flushQueues() }.onFailure { Log.w(TAG, "flushQueues threw: ${it.message}") } }
        }
        reply.resolve()
    }

    /**
     * Logs a LOAD screen view directly: `resumeConnect` would re-inject the JavaScript interface while
     * the page is live and make the WebView reload. Never fails once the name is valid.
     */
    fun setCurrentScreenName(data: JSONObject, reply: Reply) {
        val name = text(data, "name").trim()
        if (name.isBlank()) return reply.reject(CODE_INVALID_ARGS, "setCurrentScreenName: name is required")
        ui.run { runCatching { sdk.logScreenview(name, ScreenViewType.LOAD, null) }.onFailure { Log.w(TAG, "setCurrentScreenName threw: ${it.message}") } }
        reply.resolve()
    }

    fun logCustomEvent(data: JSONObject, reply: Reply) {
        val eventName = text(data, "eventName").trim()
        if (eventName.isBlank()) return reply.reject(CODE_INVALID_ARGS, "logCustomEvent: eventName is required")
        val values = data.optJSONObject("values")?.let { stringMap(it) } ?: emptyMap()
        val level = data.optInt("level", DEFAULT_EVENT_LEVEL)
        // No activity: nothing to attach the event to, and the caller cannot act on it.
        onUi(reply, null) { sdkCall(reply, "logCustomEvent") { sdk.logCustomEvent(eventName, values, level) } }
    }

    fun logSignal(data: JSONObject, reply: Reply) {
        val values = data.optJSONObject("values") ?: return reply.reject(CODE_INVALID_ARGS, "logSignal: values must be a JSON object")
        val level = data.optInt("level", DEFAULT_EVENT_LEVEL)
        // Nested objects and arrays stay org.json values and JSON null stays JSONObject.NULL, as the SDK's
        // serialiser expects. SDKs before 11.0.24-beta drop a top-level number.
        val payload = HashMap<String, Any?>(values.length())
        values.keys().forEach { key -> payload[key] = values.get(key) }
        onUi(reply, "logSignal: no foreground activity") { sdkCall(reply, "logSignal") { sdk.logSignal(payload, level) } }
    }

    fun logExceptionEvent(data: JSONObject, reply: Reply) {
        val message = text(data, "message").trim()
        if (message.isBlank()) return reply.reject(CODE_INVALID_ARGS, "logExceptionEvent: message is required")
        val stackInfo = text(data, "stackInfo")
        val unhandled = data.optBoolean("unhandled", false)
        onUi(reply, "logExceptionEvent: no foreground activity") {
            sdkCall(reply, "logExceptionEvent") { sdk.logException(message, stackInfo, unhandled) }
        }
    }

    fun logScreenViewContextLoad(data: JSONObject, reply: Reply) =
        screenViewContext(data, reply, ScreenViewType.LOAD, "logScreenViewContextLoad")

    fun logScreenViewContextUnload(data: JSONObject, reply: Reply) =
        screenViewContext(data, reply, ScreenViewType.UNLOAD, "logScreenViewContextUnload")

    private fun screenViewContext(data: JSONObject, reply: Reply, type: ScreenViewType, label: String) {
        val name = text(data, "logicalPageName").trim()
        if (name.isBlank()) return reply.reject(CODE_INVALID_ARGS, "$label: logicalPageName is required")
        val referrer = text(data, "referrer").ifBlank { null }
        onUi(reply, "$label: no foreground activity") { sdkCall(reply, label) { sdk.logScreenview(name, type, referrer) } }
    }

    fun setConfigItem(data: JSONObject, reply: Reply) {
        val key = text(data, "key").trim()
        val module = text(data, "moduleName").trim()
        val value = configString(data.opt("value"))
        if (key.isEmpty() || module.isEmpty() || value == null) {
            return reply.reject(
                CODE_INVALID_ARGS,
                "setConfigItem: key and moduleName must be non-empty strings and value a boolean, string or number",
            )
        }
        try {
            if (sdk.updateConfig(key, value, module)) {
                reply.resolve()
            } else {
                reply.reject(CODE_INTERNAL_ERROR, "setConfigItem returned false — SDK may not be initialised or module \"$module\" is not registered")
            }
        } catch (t: Throwable) {
            reply.reject(CODE_INTERNAL_ERROR, t.message ?: "setConfigItem failed")
        }
    }

    /** Resolves the raw string the SDK stores, or no value when the item is not set; the TypeScript layer types it. */
    fun getConfigItem(data: JSONObject, reply: Reply) {
        val key = text(data, "key").trim()
        val module = text(data, "moduleName").trim()
        if (key.isEmpty() || module.isEmpty()) {
            return reply.reject(CODE_INVALID_ARGS, "getConfigItem: key and moduleName must be non-empty strings")
        }
        try {
            val raw = sdk.getConfigItemString(key, module)
            reply.resolve(JSONObject().also { if (!raw.isNullOrEmpty()) it.put("value", raw) })
        } catch (t: Throwable) {
            reply.reject(CODE_INTERNAL_ERROR, t.message ?: "getConfigItem failed")
        }
    }

    /** Never rejects: a refusal or a failure is part of the result. */
    fun pushRequestPermission(reply: Reply) {
        val ran = ui.run {
            try {
                if (!sdk.notificationPermissionNeeded()) {
                    reply.resolve(JSONObject().put("granted", true))
                } else {
                    sdk.requestNotificationPermission { granted -> reply.resolve(JSONObject().put("granted", granted)) }
                }
            } catch (t: Throwable) {
                reply.resolve(JSONObject().put("granted", false).put("error", t.message ?: "permission-request-failed"))
            }
        }
        if (!ran) reply.resolve(JSONObject().put("granted", false).put("error", "no-foreground-activity"))
    }

    /** `true` granted, `false` denied, `null` not determined. Never rejects. */
    fun pushGetPermissionState(reply: Reply) {
        val ran = ui.run {
            val state = try {
                sdk.pushPermissionState()
            } catch (t: Throwable) {
                Log.w(TAG, "getPushPermissionState failed: ${t.message}")
                null
            }
            reply.resolve(JSONObject().put("value", state ?: JSONObject.NULL))
        }
        if (!ran) reply.resolve(JSONObject().put("value", JSONObject.NULL))
    }

    /** The SDK settles consent through its own lifecycle callbacks; this only satisfies the cross-platform contract. */
    fun pushDidReceiveAuthorization(data: JSONObject, reply: Reply) {
        val known = data.has("granted") && !data.isNull("granted")
        reply.resolve(JSONObject().put("value", known))
    }

    fun pushDidReceiveNotification(@Suppress("UNUSED_PARAMETER") data: JSONObject, reply: Reply) = notManual(reply)

    fun pushDidReceiveResponse(@Suppress("UNUSED_PARAMETER") data: JSONObject, reply: Reply) = notManual(reply)

    // The APNs token and its failure are iOS manual-mode calls; FCM registers by itself.
    fun pushDidRegisterWithToken(@Suppress("UNUSED_PARAMETER") data: JSONObject, reply: Reply) = notManual(reply)

    fun pushDidFailToRegister(@Suppress("UNUSED_PARAMETER") data: JSONObject, reply: Reply) = notManual(reply)

    private fun notManual(reply: Reply) =
        reply.reject(CODE_PUSH_MODE_NOT_MANUAL, "Android does not support manual push mode")

    /** Runs [block] on the main thread; without an activity, rejects with [noActivity] or, when that is null, resolves. */
    private fun onUi(reply: Reply, noActivity: String?, block: () -> Unit) {
        if (ui.run(block)) return
        if (noActivity == null) reply.resolve() else reply.reject(CODE_INTERNAL_ERROR, noActivity)
    }

    private fun sdkCall(reply: Reply, label: String, call: () -> Boolean) {
        try {
            if (call()) reply.resolve() else reply.reject(CODE_INTERNAL_ERROR, "$label returned false")
        } catch (t: Throwable) {
            reply.reject(CODE_INTERNAL_ERROR, t.message ?: "$label failed")
        }
    }

    /** A string option; a missing key and a JSON null are both empty (`optString` would turn null into "null"). */
    private fun text(data: JSONObject, key: String): String = if (data.isNull(key)) "" else data.optString(key, "")

    private fun stringMap(json: JSONObject): Map<String, String> =
        json.keys().asSequence().associateWith { json.optString(it) }

    /**
     * A config value the way the SDK's config files spell it: `true`/`false`, a whole number without a
     * trailing ".0", other numbers as is. Null for anything but a boolean, string or finite number.
     */
    internal fun configString(value: Any?): String? = when (value) {
        is Boolean -> value.toString()
        is String -> value
        is Int, is Long -> value.toString()
        is Number -> {
            val d = value.toDouble()
            when {
                d.isNaN() || d.isInfinite() -> null
                d == Math.floor(d) && Math.abs(d) < 1e15 -> d.toLong().toString()
                else -> d.toString()
            }
        }
        else -> null
    }

    companion object {
        private const val TAG = "AcousticConnect"
        internal const val PUSH_MODE_AUTOMATIC = "automatic"
        internal const val LOG_LEVEL_DEFAULT = "error"
        internal val VALID_LOG_LEVELS = setOf("silent", "error", "warn", "info", "verbose")
        internal const val DEFAULT_EVENT_LEVEL = 3
        internal const val LAYOUT_FIXED_IN = "11.1.10"
        internal const val CODE_INVALID_ARGS = "ACOUSTIC_INVALID_ARGS"
        internal const val CODE_INTERNAL_ERROR = "ACOUSTIC_INTERNAL_ERROR"
        internal const val CODE_PUSH_MODE_NOT_MANUAL = "ACOUSTIC_PUSH_MODE_NOT_MANUAL"
    }
}
