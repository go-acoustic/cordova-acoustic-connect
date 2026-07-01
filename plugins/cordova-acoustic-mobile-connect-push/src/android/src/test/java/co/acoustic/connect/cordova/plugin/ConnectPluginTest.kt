/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Robolectric unit tests for ConnectPlugin.
 *
 * Tests in this file deliberately avoid mocking the Connect SDK's
 * `Connect.init` / `Connect.enable` static objects — they verify the
 * dispatch table, validation, manual-mode gating, and stub responses.
 */

package co.acoustic.connect.cordova.plugin

import android.app.Activity
import android.content.pm.ApplicationInfo
import android.content.res.Resources
import androidx.activity.ComponentActivity
import org.apache.cordova.CallbackContext
import org.apache.cordova.CordovaInterface
import org.apache.cordova.CordovaWebView
import org.apache.cordova.PluginResult
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.kotlin.any
import org.mockito.kotlin.argumentCaptor
import org.mockito.kotlin.clearInvocations
import org.mockito.kotlin.mock
import org.mockito.kotlin.never
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.Executors

@RunWith(RobolectricTestRunner::class)
class ConnectPluginTest {

    private lateinit var plugin: ConnectPlugin
    private lateinit var cordova: CordovaInterface
    private lateinit var webView: CordovaWebView
    private lateinit var cb: CallbackContext

    @Before
    fun setUp() {
        plugin = ConnectPlugin()
        cordova = mock()
        webView = mock()
        cb = mock()
        whenever(cordova.threadPool).thenReturn(Executors.newSingleThreadExecutor())
        plugin.initialize(cordova, webView)
        // tryAutoInit() in pluginInitialize() accesses cordova.activity; reset so
        // per-test verify(cordova, never()).activity assertions cover only the action under test.
        clearInvocations(cordova)
    }

    @Test
    fun execute_unknownAction_returnsFalse_sendsInvalidAction() {
        val result = plugin.execute("bogus", JSONArray(), cb)
        assertFalse(result)

        val captor = argumentCaptor<PluginResult>()
        verify(cb).sendPluginResult(captor.capture())
        assertEquals(
            PluginResult.Status.INVALID_ACTION.ordinal,
            captor.firstValue.status
        )
    }

    @Test
    fun execute_returnsTrue_forEveryKnownActionExceptUnknown() {
        val knownActions = listOf(
            "enable",
            "disable",
            "setLogLevel",
            "pushRequestPermission",
            "pushGetPermissionState",
            "pushDidReceiveAuthorization",
            "pushDidReceiveNotification",
            "pushDidReceiveResponse",
            "logIdentificationEvent"
        )
        for (action in knownActions) {
            val freshCb = mock<CallbackContext>()
            val args = if (action == "enable") {
                JSONArray().apply { put("key"); put("https://example.com"); put("automatic") }
            } else if (action == "setLogLevel") {
                JSONArray().apply { put("error") }
            } else {
                JSONArray()
            }
            val handled = plugin.execute(action, args, freshCb)
            assertTrue("action '$action' must be handled by ConnectPlugin", handled)
        }
    }

    @Test
    fun setLogLevel_validLevel_resolves_andPersistsOnInstance() {
        plugin.execute(
            "setLogLevel",
            JSONArray().apply { put("verbose") },
            cb
        )
        verify(cb).success()
        assertEquals("verbose", plugin.bridgeLogLevel)
    }

    @Test
    fun setLogLevel_invalidLevel_rejectsAcousticInvalidArgs() {
        plugin.execute(
            "setLogLevel",
            JSONArray().apply { put("bogus") },
            cb
        )
        val captor = argumentCaptor<JSONObject>()
        verify(cb).error(captor.capture())
        assertEquals("ACOUSTIC_INVALID_ARGS", captor.firstValue.getString("code"))
        // Bridge log level retained at default.
        assertEquals("error", plugin.bridgeLogLevel)
    }

