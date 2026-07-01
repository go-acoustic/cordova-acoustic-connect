/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * NOTICE: This file contains material that is confidential and proprietary
 * to Acoustic, L.P. and/or other developers. No license is granted under any
 * intellectual or industrial property rights of Acoustic, L.P. except as may
 * be provided in an agreement with Acoustic, L.P. Any unauthorized copying
 * or distribution of content from this file is prohibited.
 */

package co.acoustic.connect.cordova.plugin

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.activity.ComponentActivity
import com.acoustic.connect.android.connectmod.Connect
import com.acoustic.connect.android.connectmod.push.PushPermissionState
import com.tl.uic.Tealeaf
import com.tl.uic.model.ScreenviewType
import com.acoustic.connect.android.connectmod.push.core.MobileServiceType
import org.apache.cordova.CallbackContext
import org.apache.cordova.CordovaInterface
import org.apache.cordova.CordovaPlugin
import org.apache.cordova.PluginResult
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Cordova entry point for the Acoustic Connect plugin.
 *
 * Dispatches the 11 actions emitted by the JS facade
 * `www/AcousticConnect.js` against the native Connect SDK. Action strings
 * must match the JS facade exactly.
 *
 * Scope:
 * - Fully implemented: enable (incl. push orchestration —
 *     `Connect.push.enable` + `turnOnPush` for the only-supported
 *     automatic mode, and optional post-registration
 *     `Connect.logIdentificationEvent(identifier)`),
 *     disable, setLogLevel, pushRequestPermission /
 *     pushGetPermissionState / pushDidReceiveAuthorization,
 * - Manual-mode forwarders (pushDidReceiveNotification /
 *     pushDidReceiveResponse) are unreachable in normal use — manual mode
 *     is rejected at `enable()` boundary — and reject with
 *     `ACOUSTIC_PUSH_MODE_NOT_MANUAL` per the Android automatic-only stance.
 * - Push delivery is handled entirely by the SDK's FCMPushService; the
 *     Cordova plugin does not intercept or re-broadcast push messages.
 *
 * Constraints:
 * - All Connect SDK calls run on the UI thread via
 *   `cordova.activity.runOnUiThread { ... }`.
 * - Never `runBlocking { ... }` on the Cordova plugin thread; async
 *   `Work<T>` results are bridged via `WorkWrapper` listeners.
 * - Android Connect SDK only supports automatic push mode (FCM).
 *   `manual` and `off` are rejected at the bridge boundary with
 *   `ACOUSTIC_INVALID_ARGS`.
 */
class ConnectPlugin : CordovaPlugin() {

    @Volatile
    internal var pushMode: String = PUSH_MODE_AUTOMATIC
        private set

    @Volatile
    internal var bridgeLogLevel: String = LOG_LEVEL_DEFAULT
        private set

    internal lateinit var workWrapper: WorkWrapper
        private set

    // Guards the bundled-config auto-init vs handleEnable race.
    // tryBundledConfigInit stores the Runnable here so handleEnable can cancel
    // it via Handler.removeCallbacks() before the JS-triggered enable() runs.
    // @Volatile because it is written on the pluginInitialize thread and read
    // on the Cordova thread-pool thread that dispatches handleEnable.
    private val mainHandler = Handler(Looper.getMainLooper())
    @Volatile private var autoInitRunnable: Runnable? = null

    override fun pluginInitialize() {
        super.pluginInitialize()
        workWrapper = WorkWrapper(cordova)
        Log.d(TAG, "pluginInitialize pushMode=$pushMode logLevel=$bridgeLogLevel")
        tryBundledConfigInit()
    }

