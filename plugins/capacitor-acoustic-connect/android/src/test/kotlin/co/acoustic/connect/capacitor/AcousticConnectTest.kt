package co.acoustic.connect.capacitor

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Records what the bridge asked of the SDK and lets a test choose what the SDK answers. */
class FakeSdk : ConnectSdk {
    val calls = mutableListOf<String>()
    var enabled = false
    var version = "11.0.21-beta"
    var accepts = true
    var throwOnCall: Throwable? = null
    var configItem: String? = null
    var permissionState: Boolean? = null
    var iconRes = 7
    var turnOnPushResult: Result<Unit>? = Result.success(Unit)
    var permissionResult: Result<Boolean>? = Result.success(true)
    var apiLevel = 34
    var pushAvailable = true
    var pushEnableThrows: Throwable? = null
    var configUpdates = mutableListOf<Triple<String, String, String>>()
    var lastCustom: Triple<String, Map<String, String>, Int>? = null
    var lastSignal: Pair<Map<String, Any?>, Int>? = null
    var lastIdentity: List<Any>? = null
    var lastScreen: List<Any?>? = null
    var lastException: List<Any>? = null

    private fun record(call: String) {
        calls += call
        throwOnCall?.let { throw it }
    }

    override fun isEnabled() = enabled
    override fun libraryVersion() = version
    override fun init() = record("init")
    override fun enable(appKey: String, postURL: String) {
        record("enable($appKey,$postURL)")
        enabled = true
    }
    override fun disable() = record("disable")
    override fun resolveIconRes(requestedName: String?): Int {
        record("resolveIconRes($requestedName)")
        return iconRes
    }
    override fun pushAvailable() = pushAvailable
    override fun pushEnable(iconRes: Int, onWarning: (Throwable) -> Unit) {
        record("pushEnable($iconRes)")
        pushEnableThrows?.let { throw it }
    }
    override fun turnOnPush(onSuccess: () -> Unit, onFailure: (Throwable) -> Unit) {
        record("turnOnPush")
        turnOnPushResult?.fold({ onSuccess() }, { onFailure(it) })
    }
    override fun requestNotificationPermission(onResult: (Boolean) -> Unit) {
        record("requestNotificationPermission")
        permissionResult?.fold({ onResult(it) }, { throw it })
    }
    override fun notificationPermissionNeeded() = apiLevel >= 33
    override fun pushPermissionState(): Boolean? {
        record("pushPermissionState")
        return permissionState
    }
    override fun logIdentification(name: String, value: String, signalType: String, params: Map<String, String>): Boolean {
        record("logIdentification")
        lastIdentity = listOf(name, value, signalType, params)
        return accepts
    }
    override fun flushQueues() = record("flushQueues")
    override fun flushImmediately() = record("flushImmediately")
    override fun logScreenview(name: String, type: ScreenViewType, referrer: String?): Boolean {
        record("logScreenview")
        lastScreen = listOf(name, type, referrer)
        return accepts
    }
    var lastLayout: List<Any?>? = null
    override fun logScreenLayout(name: String, delayMs: Int?): Boolean {
        record("logScreenLayout")
        lastLayout = listOf(name, delayMs)
        return accepts
    }
    var lastLocation: List<Any?>? = null
    override fun logLocation(level: Int): Boolean {
        record("logLocation")
        lastLocation = listOf(level)
        return accepts
    }
    override fun logLocationUpdate(latitude: Double, longitude: Double, level: Int): Boolean {
        record("logLocationUpdate")
        lastLocation = listOf(latitude, longitude, level)
        return accepts
    }
    override fun logCustomEvent(name: String, values: Map<String, String>, level: Int): Boolean {
        record("logCustomEvent")
        lastCustom = Triple(name, values, level)
        return accepts
    }
    override fun logSignal(values: Map<String, Any?>, level: Int): Boolean {
        record("logSignal")
        lastSignal = values to level
        return accepts
    }
    override fun logException(message: String, stackInfo: String, unhandled: Boolean): Boolean {
        record("logException")
        lastException = listOf(message, stackInfo, unhandled)
        return accepts
    }
    override fun updateConfig(key: String, value: String, module: String): Boolean {
        record("updateConfig($key=$value@$module)")
        configUpdates += Triple(key, value, module)
        return accepts
    }
    override fun getConfigItemString(key: String, module: String): String? {
        record("getConfigItemString($key,$module)")
        return configItem
    }
}