    @Test
    fun setLogLevel_emptyString_rejectsAcousticInvalidArgs() {
        plugin.execute(
            "setLogLevel",
            JSONArray().apply { put("") },
            cb
        )
        val captor = argumentCaptor<JSONObject>()
        verify(cb).error(captor.capture())
        assertEquals("ACOUSTIC_INVALID_ARGS", captor.firstValue.getString("code"))
    }

    @Test
    fun handleDisable_beforeEnable_succeedsWithoutTouchingActivity() {
        // initialized flag is false at construction; disable is a safe no-op.
        plugin.execute("disable", JSONArray(), cb)
        verify(cb).success()
        verify(cordova, never()).activity
    }

    @Test
    fun pushDidReceiveNotification_inDefaultMode_rejectsPushModeNotManual() {
        // Plugin defaults to pushMode = "automatic" (not manual).
        plugin.execute("pushDidReceiveNotification", JSONArray(), cb)
        val captor = argumentCaptor<JSONObject>()
        verify(cb).error(captor.capture())
        assertEquals(
            "ACOUSTIC_PUSH_MODE_NOT_MANUAL",
            captor.firstValue.getString("code")
        )
    }

    @Test
    fun pushDidReceiveResponse_rejectsPushModeNotManual() {
        plugin.execute("pushDidReceiveResponse", JSONArray(), cb)
        val captor = argumentCaptor<JSONObject>()
        verify(cb).error(captor.capture())
        assertEquals(
            "ACOUSTIC_PUSH_MODE_NOT_MANUAL",
            captor.firstValue.getString("code")
        )
    }

    @Test
    fun handleEnable_emptyAppKey_rejectsInvalidArgs_doesNotTouchActivity() {
        plugin.execute(
            "enable",
            JSONArray().apply { put(""); put("https://example.com"); put("automatic") },
            cb
        )
        val captor = argumentCaptor<JSONObject>()
        verify(cb).error(captor.capture())
        assertEquals("ACOUSTIC_INVALID_ARGS", captor.firstValue.getString("code"))
        verify(cordova, never()).activity
    }

    @Test
    fun handleEnable_emptyPostURL_rejectsInvalidArgs_doesNotTouchActivity() {
        plugin.execute(
            "enable",
            JSONArray().apply { put("key"); put(""); put("automatic") },
            cb
        )
        val captor = argumentCaptor<JSONObject>()
        verify(cb).error(captor.capture())
        assertEquals("ACOUSTIC_INVALID_ARGS", captor.firstValue.getString("code"))
        verify(cordova, never()).activity
    }

    @Test
    fun handleEnable_manualMode_rejectsInvalidArgs_androidDoesNotSupportManual() {
        plugin.execute(
            "enable",
            JSONArray().apply { put("key"); put("https://example.com"); put("manual") },
            cb
        )
        val captor = argumentCaptor<JSONObject>()
        verify(cb).error(captor.capture())
        assertEquals("ACOUSTIC_INVALID_ARGS", captor.firstValue.getString("code"))
        assertTrue(captor.firstValue.getString("message").contains("automatic"))
        verify(cordova, never()).activity
    }

    @Test
    fun handleEnable_offMode_rejectsInvalidArgs_androidDoesNotSupportOff() {
        plugin.execute(
            "enable",
            JSONArray().apply { put("key"); put("https://example.com"); put("off") },
            cb
        )
        val captor = argumentCaptor<JSONObject>()
        verify(cb).error(captor.capture())
        assertEquals("ACOUSTIC_INVALID_ARGS", captor.firstValue.getString("code"))
        verify(cordova, never()).activity
    }

    @Test
    fun handleEnable_missingActivity_rejectsInternalError() {
        whenever(cordova.activity).thenReturn(null)
        plugin.execute(
            "enable",
            JSONArray().apply { put("key"); put("https://example.com"); put("automatic") },
            cb
        )
        val captor = argumentCaptor<JSONObject>()
        verify(cb).error(captor.capture())
        assertEquals(
            "ACOUSTIC_INTERNAL_ERROR",
            captor.firstValue.getString("code")
        )
    }