    @Throws(JSONException::class)
    override fun execute(
        action: String,
        args: JSONArray,
        callbackContext: CallbackContext
    ): Boolean {
        if (bridgeLogLevel == LOG_LEVEL_VERBOSE) {
            Log.v(TAG, "execute action=$action argsLen=${args.length()}")
        }
        return when (action) {
            ACTION_ENABLE -> {
                handleEnable(args, callbackContext); true
            }
            ACTION_DISABLE -> {
                handleDisable(callbackContext); true
            }
            ACTION_SET_LOG_LEVEL -> {
                handleSetLogLevel(args, callbackContext); true
            }
            ACTION_PUSH_REQUEST_PERMISSION -> {
                handlePushRequestPermission(args, callbackContext); true
            }
            ACTION_PUSH_GET_PERMISSION_STATE -> {
                handlePushGetPermissionState(callbackContext); true
            }
            ACTION_PUSH_DID_RECEIVE_AUTHORIZATION -> {
                handlePushDidReceiveAuthorization(args, callbackContext); true
            }
            ACTION_PUSH_DID_RECEIVE_NOTIFICATION,
            ACTION_PUSH_DID_RECEIVE_RESPONSE -> {
                handleManualModeStub(callbackContext); true
            }
            ACTION_LOG_IDENTIFICATION_EVENT -> {
                handleLogIdentificationEvent(args, callbackContext); true
            }
            ACTION_FLUSH_QUEUES -> {
                handleFlushQueues(callbackContext); true
            }
            ACTION_IS_SDK_ENABLED -> {
                // Used by JS on deviceready to detect auto-init and update UI.
                callbackContext.sendPluginResult(
                    PluginResult(PluginResult.Status.OK, Connect.isEnabled())
                ); true
            }
            ACTION_SET_CURRENT_SCREEN_NAME -> {
                handleSetCurrentScreenName(args, callbackContext); true
            }
            ACTION_LOG_CUSTOM_EVENT -> {
                handleLogCustomEvent(args, callbackContext); true
            }
            else -> {
                callbackContext.sendPluginResult(
                    PluginResult(PluginResult.Status.INVALID_ACTION, action)
                )
                false
            }
        }
    }