class RecordingReply : Reply {
    var resolved: JSONObject? = null
    var resolveCount = 0
    var code: String? = null
    var message: String? = null

    override fun resolve(data: JSONObject?) {
        resolveCount++
        resolved = data
    }
    override fun reject(code: String, message: String) {
        this.code = code
        this.message = message
    }
    val rejected get() = code != null
}

class AcousticConnectTest {
    private lateinit var sdk: FakeSdk
    private lateinit var connect: AcousticConnect
    private var uiAvailable = true

    @Before
    fun setUp() {
        sdk = FakeSdk()
        uiAvailable = true
        connect = AcousticConnect(sdk, UiRunner { block -> if (uiAvailable) { block(); true } else false })
    }

    private fun obj(json: String) = JSONObject(json)

    /** The bridge as an app with `pushEnabled: true` gets it. */
    private fun withPush() =
        AcousticConnect(sdk, UiRunner { block -> if (uiAvailable) { block(); true } else false }, NativeConfig(pushEnabled = true))

    private fun reply(block: (RecordingReply) -> Unit): RecordingReply = RecordingReply().also(block)

    private fun RecordingReply.assertRejected(code: String, messagePart: String? = null) {
        assertEquals(code, this.code)
        if (messagePart != null) assertTrue(message, message!!.contains(messagePart))
    }

    // enable

    private val sdkSetup = listOf(
        "init",
        "updateConfig(DisplayLogging=true@EOCore)",
        "updateConfig(GoogleWebViewEnabled=false@Tealeaf)",
        "updateConfig(KillSwitchEnabled=false@Tealeaf)",
        "updateConfig(LogViewLayoutOnScreenTransition=false@Tealeaf)",
        "enable(k,https://p)",
    )

    @Test fun enable_startsTheSdkAndLeavesPushAloneByDefault() {
        val r = reply { connect.enable(obj("""{"appKey":"k","postURL":"https://p","pushMode":"automatic"}"""), it) }
        assertEquals(sdkSetup, sdk.calls)
        assertEquals(1, r.resolveCount)
        assertNull(r.resolved)
    }

    @Test fun enable_withPushOnSetsPushUpAfterTheSdk() {
        val r = reply { withPush().enable(obj("""{"appKey":"k","postURL":"https://p","pushMode":"automatic"}"""), it) }
        assertEquals(
            sdkSetup + listOf("resolveIconRes(null)", "pushEnable(7)", "turnOnPush", "flushQueues", "requestNotificationPermission"),
            sdk.calls,
        )
        assertEquals(1, r.resolveCount)
    }

    @Test fun enable_doesNotWaitForPushToResolve() {
        sdk.turnOnPushResult = null // the SDK never answers
        val r = reply { withPush().enable(obj("""{"appKey":"k","postURL":"u","pushMode":"automatic"}"""), it) }
        assertEquals(1, r.resolveCount)
    }

    @Test fun enable_aFailingPushStartDoesNotFailTheCall() {
        sdk.turnOnPushResult = Result.failure(IllegalStateException("no token"))
        val failed = reply { withPush().enable(obj("""{"appKey":"k","postURL":"u","pushMode":"automatic"}"""), it) }
        assertEquals(1, failed.resolveCount)
        assertFalse(failed.rejected)
        sdk = FakeSdk().also { it.pushEnableThrows = IllegalStateException("Firebase is not initialised") }
        val thrown = reply { withPush().enable(obj("""{"appKey":"k","postURL":"u","pushMode":"automatic"}"""), it) }
        assertEquals(1, thrown.resolveCount)
        assertFalse(thrown.rejected)
    }