    @Test
    fun handleEnable_validAutomaticMode_setsPushModeAndDispatchesOnUiThread() {
        val activity = mock<Activity>()
        whenever(cordova.activity).thenReturn(activity)
        plugin.execute(
            "enable",
            JSONArray().apply {
                put("key"); put("https://example.com"); put("automatic")
            },
            cb
        )
        assertEquals("automatic", plugin.pushMode)
        verify(activity).runOnUiThread(any())
    }

    @Test
    fun handleEnable_defaultsToAutomatic_whenPushModeOmitted() {
        val activity = mock<Activity>()
        whenever(cordova.activity).thenReturn(activity)
        plugin.execute(
            "enable",
            JSONArray().apply { put("key"); put("https://example.com") },
            cb
        )
        assertEquals("automatic", plugin.pushMode)
        verify(activity).runOnUiThread(any())
    }

    @Test
    fun resolveIconRes_resolvesProvidedName_whenDrawablePresent() {
        val activity = mock<Activity>()
        val resources = mock<Resources>()
        whenever(activity.resources).thenReturn(resources)
        whenever(activity.packageName).thenReturn("co.example.app")
        whenever(
            resources.getIdentifier("ic_notification", "drawable", "co.example.app")
        ).thenReturn(42)

        val options = JSONObject().apply { put("androidIconResName", "ic_notification") }
        val result = plugin.resolveIconRes(activity, options)

        assertEquals(42, result)
    }

    @Test
    fun resolveIconRes_fallsBackToIcLauncher_whenRequestedNameMissing() {
        val activity = mock<Activity>()
        val resources = mock<Resources>()
        whenever(activity.resources).thenReturn(resources)
        whenever(activity.packageName).thenReturn("co.example.app")
        whenever(
            resources.getIdentifier("nonexistent_icon", "drawable", "co.example.app")
        ).thenReturn(0)
        whenever(
            resources.getIdentifier("ic_launcher", "drawable", "co.example.app")
        ).thenReturn(99)

        val options = JSONObject().apply { put("androidIconResName", "nonexistent_icon") }
        val result = plugin.resolveIconRes(activity, options)

        assertEquals(99, result)
    }

    @Test
    fun resolveIconRes_usesIcLauncher_whenIconNameOmitted() {
        val activity = mock<Activity>()
        val resources = mock<Resources>()
        whenever(activity.resources).thenReturn(resources)
        whenever(activity.packageName).thenReturn("co.example.app")
        whenever(
            resources.getIdentifier("ic_launcher", "drawable", "co.example.app")
        ).thenReturn(7)

        val result = plugin.resolveIconRes(activity, JSONObject())

        assertEquals(7, result)
    }

    @Test
    fun resolveIconRes_returnsZero_whenIcLauncherAlsoMissing() {
        val activity = mock<Activity>()
        val resources = mock<Resources>()
        whenever(activity.resources).thenReturn(resources)
        whenever(activity.packageName).thenReturn("co.example.app")
        whenever(
            resources.getIdentifier("ic_launcher", "drawable", "co.example.app")
        ).thenReturn(0)

        val result = plugin.resolveIconRes(activity, JSONObject())

        assertEquals(0, result)
    }

    @Test
    fun pluginInitialize_constructsWorkWrapper() {
        // initialize() was called in @Before. WorkWrapper must be assigned.
        assertNotNull(plugin.workWrapper)
    }

    // ── permission flow handlers ─────────────────────────────────────────

    @Test
    fun pushDidReceiveAuthorization_jsonNull_resolvesFalse_withoutSdkCall() {
        val args = JSONArray().apply { put(JSONObject.NULL); put(JSONObject.NULL) }
        plugin.execute("pushDidReceiveAuthorization", args, cb)

        val captor = argumentCaptor<PluginResult>()
        verify(cb).sendPluginResult(captor.capture())
        assertEquals(PluginResult.Status.OK.ordinal, captor.firstValue.status)
        assertEquals(PluginResult.MESSAGE_TYPE_BOOLEAN, captor.firstValue.messageType)
        assertEquals("false", captor.firstValue.message)
    }

