package co.acoustic.connect.capacitor

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class NativeConfigTest {
    private val warnings = mutableListOf<String>()

    private fun parse(json: String?) = NativeConfig.from(json?.let { JSONObject(it) }) { warnings += it }

    @Test fun missingConfigGivesTheDefaults() {
        val config = parse(null)
        assertEquals(NativeConfig(), config)
        assertNull(config.appKey)
        assertTrue(config.autoEnable)
        assertFalse(config.useRelease)
        assertFalse(config.killSwitchEnabled)
        assertNull(config.locationLoggingEnabled)
        assertNull(config.screenCaptureEnabled)
        assertFalse("push is opt-in", config.pushEnabled)
        assertEquals(emptyList<String>(), warnings)
    }

    @Test fun readsEveryKey() {
        val config = parse(
            """{"appKey":"k","postMessageUrl":"https://c/collectorPost","autoEnable":false,"useRelease":true,
               "killSwitchEnabled":true,"killSwitchUrl":"https://c/switch/k","locationLoggingEnabled":false,
               "screenCaptureEnabled":false,"androidNotificationIconResName":"ic_push","pushEnabled":true}""",
        )
        assertEquals("k", config.appKey)
        assertEquals("https://c/collectorPost", config.postMessageUrl)
        assertFalse(config.autoEnable)
        assertTrue(config.useRelease)
        assertTrue(config.killSwitchEnabled)
        assertEquals("https://c/switch/k", config.killSwitchUrl)
        assertEquals(false, config.locationLoggingEnabled)
        assertEquals(false, config.screenCaptureEnabled)
        assertEquals("ic_push", config.notificationIconResName)
        assertTrue(config.pushEnabled)
        assertEquals(emptyList<String>(), warnings)
    }

    @Test fun nullAndBlankMeanNotConfigured() {
        val config = parse("""{"appKey":" ","postMessageUrl":null,"locationLoggingEnabled":null,"screenCaptureEnabled":null}""")
        assertNull(config.appKey)
        assertNull(config.postMessageUrl)
        assertNull(config.locationLoggingEnabled)
        assertNull(config.screenCaptureEnabled)
        assertEquals(emptyList<String>(), warnings)
    }

    @Test fun aValueOfTheWrongTypeIsIgnoredWithAWarning() {
        val config = parse("""{"useRelease":"yes","killSwitchEnabled":1,"appKey":5,"locationLoggingEnabled":"no","pushEnabled":"true"}""")
        assertFalse(config.useRelease)
        assertFalse(config.killSwitchEnabled)
        assertNull(config.appKey)
        assertNull(config.locationLoggingEnabled)
        assertFalse(config.pushEnabled)
        assertEquals(5, warnings.size)
        assertTrue(warnings.any { it.contains("useRelease") })
        assertTrue(warnings.any { it.contains("appKey") })
    }
}

class AcousticConnectConfigTest {
    private lateinit var sdk: FakeSdk

    @Before fun setUp() {
        sdk = FakeSdk()
    }

    private val warnings = mutableListOf<String>()

    private fun bridge(config: NativeConfig) =
        AcousticConnect(sdk, UiRunner { block -> block(); true }, config, warn = { warnings += it })

    private fun enableOptions(extra: String = "") =
        JSONObject("""{"appKey":"k","postURL":"u","pushMode":"automatic"$extra}""")

    @Test fun enable_appliesTheConfigAfterInitAndBeforeEnable() {
        val config = NativeConfig(useRelease = true, locationLoggingEnabled = true, screenCaptureEnabled = false)
        bridge(config).enable(enableOptions(), RecordingReply())
        assertEquals(
            listOf(
                "init",
                "updateConfig(DisplayLogging=false@EOCore)",
                "updateConfig(GoogleWebViewEnabled=false@Tealeaf)",
                "updateConfig(KillSwitchEnabled=false@Tealeaf)",
                "updateConfig(LogLocationEnabled=true@Tealeaf)",
                "updateConfig(LogViewLayoutOnScreenTransition=false@Tealeaf)",
                "enable(k,u)",
            ),
            sdk.calls.take(7),
        )
    }

    @Test fun enable_leavesUnsetOptionsToTheSdk() {
        sdk.version = "11.1.10-beta"
        bridge(NativeConfig()).enable(enableOptions(), RecordingReply())
        assertEquals(listOf("DisplayLogging", "GoogleWebViewEnabled", "KillSwitchEnabled"), sdk.configUpdates.map { it.first })
        assertEquals(listOf("true", "false", "false"), sdk.configUpdates.map { it.second })
    }