    @Test fun enable_pushOnWithoutTheFcmArtifactSkipsPush() {
        sdk.pushAvailable = false
        val r = reply { withPush().enable(obj("""{"appKey":"k","postURL":"https://p","pushMode":"automatic"}"""), it) }
        assertEquals(sdkSetup, sdk.calls)
        assertEquals(1, r.resolveCount)
    }

    @Test fun enable_usesTheIconNameFromTheOptions() {
        reply { withPush().enable(obj("""{"appKey":"k","postURL":"u","pushMode":"automatic","androidIconResName":"ic_push"}"""), it) }
        assertTrue(sdk.calls.contains("resolveIconRes(ic_push)"))
    }

    @Test fun enable_doesNotAskForPermissionBeforeAndroid13() {
        sdk.apiLevel = 32
        val r = reply { withPush().enable(obj("""{"appKey":"k","postURL":"u","pushMode":"automatic"}"""), it) }
        assertFalse(sdk.calls.contains("requestNotificationPermission"))
        assertEquals(1, r.resolveCount)
    }

    @Test fun enable_whenAlreadyEnabledResolvesWithoutRepeatingTheSetup() {
        sdk.enabled = true
        val r = reply { connect.enable(obj("""{"appKey":"k","postURL":"u","pushMode":"automatic"}"""), it) }
        assertEquals(emptyList<String>(), sdk.calls)
        assertEquals(1, r.resolveCount)
    }

