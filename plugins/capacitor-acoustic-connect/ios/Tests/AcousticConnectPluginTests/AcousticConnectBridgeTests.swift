import XCTest
@testable import AcousticConnectPlugin

@MainActor
final class FakeSdk: ConnectSdk {
    var calls: [String] = []
    var enabled = false
    var ready = true
    /// The SDK becomes ready after this many readiness checks; nil keeps `ready`.
    var readyAfterChecks: Int?
    private var checks = 0
    var readinessChecks: Int { checks }
    var frameworkVersion = "2.1.13"
    var accepts = true
    var configValue: Any?
    var configStore: [String: Any] = [:]
    var killSwitch: (enabled: Bool, url: String?)?
    var pushRequest: Result<(granted: Bool, error: String?), Error> = .success((true, nil))
    var pushState: Result<Bool?, Error> = .success(nil)
    var authorization: Result<Void, Error> = .success(())

    var lastEnable: (appKey: String, postURL: String, mode: PushMode, group: String?)?
    var lastIdentity: (name: String, value: String, type: String, params: [String: String])?
    var lastCustom: (name: String, values: [String: Any], level: MonitoringLevel)?
    var lastSignal: (values: [String: Any], level: MonitoringLevel)?
    var lastException: (name: String, reason: String, stack: String, unhandled: Bool)?
    var lastScreenView: (page: String, cls: String, kind: ScreenViewKind, referrer: String?)?
    var lastScreen: String?
    var lastNotification: [String: Any]?
    var lastResponse: (actionIdentifier: String, userInfo: [String: Any])?
    var forwarding: Result<Void, Error> = .success(())
    var lastToken: Data?
    var lastRegistrationError: String??
    var configSets: [(String, Any)] = []
    var lastAuthorization: (granted: Bool, error: String?)?

    var isEnabled: Bool { enabled }

    func isReadyForLogging() -> Bool {
        checks += 1
        if let after = readyAfterChecks { return checks > after }
        return ready
    }

    func enable(appKey: String, postURL: String, pushMode: PushMode, appGroupIdentifier: String?) {
        calls.append("enable")
        lastEnable = (appKey, postURL, pushMode, appGroupIdentifier)
        enabled = true
    }
    func disable() { calls.append("disable") }
    func flush() { calls.append("flush") }
    func setCurrentScreen(_ name: String) -> Bool { calls.append("setCurrentScreen"); lastScreen = name; return accepts }
    func logIdentity(name: String, value: String, signalType: String, additionalParameters: [String: String]) -> Bool {
        calls.append("logIdentity")
        lastIdentity = (name, value, signalType, additionalParameters)
        return accepts
    }
    func logCustomEvent(_ name: String, values: [String: Any], level: MonitoringLevel) -> Bool {
        calls.append("logCustomEvent")
        lastCustom = (name, values, level)
        return accepts
    }
    func logSignal(_ values: [String: Any], level: MonitoringLevel) -> Bool {
        calls.append("logSignal")
        lastSignal = (values, level)
        return accepts
    }
    func logException(name: String, reason: String, stackInfo: String, unhandled: Bool) -> Bool {
        calls.append("logException")
        lastException = (name, reason, stackInfo, unhandled)
        return accepts
    }
    func logScreenView(pageName: String, className: String, kind: ScreenViewKind, referrer: String?) -> Bool {
        calls.append("logScreenView")
        lastScreenView = (pageName, className, kind, referrer)
        return accepts
    }
    var lastLayout: (name: String, delayMs: Int?)?
    func logScreenLayout(name: String, delayMs: Int?) -> Bool {
        calls.append("logScreenLayout")
        lastLayout = (name, delayMs)
        return accepts
    }
    var lastLocation: (latitude: Double, longitude: Double, level: MonitoringLevel)?
    func logLocation() -> Bool {
        calls.append("logLocation")
        return accepts
    }
    func logLocationUpdate(latitude: Double, longitude: Double, level: MonitoringLevel) -> Bool {
        calls.append("logLocationUpdate")
        lastLocation = (latitude, longitude, level)
        return accepts
    }
    func setConfigItem(key: String, value: Any) -> Bool {
        calls.append("setConfigItem(\(key))")
        configSets.append((key, value))
        configStore[key] = value
        return accepts
    }
    func configItem(key: String) -> Any? { configStore[key] ?? configValue }
    func setKillSwitch(enabled: Bool, url: String?) {
        calls.append("killSwitch(\(enabled))")
        killSwitch = (enabled, url)
    }
    func requestPushAuthorization() async throws -> (granted: Bool, error: String?) { try pushRequest.get() }
    func currentPushAuthorization() async throws -> Bool? { try pushState.get() }
    func didReceivePushAuthorization(granted: Bool, error: String?) throws {
        calls.append("didReceivePushAuthorization")
        lastAuthorization = (granted, error)
        try authorization.get()
    }
    func didRegisterPushToken(_ token: Data) throws {
        calls.append("didRegisterPushToken")
        lastToken = token
        try forwarding.get()
    }
    func didFailPushRegistration(error: String?) throws {
        calls.append("didFailPushRegistration")
        lastRegistrationError = .some(error)
        try forwarding.get()
    }
    func didReceivePushNotification(userInfo: [String: Any]) throws {
        calls.append("didReceivePushNotification")
        lastNotification = userInfo
        try forwarding.get()
    }
    func didReceivePushResponse(actionIdentifier: String, userInfo: [String: Any]) throws {
        calls.append("didReceivePushResponse")
        lastResponse = (actionIdentifier, userInfo)
        try forwarding.get()
    }
}