    @Test fun enable_layoutCaptureIsOffByDefaultOnAnSdkThatCannotFinishAWebViewLayout() {
        // Before 11.1.10 the layout of a WebView screen waits for a script the plugin has to keep out of
        // the page, never completes, and holds back every later message.
        sdk.version = "11.0.21-beta"
        bridge(NativeConfig()).enable(enableOptions(), RecordingReply())
        assertTrue(sdk.configUpdates.contains(Triple("LogViewLayoutOnScreenTransition", "false", "Tealeaf")))
    }

    @Test fun enable_layoutCaptureKeepsTheSdkDefaultOnAnSdkThatCan() {
        sdk.version = "11.1.10-beta"
        bridge(NativeConfig()).enable(enableOptions(), RecordingReply())
        assertFalse(sdk.configUpdates.any { it.first == "LogViewLayoutOnScreenTransition" })
        sdk = FakeSdk().also { it.version = "12.0.0" }
        bridge(NativeConfig()).enable(enableOptions(), RecordingReply())
        assertFalse(sdk.configUpdates.any { it.first == "LogViewLayoutOnScreenTransition" })
    }

    @Test fun enable_anExplicitScreenCaptureChoiceWinsOverTheVersionRule() {
        sdk.version = "11.0.21-beta"
        bridge(NativeConfig(screenCaptureEnabled = true)).enable(enableOptions(), RecordingReply())
        assertFalse(sdk.configUpdates.any { it.first == "LogViewLayoutOnScreenTransition" })
        sdk = FakeSdk().also { it.version = "11.1.10-beta" }
        bridge(NativeConfig(screenCaptureEnabled = false)).enable(enableOptions(), RecordingReply())
        assertTrue(sdk.configUpdates.contains(Triple("LogViewLayoutOnScreenTransition", "false", "Tealeaf")))
    }

    @Test fun enable_anUnreadableVersionLeavesTheSdkDefault() {
        sdk.version = "dev"
        bridge(NativeConfig()).enable(enableOptions(), RecordingReply())
        assertFalse(sdk.configUpdates.any { it.first == "LogViewLayoutOnScreenTransition" })
    }

    @Test fun enable_screenCaptureOnLeavesTheSdkDefault() {
        bridge(NativeConfig(screenCaptureEnabled = true)).enable(enableOptions(), RecordingReply())
        assertFalse(sdk.configUpdates.any { it.first == "LogViewLayoutOnScreenTransition" })
    }

    @Test fun enable_theKillSwitchIsOffUnlessTheConfigOptsIn() {
        bridge(NativeConfig(killSwitchUrl = "https://c/switch/k")).enable(enableOptions(), RecordingReply())
        assertTrue(sdk.configUpdates.contains(Triple("KillSwitchEnabled", "false", "Tealeaf")))
        assertFalse("a URL means nothing while the switch is off", sdk.configUpdates.any { it.first == "KillSwitchUrl" })
    }

    @Test fun enable_setsTheKillSwitchAndItsUrlBeforeEnableWhenOptedIn() {
        bridge(NativeConfig(killSwitchEnabled = true, killSwitchUrl = "https://c/switch/k")).enable(enableOptions(), RecordingReply())
        assertTrue(sdk.configUpdates.contains(Triple("KillSwitchEnabled", "true", "Tealeaf")))
        assertTrue(sdk.configUpdates.contains(Triple("KillSwitchUrl", "https://c/switch/k", "Tealeaf")))
        assertTrue(sdk.calls.indexOf("updateConfig(KillSwitchUrl=https://c/switch/k@Tealeaf)") < sdk.calls.indexOf("enable(k,u)"))
    }

    @Test fun enable_aFailedConfigUpdateDoesNotFailTheCall() {
        sdk.accepts = false
        val r = RecordingReply()
        bridge(NativeConfig(locationLoggingEnabled = true)).enable(enableOptions(), r)
        assertEquals(1, r.resolveCount)
        assertFalse(r.rejected)
    }

    @Test fun enable_whenAlreadyEnabledAppliesNothing() {
        sdk.enabled = true
        bridge(NativeConfig(useRelease = true)).enable(enableOptions(), RecordingReply())
        assertEquals(emptyList<String>(), sdk.calls)
    }

    // Once the config has started the SDK a call to enable() changes nothing: it says what it did not change.