    @Test
    fun pushDidReceiveAuthorization_missingArg_resolvesFalse_withoutSdkCall() {
        // Empty args — args.opt(0) returns null; same null-drop branch.
        plugin.execute("pushDidReceiveAuthorization", JSONArray(), cb)

        val captor = argumentCaptor<PluginResult>()
        verify(cb).sendPluginResult(captor.capture())
        assertEquals(PluginResult.Status.OK.ordinal, captor.firstValue.status)
        assertEquals("false", captor.firstValue.message)
    }

    @Test
    fun pushDidReceiveAuthorization_trueInput_resolvesTrue() {
        val args = JSONArray().apply { put(true) }
        plugin.execute("pushDidReceiveAuthorization", args, cb)

        val captor = argumentCaptor<PluginResult>()
        verify(cb).sendPluginResult(captor.capture())
        assertEquals(PluginResult.Status.OK.ordinal, captor.firstValue.status)
        assertEquals("true", captor.firstValue.message)
    }

    @Test
    fun pushDidReceiveAuthorization_falseInput_resolvesTrue() {
        // Android returns `true` for cross-platform parity regardless of the
        // `granted` Boolean — the SDK reconciles state via lifecycle hooks.
        val args = JSONArray().apply { put(false); put("denied") }
        plugin.execute("pushDidReceiveAuthorization", args, cb)

        val captor = argumentCaptor<PluginResult>()
        verify(cb).sendPluginResult(captor.capture())
        assertEquals("true", captor.firstValue.message)
    }

    @Test
    fun pushRequestPermission_missingActivity_resolvesGrantedFalseWithError() {
        // Never rejects — missing activity returns { granted: false, error: "no-foreground-activity" }.
        whenever(cordova.activity).thenReturn(null)
        plugin.execute("pushRequestPermission", JSONArray(), cb)

        val captor = argumentCaptor<JSONObject>()
        verify(cb).success(captor.capture())
        assertFalse(captor.firstValue.getBoolean("granted"))
        assertEquals("no-foreground-activity", captor.firstValue.getString("error"))
    }

    @Test
    @Config(sdk = [30])
    fun pushRequestPermission_preApi33_resolvesGrantedTrue_withoutDialog() {
        // Pre-Tiramisu: no runtime permission required.
        val activity = mock<Activity>()
        whenever(cordova.activity).thenReturn(activity)

        plugin.execute("pushRequestPermission", JSONArray(), cb)

        val captor = argumentCaptor<JSONObject>()
        verify(cb).success(captor.capture())
        assertTrue(captor.firstValue.getBoolean("granted"))
        // No UI dispatch happens on pre-API 33.
        verify(activity, never()).runOnUiThread(any())
    }

    @Test
    @Config(sdk = [33])
    fun pushRequestPermission_api33_castFails_resolvesGrantedFalseWithError() {
        // Never rejects — plain Activity (not ComponentActivity) returns structured error.
        val activity = mock<Activity>()
        whenever(cordova.activity).thenReturn(activity)

        plugin.execute("pushRequestPermission", JSONArray(), cb)

        val captor = argumentCaptor<JSONObject>()
        verify(cb).success(captor.capture())
        assertFalse(captor.firstValue.getBoolean("granted"))
        assertEquals("activity-not-component-activity", captor.firstValue.getString("error"))
        // No UI dispatch happens when the cast fails.
        verify(activity, never()).runOnUiThread(any())
    }

    @Test
    @Config(sdk = [33])
    fun pushRequestPermission_api33_componentActivity_dispatchesOnUiThread() {
        val activity = mock<ComponentActivity>()
        whenever(cordova.activity).thenReturn(activity)

        plugin.execute("pushRequestPermission", JSONArray(), cb)

        // UI dispatch is the gate before the SDK call; we don't execute the
        // Runnable here because the SDK static calls are unmockable.
        verify(activity).runOnUiThread(any())
    }

