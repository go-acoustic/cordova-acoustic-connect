package co.acoustic.connect.capacitor

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginConfig
import java.net.CookieHandler
import java.net.CookieManager
import java.net.CookiePolicy
import java.net.CookieStore
import org.json.JSONObject
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.doReturn
import org.mockito.kotlin.spy
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever
import org.mockito.kotlin.argumentCaptor
import org.junit.Assert.assertEquals

class AcousticConnectPluginTest {
    @Test fun callReply_resolvesTheCallWithNoDataOrAnObject() {
        val call = mock<PluginCall>()
        val reply = CallReply(call)
        reply.resolve(null)
        verify(call).resolve()
        reply.resolve(org.json.JSONObject("""{"value":true}"""))
        val captor = argumentCaptor<JSObject>()
        verify(call).resolve(captor.capture())
        assertEquals(true, captor.firstValue.getBoolean("value"))
    }

    @Test fun load_replacesCapacitorsCookieHandlerWithoutAnEnableCall() {
        // A push can start the SDK before the bridge loads and the app then never calls enable() (autoEnable off):
        // Capacitor's handler, which refuses to expose its store, has to be replaced by load() alone.
        val original = CookieHandler.getDefault()
        try {
            CookieHandler.setDefault(object : CookieManager(null, CookiePolicy.ACCEPT_ALL) {
                override fun getCookieStore(): CookieStore = throw UnsupportedOperationException()
            })
            val config = mock<PluginConfig> { on { configJSON } doReturn JSONObject() }
            val plugin = spy(AcousticConnectPlugin()) { doReturn(config).whenever(it).config }
            plugin.load()
            assertNotNull((CookieHandler.getDefault() as CookieManager).cookieStore)
        } finally {
            CookieHandler.setDefault(original)
        }
    }

    @Test fun callReply_rejectsWithMessageAndCode() {
        val call = mock<PluginCall>()
        CallReply(call).reject("ACOUSTIC_INVALID_ARGS", "bad")
        verify(call).reject("bad", "ACOUSTIC_INVALID_ARGS")
    }

    @Test fun callData_isTheCallsDataOrEmpty() {
        val call = mock<PluginCall>()
        whenever(call.data).thenReturn(JSObject("""{"a":1}"""))
        assertEquals(1, call.dataOrEmpty().getInt("a"))
        val empty = mock<PluginCall>()
        whenever(empty.data).thenReturn(null)
        assertEquals(0, empty.dataOrEmpty().length())
    }
}
