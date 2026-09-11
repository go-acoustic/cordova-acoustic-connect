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
import com.acoustic.connect.android.connectmod.model.ConnectScreenviewType
import com.acoustic.connect.android.connectmod.push.PushPermissionState
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

    // applyKillSwitchConfig's re-apply runnable, tracked the same way as
    // autoInitRunnable so onDestroy() can cancel it — mainHandler is bound to
    // the process-wide main Looper, not this plugin instance's lifecycle, so a
    // pending postDelayed(..., CONFIG_REAPPLY_DELAY_MS) would otherwise
    // still fire after the WebView/Activity that created this plugin is gone.
    @Volatile private var killSwitchRunnable: Runnable? = null

    override fun pluginInitialize() {
        super.pluginInitialize()
        workWrapper = WorkWrapper(cordova)
        Log.d(TAG, "pluginInitialize pushMode=$pushMode logLevel=$bridgeLogLevel")
        tryBundledConfigInit()
    }

    override fun onDestroy() {
        autoInitRunnable?.let { mainHandler.removeCallbacks(it) }
        autoInitRunnable = null
        killSwitchRunnable?.let { mainHandler.removeCallbacks(it) }
        killSwitchRunnable = null
        super.onDestroy()
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
            ACTION_GET_SDK_VERSION -> {
                callbackContext.sendPluginResult(
                    PluginResult(PluginResult.Status.OK, Connect.getLibraryVersion())
                ); true
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
                // Captured once, up front: whether the SDK was already fully set up
                // before this call — e.g. tryBundledConfigInit won the race against
                // this handleEnable call despite the removeCallbacks() above (see its
                // own comment). Previously only Connect.init/enable were guarded by
                // this check; push.enable/turnOnPush/requestNotificationPermission
                // below ran unconditionally every time handleEnable was invoked. That
                // let the auto-init path AND a racing handleEnable call both run the
                // full push-init sequence, registering a second
                // ActivityLifecycleCallbacks/BroadcastReceiver in the native SDK
                // (com.acoustic...push.ConnectPush — registerActivityLifecycleCallbacks
                // and registerReceiver are both additive, not idempotent) and
                // requesting notification permission twice — producing duplicate
                // "Create token registration event"/"New token received" logs and the
                // "Attempted to send a second callback" Cordova bridge warning from a
                // second requestNotificationPermission call. Skipping the whole
                // sequence (not just init/enable) when already enabled fixes this at
                // the source instead of just deduplicating the resulting logs.
                val alreadyEnabled = Connect.isEnabled()
                if (!alreadyEnabled) {
                    Connect.init(activity.application)
                    val nativeConfig = readNativeConfig(activity.application)
                    applyDisplayLoggingConfig(activity.application, nativeConfig)
                    // Must run before Connect.enable(): LogLocationEnabled is read once
                    // inside the SDK's own enable() body (see the function's own doc).
                    applyLocationLoggingConfig(activity.application, nativeConfig)
                    Connect.enable(appKey, postURL)
                    applyKillSwitchConfig(activity.application, nativeConfig)
                    // Screen/layout capture is deliberately left at the SDK's own
                    // default (on) here — see applyScreenCaptureConfig's doc comment
                    // for why it exists but isn't invoked.
                } else {
                    // Push setup already ran via whichever path enabled the SDK
                    // first — resolve success without repeating it.
                    workWrapper.success(callbackContext)
                    return@runOnUiThread
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
                    flushTealeafImmediately()
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
                Connect.logScreenview(activity, name, ConnectScreenviewType.LOAD, null)
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
     * Forces an immediate server post of queued events, bypassing the SDK's normal
     * batch-upload timer.
     *
     * NOT the same as `Connect.flushQueues()`: that public method delegates to
     * `EOCore.flushQueues()` -> `QueueService.flushQueues()`, which only calls
     * `saveToCache(true)` — it persists the in-memory queue to disk cache but does
     * NOT trigger a network post. The old direct call this replaces,
     * `Tealeaf.flushAll(false)`, called `TLFCache.flush(false)` AND
     * `requestManualServerPost(true)` — the second call is what actually posts
     * immediately. Both verified by decompiling tealeaf/eocore's classes.jar.
     *
     * `Tealeaf` is a runtime-only dependency of `connect` (the single-artifact
     * merge), so it's not on the compile classpath here
     * and there's no public `Connect` API that exposes `requestManualServerPost`.
     * Reflection is the only way to reach it without a compile-time dependency; if it
     * fails (e.g. a future SDK release renames/removes the method), falls back to
     * `Connect.flushQueues()` so the event still reaches disk cache and goes out on
     * the SDK's next scheduled batch, rather than silently doing nothing.
     */
    private fun flushTealeafImmediately() {
        try {
            val tealeafClass = Class.forName("com.tl.uic.Tealeaf")
            val flushAll = tealeafClass.getMethod("flushAll", java.lang.Boolean::class.java)
            flushAll.invoke(null, java.lang.Boolean.FALSE)
        } catch (t: Throwable) {
            Log.w(TAG, "Tealeaf.flushAll reflection failed — falling back to " +
                "Connect.flushQueues() (queues to disk cache, posts on the SDK's next " +
                "scheduled batch instead of immediately): ${t.message}")
            Connect.flushQueues()
        }
    }

    /**
     * Reads credentials saved by a previous successful `enable()` call and
     * re-initialises the SDK at plugin load time.Apps that call `enable()` once don't need
     * to call it again on every subsequent cold start.
     */
    /**
     * First-launch initialisation from the bundled `BasicConfig.properties`.
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
                val nativeConfig = readNativeConfig(activity.application)
                applyDisplayLoggingConfig(activity.application, nativeConfig)
                // No-arg enable() reads AppKey + PostMessageUrl from the assets/
                // BasicConfig.properties bundled by the after_prepare hook — same
                // path as the Android Java demo's ConnectWrapper initialisation.
                // Forwards to Tealeaf.enable(null) internally, which never reaches the
                // 100ms-delayed kill-switch handler (see applyKillSwitchConfig) — so
                // ConnectBasicConfig.properties' KillSwitchEnabled value already sticks
                // here without a re-apply. applyKillSwitchConfig is still called below
                // as a safety net against a future SDK version changing that internal
                // behavior — this was verified against checked-out SDK source, not the
                // exact pinned Maven artifact.
                //
                // applyLocationLoggingConfig must run before Connect.enable() too — the
                // 0-arg path still reaches Tealeaf's enable(String sessionId) body (via
                // enable(null)) that reads LogLocationEnabled once.
                applyLocationLoggingConfig(activity.application, nativeConfig)
                Connect.enable()
                applyKillSwitchConfig(activity.application, nativeConfig)
                // Screen/layout capture left at the SDK default here too — see
                // applyScreenCaptureConfig's doc comment.
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
                    // Request POST_NOTIFICATIONS on API 33+
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

    // Parsed contents of www/AcousticConnectNativeConfig.json (bundled into assets by
    // Cordova, generated by before_prepare_connect_config.js) — the cross-platform
    // native runtime config shared with ConnectPlugin.swift.
    internal data class NativeConfig(
        val useRelease: Boolean,
        val killSwitchEnabled: Boolean,
        val killSwitchUrl: String?,
        // null = not configured by the app — leave the SDK's own default alone. Unlike
        // killSwitchEnabled, this plugin does not decide a default for location logging.
        val locationLoggingEnabled: Boolean? = null
    )

    private fun readNativeConfig(context: Context): NativeConfig {
        return try {
            val json = context.assets.open("www/AcousticConnectNativeConfig.json")
                .bufferedReader()
                .use { it.readText() }
            parseNativeConfig(json)
        } catch (t: Throwable) {
            NativeConfig(useRelease = false, killSwitchEnabled = false, killSwitchUrl = null)
        }
    }

    // Pure parsing split out from readNativeConfig so it's testable without mocking
    // android.content.res.AssetManager (final, not mockable without mockito-inline,
    // which this module deliberately doesn't depend on).
    internal fun parseNativeConfig(json: String): NativeConfig {
        return try {
            val obj = JSONObject(json)
            NativeConfig(
                useRelease = obj.optBoolean("useRelease", false),
                killSwitchEnabled = obj.optBoolean("killSwitchEnabled", false),
                killSwitchUrl = obj.optString("killSwitchUrl", "").ifBlank { null },
                locationLoggingEnabled = if (obj.has("locationLoggingEnabled") && !obj.isNull("locationLoggingEnabled")) {
                    obj.getBoolean("locationLoggingEnabled")
                } else {
                    null
                }
            )
        } catch (t: Throwable) {
            NativeConfig(useRelease = false, killSwitchEnabled = false, killSwitchUrl = null)
        }
    }

    /**
     * Applies `useRelease` as the native SDK's `DisplayLogging` config — mirrors iOS's
     * useRelease -> release/debug pod selection, which suppresses verbose native SDK
     * logging outright in production builds.
     *
     * Deliberately NOT done via an app-level EOCoreBasicConfig.properties asset
     * override: Android's asset merge replaces the *entire* file on a name
     * collision, and the SDK's bundled EOCoreBasicConfig.properties carries other
     * required keys (e.g. PostMessageTimeInterval) that a partial override would
     * silently drop, crashing QueueService at enable() time.
     *
     * Must run after Connect.init() — that call chain is what enables EOCore and
     * loads its config service.
     *
     * Targets the "EOCore" module by name via the 3-arg `Connect.updateConfig(key,
     * value, module: String)` overload — Tealeaf/EOCore are runtime-only dependencies of
     * Connect (the single-artifact merge), so their types (e.g. `EOCore.getInstance()`)
     * are no longer on the compile classpath.
     * `updateConfig`'s String overload resolves the module by name internally.
     */
    private fun applyDisplayLoggingConfig(context: Context, config: NativeConfig) {
        try {
            // See applyKillSwitchConfig — updateConfig's String-module overload
            // returns false rather than throwing when the module isn't registered.
            val applied = Connect.updateConfig(
                "DisplayLogging", (!config.useRelease).toString(), "EOCore"
            )
            if (!applied) {
                Log.w(TAG, "applyDisplayLoggingConfig: \"EOCore\" module update failed — skipping")
            }
        } catch (t: Throwable) {
            Log.w(TAG, "applyDisplayLoggingConfig failed — leaving native SDK logging at its default: ${t.message}")
        }
    }

    /**
     * Applies `killSwitchEnabled`/`killSwitchUrl` as the native SDK's kill-switch config.
     *
     * The SDK's own bundled default is `KillSwitchEnabled=true`; ConnectBasicConfig.properties
     * sets it `false` at asset-load time, but that is NOT the last word: the 2-arg
     * `Tealeaf.enable(appKey, postMessageUrl)` that `handleEnable()` calls has an internal
     * `Handler.postDelayed(..., 100)` that unconditionally sets `KillSwitchEnabled=true` and
     * computes its own kill-switch URL, once, ~100ms after being called. So whatever value
     * the app actually wants (on OR off) must be re-applied *after* that window to stick —
     * this schedules the re-apply at [CONFIG_REAPPLY_DELAY_MS], comfortably past the
     * SDK's own 100ms delay.
     *
     * Targets the "Tealeaf" module, not EOCore's — confirmed via `Tealeaf.java`'s own
     * KillSwitchEnabled/KillSwitchUrl reads and writes, which all pass
     * `TealeafEOLifecycleObject.getInstance()` as the module. Passed by name ("Tealeaf")
     * to the 3-arg `Connect.updateConfig(key, value, module: String)` overload rather than
     * resolved via `Connect.getLifecycleObject()` — Tealeaf/EOCore are runtime-only
     * dependencies of Connect (the single-artifact merge), so `EOLifecycleObject`
     * is no longer on the compile classpath either.
     *
     * Called from both `handleEnable()` (2-arg `Connect.enable(appKey, postURL)`) and
     * `tryBundledConfigInit()` (0-arg `Connect.enable()`). Strictly required only for the
     * 2-arg path — the 0-arg path forwards to `Tealeaf.enable(null)` internally, which never
     * reaches the delayed handler, so the properties-file value already sticks there without
     * a race. Called on both paths anyway as a defense-in-depth safety net: that "0-arg never
     * races" behavior was verified against checked-out SDK source, not the exact pinned Maven
     * artifact, and the call is cheap enough that keeping both paths symmetric is worth it.
     *
     * The scheduled runnable is tracked in [killSwitchRunnable] and cancelled in
     * [onDestroy] — `mainHandler` is bound to the process-wide main Looper, not this
     * plugin instance, so an uncancelled callback would otherwise still fire after the
     * WebView/Activity that created this plugin instance is gone.
     */
    internal fun applyKillSwitchConfig(context: Context, config: NativeConfig) {
        val r = Runnable {
            killSwitchRunnable = null
            try {
                // updateConfig's String-module overload returns false (rather than
                // throwing) when the named module isn't registered — e.g. the SDK was
                // never initialized — so the failure must be checked explicitly; a bare
                // try/catch around it would silently see success.
                val applied = Connect.updateConfig(
                    "KillSwitchEnabled", config.killSwitchEnabled.toString(), "Tealeaf"
                )
                if (!applied) {
                    Log.w(TAG, "applyKillSwitchConfig: \"Tealeaf\" module update failed — skipping")
                    return@Runnable
                }
                if (config.killSwitchEnabled && !config.killSwitchUrl.isNullOrBlank()) {
                    Connect.updateConfig("KillSwitchUrl", config.killSwitchUrl, "Tealeaf")
                }
            } catch (t: Throwable) {
                Log.w(TAG, "applyKillSwitchConfig failed — leaving native SDK kill switch at its default: ${t.message}")
            }
        }
        killSwitchRunnable = r
        mainHandler.postDelayed(r, CONFIG_REAPPLY_DELAY_MS)
    }

    /**
     * Applies `locationLoggingEnabled` as the native SDK's `LogLocationEnabled` config —
     * a no-op unless the app has explicitly opted in or out via `ConnectConfig.json`'s
     * `LocationLoggingEnabled`.
     *
     * Must be called synchronously, BEFORE `Connect.enable(appKey, postURL)` — the
     * opposite timing requirement from [applyKillSwitchConfig]. Confirmed via checked-out
     * `Tealeaf.java` source: `TLF_LOG_LOCATION_ENABLED` is read exactly once, inside
     * `enable(String sessionId)`, to decide whether to start the SDK's geolocation task —
     * there is no delayed reset the way `KillSwitchEnabled` has, so setting it after
     * `enable()` would be too late (the task would already have started or not, based on
     * whatever the SDK's own default was). The "Tealeaf" module resolves immediately here
     * too — registered synchronously inside `Connect.init()`, which this plugin always
     * calls first — so no scheduling delay is needed for module availability either. Passed
     * by name to `Connect.updateConfig(key, value, module: String)` rather than resolved via
     * `Connect.getLifecycleObject()` — see [applyKillSwitchConfig] for why.
     *
     * Note: this only stops location data reaching the collector. It does NOT remove the
     * `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION` permissions the Tealeaf AAR's own
     * manifest declares (auto-merged into the host app's manifest regardless of this
     * flag) — those still show up in the merged manifest either way.
     */
    internal fun applyLocationLoggingConfig(context: Context, config: NativeConfig) {
        val locationLoggingEnabled = config.locationLoggingEnabled ?: return
        try {
            // See applyKillSwitchConfig — updateConfig's String-module overload
            // returns false rather than throwing when the module isn't registered.
            val applied = Connect.updateConfig(
                "LogLocationEnabled", locationLoggingEnabled.toString(), "Tealeaf"
            )
            if (!applied) {
                Log.w(TAG, "applyLocationLoggingConfig: \"Tealeaf\" module update failed — skipping")
            }
        } catch (t: Throwable) {
            Log.w(TAG, "applyLocationLoggingConfig failed — leaving native SDK location logging at its default: ${t.message}")
        }
    }

    /**
     * Disables native screen-layout capture (`LogViewLayoutOnScreenTransition`), unconditionally.
     *
     * NOT CURRENTLY CALLED — kept, unused, pending product confirmation. This was written on
     * the assumption that "the Cordova plugin offers push + identity signals only, so the
     * SDK's own default of capturing the full native view hierarchy on every screen transition
     * adds payload size and collector storage cost with no benefit here." That's a scope
     * assumption, not a confirmed requirement — pending confirmation from product (does the
     * team actually want this disabled, or should the SDK's own default, capture on, stay in
     * effect?), the default is left alone and this function isn't invoked from `handleEnable`
     * or `tryBundledConfigInit`. Wire it back in with a single call if/when disabling is
     * confirmed as wanted.
     *
     * Targets the same "Tealeaf" module as [applyKillSwitchConfig], but unlike it, applies
     * synchronously with no re-apply delay — both verified against checked-out
     * `Tealeaf.java`/`TealeafEOLifecycleObject.java`/`EOCore.java` source:
     *  - The "Tealeaf" module is registered into EOCore's module registry synchronously inside
     *    `Connect.init()` (`Tealeaf`'s constructor -> `TealeafEOLifecycleObject.init()` ->
     *    `EOCore.addModule(...)`), which this plugin always calls before `Connect.enable(...)`.
     *    It is never gated by `enable()`'s internal 100ms-delayed callback, so the module
     *    already resolves immediately, at t=0.
     *  - `TLF_LOG_SCREENLAYOUT` ("LogViewLayoutOnScreenTransition") is only ever *read* by
     *    `Tealeaf.java` (inside its `logScreenLayout*` methods, at actual screen-transition
     *    time) — never written by `enable()`'s synchronous body or its delayed callback, unlike
     *    `KillSwitchEnabled`. There is no reset race here to guard against.
     *
     * Note: this does NOT suppress screenshot capture. That's gated by a separate, cached
     * `AutoLayout.GlobalScreenSettings.ScreenShot` JSON field with no confirmed live/flat
     * runtime toggle (unlike this key) — attempting to override it via the nested
     * `Connect.updateConfig(module, JSONObject)` path risks silently dropping other nested
     * fields (e.g. sensitive-data masking config) it isn't safe to guess the full shape of.
     * Left as a known follow-up, not attempted here.
     */
    internal fun applyScreenCaptureConfig(context: Context) {
        try {
            // See applyKillSwitchConfig — updateConfig's String-module overload
            // returns false rather than throwing when the module isn't registered.
            val applied = Connect.updateConfig("LogViewLayoutOnScreenTransition", "false", "Tealeaf")
            if (!applied) {
                Log.w(TAG, "applyScreenCaptureConfig: \"Tealeaf\" module update failed — skipping")
            }
        } catch (t: Throwable) {
            Log.w(TAG, "applyScreenCaptureConfig failed — leaving native SDK layout capture at its default: ${t.message}")
        }
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
        internal const val ACTION_GET_SDK_VERSION           = "getSdkVersion"

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

        // Tealeaf.java's 2-arg enable(appKey, postMessageUrl) overload internally
        // schedules a KillSwitchEnabled=true / KillSwitchUrl overwrite 100ms after
        // being called (its own ENABLE_DELAY). This must run comfortably after that.
        internal const val CONFIG_REAPPLY_DELAY_MS = 300L

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
