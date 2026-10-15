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

import com.getcapacitor.JSObject
import com.getcapacitor.PluginCall
import org.json.JSONObject

/** How a bridge method answers; [CallReply] sends the answer to the JavaScript caller. */
interface Reply {
    fun resolve(data: JSONObject? = null)
    fun reject(code: String, message: String)
}

/** Runs a block on the main thread; false when there is no activity to run it on. */
fun interface UiRunner {
    fun run(block: () -> Unit): Boolean
}

/** The answer of a start-up call nobody is waiting for: logged, not sent. */
object LogReply : Reply {
    override fun resolve(data: JSONObject?) {
        android.util.Log.i("AcousticConnect", "auto-enable done")
    }

    override fun reject(code: String, message: String) {
        android.util.Log.w("AcousticConnect", "auto-enable failed: $code $message")
    }
}

class CallReply(private val call: PluginCall) : Reply {
    override fun resolve(data: JSONObject?) {
        if (data == null) call.resolve() else call.resolve(JSObject(data.toString()))
    }

    override fun reject(code: String, message: String) {
        call.reject(message, code)
    }
}

fun PluginCall.dataOrEmpty(): JSONObject = data ?: JSONObject()