    @Test
    fun pushGetPermissionState_missingActivity_resolvesNull() {
        // Never rejects — missing activity returns tri-state null (NOT_DETERMINED).
        whenever(cordova.activity).thenReturn(null)
        plugin.execute("pushGetPermissionState", JSONArray(), cb)

        val captor = argumentCaptor<PluginResult>()
        verify(cb).sendPluginResult(captor.capture())
        assertEquals(PluginResult.Status.OK.ordinal, captor.firstValue.status)
        assertEquals(PluginResult.MESSAGE_TYPE_NULL, captor.firstValue.messageType)
    }

    @Test
    fun pushGetPermissionState_dispatchesOnUiThread() {
        val activity = mock<Activity>()
        whenever(cordova.activity).thenReturn(activity)

        plugin.execute("pushGetPermissionState", JSONArray(), cb)

        verify(activity).runOnUiThread(any())
    }

    // ── logIdentificationEvent handler ─────────────────────────────────────

    @Test
    fun logIdentificationEvent_blankName_rejectsAcousticInvalidArgs_doesNotTouchActivity() {
        plugin.execute(
            "logIdentificationEvent",
            JSONArray().apply { put(""); put("user@example.com") },
            cb
        )
        val captor = argumentCaptor<JSONObject>()
        verify(cb).error(captor.capture())
        assertEquals("ACOUSTIC_INVALID_ARGS", captor.firstValue.getString("code"))
        // Validation fires before any activity access.
        verify(cordova, never()).activity
    }

    @Test
    fun logIdentificationEvent_blankValue_rejectsAcousticInvalidArgs_doesNotTouchActivity() {
        plugin.execute(
            "logIdentificationEvent",
            JSONArray().apply { put("email"); put("") },
            cb
        )
        val captor = argumentCaptor<JSONObject>()
        verify(cb).error(captor.capture())
        assertEquals("ACOUSTIC_INVALID_ARGS", captor.firstValue.getString("code"))
        verify(cordova, never()).activity
    }

    @Test
    fun logIdentificationEvent_bothBlank_rejectsAcousticInvalidArgs() {
        plugin.execute(
            "logIdentificationEvent",
            JSONArray().apply { put(""); put("") },
            cb
        )
        val captor = argumentCaptor<JSONObject>()
        verify(cb).error(captor.capture())
        assertEquals("ACOUSTIC_INVALID_ARGS", captor.firstValue.getString("code"))
    }


    @Test
    fun logIdentificationEvent_nullActivity_rejectsInternalError() {
        // No activity stub → cordova.activity returns null → error before UI dispatch.
        whenever(cordova.activity).thenReturn(null)
        plugin.execute(
            "logIdentificationEvent",
            JSONArray().apply { put("email"); put("user@example.com") },
            cb
        )
        val captor = argumentCaptor<JSONObject>()
        verify(cb).error(captor.capture())
        assertEquals("ACOUSTIC_INTERNAL_ERROR", captor.firstValue.getString("code"))
    }

    @Test
    fun logIdentificationEvent_withActivity_dispatchesOnUiThread() {
        val activity = mock<Activity>()
        whenever(cordova.activity).thenReturn(activity)
        plugin.execute(
            "logIdentificationEvent",
            JSONArray().apply { put("email"); put("user@example.com") },
            cb
        )
        // Handler must post to UI thread so Connect SDK runs on the correct thread.
        verify(activity).runOnUiThread(any())
    }

    @Test
    fun logIdentificationEvent_withAdditionalParameters_dispatchesOnUiThread() {
        val activity = mock<Activity>()
        whenever(cordova.activity).thenReturn(activity)
        plugin.execute(
            "logIdentificationEvent",
            JSONArray().apply {
                put("email")
                put("user@example.com")
                put("loggedIn")
                put(org.json.JSONObject().apply { put("loginMethod", "email") })
            },
            cb
        )
        verify(activity).runOnUiThread(any())
    }

}