final class RecordingReply: Reply {
    var resolved: [String: Any]?
    var resolveCount = 0
    var code: String?
    var message: String?

    func resolve(_ data: [String: Any]?) {
        resolveCount += 1
        resolved = data
    }
    func reject(code: String, message: String) {
        self.code = code
        self.message = message
    }
    var rejected: Bool { code != nil }
}

private struct Boom: LocalizedError {
    var errorDescription: String? { "boom" }
}

@MainActor
final class AcousticConnectBridgeTests: XCTestCase {
    private var sdk: FakeSdk!
    private var bridge: AcousticConnect!

    override func setUp() async throws {
        sdk = FakeSdk()
        var config = NativeConfig()
        config.pushEnabled = true
        bridge = AcousticConnect(sdk: sdk, config: config, readyTimeout: 0.3, pollInterval: 0.01)
    }

    private func json(_ text: String) -> [String: Any] {
        try! JSONSerialization.jsonObject(with: Data(text.utf8)) as! [String: Any]
    }

    private func reply(_ body: (RecordingReply) -> Void) -> RecordingReply {
        let r = RecordingReply()
        body(r)
        return r
    }

    private func replyAsync(_ body: (RecordingReply) async -> Void) async -> RecordingReply {
        let r = RecordingReply()
        await body(r)
        return r
    }

    private func assertRejected(_ r: RecordingReply, _ code: String, _ part: String? = nil, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(r.code, code, file: file, line: line)
        if let part { XCTAssertTrue(r.message?.contains(part) ?? false, "\(r.message ?? "nil")", file: file, line: line) }
    }

    // MARK: enable

