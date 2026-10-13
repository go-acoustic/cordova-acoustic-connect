import XCTest
@testable import AcousticConnectPlugin

final class NativeConfigTests: XCTestCase {
    private var warnings: [String] = []

    private func parse(_ json: String?) -> NativeConfig {
        let object = json.map { try! JSONSerialization.jsonObject(with: Data($0.utf8)) as! [String: Any] }
        return NativeConfig(json: object, warn: { self.warnings.append($0) })
    }

    func testMissingConfigGivesTheDefaults() {
        let c = parse(nil)
        XCTAssertNil(c.appKey)
        XCTAssertNil(c.postMessageUrl)
        XCTAssertTrue(c.autoEnable)
        XCTAssertFalse(c.useRelease)
        XCTAssertFalse(c.killSwitchEnabled)
        XCTAssertNil(c.locationLoggingEnabled)
        XCTAssertNil(c.screenCaptureEnabled)
        XCTAssertNil(c.pushMode)
        XCTAssertFalse(c.pushEnabled, "push is opt-in")
        XCTAssertNil(c.layout)
        XCTAssertEqual(warnings, [])
    }

    func testReadsEveryKey() {
        let c = parse(#"""
        {"appKey":"k","postMessageUrl":"https://c/post","autoEnable":false,"useRelease":true,
         "killSwitchEnabled":true,"killSwitchUrl":"https://c/switch/k","locationLoggingEnabled":false,
         "screenCaptureEnabled":false,"iosPushMode":"manual","iosAppGroupIdentifier":"group.x","pushEnabled":true}
        """#)
        XCTAssertEqual(c.appKey, "k")
        XCTAssertEqual(c.postMessageUrl, "https://c/post")
        XCTAssertFalse(c.autoEnable)
        XCTAssertTrue(c.useRelease)
        XCTAssertTrue(c.killSwitchEnabled)
        XCTAssertEqual(c.killSwitchUrl, "https://c/switch/k")
        XCTAssertEqual(c.locationLoggingEnabled, false)
        XCTAssertEqual(c.screenCaptureEnabled, false)
        XCTAssertEqual(c.pushMode, .manual)
        XCTAssertEqual(c.appGroupIdentifier, "group.x")
        XCTAssertTrue(c.pushEnabled)
        XCTAssertEqual(warnings, [])
    }

    func testNullAndBlankMeanNotConfigured() {
        let c = parse(#"{"appKey":" ","postMessageUrl":null,"locationLoggingEnabled":null,"iosPushMode":null}"#)
        XCTAssertNil(c.appKey)
        XCTAssertNil(c.postMessageUrl)
        XCTAssertNil(c.locationLoggingEnabled)
        XCTAssertNil(c.pushMode)
        XCTAssertEqual(warnings, [])
    }

    func testAValueOfTheWrongTypeIsIgnoredWithAWarning() {
        let c = parse(#"{"useRelease":"yes","killSwitchEnabled":1,"appKey":5,"locationLoggingEnabled":"no","iosPushMode":"off","pushEnabled":"true"}"#)
        XCTAssertFalse(c.useRelease)
        XCTAssertFalse(c.killSwitchEnabled)
        XCTAssertNil(c.appKey)
        XCTAssertNil(c.locationLoggingEnabled)
        XCTAssertNil(c.pushMode)
        XCTAssertFalse(c.pushEnabled)
        XCTAssertEqual(warnings.count, 6)
    }

    func testLayoutIsTheSharedBlockWithTheIosBlockMergedOver() {
        let c = parse(#"""
        {"layoutConfig":{"AutoLayout":{"GlobalScreenSettings":{"ScreenChange":true,"CaptureLayoutOn":1},"MaskIdList":["a","b"]}},
         "layoutConfigIos":{"AutoLayout":{"GlobalScreenSettings":{"CaptureLayoutOn":0},"MaskIdList":["c"]},"AppendMapIds":{"x":{}}},
         "layoutConfigAndroid":{"AutoLayout":{"Android":true}}}
        """#)
        let auto = c.layout?["AutoLayout"] as? [String: Any]
        let global = auto?["GlobalScreenSettings"] as? [String: Any]
        XCTAssertEqual(global?["ScreenChange"] as? Bool, true)
        XCTAssertEqual(global?["CaptureLayoutOn"] as? Int, 0)
        XCTAssertEqual(auto?["MaskIdList"] as? [String], ["c"])
        XCTAssertNotNil(c.layout?["AppendMapIds"])
        XCTAssertEqual(warnings, [])
    }

    func testLayoutKeysOtherThanTheSdksAreDroppedWithAWarning() {
        let c = parse(#"{"layoutConfig":{"AutoLayout":{},"Other":{}}}"#)
        XCTAssertNil(c.layout?["Other"])
        XCTAssertEqual(warnings.count, 1)
        let none = parse(#"{"layoutConfig":null,"layoutConfigIos":{}}"#)
        XCTAssertNil(none.layout)
    }

    func testALayoutBlockThatIsNotAnObjectIsIgnoredWithAWarning() {
        let c = parse(#"{"layoutConfig":[1]}"#)
        XCTAssertNil(c.layout)
        XCTAssertEqual(warnings.count, 1)
    }
}

@MainActor
final class AcousticConnectConfigTests: XCTestCase {
    private var sdk: FakeSdk!

    override func setUp() async throws { sdk = FakeSdk() }

    private var logs: [String] = []

    private func bridge(_ config: NativeConfig) -> AcousticConnect {
        AcousticConnect(sdk: sdk, config: config, readyTimeout: 0.3, pollInterval: 0.01, log: { self.logs.append($0) })
    }

    private func json(_ text: String) -> [String: Any] {
        try! JSONSerialization.jsonObject(with: Data(text.utf8)) as! [String: Any]
    }

    func testEnable_appliesTheKillSwitchAndLocationBeforeEnableAndTheScreenSettingsAfter() async {
        var config = NativeConfig()
        config.killSwitchEnabled = true
        config.killSwitchUrl = "https://c/switch/k"
        config.locationLoggingEnabled = false
        config.screenCaptureEnabled = false
        sdk.configStore["AutoLayout"] = ["GlobalScreenSettings": ["CaptureLayoutOn": 1, "ScreenShot": 1]]
        let r = RecordingReply()
        await bridge(config).enable(json(#"{"appKey":"k","postURL":"u"}"#), reply: r)
        XCTAssertEqual(sdk.calls, ["killSwitch(true)", "setConfigItem(LogLocationEnabled)", "enable", "setConfigItem(AutoLayout)"])
        XCTAssertEqual(sdk.killSwitch?.url, "https://c/switch/k")
        XCTAssertEqual(sdk.configSets.first?.1 as? Bool, false)
        let auto = sdk.configStore["AutoLayout"] as? [String: Any]
        let global = auto?["GlobalScreenSettings"] as? [String: Any]
        XCTAssertEqual(global?["CaptureLayoutOn"] as? Int, 0)
        XCTAssertEqual(global?["ScreenShot"] as? Int, 1, "other keys survive")
        XCTAssertEqual(r.resolveCount, 1)
    }

    func testEnable_theKillSwitchIsOffByDefaultAndTheRestIsLeftToTheSdk() async {
        _ = await { () async -> RecordingReply in
            let r = RecordingReply()
            await bridge(NativeConfig()).enable(json(#"{"appKey":"k","postURL":"u"}"#), reply: r)
            return r
        }()
        XCTAssertEqual(sdk.calls, ["killSwitch(false)", "enable"])
        XCTAssertNil(sdk.killSwitch?.url)
    }

    func testEnable_screenCaptureOnLeavesTheSdkDefault() async {
        var config = NativeConfig()
        config.screenCaptureEnabled = true
        await bridge(config).enable(json(#"{"appKey":"k","postURL":"u"}"#), reply: RecordingReply())
        XCTAssertFalse(sdk.calls.contains("setConfigItem(AutoLayout)"))
    }

    func testEnable_mergesTheLayoutConfigOverTheSdksOwn() async {
        var config = NativeConfig()
        config.layout = ["AutoLayout": ["GlobalScreenSettings": ["CaptureLayoutOn": 0], "MaskIdList": ["c"]], "AppendMapIds": ["x": [String: Any]()]]
        sdk.configStore["AutoLayout"] = ["GlobalScreenSettings": ["ScreenChange": true, "CaptureLayoutOn": 1], "MaskIdList": ["a"]]
        await bridge(config).enable(json(#"{"appKey":"k","postURL":"u"}"#), reply: RecordingReply())
        let auto = sdk.configStore["AutoLayout"] as? [String: Any]
        let global = auto?["GlobalScreenSettings"] as? [String: Any]
        XCTAssertEqual(global?["ScreenChange"] as? Bool, true, "the SDK's own key survives")
        XCTAssertEqual(global?["CaptureLayoutOn"] as? Int, 0)
        XCTAssertEqual(auto?["MaskIdList"] as? [String], ["c"], "arrays are replaced, not merged")
        XCTAssertNotNil(sdk.configStore["AppendMapIds"])
    }

    func testEnable_aRefusedSettingDoesNotFailTheCall() async {
        sdk.accepts = false
        var config = NativeConfig()
        config.locationLoggingEnabled = true
        let r = RecordingReply()
        await bridge(config).enable(json(#"{"appKey":"k","postURL":"u"}"#), reply: r)
        XCTAssertEqual(r.resolveCount, 1)
        XCTAssertFalse(r.rejected)
    }

    func testEnable_theConfigSuppliesPushModeAndAppGroupUnlessTheCallDoes() async {
        var config = NativeConfig()
        config.pushEnabled = true
        config.pushMode = .manual
        config.appGroupIdentifier = "group.cfg"
        await bridge(config).enable(json(#"{"appKey":"k","postURL":"u"}"#), reply: RecordingReply())
        XCTAssertEqual(sdk.lastEnable?.mode, .manual)
        XCTAssertEqual(sdk.lastEnable?.group, "group.cfg")
        sdk = FakeSdk()
        await bridge(config).enable(json(#"{"appKey":"k","postURL":"u","pushMode":"automatic","iosAppGroupIdentifier":"group.call"}"#), reply: RecordingReply())
        XCTAssertEqual(sdk.lastEnable?.mode, .automatic)
        XCTAssertEqual(sdk.lastEnable?.group, "group.call")
    }

    func testEnable_pushIsOffUnlessTheConfigTurnsItOn() async {
        var config = NativeConfig()
        config.pushMode = .manual
        config.appGroupIdentifier = "group.cfg"
        await bridge(config).enable(json(#"{"appKey":"k","postURL":"u","pushMode":"manual"}"#), reply: RecordingReply())
        XCTAssertEqual(sdk.lastEnable?.mode, .off, "what the call or the config says about the mode is ignored while push is off")
    }

    func testEnable_pushOffMakesTheManualForwardersReject() async {
        let b = bridge(NativeConfig())
        await b.enable(json(#"{"appKey":"k","postURL":"u","pushMode":"manual"}"#), reply: RecordingReply())
        let r = RecordingReply()
        b.pushDidReceiveNotification(["userInfo": [String: Any]()], reply: r)
        XCTAssertEqual(r.code, "ACOUSTIC_PUSH_MODE_NOT_MANUAL")
    }

    func testEnable_offIsNotAModeTheCallCanAskFor() async {
        var config = NativeConfig()
        config.pushEnabled = true
        let r = RecordingReply()
        await bridge(config).enable(json(#"{"appKey":"k","postURL":"u","pushMode":"off"}"#), reply: r)
        XCTAssertEqual(r.code, "ACOUSTIC_INVALID_ARGS")
        XCTAssertEqual(sdk.calls, [])
    }

    func testEnable_whenAlreadyEnabledResolvesWithoutRepeatingTheSetup() async {
        sdk.enabled = true
        let r = RecordingReply()
        await bridge(NativeConfig()).enable(json(#"{"appKey":"k","postURL":"u"}"#), reply: r)
        XCTAssertEqual(sdk.calls, [])
        XCTAssertEqual(r.resolveCount, 1)
    }

    /// `isEnabled` turns true at once, the kill-switch check and the session start finish later: an enable() that answers in
    /// between would let the next logIdentity() be refused as "not ready".
    func testEnable_whenAlreadyEnabledButNotYetReadyWaitsForReadiness() async {
        sdk.enabled = true
        sdk.readyAfterChecks = 3
        let r = RecordingReply()
        await bridge(NativeConfig()).enable(json(#"{"appKey":"k","postURL":"u"}"#), reply: r)
        XCTAssertEqual(sdk.calls, [], "the set-up is not repeated")
        XCTAssertEqual(r.resolveCount, 1)
        XCTAssertGreaterThan(sdk.readinessChecks, 3, "it waited until the SDK was ready")
    }

    func testEnable_whenAlreadyEnabledAndReadyAnswersAtOnce() async {
        sdk.enabled = true
        sdk.ready = true
        let r = RecordingReply()
        await bridge(NativeConfig()).enable(json(#"{"appKey":"k","postURL":"u"}"#), reply: r)
        XCTAssertEqual(r.resolveCount, 1)
        XCTAssertEqual(sdk.readinessChecks, 1)
    }

    // MARK: enable() after the config started the SDK

    private func autoStarted() async -> AcousticConnect {
        var config = NativeConfig()
        config.appKey = "ck"; config.postMessageUrl = "https://c/post"; config.pushEnabled = true
        let b = bridge(config)
        await b.autoEnable(reply: RecordingReply())
        logs = []
        return b
    }

    func testEnableAfterTheConfigStartedTheSdk_saysWhatItDidNotChange() async {
        let b = await autoStarted()
        await b.enable(json(#"{"appKey":"other","postURL":"https://other/post","pushMode":"manual","iosAppGroupIdentifier":"group.x"}"#), reply: RecordingReply())
        let text = logs.joined(separator: "\n")
        XCTAssertTrue(text.contains("appKey"), text)
        XCTAssertTrue(text.contains("postURL"), text)
        XCTAssertTrue(text.contains("pushMode"), text)
        XCTAssertTrue(text.contains("iosAppGroupIdentifier"), text)
        XCTAssertTrue(text.contains("autoEnable"), "it says how to choose from JavaScript: \(text)")
        XCTAssertEqual(b.pushMode, .automatic, "the config's mode stays in effect")
    }

    func testEnableAfterTheConfigStartedTheSdk_isQuietWhenItAsksForWhatIsInEffect() async {
        let b = await autoStarted()
        await b.enable(json(#"{"appKey":"ck","postURL":"https://c/post"}"#), reply: RecordingReply())
        XCTAssertEqual(logs, [])
    }

    // MARK: auto-enable

    func testAutoEnable_enablesFromTheConfig() async {
        var config = NativeConfig()
        config.appKey = "ck"
        config.postMessageUrl = "https://c/post"
        let r = RecordingReply()
        await bridge(config).autoEnable(reply: r)
        XCTAssertEqual(sdk.lastEnable?.appKey, "ck")
        XCTAssertEqual(sdk.lastEnable?.postURL, "https://c/post")
        XCTAssertEqual(r.resolveCount, 1)
    }

    func testBeginAutoEnable_startsTheSdkWithoutSuspending() {
        var config = NativeConfig()
        config.appKey = "ck"
        config.postMessageUrl = "https://c/post"
        let r = RecordingReply()
        let waiting = bridge(config).beginAutoEnable(reply: r)
        // Synchronous: the plugin calls this while the view controller loads, so the SDK is up
        // before the first screen appears and can capture it.
        XCTAssertEqual(sdk.lastEnable?.appKey, "ck")
        XCTAssertTrue(waiting, "the caller still has to wait for readiness")
        XCTAssertEqual(r.resolveCount, 0)
    }

    func testBeginAutoEnable_hasNothingToWaitForWhenItDoesNotStartTheSdk() {
        XCTAssertFalse(bridge(NativeConfig()).beginAutoEnable(reply: RecordingReply()))
        sdk.enabled = true
        var config = NativeConfig()
        config.appKey = "k"; config.postMessageUrl = "u"
        let r = RecordingReply()
        XCTAssertFalse(bridge(config).beginAutoEnable(reply: r))
        XCTAssertEqual(r.resolveCount, 1, "already enabled resolves at once")
    }

    func testAutoEnable_doesNothingWithoutKeysOrWhenSwitchedOff() async {
        await bridge(NativeConfig()).autoEnable(reply: RecordingReply())
        var onlyKey = NativeConfig(); onlyKey.appKey = "k"
        await bridge(onlyKey).autoEnable(reply: RecordingReply())
        var off = NativeConfig(); off.appKey = "k"; off.postMessageUrl = "u"; off.autoEnable = false
        await bridge(off).autoEnable(reply: RecordingReply())
        XCTAssertEqual(sdk.calls, [])
    }

    func testAutoEnable_thenAnEnableFromJavaScriptResolvesWithoutRepeatingTheSetup() async {
        var config = NativeConfig()
        config.appKey = "ck"; config.postMessageUrl = "u"
        let b = bridge(config)
        await b.autoEnable(reply: RecordingReply())
        let after = sdk.calls.count
        let r = RecordingReply()
        await b.enable(json(#"{"appKey":"other","postURL":"u2"}"#), reply: r)
        XCTAssertEqual(sdk.calls.count, after)
        XCTAssertEqual(sdk.lastEnable?.appKey, "ck")
        XCTAssertEqual(r.resolveCount, 1)
    }
}
