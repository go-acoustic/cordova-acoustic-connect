package co.acoustic.connect.capacitor

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.junit.Test
import org.mockito.kotlin.any
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