    internal fun handleEnable(args: JSONArray, callbackContext: CallbackContext) {
        // Cancel any pending bundled-config init Runnable. removeCallbacks() is
        // thread-safe; if the Runnable already ran this is a no-op.
        autoInitRunnable?.let { mainHandler.removeCallbacks(it) }
        autoInitRunnable = null
        logFcmAvailability()
        val appKey = args.optString(0, "")
        val postURL = args.optString(1, "")
        if (appKey.isBlank()) {
            callbackContext.error(
                errorJson(CODE_INVALID_ARGS, "enable: appKey is empty")
            )
            return
        }
        if (postURL.isBlank()) {
            callbackContext.error(
                errorJson(CODE_INVALID_ARGS, "enable: postURL is empty")
            )
            return
        }
        val modeString = args.optString(2, PUSH_MODE_AUTOMATIC)
        if (modeString !in VALID_PUSH_MODES) {
            callbackContext.error(
                errorJson(CODE_INVALID_ARGS,
                    "enable: pushMode must be 'automatic' (Android only supports automatic mode)")
            )
            return
        }
        pushMode = modeString
        val options = args.optJSONObject(3) ?: JSONObject()

        val activity = cordova.activity
        if (activity == null) {
            callbackContext.error(
                errorJson(CODE_INTERNAL_ERROR, "enable: no host activity")
            )
            return
        }

        activity.runOnUiThread {
            check(Looper.myLooper() == Looper.getMainLooper()) {
                "Connect.init/enable must run on the main looper"
            }
            try {
                // Guard against double-init: tryBundledConfigInit may have already
                // completed on the main thread before removeCallbacks() could cancel it.
                if (!Connect.isEnabled()) {
                    Connect.init(activity.application)
                    Connect.enable(appKey, postURL)
                }

                val iconRes = resolveIconRes(activity, options)

                // strict=false: auto-detect available push provider instead of
                // requiring FCM to pass a strict GMS availability check.
                // strict=true causes "GMS: false" on emulators and devices where
                // GoogleApiAvailability returns non-SUCCESS even when FCM works.
                // The failure callback is non-fatal: turnOnPush is the authoritative
                // result. Treating push.enable failure as fatal caused a race where
                // the error callback could fire before turnOnPush succeeded, sending
                // a JS error even though push registration completed normally.
                Connect.push.enable(
                    activity.application,
                    false,
                    iconRes,
                    MobileServiceType.FCM
                ) { exception ->
                    Log.w(TAG, "push.enable warning (non-fatal, strict=false): ${exception.message}")
                }
                val work = Connect.push.turnOnPush()
                work.addOnSuccessListener {
                    // Flush any events queued before enable() was called —
                    // notably push_received logged while the app was killed.
                    Connect.flushQueues()
                    workWrapper.success(callbackContext)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        (cordova.activity as? ComponentActivity)?.let { comp ->
                            cordova.activity.runOnUiThread {
                                Connect.push.requestNotificationPermission(comp) { _ -> }
                            }
                        }
                    }
                }
                work.addOnFailureListener { t ->
                    workWrapper.error(
                        callbackContext,
                        CODE_INTERNAL_ERROR,
                        t.message ?: "turnOnPush failed"
                    )
                }
            } catch (t: Throwable) {
                callbackContext.error(
                    errorJson(CODE_INTERNAL_ERROR, t.message ?: "enable failed")
                )
            }
        }
    }

    /**
     * Resolves the notification small-icon resource for [Connect.push.enable].
     *
     * Fallback chain (first non-zero result wins):
     * 1. `androidIconResName` option value — explicitly configured name in drawable.
     * 2. `ic_notification` in drawable — the dedicated monochrome notification icon
     *    that ships with the plugin. This is the correct default: notification small
     *    icons must be simple white-on-transparent vectors; launcher icons (adaptive
     *    WebP) are NOT valid and cause a fatal IllegalArgumentException at delivery.
     * 3. `ic_launcher` in drawable — legacy fallback; may not exist in projects that
     *    use mipmap-only launcher icons.
     *
     * Returns 0 only if every lookup fails; the SDK then uses its own default.
     */
    internal fun resolveIconRes(activity: Activity, options: JSONObject): Int {
        val resources = activity.resources
        val packageName = activity.packageName

        // 1. Explicitly configured name.
        val requested = options.optString("androidIconResName", "")
        if (requested.isNotEmpty()) {
            val resolved = resources.getIdentifier(requested, "drawable", packageName)
            if (resolved != 0) return resolved
            Log.w(TAG, "androidIconResName='$requested' not found in drawable; falling back")
        }

        // 2. Dedicated notification icon — always a valid monochrome drawable.
        val notifIcon = resources.getIdentifier("ic_notification", "drawable", packageName)
        if (notifIcon != 0) return notifIcon

        // 3. Launcher icon drawable (legacy; mipmap-based projects may not have this).
        val launcherDrawable = resources.getIdentifier("ic_launcher", "drawable", packageName)
        if (launcherDrawable != 0) return launcherDrawable

        Log.e(TAG, "No valid notification small icon found — " +
                "add ic_notification.xml to drawable/ or set androidIconResName in ConnectConfig.json")
        return 0
    }

    /**
     * `pushRequestPermission`. API 33+ presents the system
     * notification permission dialog via the Connect SDK; pre-API 33
     * auto-resolves `{ granted: true }` because Android < 13 grants
     * notifications implicitly at install time.
     */
    internal fun handlePushRequestPermission(
        @Suppress("UNUSED_PARAMETER") args: JSONArray,
        callbackContext: CallbackContext
    ) {
        val activity = cordova.activity
        if (activity == null) {
            // Never rejects — structured error so JS callers skip try/catch.
            callbackContext.success(
                JSONObject().apply { put("granted", false); put("error", "no-foreground-activity") }
            )
            return
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            callbackContext.success(JSONObject().apply { put("granted", true) })
            return
        }
        val componentActivity = activity as? ComponentActivity
        if (componentActivity == null) {
            callbackContext.success(
                JSONObject().apply { put("granted", false); put("error", "activity-not-component-activity") }
            )
            return
        }
        activity.runOnUiThread {
            try {
                Connect.push.requestNotificationPermission(componentActivity) { granted ->
                    workWrapper.success(
                        callbackContext,
                        JSONObject().apply { put("granted", granted) }
                    )
                }
            } catch (t: Throwable) {
                workWrapper.success(
                    callbackContext,
                    JSONObject().apply {
                        put("granted", false)
                        put("error", t.message ?: "permission-request-failed")
                    }
                )
            }
        }
    }

    /**
     * `pushGetPermissionState`. Maps Connect SDK
     * `PushPermissionState` to the unified tri-state JS contract
     * (`true` / `false` / `null`) per IDF §Method semantics.
     */
    internal fun handlePushGetPermissionState(callbackContext: CallbackContext) {
        val activity = cordova.activity
        if (activity == null) {
            // Never rejects — tri-state null signals NOT_DETERMINED to JS callers.
            callbackContext.sendPluginResult(PluginResult(PluginResult.Status.OK))
            return
        }
        activity.runOnUiThread {
            try {
                val result = when (Connect.push.getPushPermissionState(activity)) {
                    PushPermissionState.GRANTED        -> PluginResult(PluginResult.Status.OK, true)
                    PushPermissionState.DENIED         -> PluginResult(PluginResult.Status.OK, false)
                    PushPermissionState.NOT_DETERMINED -> PluginResult(PluginResult.Status.OK)
                    null                               -> PluginResult(PluginResult.Status.OK)
                }
                cordova.threadPool.execute {
                    callbackContext.sendPluginResult(result)
                }
            } catch (t: Throwable) {
                Log.w(TAG, "getPushPermissionState failed: ${t.message}")
                cordova.threadPool.execute {
                    callbackContext.sendPluginResult(PluginResult(PluginResult.Status.OK))
                }
            }
        }
    }

    /**
     * `pushDidReceiveAuthorization`. Defense-in-depth null
     * drop — the JS façade already short-circuits null/undefined per
     * [api-contract §4]. Android's ConnectPush has no analogous
     * didReceiveAuthorization API; the SDK reconciles consent via
     * ActivityLifecycleCallbacks internally. The handler's job is to
     * satisfy the cross-platform JS contract.
     */
    internal fun handlePushDidReceiveAuthorization(
        args: JSONArray,
        callbackContext: CallbackContext
    ) {
        val granted = args.opt(0)
        if (granted == null || granted == JSONObject.NULL) {
            callbackContext.sendPluginResult(
                PluginResult(PluginResult.Status.OK, false)
            )
            return
        }
        callbackContext.sendPluginResult(
            PluginResult(PluginResult.Status.OK, true)
        )
    }


    internal fun handleDisable(callbackContext: CallbackContext) {
        val activity = cordova.activity
        if (activity == null) {
            callbackContext.error(
                errorJson(CODE_INTERNAL_ERROR, "disable: no host activity")
            )
            return
        }
        activity.runOnUiThread {
            try {
                Connect.disable()
                callbackContext.success()
            } catch (t: Throwable) {
                callbackContext.error(
                    errorJson(CODE_INTERNAL_ERROR, t.message ?: "disable failed")
                )
            }
        }
    }

    internal fun handleSetLogLevel(args: JSONArray, callbackContext: CallbackContext) {
        val level = args.optString(0, "")
        if (level !in VALID_LOG_LEVELS) {
            callbackContext.error(
                errorJson(
                    CODE_INVALID_ARGS,
                    "setLogLevel: level must be one of $VALID_LOG_LEVELS"
                )
            )
            return
        }
        bridgeLogLevel = level
        callbackContext.success()
    }

    /**
     * Logs an identification event via `Connect.logIdentificationEvent`.
     * args[0]=identifierName, args[1]=identifierValue, args[2]=signalType,
     * args[3]=additionalParameters (JSONObject → Map<String,String>).
     */
    internal fun handleLogIdentificationEvent(args: JSONArray, callbackContext: CallbackContext) {
        val name       = args.optString(0, "").trim()
        val value      = args.optString(1, "").trim()
        val signalType = args.optString(2, "loggedIn").trim().ifBlank { "loggedIn" }
        val additionalParameters: Map<String, String> = args.optJSONObject(3)?.let { json ->
            json.keys().asSequence().associate { key -> key to json.optString(key) }
        } ?: emptyMap()
        if (name.isBlank() || value.isBlank()) {
            callbackContext.error(
                errorJson(CODE_INVALID_ARGS, "logIdentificationEvent: name and value are required")
            )
            return
        }
        val activity = cordova.activity ?: run {
            callbackContext.error(errorJson(CODE_INTERNAL_ERROR, "logIdentificationEvent: no host activity"))
            return
        }
        activity.runOnUiThread {
            try {
                val ok = Connect.logIdentificationEvent(
                    identifierName       = name,
                    identifierValue      = value,
                    signalType           = signalType,
                    additionalParameters = additionalParameters
                )
                if (ok) {
                    // Flush immediately so the server sees the identity signal without
                    // waiting for the SDK's next scheduled batch upload.
                    Tealeaf.flushAll(false)
                    workWrapper.success(callbackContext)
                } else {
                    workWrapper.error(
                        callbackContext,
                        CODE_INTERNAL_ERROR,
                        "logIdentificationEvent returned false — SDK may not be enabled"
                    )
                }
            } catch (t: Throwable) {
                workWrapper.error(
                    callbackContext,
                    CODE_INTERNAL_ERROR,
                    t.message ?: "logIdentificationEvent failed"
                )
            }
        }
    }

    /**
     * Flushes queued Analytics events to the collector immediately.
     * Mirrors `onFlushMessages` in the Android Java demo's NotificationViewModel.
     * Never rejects — best-effort fire-and-forget; resolves success once the
     * call has been dispatched (delivery is async inside the SDK).
     */
    internal fun handleFlushQueues(callbackContext: CallbackContext) {
        if (!Connect.isEnabled()) {
            callbackContext.success()
            return
        }
        val activity = cordova.activity ?: run {
            callbackContext.success()
            return
        }
        activity.runOnUiThread {
            try {
                Connect.flushQueues()
                callbackContext.success()
            } catch (t: Throwable) {
                Log.w(TAG, "flushQueues threw: ${t.message}")
                callbackContext.success()
            }
        }
    }

    /**
     * Updates the logical screen name reported to the Connect SDK.
     * Mirrors [Connect.resumeConnect] / RN's [setCurrentScreenName].
     * Call this on every tab/page navigation so the server sees distinct
     * screen identifiers (e.g. "notification_screen", "identity_screen").
     */
    internal fun handleSetCurrentScreenName(args: JSONArray, callbackContext: CallbackContext) {
        val name = args.optString(0, "").trim()
        if (name.isBlank()) {
            callbackContext.error(errorJson(CODE_INVALID_ARGS, "setCurrentScreenName: name is required"))
            return
        }
        val activity = cordova.activity ?: run {
            callbackContext.success()
            return
        }
        activity.runOnUiThread {
            try {
                // Use logScreenview (type-2 event queued directly) instead of
                // resumeConnect, which calls Logger.a() internally, triggers
                // addJavascriptInterface while the page is live, and causes a
                // WebView reload → deviceready re-fires → infinite blinking loop.
                Connect.logScreenview(activity, name, ScreenviewType.LOAD, null)
                callbackContext.success()
            } catch (t: Throwable) {
                Log.w(TAG, "setCurrentScreenName threw: ${t.message}")
                callbackContext.success()
            }
        }
    }

    /**
     * Logs a custom event.
     * @param args[0] eventName  String
     * @param args[1] values     JSON object of key→string/number/bool pairs (optional)
     * @param args[2] level      Int monitoring level (optional, default 3 = kEOMonitoringLevelInfo)
     */
    internal fun handleLogCustomEvent(args: JSONArray, callbackContext: CallbackContext) {
        val eventName = args.optString(0, "").trim()
        if (eventName.isBlank()) {
            callbackContext.error(errorJson(CODE_INVALID_ARGS, "logCustomEvent: eventName is required"))
            return
        }
        val valuesObj = args.optJSONObject(1) ?: JSONObject()
        val level = args.optInt(2, 3)
        val map = HashMap<String?, String?>()
        valuesObj.keys().forEach { k -> map[k] = valuesObj.optString(k) }

        val activity = cordova.activity ?: run { callbackContext.success(); return }
        activity.runOnUiThread {
            try {
                val ok = Connect.logCustomEvent(eventName, map, level)
                if (ok) callbackContext.success()
                else workWrapper.error(callbackContext, CODE_INTERNAL_ERROR, "logCustomEvent returned false")
            } catch (t: Throwable) {
                workWrapper.error(callbackContext, CODE_INTERNAL_ERROR, t.message ?: "logCustomEvent failed")
            }
        }
    }

    private fun handleManualModeStub(callbackContext: CallbackContext) {
        callbackContext.error(
            errorJson(CODE_PUSH_MODE_NOT_MANUAL, "Android does not support manual push mode")
        )
    }

    private fun errorJson(code: String, message: String): JSONObject =
        JSONObject().apply {
            put("code", code)
            put("message", message)
        }

    /**
     * Reads credentials saved by a previous successful `enable()` call and
     * re-initialises the SDK at plugin load time.Apps that call `enable()` once don't need
     * to call it again on every subsequent cold start.
     */
    /**
     * First-launch initialisation from the bundled `BasicConfig.properties`.
     * Mirrors `ConnectWrapper` / `ViewModel` auto-init in the Android Java demo:
     * `Connect.init(application)` + `Connect.enable()` (no explicit args — the SDK
     * reads AppKey and PostMessageUrl from the bundled properties file).
     *
     * Runs on startup (first install, cleared data, or every launch if the SDK
     * has not yet been enabled via JS). A rapid JS `enable(appKey, postURL)` call
     * cancels the pending [autoInitRunnable] via [handleEnable] and takes over.
     */
    private fun tryBundledConfigInit() {
        val activity = cordova.activity ?: return
        Log.i(TAG, "pluginInitialize: no saved credentials — auto-initialising from bundled BasicConfig.properties")
        val r = Runnable {
            autoInitRunnable = null
            if (Connect.isEnabled()) return@Runnable
            try {
                Connect.init(activity.application)
                // No-arg enable() reads AppKey + PostMessageUrl from the assets/
                // BasicConfig.properties bundled by the after_prepare hook — same
                // path as the Android Java demo's ConnectWrapper initialisation.
                Connect.enable()
                pushMode = PUSH_MODE_AUTOMATIC
                val iconRes = resolveIconRes(activity, JSONObject())
                Connect.push.enable(
                    activity.application, false, iconRes, MobileServiceType.FCM
                ) { exception ->
                    Log.w(TAG, "bundled-init: push.enable failed: ${exception.message}")
                }
                val work = Connect.push.turnOnPush()
                work.addOnSuccessListener {
                    Connect.flushQueues()
                    Log.i(TAG, "bundled-init: SDK enabled from bundled config")
                    // Request POST_NOTIFICATIONS on API 33+ — mirrors handleEnable() behaviour
                    // so first launch / reinstall shows the permission dialog automatically.
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        (cordova.activity as? ComponentActivity)?.let { comp ->
                            cordova.activity.runOnUiThread {
                                Connect.push.requestNotificationPermission(comp) { _ -> }
                            }
                        }
                    }
                }
                work.addOnFailureListener { t ->
                    Log.w(TAG, "bundled-init: turnOnPush failed: ${t.message}")
                }
            } catch (t: Throwable) {
                Log.w(TAG, "bundled-init: Connect.init/enable failed — ${t.message}. " +
                    "Ensure ConnectBasicConfig.properties is present in assets/ " +
                    "(run `cordova prepare android` to regenerate it from ConnectConfig.json).")
            }
        }
        autoInitRunnable = r
        mainHandler.post(r)
    }

    private fun logFcmAvailability() {
        val available = isConnectPushFcmAvailable()
        Log.i(TAG, "[config] connect-push-fcm on classpath: $available")
        if (!available) {
            Log.w(TAG, "[config] Push inactive — set Connect.PushEnabled=true in ConnectConfig and re-sync Gradle")
        }
    }

    /**
     * Probes whether the `connect-push-fcm` artifact is on the classpath.
     * A missing class means push was excluded from the build; surfaces
     * misconfiguration in logcat at enable() time rather than silently at
     * push-delivery time.
     */
    private fun isConnectPushFcmAvailable(): Boolean {
        return try {
            Class.forName(CONNECT_PUSH_FCM_PROBE_CLASS)
            true
        } catch (e: ClassNotFoundException) {
            false
        }
    }

    companion object {
        private const val TAG = "ConnectPlugin"

        // Action names — must match `www/AcousticConnect.js` exactly.
        internal const val ACTION_ENABLE = "enable"
        internal const val ACTION_DISABLE = "disable"
        internal const val ACTION_SET_LOG_LEVEL = "setLogLevel"
        internal const val ACTION_PUSH_REQUEST_PERMISSION = "pushRequestPermission"
        internal const val ACTION_PUSH_GET_PERMISSION_STATE = "pushGetPermissionState"
        internal const val ACTION_PUSH_DID_RECEIVE_AUTHORIZATION =
            "pushDidReceiveAuthorization"
        internal const val ACTION_PUSH_DID_RECEIVE_NOTIFICATION =
            "pushDidReceiveNotification"
        internal const val ACTION_PUSH_DID_RECEIVE_RESPONSE = "pushDidReceiveResponse"
        internal const val ACTION_LOG_IDENTIFICATION_EVENT = "logIdentificationEvent"
        internal const val ACTION_FLUSH_QUEUES             = "flushQueues"
        internal const val ACTION_IS_SDK_ENABLED           = "isSdkEnabled"
        internal const val ACTION_SET_CURRENT_SCREEN_NAME  = "setCurrentScreenName"
        internal const val ACTION_LOG_CUSTOM_EVENT          = "logCustomEvent"

        internal const val PUSH_MODE_AUTOMATIC = "automatic"
        // Android Connect SDK only supports automatic mode.
        internal val VALID_PUSH_MODES = setOf(PUSH_MODE_AUTOMATIC)

        internal const val LOG_LEVEL_DEFAULT = "error"
        internal const val LOG_LEVEL_VERBOSE = "verbose"
        internal val VALID_LOG_LEVELS =
            setOf("silent", "error", "warn", "info", "verbose")

        internal const val CODE_INVALID_ARGS = "ACOUSTIC_INVALID_ARGS"
        internal const val CODE_INTERNAL_ERROR = "ACOUSTIC_INTERNAL_ERROR"
        internal const val CODE_PUSH_MODE_NOT_MANUAL = "ACOUSTIC_PUSH_MODE_NOT_MANUAL"

        private const val CONNECT_PUSH_FCM_PROBE_CLASS =
            "com.acoustic.connect.android.connectmod.push.services.fcm.FCMPushService"

    }
}