    func testEnable_enablesTheSdkAndWaitsUntilItIsReady() async {
        let r = await replyAsync { await bridge.enable(json(#"{"appKey":"k","postURL":"https://p","pushMode":"automatic","iosAppGroupIdentifier":"group.x"}"#), reply: $0) }
        XCTAssertEqual(sdk.lastEnable?.appKey, "k")
        XCTAssertEqual(sdk.lastEnable?.postURL, "https://p")
        XCTAssertEqual(sdk.lastEnable?.mode, .automatic)
        XCTAssertEqual(sdk.lastEnable?.group, "group.x")
        XCTAssertEqual(r.resolveCount, 1)
        XCTAssertNil(r.resolved)
    }

    func testEnable_passesManualModeThrough() async {
        _ = await replyAsync { await bridge.enable(json(#"{"appKey":"k","postURL":"u","pushMode":"manual"}"#), reply: $0) }
        XCTAssertEqual(sdk.lastEnable?.mode, .manual)
        XCTAssertNil(sdk.lastEnable?.group)
    }

    func testEnable_defaultsToAutomatic() async {
        _ = await replyAsync { await bridge.enable(json(#"{"appKey":"k","postURL":"u"}"#), reply: $0) }
        XCTAssertEqual(sdk.lastEnable?.mode, .automatic)
    }

    func testEnable_waitsForTheKillSwitchCheckToFinish() async {
        sdk.readyAfterChecks = 3
        let r = await replyAsync { await bridge.enable(json(#"{"appKey":"k","postURL":"u"}"#), reply: $0) }
        XCTAssertEqual(r.resolveCount, 1)
    }

    func testEnable_resolvesWhenReadinessTimesOutButTheSdkIsEnabled() async {
        sdk.ready = false
        let r = await replyAsync { await bridge.enable(json(#"{"appKey":"k","postURL":"u"}"#), reply: $0) }
        XCTAssertEqual(r.resolveCount, 1)
    }

    func testEnable_rejectsWhenTheSdkNeverBecomesEnabled() async {
        sdk.ready = false
        let stuck = StuckSdk()
        let b = AcousticConnect(sdk: stuck, readyTimeout: 0.1, pollInterval: 0.01)
        let r = await replyAsync { await b.enable(json(#"{"appKey":"k","postURL":"u"}"#), reply: $0) }
        assertRejected(r, "ACOUSTIC_INTERNAL_ERROR", "did not become ready")
    }

    func testEnable_rejectsBadArguments() async {
        var r = await replyAsync { await bridge.enable(json(#"{"appKey":"","postURL":"u"}"#), reply: $0) }
        assertRejected(r, "ACOUSTIC_INVALID_ARGS", "appKey")
        r = await replyAsync { await bridge.enable(json(#"{"appKey":"k","postURL":""}"#), reply: $0) }
        assertRejected(r, "ACOUSTIC_INVALID_ARGS", "postURL")
        r = await replyAsync { await bridge.enable(json(#"{"appKey":"k","postURL":"u","pushMode":"off"}"#), reply: $0) }
        assertRejected(r, "ACOUSTIC_INVALID_ARGS", "pushMode")
        XCTAssertEqual(sdk.calls, [])
    }

    // MARK: disable, log level

    func testDisable_callsTheSdk() {
        let r = reply { bridge.disable(reply: $0) }
        XCTAssertEqual(sdk.calls, ["disable"])
        XCTAssertEqual(r.resolveCount, 1)
    }

    func testSetLogLevel_acceptsKnownLevelsOnly() {
        for level in ["silent", "error", "warn", "info", "verbose"] {
            XCTAssertEqual(reply { bridge.setLogLevel(["level": level], reply: $0) }.resolveCount, 1)
        }
        assertRejected(reply { bridge.setLogLevel(["level": "loud"], reply: $0) }, "ACOUSTIC_INVALID_ARGS")
        assertRejected(reply { bridge.setLogLevel([:], reply: $0) }, "ACOUSTIC_INVALID_ARGS")
    }

    // MARK: state

    func testIsSdkEnabledAndGetSdkVersion() {
        XCTAssertEqual(reply { bridge.isSdkEnabled(reply: $0) }.resolved?["value"] as? Bool, false)
        sdk.enabled = true
        XCTAssertEqual(reply { bridge.isSdkEnabled(reply: $0) }.resolved?["value"] as? Bool, true)
        XCTAssertEqual(reply { bridge.getSdkVersion(reply: $0) }.resolved?["value"] as? String, "2.1.13")
    }

    func testFlushQueues_flushes() {
        XCTAssertEqual(reply { bridge.flushQueues(reply: $0) }.resolveCount, 1)
        XCTAssertEqual(sdk.calls, ["flush"])
    }

    func testSetCurrentScreenName_setsTheTrimmedName() {
        XCTAssertEqual(reply { bridge.setCurrentScreenName(["name": " home "], reply: $0) }.resolveCount, 1)
        XCTAssertEqual(sdk.lastScreen, "home")
        assertRejected(reply { bridge.setCurrentScreenName(["name": "  "], reply: $0) }, "ACOUSTIC_INVALID_ARGS")
    }

    func testSetCurrentScreenName_rejectsWhenTheSdkDeclines() {
        sdk.accepts = false
        assertRejected(reply { bridge.setCurrentScreenName(["name": "home"], reply: $0) }, "ACOUSTIC_INTERNAL_ERROR", "returned false")
    }

    // MARK: identity

    func testLogIdentity_sendsTheIdentityAndFlushes() {
        let r = reply { bridge.logIdentity(json(#"{"identifierName":" email ","identifierValue":"a@b.c","signalType":"registered","additionalParameters":{"plan":"pro","n":2}}"#), reply: $0) }
        XCTAssertEqual(sdk.lastIdentity?.name, "email")
        XCTAssertEqual(sdk.lastIdentity?.value, "a@b.c")
        XCTAssertEqual(sdk.lastIdentity?.type, "registered")
        XCTAssertEqual(sdk.lastIdentity?.params, ["plan": "pro", "n": "2"])
        XCTAssertEqual(sdk.calls, ["logIdentity", "flush"])
        XCTAssertEqual(r.resolveCount, 1)
    }

    /// Android sends `optString` of each parameter, so a JSON boolean is `true`, a null `null` and a nested value its JSON text;
    /// iOS has to send the same text, not Swift's description of the value.
    func testLogIdentity_writesEveryParameterAsTheSameTextAndroidSends() {
        let params: [String: Any] = [
            "flag": NSNumber(value: true), "off": NSNumber(value: false), "count": NSNumber(value: 2),
            "ratio": NSNumber(value: 1.5), "none": NSNull(), "text": "pro",
            "nested": ["x": 1], "list": [1, "a"],
        ]
        _ = reply { bridge.logIdentity(["identifierName": "n", "identifierValue": "v", "additionalParameters": params], reply: $0) }
        let sent = sdk.lastIdentity?.params
        XCTAssertEqual(sent?["flag"], "true")
        XCTAssertEqual(sent?["off"], "false")
        XCTAssertEqual(sent?["count"], "2")
        XCTAssertEqual(sent?["ratio"], "1.5")
        XCTAssertEqual(sent?["none"], "null")
        XCTAssertEqual(sent?["text"], "pro")
        XCTAssertEqual(sent?["nested"], #"{"x":1}"#)
        XCTAssertEqual(sent?["list"], #"[1,"a"]"#)
    }

    func testLogIdentity_defaultsTheSignalType() {
        _ = reply { bridge.logIdentity(json(#"{"identifierName":"n","identifierValue":"v","signalType":" "}"#), reply: $0) }
        XCTAssertEqual(sdk.lastIdentity?.type, "loggedIn")
        XCTAssertEqual(sdk.lastIdentity?.params, [:])
    }

    func testLogIdentity_rejectsMissingValuesAnAbsentSdkAndADecline() {
        assertRejected(reply { bridge.logIdentity(json(#"{"identifierName":"","identifierValue":"v"}"#), reply: $0) }, "ACOUSTIC_INVALID_ARGS")
        assertRejected(reply { bridge.logIdentity(json(#"{"identifierName":"n"}"#), reply: $0) }, "ACOUSTIC_INVALID_ARGS")
        sdk.ready = false
        assertRejected(reply { bridge.logIdentity(json(#"{"identifierName":"n","identifierValue":"v"}"#), reply: $0) }, "ACOUSTIC_INTERNAL_ERROR", "not ready")
        sdk.ready = true
        sdk.accepts = false
        assertRejected(reply { bridge.logIdentity(json(#"{"identifierName":"n","identifierValue":"v"}"#), reply: $0) }, "ACOUSTIC_INTERNAL_ERROR", "returned false")
        XCTAssertFalse(sdk.calls.contains("flush"))
    }

    // MARK: events

    func testLogCustomEvent_sendsValuesAndTheLevel() {
        let r = reply { bridge.logCustomEvent(json(#"{"eventName":" buy ","values":{"a":"x","b":2,"c":true},"level":1}"#), reply: $0) }
        XCTAssertEqual(sdk.lastCustom?.name, "buy")
        XCTAssertEqual(sdk.lastCustom?.values["a"] as? String, "x")
        XCTAssertEqual(sdk.lastCustom?.values["b"] as? Int, 2)
        XCTAssertEqual(sdk.lastCustom?.level, .cellularAndWiFi)
        XCTAssertEqual(r.resolveCount, 1)
    }

    func testLogCustomEvent_mapsLevels() {
        for (level, expected) in [(0, MonitoringLevel.ignore), (1, .cellularAndWiFi), (2, .wifi), (3, .wifi), (9, .wifi)] {
            _ = reply { bridge.logCustomEvent(["eventName": "e", "level": level], reply: $0) }
            XCTAssertEqual(sdk.lastCustom?.level, expected, "level \(level)")
        }
        _ = reply { bridge.logCustomEvent(["eventName": "e"], reply: $0) }
        XCTAssertEqual(sdk.lastCustom?.level, .wifi)
        XCTAssertEqual(sdk.lastCustom?.values.count, 0)
    }

    func testLogCustomEvent_rejectsBlankNameAndDecline() {
        assertRejected(reply { bridge.logCustomEvent(["eventName": " "], reply: $0) }, "ACOUSTIC_INVALID_ARGS")
        sdk.accepts = false
        assertRejected(reply { bridge.logCustomEvent(["eventName": "e"], reply: $0) }, "ACOUSTIC_INTERNAL_ERROR", "returned false")
    }

    func testLogSignal_sendsNestedJson() {
        let r = reply { bridge.logSignal(json(#"{"values":{"n":1,"o":{"a":[1,2]},"z":null},"level":2}"#), reply: $0) }
        XCTAssertEqual(sdk.lastSignal?.values["n"] as? Int, 1)
        XCTAssertNotNil(sdk.lastSignal?.values["o"] as? [String: Any])
        XCTAssertEqual(sdk.lastSignal?.level, .wifi)
        XCTAssertEqual(r.resolveCount, 1)
    }

    func testLogSignal_rejectsMissingValuesAndDecline() {
        assertRejected(reply { bridge.logSignal([:], reply: $0) }, "ACOUSTIC_INVALID_ARGS")
        assertRejected(reply { bridge.logSignal(["values": "x"], reply: $0) }, "ACOUSTIC_INVALID_ARGS")
        sdk.accepts = false
        assertRejected(reply { bridge.logSignal(["values": [String: Any]()], reply: $0) }, "ACOUSTIC_INTERNAL_ERROR", "returned false")
    }

    func testLogExceptionEvent_sendsMessageStackAndFlag() {
        _ = reply { bridge.logExceptionEvent(json(#"{"message":" bad ","stackInfo":"at x","unhandled":true}"#), reply: $0) }
        XCTAssertEqual(sdk.lastException?.reason, "bad")
        XCTAssertEqual(sdk.lastException?.name, "Capacitor Plugin")
        XCTAssertEqual(sdk.lastException?.stack, "at x")
        XCTAssertEqual(sdk.lastException?.unhandled, true)
        _ = reply { bridge.logExceptionEvent(["message": "bad"], reply: $0) }
        XCTAssertEqual(sdk.lastException?.stack, "")
        XCTAssertEqual(sdk.lastException?.unhandled, false)
        assertRejected(reply { bridge.logExceptionEvent(["message": ""], reply: $0) }, "ACOUSTIC_INVALID_ARGS")
        sdk.accepts = false
        assertRejected(reply { bridge.logExceptionEvent(["message": "bad"], reply: $0) }, "ACOUSTIC_INTERNAL_ERROR", "returned false")
    }

    func testScreenViewContext_logsLoadAndUnload() {
        _ = reply { bridge.logScreenViewContextLoad(json(#"{"logicalPageName":"cart","referrer":"home"}"#), reply: $0) }
        XCTAssertEqual(sdk.lastScreenView?.page, "cart")
        XCTAssertEqual(sdk.lastScreenView?.cls, "Capacitor_cart")
        XCTAssertEqual(sdk.lastScreenView?.kind, .load)
        XCTAssertEqual(sdk.lastScreenView?.referrer, "home")
        _ = reply { bridge.logScreenViewContextUnload(json(#"{"logicalPageName":"cart","referrer":null}"#), reply: $0) }
        XCTAssertEqual(sdk.lastScreenView?.kind, .unload)
        XCTAssertNil(sdk.lastScreenView?.referrer)
        _ = reply { bridge.logScreenViewContextLoad(["logicalPageName": "cart", "referrer": "  "], reply: $0) }
        XCTAssertNil(sdk.lastScreenView?.referrer)
    }

    func testScreenViewContext_rejectsBlankNameAndDecline() {
        assertRejected(reply { bridge.logScreenViewContextLoad(["logicalPageName": " "], reply: $0) }, "ACOUSTIC_INVALID_ARGS", "logScreenViewContextLoad")
        sdk.accepts = false
        assertRejected(reply { bridge.logScreenViewContextUnload(["logicalPageName": "a"], reply: $0) }, "ACOUSTIC_INTERNAL_ERROR", "logScreenViewContextUnload returned false")
    }

    func testLogScreenLayout_passesTheNameAndTheDelay() {
        _ = reply { bridge.logScreenLayout(["name": " Home ", "delayMs": 300], reply: $0) }
        XCTAssertEqual(sdk.lastLayout?.name, "Home")
        XCTAssertEqual(sdk.lastLayout?.delayMs, 300)
        _ = reply { bridge.logScreenLayout(["name": "Home"], reply: $0) }
        XCTAssertNil(sdk.lastLayout?.delayMs)
        _ = reply { bridge.logScreenLayout(["name": "Home", "delayMs": NSNull()], reply: $0) }
        XCTAssertNil(sdk.lastLayout?.delayMs)
    }

    func testLogScreenLayout_rejectsBlankNameBadDelayAndDecline() {
        assertRejected(reply { bridge.logScreenLayout(["name": " "], reply: $0) }, "ACOUSTIC_INVALID_ARGS", "name is required")
        assertRejected(reply { bridge.logScreenLayout(["name": "Home", "delayMs": -1], reply: $0) }, "ACOUSTIC_INVALID_ARGS", "delayMs")
        assertRejected(reply { bridge.logScreenLayout(["name": "Home", "delayMs": 1.5], reply: $0) }, "ACOUSTIC_INVALID_ARGS", "delayMs")
        assertRejected(reply { bridge.logScreenLayout(["name": "Home", "delayMs": "5"], reply: $0) }, "ACOUSTIC_INVALID_ARGS", "delayMs")
        XCTAssertNil(sdk.lastLayout)
        sdk.accepts = false
        assertRejected(reply { bridge.logScreenLayout(["name": "Home"], reply: $0) }, "ACOUSTIC_INTERNAL_ERROR", "logScreenLayout returned false")
    }

    func testLogLocation_asksTheSdkAndRejectsWhenItDeclines() {
        _ = reply { bridge.logLocation(reply: $0) }
        XCTAssertTrue(sdk.calls.contains("logLocation"))
        sdk.accepts = false
        assertRejected(reply { bridge.logLocation(reply: $0) }, "ACOUSTIC_INTERNAL_ERROR", "logLocation returned false")
    }

    func testLogLocationUpdate_passesThePositionAndTheLevel() {
        _ = reply { bridge.logLocationUpdate(["latitude": 52.5, "longitude": -13.4, "level": 2], reply: $0) }
        XCTAssertEqual(sdk.lastLocation?.latitude, 52.5)
        XCTAssertEqual(sdk.lastLocation?.longitude, -13.4)
        XCTAssertNotNil(sdk.lastLocation?.level)
    }

    func testLogLocationUpdate_rejectsAPositionOutOfRangeOrMissingAndDecline() {
        assertRejected(reply { bridge.logLocationUpdate(["latitude": 91, "longitude": 0], reply: $0) }, "ACOUSTIC_INVALID_ARGS", "out of range")
        assertRejected(reply { bridge.logLocationUpdate(["latitude": 0, "longitude": -181], reply: $0) }, "ACOUSTIC_INVALID_ARGS", "out of range")
        assertRejected(reply { bridge.logLocationUpdate(["latitude": 0], reply: $0) }, "ACOUSTIC_INVALID_ARGS", "out of range")
        XCTAssertNil(sdk.lastLocation)
        sdk.accepts = false
        assertRejected(reply { bridge.logLocationUpdate(["latitude": 1, "longitude": 2], reply: $0) }, "ACOUSTIC_INTERNAL_ERROR", "logLocationUpdate returned false")
    }

    // MARK: config items

    func testSetConfigItem_keepsBooleansStringsAndNumbersApart() {
        _ = reply { bridge.setConfigItem(json(#"{"key":"a","value":true,"moduleName":"m"}"#), reply: $0) }
        _ = reply { bridge.setConfigItem(json(#"{"key":"b","value":"s","moduleName":"m"}"#), reply: $0) }
        _ = reply { bridge.setConfigItem(json(#"{"key":"c","value":5,"moduleName":"m"}"#), reply: $0) }
        XCTAssertEqual(sdk.configSets.count, 3)
        XCTAssertEqual(sdk.configSets[0].1 as? Bool, true)
        XCTAssertEqual(sdk.configSets[1].1 as? String, "s")
        XCTAssertEqual(sdk.configSets[2].1 as? Double, 5)
        XCTAssertFalse(sdk.configSets[2].1 is Bool)
    }

    func testSetConfigItem_rejectsBadArgumentsAndDecline() {
        assertRejected(reply { bridge.setConfigItem(json(#"{"key":"","value":1,"moduleName":"m"}"#), reply: $0) }, "ACOUSTIC_INVALID_ARGS")
        assertRejected(reply { bridge.setConfigItem(json(#"{"key":"k","value":1,"moduleName":" "}"#), reply: $0) }, "ACOUSTIC_INVALID_ARGS")
        assertRejected(reply { bridge.setConfigItem(json(#"{"key":"k","moduleName":"m"}"#), reply: $0) }, "ACOUSTIC_INVALID_ARGS")
        assertRejected(reply { bridge.setConfigItem(json(#"{"key":"k","value":{"a":1},"moduleName":"m"}"#), reply: $0) }, "ACOUSTIC_INVALID_ARGS")
        sdk.accepts = false
        assertRejected(reply { bridge.setConfigItem(json(#"{"key":"k","value":1,"moduleName":"m"}"#), reply: $0) }, "ACOUSTIC_INTERNAL_ERROR", "returned false")
    }

    func testGetConfigItem_resolvesTheRawItemAsTextOrNothing() {
        sdk.configValue = "42"
        XCTAssertEqual(reply { bridge.getConfigItem(json(#"{"key":"k","moduleName":"m"}"#), reply: $0) }.resolved?["value"] as? String, "42")
        sdk.configValue = NSNumber(value: true)
        XCTAssertEqual(reply { bridge.getConfigItem(json(#"{"key":"k","moduleName":"m"}"#), reply: $0) }.resolved?["value"] as? String, "true")
        sdk.configValue = NSNumber(value: 5.0)
        XCTAssertEqual(reply { bridge.getConfigItem(json(#"{"key":"k","moduleName":"m"}"#), reply: $0) }.resolved?["value"] as? String, "5")
        sdk.configValue = NSNumber(value: 2.5)
        XCTAssertEqual(reply { bridge.getConfigItem(json(#"{"key":"k","moduleName":"m"}"#), reply: $0) }.resolved?["value"] as? String, "2.5")
        sdk.configValue = nil
        let none = reply { bridge.getConfigItem(json(#"{"key":"k","moduleName":"m"}"#), reply: $0) }
        XCTAssertEqual(none.resolveCount, 1)
        XCTAssertNil(none.resolved?["value"])
    }

    func testGetConfigItem_rejectsBadArguments() {
        assertRejected(reply { bridge.getConfigItem(["key": "", "moduleName": "m"], reply: $0) }, "ACOUSTIC_INVALID_ARGS")
        assertRejected(reply { bridge.getConfigItem(["key": "k"], reply: $0) }, "ACOUSTIC_INVALID_ARGS")
    }

    // MARK: push

    func testPushRequestPermission_resolvesTheAnswerAndNeverRejects() async {
        sdk.pushRequest = .success((false, "denied"))
        var r = await replyAsync { await bridge.pushRequestPermission(reply: $0) }
        XCTAssertEqual(r.resolved?["granted"] as? Bool, false)
        XCTAssertEqual(r.resolved?["error"] as? String, "denied")
        sdk.pushRequest = .success((true, nil))
        r = await replyAsync { await bridge.pushRequestPermission(reply: $0) }
        XCTAssertEqual(r.resolved?["granted"] as? Bool, true)
        XCTAssertNil(r.resolved?["error"])
        sdk.pushRequest = .failure(Boom())
        r = await replyAsync { await bridge.pushRequestPermission(reply: $0) }
        XCTAssertEqual(r.resolved?["granted"] as? Bool, false)
        XCTAssertEqual(r.resolved?["error"] as? String, "boom")
    }

    func testPushGetPermissionState_isTriStateAndNeverRejects() async {
        sdk.pushState = .success(true)
        var r = await replyAsync { await bridge.pushGetPermissionState(reply: $0) }
        XCTAssertEqual(r.resolved?["value"] as? Bool, true)
        sdk.pushState = .success(false)
        r = await replyAsync { await bridge.pushGetPermissionState(reply: $0) }
        XCTAssertEqual(r.resolved?["value"] as? Bool, false)
        sdk.pushState = .success(nil)
        r = await replyAsync { await bridge.pushGetPermissionState(reply: $0) }
        XCTAssertTrue(r.resolved?["value"] is NSNull)
        sdk.pushState = .failure(Boom())
        r = await replyAsync { await bridge.pushGetPermissionState(reply: $0) }
        XCTAssertTrue(r.resolved?["value"] is NSNull)
    }

    func testPushDidReceiveAuthorization_forwardsAKnownAnswer() async {
        var r = await replyAsync { await bridge.pushDidReceiveAuthorization(json(#"{"granted":true,"error":null}"#), reply: $0) }
        XCTAssertEqual(r.resolved?["value"] as? Bool, true)
        XCTAssertEqual(sdk.lastAuthorization?.granted, true)
        XCTAssertNil(sdk.lastAuthorization?.error)
        r = await replyAsync { await bridge.pushDidReceiveAuthorization(json(#"{"granted":false,"error":"nope"}"#), reply: $0) }
        XCTAssertEqual(sdk.lastAuthorization?.error, "nope")
        sdk.authorization = .failure(Boom())
        r = await replyAsync { await bridge.pushDidReceiveAuthorization(json(#"{"granted":true}"#), reply: $0) }
        XCTAssertEqual(r.resolved?["value"] as? Bool, false)
    }

    func testPushDidReceiveAuthorization_skipsAnUnknownAnswer() async {
        let r = await replyAsync { await bridge.pushDidReceiveAuthorization(json(#"{"granted":null}"#), reply: $0) }
        XCTAssertEqual(r.resolved?["value"] as? Bool, false)
        XCTAssertEqual(sdk.calls, [])
    }

    func testManualForwarders_requireManualMode() async {
        assertRejected(reply { bridge.pushDidReceiveNotification(["userInfo": [String: Any]()], reply: $0) }, "ACOUSTIC_PUSH_MODE_NOT_MANUAL", "automatic")
        assertRejected(reply { bridge.pushDidReceiveResponse(["actionIdentifier": "a", "userInfo": [String: Any]()], reply: $0) }, "ACOUSTIC_PUSH_MODE_NOT_MANUAL")
        XCTAssertFalse(sdk.calls.contains("didReceivePushNotification"))
        XCTAssertFalse(sdk.calls.contains("didReceivePushResponse"))
    }

    func testManualForwarders_handTheNotificationAndTheResponseToTheSdk() async {
        _ = await replyAsync { await bridge.enable(json(#"{"appKey":"k","postURL":"u","pushMode":"manual"}"#), reply: $0) }

        let n = reply { bridge.pushDidReceiveNotification(["userInfo": ["aps": ["alert": "hi"], "id": 7]], reply: $0) }
        XCTAssertEqual(n.resolved?["value"] as? Bool, true)
        XCTAssertEqual((sdk.lastNotification?["aps"] as? [String: Any])?["alert"] as? String, "hi")
        XCTAssertEqual(sdk.lastNotification?["id"] as? Int, 7)

        let r = reply { bridge.pushDidReceiveResponse(["actionIdentifier": "open", "userInfo": ["id": 7]], reply: $0) }
        XCTAssertEqual(r.resolved?["value"] as? Bool, true)
        XCTAssertEqual(sdk.lastResponse?.actionIdentifier, "open")
        XCTAssertEqual(sdk.lastResponse?.userInfo["id"] as? Int, 7)
    }

    func testManualForwarders_answerFalseWhenTheSdkRefuses() async {
        _ = await replyAsync { await bridge.enable(json(#"{"appKey":"k","postURL":"u","pushMode":"manual"}"#), reply: $0) }
        sdk.forwarding = .failure(Boom())
        XCTAssertEqual(reply { bridge.pushDidReceiveNotification(["userInfo": [String: Any]()], reply: $0) }.resolved?["value"] as? Bool, false)
        XCTAssertEqual(reply { bridge.pushDidReceiveResponse(["actionIdentifier": "a", "userInfo": [String: Any]()], reply: $0) }.resolved?["value"] as? Bool, false)
    }

    func testManualForwarders_rejectAPayloadThatIsNotAnObject() async {
        _ = await replyAsync { await bridge.enable(json(#"{"appKey":"k","postURL":"u","pushMode":"manual"}"#), reply: $0) }
        assertRejected(reply { bridge.pushDidReceiveNotification(["userInfo": "text"], reply: $0) }, "ACOUSTIC_INVALID_ARGS", "userInfo")
        assertRejected(reply { bridge.pushDidReceiveNotification([:], reply: $0) }, "ACOUSTIC_INVALID_ARGS")
        assertRejected(reply { bridge.pushDidReceiveResponse(["userInfo": [String: Any]()], reply: $0) }, "ACOUSTIC_INVALID_ARGS", "actionIdentifier")
        assertRejected(reply { bridge.pushDidReceiveResponse(["actionIdentifier": "a", "userInfo": 3], reply: $0) }, "ACOUSTIC_INVALID_ARGS", "userInfo")
        XCTAssertFalse(sdk.calls.contains("didReceivePushNotification"))
        XCTAssertFalse(sdk.calls.contains("didReceivePushResponse"))
    }

    // MARK: manual mode: the APNs token and its failure

    private func manualBridge() async {
        _ = await replyAsync { await bridge.enable(json(#"{"appKey":"k","postURL":"u","pushMode":"manual"}"#), reply: $0) }
    }

    func testTokenForwarders_requireManualMode() {
        assertRejected(reply { bridge.pushDidRegisterWithToken(["token": "0a1b"], reply: $0) }, "ACOUSTIC_PUSH_MODE_NOT_MANUAL", "automatic")
        assertRejected(reply { bridge.pushDidFailToRegister(["error": NSNull()], reply: $0) }, "ACOUSTIC_PUSH_MODE_NOT_MANUAL")
        XCTAssertFalse(sdk.calls.contains("didRegisterPushToken"))
        XCTAssertFalse(sdk.calls.contains("didFailPushRegistration"))
    }

    func testDidRegisterWithToken_handsTheBytesOfTheHexTokenToTheSdk() async {
        await manualBridge()
        let r = reply { bridge.pushDidRegisterWithToken(["token": "0a1B"], reply: $0) }
        XCTAssertEqual(r.resolved?["value"] as? Bool, true)
        XCTAssertEqual(sdk.lastToken, Data([0x0a, 0x1b]))
    }

    func testDidRegisterWithToken_handsOverALongToken() async {
        await manualBridge()
        let hex = String(repeating: "ab", count: 32)
        _ = reply { bridge.pushDidRegisterWithToken(["token": hex], reply: $0) }
        XCTAssertEqual(sdk.lastToken, Data(repeating: 0xab, count: 32))
    }

    func testDidRegisterWithToken_rejectsATokenThatIsNotWholeHexBytes() async {
        await manualBridge()
        for bad in [["token": ""], ["token": "abc"], ["token": "zz"], ["token": "0a 1b"], ["token": 12], [:]] as [[String: Any]] {
            assertRejected(reply { bridge.pushDidRegisterWithToken(bad, reply: $0) }, "ACOUSTIC_INVALID_ARGS", "token")
        }
        XCTAssertFalse(sdk.calls.contains("didRegisterPushToken"))
    }

    func testDidFailToRegister_handsTheErrorTextToTheSdk() async {
        await manualBridge()
        XCTAssertEqual(reply { bridge.pushDidFailToRegister(["error": "no network"], reply: $0) }.resolved?["value"] as? Bool, true)
        XCTAssertEqual(sdk.lastRegistrationError, .some("no network"))
        _ = reply { bridge.pushDidFailToRegister(["error": NSNull()], reply: $0) }
        XCTAssertEqual(sdk.lastRegistrationError, .some(nil))
        _ = reply { bridge.pushDidFailToRegister([:], reply: $0) }
        XCTAssertEqual(sdk.lastRegistrationError, .some(nil))
    }

    func testTokenForwarders_answerFalseWhenTheSdkRefuses() async {
        await manualBridge()
        sdk.forwarding = .failure(Boom())
        XCTAssertEqual(reply { bridge.pushDidRegisterWithToken(["token": "0a1b"], reply: $0) }.resolved?["value"] as? Bool, false)
        XCTAssertEqual(reply { bridge.pushDidFailToRegister(["error": "x"], reply: $0) }.resolved?["value"] as? Bool, false)
    }

    func testDidFailToRegister_rejectsAnErrorThatIsNotText() async {
        await manualBridge()
        assertRejected(reply { bridge.pushDidFailToRegister(["error": 12], reply: $0) }, "ACOUSTIC_INVALID_ARGS", "error")
        XCTAssertFalse(sdk.calls.contains("didFailPushRegistration"))
    }
}

/// An SDK that never reports enabled or ready.
@MainActor
private final class StuckSdk: ConnectSdk {
    var isEnabled: Bool { false }
    var frameworkVersion: String { "" }
    func isReadyForLogging() -> Bool { false }
    func enable(appKey: String, postURL: String, pushMode: PushMode, appGroupIdentifier: String?) {}
    func disable() {}
    func flush() {}
    func setCurrentScreen(_ name: String) -> Bool { false }
    func logIdentity(name: String, value: String, signalType: String, additionalParameters: [String: String]) -> Bool { false }
    func logCustomEvent(_ name: String, values: [String: Any], level: MonitoringLevel) -> Bool { false }
    func logSignal(_ values: [String: Any], level: MonitoringLevel) -> Bool { false }
    func logException(name: String, reason: String, stackInfo: String, unhandled: Bool) -> Bool { false }
    func logScreenView(pageName: String, className: String, kind: ScreenViewKind, referrer: String?) -> Bool { false }
    func logScreenLayout(name: String, delayMs: Int?) -> Bool { false }
    func logLocation() -> Bool { false }
    func logLocationUpdate(latitude: Double, longitude: Double, level: MonitoringLevel) -> Bool { false }
    func setConfigItem(key: String, value: Any) -> Bool { false }
    func configItem(key: String) -> Any? { nil }
    func setKillSwitch(enabled: Bool, url: String?) {}
    func requestPushAuthorization() async throws -> (granted: Bool, error: String?) { (false, nil) }
    func currentPushAuthorization() async throws -> Bool? { nil }
    func didReceivePushAuthorization(granted: Bool, error: String?) throws {}
    func didRegisterPushToken(_ token: Data) throws {}
    func didFailPushRegistration(error: String?) throws {}
    func didReceivePushNotification(userInfo: [String: Any]) throws {}
    func didReceivePushResponse(actionIdentifier: String, userInfo: [String: Any]) throws {}
}
