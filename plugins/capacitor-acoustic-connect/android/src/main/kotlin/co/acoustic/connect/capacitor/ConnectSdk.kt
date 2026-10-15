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

import android.app.Activity
import android.os.Build
import androidx.activity.ComponentActivity
import com.acoustic.connect.android.connectmod.Connect
import com.acoustic.connect.android.connectmod.model.ConnectScreenviewType
import com.acoustic.connect.android.connectmod.push.PushPermissionState
import com.acoustic.connect.android.connectmod.push.core.MobileServiceType

enum class ScreenViewType { LOAD, UNLOAD }

/**
 * The config module that holds the SDK's capture settings (app key, post URL, kill switch, location, layout). The SDK's public
 * `updateConfig` and `getConfigItem*` take the module as a string and have no call without one, so every setting is
 * written to this module by name.
 */
internal const val TEALEAF_CONFIG_MODULE = "Tealeaf"

/** The config module that holds the SDK's own logging setting; named the same way as [TEALEAF_CONFIG_MODULE]. */
internal const val EOCORE_CONFIG_MODULE = "EOCore"

/**
 * What the bridge needs from the Connect Android SDK. The bridge logic talks to this, so it
 * can be tested on the JVM; [ConnectSdkImpl] is the only implementation that touches the SDK.
 * Every call runs on the main thread.
 */
interface ConnectSdk {
    fun isEnabled(): Boolean
    fun libraryVersion(): String
    fun init()
    fun enable(appKey: String, postURL: String)
    fun disable()

    /** The small-icon drawable for push: the named one, else `ic_notification`, else 0 (the SDK then uses its own default). */
    fun resolveIconRes(requestedName: String?): Int
    /** True when the FCM push transport (`connect-push-fcm`) is on the classpath. */
    fun pushAvailable(): Boolean
    fun pushEnable(iconRes: Int, onWarning: (Throwable) -> Unit)
    fun turnOnPush(onSuccess: () -> Unit, onFailure: (Throwable) -> Unit)

    /** False before Android 13, which grants notifications at install time. */
    fun notificationPermissionNeeded(): Boolean

    /** Throws when there is no activity that can show the dialog. */
    fun requestNotificationPermission(onResult: (Boolean) -> Unit)

    /** `true` granted, `false` denied, `null` not determined. */
    fun pushPermissionState(): Boolean?

    fun logIdentification(name: String, value: String, signalType: String, params: Map<String, String>): Boolean
    fun flushQueues()

    /** Posts the queued events now; `flushQueues` only writes them to the cache. */
    fun flushImmediately()
    fun logScreenview(name: String, type: ScreenViewType, referrer: String?): Boolean

    /** Captures the layout of the screen on display; `delayMs` null captures now. */
    fun logScreenLayout(name: String, delayMs: Int?): Boolean
    fun logCustomEvent(name: String, values: Map<String, String>, level: Int): Boolean
    fun logSignal(values: Map<String, Any?>, level: Int): Boolean
    fun logException(message: String, stackInfo: String, unhandled: Boolean): Boolean
    fun updateConfig(key: String, value: String, module: String): Boolean
    fun getConfigItemString(key: String, module: String): String?
}

/**
 * The SDK, reached through the current activity. The two class names are the SDK's FCM service and Tealeaf, which are only
 * reached by name; they are parameters so a test can point them at stand-ins.
 */