/**
 * Thread-safety glue between Connect Android SDK `Work<T>` callbacks and
 * Cordova's threading model.
 *
 * The Connect SDK dispatches `Work<T>.addOnSuccessListener` /
 * `addOnFailureListener` on its internal worker thread. Cordova's
 * `CallbackContext.success` / `error` is documented as thread-safe, but
 * routing every result through `cordova.threadPool` (a) keeps event
 * ordering predictable, (b) gives a single place to add back-pressure or
 * tracing, and (c) avoids surprising the WebView main-thread expectations.
 *
 * Usage example:
 * ```
 * val work: Work<Token> = Connect.push.getToken()
 * work.addOnSuccessListener { token ->
 *     workWrapper.success(callbackContext, token.value)
 * }
 * work.addOnFailureListener { t ->
 *     workWrapper.error(
 *         callbackContext,
 *         ConnectPlugin.CODE_INTERNAL_ERROR,
 *         t.message ?: "failure"
 *     )
 * }
 * ```
 *
 * Never `runBlocking { ... }` here — the Cordova plugin thread cannot be
 * suspended.
 */
internal class WorkWrapper(private val cordova: CordovaInterface) {

    fun success(callbackContext: CallbackContext) {
        cordova.threadPool.execute { callbackContext.success() }
    }

    fun success(callbackContext: CallbackContext, value: String?) {
        cordova.threadPool.execute {
            if (value == null) callbackContext.success() else callbackContext.success(value)
        }
    }

    fun success(callbackContext: CallbackContext, value: JSONObject) {
        cordova.threadPool.execute { callbackContext.success(value) }
    }

    fun success(callbackContext: CallbackContext, value: Boolean) {
        cordova.threadPool.execute { callbackContext.success(if (value) 1 else 0) }
    }

    fun error(
        callbackContext: CallbackContext,
        code: String,
        message: String
    ) {
        cordova.threadPool.execute {
            val err = JSONObject().apply {
                put("code", code)
                put("message", message)
            }
            callbackContext.error(err)
        }
    }
}
