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
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** The Capacitor entry point: each method hands its options to [AcousticConnect] and answers through the call. */
@CapacitorPlugin(name = "AcousticConnect")
class AcousticConnectPlugin : Plugin() {

    private lateinit var connect: AcousticConnect

    override fun load() {
        val config = NativeConfig.from(getConfig().configJSON) { Log.w(TAG, it) }
        connect = AcousticConnect(
            ConnectSdkImpl(activityProvider = { activity }),
            UiRunner { block ->
                val host = activity
                if (host == null) {
                    false
                } else {
                    host.runOnUiThread { block() }
                    true
                }
            },
            config,
        )
        quietPage()
        connect.autoEnable(LogReply)
    }

    /** Gives the page the `tlBridge` the SDK's DOM capture script calls (see [TlBridgeShim]). */
    private fun quietPage() {
        val web = bridge?.webView ?: return
        web.post { web.addJavascriptInterface(TlBridgeShim(), TlBridgeShim.NAME) }
    }

    private companion object {
        const val TAG = "AcousticConnect"
    }

    @PluginMethod fun enable(call: PluginCall) = connect.enable(call.dataOrEmpty(), CallReply(call))
    @PluginMethod fun disable(call: PluginCall) = connect.disable(CallReply(call))
    @PluginMethod fun setLogLevel(call: PluginCall) = connect.setLogLevel(call.dataOrEmpty(), CallReply(call))
    @PluginMethod fun logIdentity(call: PluginCall) = connect.logIdentity(call.dataOrEmpty(), CallReply(call))
    @PluginMethod fun getSdkVersion(call: PluginCall) = connect.getSdkVersion(CallReply(call))
    @PluginMethod fun isSdkEnabled(call: PluginCall) = connect.isSdkEnabled(CallReply(call))
    @PluginMethod fun flushQueues(call: PluginCall) = connect.flushQueues(CallReply(call))
    @PluginMethod fun setCurrentScreenName(call: PluginCall) = connect.setCurrentScreenName(call.dataOrEmpty(), CallReply(call))
    @PluginMethod fun logCustomEvent(call: PluginCall) = connect.logCustomEvent(call.dataOrEmpty(), CallReply(call))
    @PluginMethod fun logSignal(call: PluginCall) = connect.logSignal(call.dataOrEmpty(), CallReply(call))
    @PluginMethod fun logExceptionEvent(call: PluginCall) = connect.logExceptionEvent(call.dataOrEmpty(), CallReply(call))
    @PluginMethod fun logScreenViewContextLoad(call: PluginCall) = connect.logScreenViewContextLoad(call.dataOrEmpty(), CallReply(call))
    @PluginMethod fun logScreenViewContextUnload(call: PluginCall) = connect.logScreenViewContextUnload(call.dataOrEmpty(), CallReply(call))
    @PluginMethod fun setConfigItem(call: PluginCall) = connect.setConfigItem(call.dataOrEmpty(), CallReply(call))
    @PluginMethod fun getConfigItem(call: PluginCall) = connect.getConfigItem(call.dataOrEmpty(), CallReply(call))
    @PluginMethod fun pushRequestPermission(call: PluginCall) = connect.pushRequestPermission(CallReply(call))
    @PluginMethod fun pushGetPermissionState(call: PluginCall) = connect.pushGetPermissionState(CallReply(call))
    @PluginMethod fun pushDidReceiveAuthorization(call: PluginCall) = connect.pushDidReceiveAuthorization(call.dataOrEmpty(), CallReply(call))
    @PluginMethod fun pushDidReceiveNotification(call: PluginCall) = connect.pushDidReceiveNotification(call.dataOrEmpty(), CallReply(call))
    @PluginMethod fun pushDidReceiveResponse(call: PluginCall) = connect.pushDidReceiveResponse(call.dataOrEmpty(), CallReply(call))
    @PluginMethod fun pushDidRegisterWithToken(call: PluginCall) = connect.pushDidRegisterWithToken(call.dataOrEmpty(), CallReply(call))
    @PluginMethod fun pushDidFailToRegister(call: PluginCall) = connect.pushDidFailToRegister(call.dataOrEmpty(), CallReply(call))
}