    @Test fun enable_rejectsBlankAppKeyAndPostUrl() {
        reply { connect.enable(obj("""{"appKey":" ","postURL":"u","pushMode":"automatic"}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS", "appKey")
        reply { connect.enable(obj("""{"appKey":"k","postURL":"","pushMode":"automatic"}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS", "postURL")
        assertEquals(emptyList<String>(), sdk.calls)
    }

    @Test fun enable_rejectsManualPushMode() {
        reply { connect.enable(obj("""{"appKey":"k","postURL":"u","pushMode":"manual"}"""), it) }
            .assertRejected("ACOUSTIC_INVALID_ARGS", "automatic")
        assertEquals(emptyList<String>(), sdk.calls)
    }

    @Test fun enable_withoutActivityRejects() {
        uiAvailable = false
        reply { connect.enable(obj("""{"appKey":"k","postURL":"u","pushMode":"automatic"}"""), it) }
            .assertRejected("ACOUSTIC_INTERNAL_ERROR", "no host activity")
    }

    @Test fun enable_rejectsWhenTheSdkThrows() {
        sdk.throwOnCall = IllegalStateException("boom")
        reply { connect.enable(obj("""{"appKey":"k","postURL":"u","pushMode":"automatic"}"""), it) }
            .assertRejected("ACOUSTIC_INTERNAL_ERROR", "boom")
    }

    @Test fun enable_aFailedPermissionRequestDoesNotFailTheCall() {
        sdk.permissionResult = Result.failure(IllegalStateException("no activity"))
        val r = reply { withPush().enable(obj("""{"appKey":"k","postURL":"u","pushMode":"automatic"}"""), it) }
        assertEquals(1, r.resolveCount)
        assertFalse(r.rejected)
    }

    // disable, log level

    @Test fun disable_callsTheSdk() {
        val r = reply { connect.disable(it) }
        assertEquals(listOf("disable"), sdk.calls)
        assertEquals(1, r.resolveCount)
    }

    @Test fun disable_rejectsWhenTheSdkThrowsOrThereIsNoActivity() {
        sdk.throwOnCall = IllegalStateException("boom")
        reply { connect.disable(it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "boom")
        uiAvailable = false
        reply { connect.disable(it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "no host activity")
    }

    @Test fun setLogLevel_acceptsKnownLevelsOnly() {
        for (level in listOf("silent", "error", "warn", "info", "verbose")) {
            assertEquals(1, reply { connect.setLogLevel(obj("""{"level":"$level"}"""), it) }.resolveCount)
        }
        reply { connect.setLogLevel(obj("""{"level":"loud"}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS")
        reply { connect.setLogLevel(obj("{}"), it) }.assertRejected("ACOUSTIC_INVALID_ARGS")
    }

    // identity

    @Test fun logIdentity_sendsTheIdentityAndFlushesImmediately() {
        val r = reply { connect.logIdentity(obj("""{"identifierName":" email ","identifierValue":"a@b.c","signalType":"registered","additionalParameters":{"plan":"pro","n":2}}"""), it) }
        assertEquals(listOf("email", "a@b.c", "registered", mapOf("plan" to "pro", "n" to "2")), sdk.lastIdentity)
        assertEquals(listOf("logIdentification", "flushImmediately"), sdk.calls)
        assertEquals(1, r.resolveCount)
    }

    @Test fun logIdentity_defaultsTheSignalTypeAndParameters() {
        reply { connect.logIdentity(obj("""{"identifierName":"n","identifierValue":"v"}"""), it) }
        assertEquals(listOf("n", "v", "loggedIn", emptyMap<String, String>()), sdk.lastIdentity)
        reply { connect.logIdentity(obj("""{"identifierName":"n","identifierValue":"v","signalType":"  "}"""), it) }
        assertEquals("loggedIn", sdk.lastIdentity!![2])
    }

    @Test fun logIdentity_rejectsMissingNameOrValue() {
        reply { connect.logIdentity(obj("""{"identifierName":"","identifierValue":"v"}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS")
        reply { connect.logIdentity(obj("""{"identifierName":"n"}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS")
        assertEquals(emptyList<String>(), sdk.calls)
    }

    @Test fun logIdentity_rejectsWhenTheSdkDeclines() {
        sdk.accepts = false
        reply { connect.logIdentity(obj("""{"identifierName":"n","identifierValue":"v"}"""), it) }
            .assertRejected("ACOUSTIC_INTERNAL_ERROR", "returned false")
        assertFalse(sdk.calls.contains("flushImmediately"))
    }

    // simple reads

    @Test fun getSdkVersion_andIsSdkEnabledResolveAValue() {
        assertEquals("11.0.21-beta", reply { connect.getSdkVersion(it) }.resolved!!.getString("value"))
        assertFalse(reply { connect.isSdkEnabled(it) }.resolved!!.getBoolean("value"))
        sdk.enabled = true
        assertTrue(reply { connect.isSdkEnabled(it) }.resolved!!.getBoolean("value"))
    }

    @Test fun flushQueues_flushesOnlyWhenEnabledAndNeverFails() {
        assertEquals(1, reply { connect.flushQueues(it) }.resolveCount)
        assertEquals(emptyList<String>(), sdk.calls)
        sdk.enabled = true
        sdk.throwOnCall = IllegalStateException("boom")
        assertEquals(1, reply { connect.flushQueues(it) }.resolveCount)
        uiAvailable = false
        assertEquals(1, reply { connect.flushQueues(it) }.resolveCount)
    }

    // events

    @Test fun setCurrentScreenName_logsALoadScreenViewAndNeverFails() {
        assertEquals(1, reply { connect.setCurrentScreenName(obj("""{"name":" home "}"""), it) }.resolveCount)
        assertEquals(listOf("home", ScreenViewType.LOAD, null), sdk.lastScreen)
        sdk.throwOnCall = IllegalStateException("boom")
        assertEquals(1, reply { connect.setCurrentScreenName(obj("""{"name":"home"}"""), it) }.resolveCount)
        uiAvailable = false
        assertEquals(1, reply { connect.setCurrentScreenName(obj("""{"name":"home"}"""), it) }.resolveCount)
        reply { connect.setCurrentScreenName(obj("""{"name":" "}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS")
    }

    @Test fun logCustomEvent_sendsStringValuesAndTheLevel() {
        val r = reply { connect.logCustomEvent(obj("""{"eventName":"buy","values":{"a":"x","b":2,"c":true},"level":2}"""), it) }
        assertEquals(Triple("buy", mapOf("a" to "x", "b" to "2", "c" to "true"), 2), sdk.lastCustom)
        assertEquals(1, r.resolveCount)
    }

    @Test fun logCustomEvent_defaultsValuesAndLevel() {
        reply { connect.logCustomEvent(obj("""{"eventName":"buy"}"""), it) }
        assertEquals(Triple("buy", emptyMap<String, String>(), 3), sdk.lastCustom)
    }

    @Test fun logCustomEvent_rejectsBlankNameDeclineAndThrow() {
        reply { connect.logCustomEvent(obj("""{"eventName":" "}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS")
        sdk.accepts = false
        reply { connect.logCustomEvent(obj("""{"eventName":"e"}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "returned false")
        sdk.accepts = true
        sdk.throwOnCall = IllegalStateException("boom")
        reply { connect.logCustomEvent(obj("""{"eventName":"e"}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "boom")
    }

    @Test fun logCustomEvent_withoutActivityResolvesWithoutSending() {
        uiAvailable = false
        assertEquals(1, reply { connect.logCustomEvent(obj("""{"eventName":"e"}"""), it) }.resolveCount)
        assertEquals(emptyList<String>(), sdk.calls)
    }

    @Test fun logSignal_keepsNestedJsonAndTopLevelNumbers() {
        val r = reply { connect.logSignal(obj("""{"values":{"n":1,"o":{"a":[1,2]},"z":null},"level":4}"""), it) }
        val (values, level) = sdk.lastSignal!!
        assertEquals(4, level)
        assertEquals(1, values["n"])
        assertTrue(values["o"] is JSONObject)
        assertEquals(JSONObject.NULL, values["z"])
        assertEquals(1, r.resolveCount)
    }

    @Test fun logSignal_defaultsTheLevelAndRejectsMissingValues() {
        reply { connect.logSignal(obj("""{"values":{}}"""), it) }
        assertEquals(3, sdk.lastSignal!!.second)
        reply { connect.logSignal(obj("{}"), it) }.assertRejected("ACOUSTIC_INVALID_ARGS")
    }

    @Test fun logSignal_rejectsWithoutActivityDeclineAndThrow() {
        uiAvailable = false
        reply { connect.logSignal(obj("""{"values":{}}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "no foreground activity")
        uiAvailable = true
        sdk.accepts = false
        reply { connect.logSignal(obj("""{"values":{}}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "returned false")
        sdk.accepts = true
        sdk.throwOnCall = IllegalStateException("boom")
        reply { connect.logSignal(obj("""{"values":{}}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "boom")
    }

    @Test fun logExceptionEvent_sendsMessageStackAndFlag() {
        reply { connect.logExceptionEvent(obj("""{"message":" bad ","stackInfo":"at x","unhandled":true}"""), it) }
        assertEquals(listOf("bad", "at x", true), sdk.lastException)
        reply { connect.logExceptionEvent(obj("""{"message":"bad"}"""), it) }
        assertEquals(listOf("bad", "", false), sdk.lastException)
        reply { connect.logExceptionEvent(obj("""{"message":""}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS")
        sdk.accepts = false
        reply { connect.logExceptionEvent(obj("""{"message":"bad"}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "returned false")
    }

    @Test fun screenViewContext_logsLoadAndUnloadWithTheReferrer() {
        reply { connect.logScreenViewContextLoad(obj("""{"logicalPageName":"cart","referrer":"home"}"""), it) }
        assertEquals(listOf("cart", ScreenViewType.LOAD, "home"), sdk.lastScreen)
        reply { connect.logScreenViewContextUnload(obj("""{"logicalPageName":"cart","referrer":null}"""), it) }
        assertEquals(listOf("cart", ScreenViewType.UNLOAD, null), sdk.lastScreen)
        reply { connect.logScreenViewContextLoad(obj("""{"logicalPageName":"cart","referrer":"  "}"""), it) }
        assertNull(sdk.lastScreen!![2])
        reply { connect.logScreenViewContextLoad(obj("""{"logicalPageName":"cart"}"""), it) }
        assertNull(sdk.lastScreen!![2])
    }

    @Test fun screenViewContext_rejectsBlankNameNoActivityDeclineAndThrow() {
        reply { connect.logScreenViewContextLoad(obj("""{"logicalPageName":" "}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS", "logScreenViewContextLoad")
        uiAvailable = false
        reply { connect.logScreenViewContextUnload(obj("""{"logicalPageName":"a"}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "no foreground activity")
        uiAvailable = true
        sdk.accepts = false
        reply { connect.logScreenViewContextUnload(obj("""{"logicalPageName":"a"}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "logScreenViewContextUnload returned false")
        sdk.accepts = true
        sdk.throwOnCall = IllegalStateException("boom")
        reply { connect.logScreenViewContextLoad(obj("""{"logicalPageName":"a"}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "boom")
    }

    @Test fun logScreenLayout_passesTheNameAndTheDelay() {
        reply { connect.logScreenLayout(obj("""{"name":" Home ","delayMs":300}"""), it) }
        assertEquals(listOf("Home", 300), sdk.lastLayout)
        reply { connect.logScreenLayout(obj("""{"name":"Home"}"""), it) }
        assertEquals(listOf("Home", null), sdk.lastLayout)
        reply { connect.logScreenLayout(obj("""{"name":"Home","delayMs":null}"""), it) }
        assertEquals(listOf("Home", null), sdk.lastLayout)
    }

    @Test fun logScreenLayout_rejectsBlankNameNegativeDelayNoActivityDeclineAndThrow() {
        reply { connect.logScreenLayout(obj("""{"name":" "}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS", "logScreenLayout: name is required")
        reply { connect.logScreenLayout(obj("""{"name":"Home","delayMs":-1}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS", "delayMs")
        assertNull(sdk.lastLayout)
        uiAvailable = false
        reply { connect.logScreenLayout(obj("""{"name":"Home"}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "no foreground activity")
        uiAvailable = true
        sdk.accepts = false
        reply { connect.logScreenLayout(obj("""{"name":"Home"}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "logScreenLayout returned false")
        sdk.accepts = true
        sdk.throwOnCall = IllegalStateException("boom")
        reply { connect.logScreenLayout(obj("""{"name":"Home"}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "boom")
    }

    @Test fun logLocation_asksTheSdkAtTheDefaultLevelAndRejectsNoActivityDeclineAndThrow() {
        reply { connect.logLocation(it) }
        assertEquals(listOf<Any?>(3), sdk.lastLocation)
        uiAvailable = false
        reply { connect.logLocation(it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "no foreground activity")
        uiAvailable = true
        sdk.accepts = false
        reply { connect.logLocation(it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "logLocation returned false")
        sdk.accepts = true
        sdk.throwOnCall = IllegalStateException("boom")
        reply { connect.logLocation(it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "boom")
    }

    @Test fun logLocationUpdate_passesThePositionAndTheLevel() {
        reply { connect.logLocationUpdate(obj("""{"latitude":52.5,"longitude":-13.4,"level":2}"""), it) }
        assertEquals(listOf<Any?>(52.5, -13.4, 2), sdk.lastLocation)
        reply { connect.logLocationUpdate(obj("""{"latitude":1,"longitude":2}"""), it) }
        assertEquals(listOf<Any?>(1.0, 2.0, 3), sdk.lastLocation)
    }

    @Test fun logLocationUpdate_rejectsAPositionOutOfRangeOrMissingDeclineAndThrow() {
        reply { connect.logLocationUpdate(obj("""{"latitude":91,"longitude":0}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS", "out of range")
        reply { connect.logLocationUpdate(obj("""{"latitude":0,"longitude":-181}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS", "out of range")
        reply { connect.logLocationUpdate(obj("""{"latitude":0}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS", "out of range")
        assertNull(sdk.lastLocation)
        sdk.accepts = false
        reply { connect.logLocationUpdate(obj("""{"latitude":1,"longitude":2}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "logLocationUpdate returned false")
        sdk.accepts = true
        sdk.throwOnCall = IllegalStateException("boom")
        reply { connect.logLocationUpdate(obj("""{"latitude":1,"longitude":2}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "boom")
    }

    // config items

    @Test fun setConfigItem_rendersValuesTheWayTheSdkSpellsThem() {
        reply { connect.setConfigItem(obj("""{"key":"k","value":true,"moduleName":"Tealeaf"}"""), it) }
        reply { connect.setConfigItem(obj("""{"key":"k","value":"s","moduleName":"Tealeaf"}"""), it) }
        reply { connect.setConfigItem(obj("""{"key":"k","value":5,"moduleName":"Tealeaf"}"""), it) }
        reply { connect.setConfigItem(obj("""{"key":"k","value":5.0,"moduleName":"Tealeaf"}"""), it) }
        reply { connect.setConfigItem(obj("""{"key":"k","value":2.5,"moduleName":"Tealeaf"}"""), it) }
        assertEquals(listOf("true", "s", "5", "5", "2.5"), sdk.configUpdates.map { it.second })
        assertEquals(Triple("k", "2.5", "Tealeaf"), sdk.configUpdates.last())
    }

    @Test fun setConfigItem_rejectsBadArgumentsDeclineAndThrow() {
        reply { connect.setConfigItem(obj("""{"key":"","value":1,"moduleName":"m"}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS")
        reply { connect.setConfigItem(obj("""{"key":"k","value":1,"moduleName":" "}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS")
        reply { connect.setConfigItem(obj("""{"key":"k","moduleName":"m"}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS")
        reply { connect.setConfigItem(obj("""{"key":"k","value":{"a":1},"moduleName":"m"}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS")
        sdk.accepts = false
        reply { connect.setConfigItem(obj("""{"key":"k","value":1,"moduleName":"m"}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "module \"m\"")
        sdk.accepts = true
        sdk.throwOnCall = IllegalStateException("boom")
        reply { connect.setConfigItem(obj("""{"key":"k","value":1,"moduleName":"m"}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "boom")
    }

    @Test fun getConfigItem_resolvesTheRawItemOrNothing() {
        sdk.configItem = "42"
        assertEquals("42", reply { connect.getConfigItem(obj("""{"key":"k","moduleName":"m"}"""), it) }.resolved!!.getString("value"))
        sdk.configItem = ""
        assertFalse(reply { connect.getConfigItem(obj("""{"key":"k","moduleName":"m"}"""), it) }.resolved!!.has("value"))
        sdk.configItem = null
        assertFalse(reply { connect.getConfigItem(obj("""{"key":"k","moduleName":"m"}"""), it) }.resolved!!.has("value"))
    }

    @Test fun getConfigItem_rejectsBadArgumentsAndThrow() {
        reply { connect.getConfigItem(obj("""{"key":"","moduleName":"m"}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS")
        reply { connect.getConfigItem(obj("""{"key":"k"}"""), it) }.assertRejected("ACOUSTIC_INVALID_ARGS")
        sdk.throwOnCall = IllegalStateException("boom")
        reply { connect.getConfigItem(obj("""{"key":"k","moduleName":"m"}"""), it) }.assertRejected("ACOUSTIC_INTERNAL_ERROR", "boom")
    }

    // push

    @Test fun pushRequestPermission_resolvesTheUsersAnswer() {
        sdk.permissionResult = Result.success(false)
        val r = reply { connect.pushRequestPermission(it) }
        assertFalse(r.resolved!!.getBoolean("granted"))
        assertFalse(r.resolved!!.has("error"))
    }

    @Test fun pushRequestPermission_isGrantedBeforeAndroid13WithoutAsking() {
        sdk.apiLevel = 32
        val r = reply { connect.pushRequestPermission(it) }
        assertTrue(r.resolved!!.getBoolean("granted"))
        assertEquals(emptyList<String>(), sdk.calls)
    }

    @Test fun pushRequestPermission_neverRejects() {
        uiAvailable = false
        assertEquals("no-foreground-activity", reply { connect.pushRequestPermission(it) }.resolved!!.getString("error"))
        uiAvailable = true
        sdk.permissionResult = Result.failure(IllegalStateException("denied by policy"))
        val r = reply { connect.pushRequestPermission(it) }
        assertFalse(r.resolved!!.getBoolean("granted"))
        assertEquals("denied by policy", r.resolved!!.getString("error"))
    }

    @Test fun pushGetPermissionState_isTriState() {
        sdk.permissionState = true
        assertEquals(true, reply { connect.pushGetPermissionState(it) }.resolved!!.get("value"))
        sdk.permissionState = false
        assertEquals(false, reply { connect.pushGetPermissionState(it) }.resolved!!.get("value"))
        sdk.permissionState = null
        assertEquals(JSONObject.NULL, reply { connect.pushGetPermissionState(it) }.resolved!!.get("value"))
    }

    @Test fun pushGetPermissionState_neverRejects() {
        uiAvailable = false
        assertEquals(JSONObject.NULL, reply { connect.pushGetPermissionState(it) }.resolved!!.get("value"))
        uiAvailable = true
        sdk.throwOnCall = IllegalStateException("boom")
        assertEquals(JSONObject.NULL, reply { connect.pushGetPermissionState(it) }.resolved!!.get("value"))
    }

    @Test fun pushDidReceiveAuthorization_acknowledgesAKnownAnswer() {
        assertTrue(reply { connect.pushDidReceiveAuthorization(obj("""{"granted":true,"error":null}"""), it) }.resolved!!.getBoolean("value"))
        assertTrue(reply { connect.pushDidReceiveAuthorization(obj("""{"granted":false,"error":"x"}"""), it) }.resolved!!.getBoolean("value"))
        assertFalse(reply { connect.pushDidReceiveAuthorization(obj("""{"granted":null}"""), it) }.resolved!!.getBoolean("value"))
        assertFalse(reply { connect.pushDidReceiveAuthorization(obj("{}"), it) }.resolved!!.getBoolean("value"))
    }

    @Test fun manualPushForwarders_rejectOnAndroid() {
        reply { connect.pushDidReceiveNotification(obj("""{"userInfo":{}}"""), it) }.assertRejected("ACOUSTIC_PUSH_MODE_NOT_MANUAL")
        reply { connect.pushDidReceiveResponse(obj("""{"actionIdentifier":"a","userInfo":{}}"""), it) }.assertRejected("ACOUSTIC_PUSH_MODE_NOT_MANUAL")
        reply { connect.pushDidRegisterWithToken(obj("""{"token":"0a1b"}"""), it) }.assertRejected("ACOUSTIC_PUSH_MODE_NOT_MANUAL")
        reply { connect.pushDidFailToRegister(obj("""{"error":null}"""), it) }.assertRejected("ACOUSTIC_PUSH_MODE_NOT_MANUAL")
    }
}