    @Test fun enableAfterTheConfigStartedTheSdk_saysWhatItDidNotChange() {
        val b = bridge(NativeConfig(appKey = "ck", postMessageUrl = "https://c/post", notificationIconResName = "ic_cfg", pushEnabled = true))
        b.autoEnable(RecordingReply())
        b.enable(JSONObject("""{"appKey":"other","postURL":"https://other/post","pushMode":"automatic","androidIconResName":"ic_call"}"""), RecordingReply())
        val text = warnings.joinToString("\n")
        assertTrue(text, text.contains("appKey"))
        assertTrue(text, text.contains("postURL"))
        assertTrue(text, text.contains("androidIconResName"))
        assertTrue(text, text.contains("autoEnable"))
    }

    @Test fun enableAfterTheConfigStartedTheSdk_isQuietWhenItAsksForWhatIsInEffect() {
        val b = bridge(NativeConfig(appKey = "ck", postMessageUrl = "https://c/post", notificationIconResName = "ic_cfg", pushEnabled = true))
        b.autoEnable(RecordingReply())
        b.enable(JSONObject("""{"appKey":"ck","postURL":"https://c/post","pushMode":"automatic"}"""), RecordingReply())
        assertEquals(emptyList<String>(), warnings)
    }

    @Test fun enable_usesTheConfiguredIconUnlessTheCallNamesOne() {
        bridge(NativeConfig(notificationIconResName = "ic_cfg", pushEnabled = true)).enable(enableOptions(), RecordingReply())
        assertTrue(sdk.calls.contains("resolveIconRes(ic_cfg)"))
        sdk = FakeSdk()
        bridge(NativeConfig(notificationIconResName = "ic_cfg", pushEnabled = true)).enable(enableOptions(""","androidIconResName":"ic_call""""), RecordingReply())
        assertTrue(sdk.calls.contains("resolveIconRes(ic_call)"))
    }

    // auto-enable from the config

    @Test fun autoEnable_enablesFromTheConfig() {
        val r = RecordingReply()
        bridge(NativeConfig(appKey = "ck", postMessageUrl = "https://c/post", notificationIconResName = "ic_cfg", pushEnabled = true)).autoEnable(r)
        assertTrue(sdk.calls.contains("enable(ck,https://c/post)"))
        assertTrue(sdk.calls.contains("resolveIconRes(ic_cfg)"))
        assertEquals(1, r.resolveCount)
    }

    @Test fun autoEnable_doesNothingWithoutKeysOrWhenSwitchedOff() {
        bridge(NativeConfig()).autoEnable(RecordingReply())
        bridge(NativeConfig(appKey = "k")).autoEnable(RecordingReply())
        bridge(NativeConfig(postMessageUrl = "u")).autoEnable(RecordingReply())
        bridge(NativeConfig(appKey = "k", postMessageUrl = "u", autoEnable = false)).autoEnable(RecordingReply())
        assertEquals(emptyList<String>(), sdk.calls)
    }

    @Test fun autoEnable_thenAnEnableFromJavaScriptResolvesWithoutRepeatingTheSetup() {
        val b = bridge(NativeConfig(appKey = "ck", postMessageUrl = "u"))
        b.autoEnable(RecordingReply())
        val callsAfterAuto = sdk.calls.size
        val r = RecordingReply()
        b.enable(enableOptions(), r)
        assertEquals(callsAfterAuto, sdk.calls.size)
        assertEquals(1, r.resolveCount)
    }
}

class SdkVersionTest {
    @Test fun parsesTheNumbersAndIgnoresTheSuffix() {
        assertEquals(Triple(11, 0, 21), SdkVersion.parse("11.0.21-beta"))
        assertEquals(Triple(11, 1, 10), SdkVersion.parse("11.1.10"))
    }

    @Test fun anythingElseDoesNotParse() {
        assertNull(SdkVersion.parse("dev"))
        assertNull(SdkVersion.parse("11.1"))
        assertNull(SdkVersion.parse(""))
    }

    @Test fun comparesNumericallyNotAsText() {
        assertTrue(SdkVersion.isOlderThan("11.0.21-beta", "11.1.10"))
        assertTrue(SdkVersion.isOlderThan("11.1.9", "11.1.10"))
        assertFalse(SdkVersion.isOlderThan("11.1.10-beta", "11.1.10"))
        assertFalse(SdkVersion.isOlderThan("11.2.0", "11.1.10"))
        assertFalse(SdkVersion.isOlderThan("12.0.0", "11.1.10"))
        assertFalse("unreadable is not old", SdkVersion.isOlderThan("dev", "11.1.10"))
    }
}