internal class ConnectSdkImpl(
    private val activityProvider: () -> Activity?,
    private val fcmServiceClass: String = FCM_SERVICE_CLASS,
    private val tealeafClass: String = TEALEAF_CLASS,
) : ConnectSdk {

    private fun activity(): Activity = activityProvider() ?: throw IllegalStateException("no host activity")

    override fun isEnabled() = Connect.isEnabled()
    override fun libraryVersion(): String = Connect.getLibraryVersion()
    override fun init() {
        // Before the SDK builds its HTTP client: see CookieHandlerCompat.
        CookieHandlerCompat.install()
        Connect.init(activity().application)
    }
    /**
     * Enables with the no-argument `Connect.enable()` after putting the key and URL into the config.
     * `Connect.enable(appKey, url)` makes the SDK set `KillSwitchEnabled=true` about 100 ms later, which
     * overrides the app's choice, and switching it off afterwards makes the SDK disable itself (seen on
     * the pinned SDK). It also holds capture back until the kill-switch check returns, so the first screen's
     * screen view and layout are lost. The no-argument path has neither problem.
     */
    override fun enable(appKey: String, postURL: String) {
        check(Connect.updateConfig("AppKey", appKey, TEALEAF_CONFIG_MODULE)) { "could not set AppKey: SDK is not initialised" }
        check(Connect.updateConfig("PostMessageUrl", postURL, TEALEAF_CONFIG_MODULE)) { "could not set PostMessageUrl" }
        Connect.enable()
    }
    override fun disable() {
        Connect.disable()
    }

    override fun resolveIconRes(requestedName: String?): Int {
        val activity = activity()
        val resources = activity.resources
        val packageName = activity.packageName
        if (!requestedName.isNullOrEmpty()) {
            val resolved = resources.getIdentifier(requestedName, "drawable", packageName)
            if (resolved != 0) return resolved
            android.util.Log.w(TAG, "androidIconResName='$requestedName' not found in drawable; falling back")
        }
        // Notification small icons must be white on transparent; a launcher icon crashes at delivery, so it is not a
        // fallback: with no icon the SDK uses its own default.
        val resolved = resources.getIdentifier("ic_notification", "drawable", packageName)
        if (resolved != 0) return resolved
        android.util.Log.e(TAG, "No notification small icon found: add ic_notification.xml to drawable/ or pass androidIconResName")
        return 0
    }

    override fun pushAvailable(): Boolean =
        try {
            Class.forName(fcmServiceClass)
            true
        } catch (_: ClassNotFoundException) {
            false
        }

    override fun pushEnable(iconRes: Int, onWarning: (Throwable) -> Unit) {
        // strict=false: detect the available provider instead of failing a Google Play services check
        // that reports false on emulators where FCM works.
        Connect.push.enable(activity().application, false, iconRes, MobileServiceType.FCM) { onWarning(it) }
    }

    override fun turnOnPush(onSuccess: () -> Unit, onFailure: (Throwable) -> Unit) {
        val work = Connect.push.turnOnPush()
        work.addOnSuccessListener { onSuccess() }
        work.addOnFailureListener { onFailure(it) }
    }

    override fun notificationPermissionNeeded() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU

    override fun requestNotificationPermission(onResult: (Boolean) -> Unit) {
        val component = activity() as? ComponentActivity ?: throw IllegalStateException("activity-not-component-activity")
        Connect.push.requestNotificationPermission(component) { onResult(it) }
    }

    override fun pushPermissionState(): Boolean? = when (Connect.push.getPushPermissionState(activity())) {
        PushPermissionState.GRANTED -> true
        PushPermissionState.DENIED -> false
        PushPermissionState.NOT_DETERMINED, null -> null
    }

    override fun logIdentification(name: String, value: String, signalType: String, params: Map<String, String>) =
        Connect.logIdentificationEvent(
            identifierName = name,
            identifierValue = value,
            signalType = signalType,
            additionalParameters = params,
        )

    override fun flushQueues() {
        Connect.flushQueues()
    }

    /**
     * `Connect.flushQueues()` only persists the in-memory queue to the disk cache; the post is what
     * `Tealeaf.flushAll(false)` adds. Tealeaf is a runtime-only dependency of Connect and no public
     * Connect API exposes it, so it is reached by reflection, with `flushQueues` as the fallback.
     * `flushAll` takes a boxed `java.lang.Boolean` (not a primitive `boolean`), so that is the parameter type to look up.
     */
    override fun flushImmediately() {
        try {
            val tealeaf = Class.forName(tealeafClass)
            tealeaf.getMethod("flushAll", java.lang.Boolean::class.java).invoke(null, java.lang.Boolean.FALSE)
        } catch (t: Throwable) {
            android.util.Log.w(TAG, "Tealeaf.flushAll is unavailable, queued events go out with the next batch: ${t.message}")
            Connect.flushQueues()
        }
    }

    override fun logScreenview(name: String, type: ScreenViewType, referrer: String?) =
        Connect.logScreenview(
            activity(),
            name,
            if (type == ScreenViewType.LOAD) ConnectScreenviewType.LOAD else ConnectScreenviewType.UNLOAD,
            referrer,
        )

    override fun logScreenLayout(name: String, delayMs: Int?): Boolean {
        val host = activity()
        return if (delayMs == null) Connect.logScreenLayout(host, name) else Connect.logScreenLayout(host, name, delayMs)
    }

    // The SDK takes `HashMap<String?, String?>` (HashMap is invariant, so a `HashMap<String, String>` does not compile). The
    // keys and values copied in are never null; only the declared type is wider.
    override fun logCustomEvent(name: String, values: Map<String, String>, level: Int): Boolean {
        val map = HashMap<String?, String?>(values)
        return Connect.logCustomEvent(name, map, level)
    }

    override fun logSignal(values: Map<String, Any?>, level: Int): Boolean {
        val map = HashMap<String?, Any?>(values)
        return Connect.logSignal(map, level)
    }

    override fun logException(message: String, stackInfo: String, unhandled: Boolean) =
        Connect.logExceptionEvent(EXCEPTION_SOURCE, message, stackInfo, unhandled)

    override fun updateConfig(key: String, value: String, module: String) = Connect.updateConfig(key, value, module)

    override fun getConfigItemString(key: String, module: String): String? = Connect.getConfigItemString(key, module)

    private companion object {
        const val TAG = "AcousticConnect"
        const val EXCEPTION_SOURCE = "Capacitor Plugin"
        const val FCM_SERVICE_CLASS = "com.acoustic.connect.android.connectmod.push.services.fcm.FCMPushService"
        const val TEALEAF_CLASS = "com.tl.uic.Tealeaf"
    }
}
