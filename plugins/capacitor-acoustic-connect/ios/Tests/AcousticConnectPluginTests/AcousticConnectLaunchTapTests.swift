import XCTest
@testable import AcousticConnectPlugin

/// Stands in for what keeps the launch tap: it writes into the SDK's call list, so the order of hand-over, enable and replay shows.
@MainActor
final class FakeLaunchHold: PushLaunchHold {
    private let sdk: FakeSdk
    /// Whether a tap was held when the hand-over came.
    var holdsTap = true
    var handOvers: [Bool] = []

    init(sdk: FakeSdk) { self.sdk = sdk }

    func handOver(sdkInstallsDelegate: Bool) -> (@MainActor () -> Void)? {
        handOvers.append(sdkInstallsDelegate)
        sdk.calls.append("handOver(\(sdkInstallsDelegate))")
        // Like the real holder: a held tap is replayed only when the SDK is going to install the delegate that handles it.
        guard sdkInstallsDelegate, holdsTap else { return nil }
        return { [sdk] in sdk.calls.append("replay") }
    }
}

/// The notification tap that launched a killed app: kept until the SDK is enabled, then replayed into it.
@MainActor
final class AcousticConnectLaunchTapTests: XCTestCase {
    private let sdk = FakeSdk()

    /// The arguments of a valid `enable` call, with `extra` on top.
    private func args(_ extra: [String: Any] = [:]) -> [String: Any] {
        ["appKey": "k", "postURL": "u"].merging(extra) { _, new in new }
    }

    private func replyAsync(_ body: (RecordingReply) async -> Void) async -> RecordingReply {
        let reply = RecordingReply()
        await body(reply)
        return reply
    }

    private func bridgeWithLaunchHold(pushEnabled: Bool = true, mode: PushMode? = nil) -> (AcousticConnect, FakeLaunchHold) {
        var config = NativeConfig()
        config.pushEnabled = pushEnabled
        config.pushMode = mode
        let hold = FakeLaunchHold(sdk: sdk)
        return (AcousticConnect(sdk: sdk, config: config, readyTimeout: 0.3, pollInterval: 0.01, launchHold: hold), hold)
    }

    func testEnable_releasesTheLaunchTapBeforeTheSdkAndReplaysItAfter() async {
        let (bridge, hold) = bridgeWithLaunchHold()
        _ = await replyAsync { await bridge.enable(args(), reply: $0) }
        XCTAssertEqual(sdk.calls, ["killSwitch(false)", "handOver(true)", "enable", "replay"])
        XCTAssertEqual(hold.handOvers, [true])
    }

    func testEnable_inManualModeHandsTheCenterBackAndReplaysNothing() async {
        let (bridge, hold) = bridgeWithLaunchHold()
        _ = await replyAsync { await bridge.enable(args(["pushMode": "manual"]), reply: $0) }
        XCTAssertEqual(sdk.calls, ["killSwitch(false)", "handOver(false)", "enable"])
        XCTAssertEqual(hold.handOvers, [false])
    }

    func testEnable_withTheConfigInManualModeHandsTheCenterBack() async {
        let (bridge, hold) = bridgeWithLaunchHold(mode: .manual)
        _ = await replyAsync { await bridge.enable(args(), reply: $0) }
        XCTAssertEqual(hold.handOvers, [false])
        XCTAssertFalse(sdk.calls.contains("replay"))
    }

    func testEnable_withPushOffHandsTheCenterBackAndReplaysNothing() async {
        let (bridge, hold) = bridgeWithLaunchHold(pushEnabled: false)
        _ = await replyAsync { await bridge.enable(args(), reply: $0) }
        XCTAssertEqual(hold.handOvers, [false])
        XCTAssertFalse(sdk.calls.contains("replay"))
    }

    func testEnable_replaysNothingWhenNoTapWasHeld() async {
        let (bridge, hold) = bridgeWithLaunchHold()
        hold.holdsTap = false
        _ = await replyAsync { await bridge.enable(args(), reply: $0) }
        XCTAssertEqual(sdk.calls, ["killSwitch(false)", "handOver(true)", "enable"])
    }

    func testEnable_theSecondCallDoesNotHandOverAgain() async {
        let (bridge, hold) = bridgeWithLaunchHold()
        _ = await replyAsync { await bridge.enable(args(), reply: $0) }
        _ = await replyAsync { await bridge.enable(args(), reply: $0) }
        XCTAssertEqual(hold.handOvers, [true])
        XCTAssertEqual(sdk.calls.filter { $0 == "replay" }.count, 1)
    }

    func testEnable_aRejectedCallKeepsTheLaunchTap() async {
        let (bridge, hold) = bridgeWithLaunchHold()
        _ = await replyAsync { await bridge.enable(args(["appKey": ""]), reply: $0) }
        XCTAssertEqual(hold.handOvers, [])
        XCTAssertEqual(sdk.calls, [])
    }

    func testAutoEnable_replaysTheLaunchTapToo() async {
        var config = NativeConfig()
        config.pushEnabled = true
        config.appKey = "k"
        config.postMessageUrl = "u"
        let hold = FakeLaunchHold(sdk: sdk)
        let bridge = AcousticConnect(sdk: sdk, config: config, readyTimeout: 0.3, pollInterval: 0.01, launchHold: hold)
        _ = await replyAsync { await bridge.autoEnable(reply: $0) }
        XCTAssertEqual(sdk.calls, ["killSwitch(false)", "handOver(true)", "enable", "replay"])
    }

    func testLaunchHold_isOnlyWantedForPushInAutomaticMode() {
        XCTAssertTrue(PushLaunchHolder.wantsHold(pushEnabled: true, mode: nil))
        XCTAssertTrue(PushLaunchHolder.wantsHold(pushEnabled: true, mode: .automatic))
        XCTAssertFalse(PushLaunchHolder.wantsHold(pushEnabled: true, mode: .manual))
        XCTAssertFalse(PushLaunchHolder.wantsHold(pushEnabled: false, mode: nil))
        XCTAssertFalse(PushLaunchHolder.wantsHold(pushEnabled: false, mode: .automatic))
    }
}
