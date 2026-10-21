/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * NOTICE: This file contains material that is confidential and proprietary to
 * Acoustic, L.P. and/or other developers. No license is granted under any intellectual or
 * industrial property rights of Acoustic, L.P. except as may be provided in an agreement with
 * Acoustic, L.P. Any unauthorized copying or distribution of content from this file is
 * prohibited.
 */

import Capacitor
import Foundation

/// The Capacitor entry point: each method hands its options to `AcousticConnect` and answers through the call.
@objc(AcousticConnectPlugin)
public class AcousticConnectPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AcousticConnectPlugin"
    public let jsName = "AcousticConnect"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "disable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setLogLevel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logIdentity", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSdkVersion", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isSdkEnabled", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "flushQueues", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setCurrentScreenName", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logCustomEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logSignal", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logExceptionEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logScreenViewContextLoad", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logScreenViewContextUnload", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logScreenLayout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logLocation", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "logLocationUpdate", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setConfigItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getConfigItem", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushDidReceiveNotification", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushDidReceiveResponse", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushDidRegisterWithToken", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushDidFailToRegister", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushRequestPermission", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushGetPermissionState", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pushDidReceiveAuthorization", returnType: CAPPluginReturnPromise)
    ]

    private var connect: AcousticConnect?

    public override func load() {
        #if canImport(Connect)
        let config = NativeConfig(json: getConfig().getConfigJSON()) { NSLog("[AcousticConnect] \($0)") }
        #if DEBUG
        if !config.useRelease {
            // Verbose native SDK logging, as the debug pod does.
            setenv("CONNECT_DEBUG", "1", 0)
            setenv("TLF_DEBUG", "1", 0)
            setenv("EODebug", "1", 0)
        }
        #endif
        // The SDK is main-actor isolated and Capacitor loads plugins on the main thread.
        // Before iOS delivers the notification that launched the app, which is right after this: with the SDK not enabled yet that
        // tap would go to Capacitor's router and be lost. Held here, it is replayed into the SDK once `enable` has run.
        let launchHold = MainActor.assumeIsolated { PushLaunchHolder.installIfWanted(config: config) }
        let started = MainActor.assumeIsolated {
            AcousticConnect(sdk: ConnectSdkImpl(viewController: { [weak self] in self?.bridge?.viewController }), config: config, launchHold: launchHold)
        }
        connect = started
        // Started right here, not in a Task: the SDK has to be up before the first screen appears.
        let reply = LogReply()
        if MainActor.assumeIsolated({ started.beginAutoEnable(reply: reply) }) {
            Task { @MainActor in await started.waitUntilReady(reply) }
        }
        #endif
    }

    /// Runs `body` on the main actor with the bridge, the call's options and its reply. Without the SDK
    /// linked (an app that did not add the Connect pod) every call rejects with an actionable message.
    private func withBridge(_ call: CAPPluginCall, _ body: @escaping @MainActor (AcousticConnect, [String: Any], Reply) async -> Void) {
        let reply = CallReply(call)
        let options = call.options as? [String: Any] ?? [:]
        Task { @MainActor [weak self] in
            guard let connect = self?.connect else {
                return reply.reject(code: "ACOUSTIC_INTERNAL_ERROR",
                                    message: "The Acoustic Connect iOS SDK is not linked: add the AcousticConnect pod to the app")
            }
            await body(connect, options, reply)
        }
    }

    @objc func disable(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.disable(reply: reply) }
    }

    @objc func setLogLevel(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.setLogLevel(options, reply: reply) }
    }

    @objc func logIdentity(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.logIdentity(options, reply: reply) }
    }

    @objc func getSdkVersion(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.getSdkVersion(reply: reply) }
    }

    @objc func isSdkEnabled(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.isSdkEnabled(reply: reply) }
    }

    @objc func flushQueues(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.flushQueues(reply: reply) }
    }

    @objc func setCurrentScreenName(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.setCurrentScreenName(options, reply: reply) }
    }

    @objc func logCustomEvent(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.logCustomEvent(options, reply: reply) }
    }

    @objc func logSignal(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.logSignal(options, reply: reply) }
    }

    @objc func logExceptionEvent(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.logExceptionEvent(options, reply: reply) }
    }

    @objc func logScreenViewContextLoad(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.logScreenViewContextLoad(options, reply: reply) }
    }

    @objc func logScreenViewContextUnload(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.logScreenViewContextUnload(options, reply: reply) }
    }

    @objc func logScreenLayout(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.logScreenLayout(options, reply: reply) }
    }

    @objc func logLocation(_ call: CAPPluginCall) {
        withBridge(call) { connect, _, reply in connect.logLocation(reply: reply) }
    }

    @objc func logLocationUpdate(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.logLocationUpdate(options, reply: reply) }
    }

    @objc func setConfigItem(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.setConfigItem(options, reply: reply) }
    }

    @objc func getConfigItem(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.getConfigItem(options, reply: reply) }
    }

    @objc func pushDidReceiveNotification(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.pushDidReceiveNotification(options, reply: reply) }
    }

    @objc func pushDidReceiveResponse(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.pushDidReceiveResponse(options, reply: reply) }
    }

    @objc func pushDidRegisterWithToken(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.pushDidRegisterWithToken(options, reply: reply) }
    }

    @objc func pushDidFailToRegister(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in connect.pushDidFailToRegister(options, reply: reply) }
    }

    @objc func enable(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in await connect.enable(options, reply: reply) }
    }

    @objc func pushRequestPermission(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in await connect.pushRequestPermission(reply: reply) }
    }

    @objc func pushGetPermissionState(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in await connect.pushGetPermissionState(reply: reply) }
    }

    @objc func pushDidReceiveAuthorization(_ call: CAPPluginCall) {
        withBridge(call) { connect, options, reply in await connect.pushDidReceiveAuthorization(options, reply: reply) }
    }
}
