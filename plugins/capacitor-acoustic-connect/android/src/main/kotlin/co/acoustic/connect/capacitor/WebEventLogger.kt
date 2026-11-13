/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * NOTICE: This file contains material that is confidential and proprietary to
 * Acoustic, L.P. and/or other developers. No license is granted under any intellectual or
 * industrial property rights of Acoustic, L.P. except as may be provided in an agreement with
 * Acoustic, L.P. Any unauthorized copying or distribution of content from this file is prohibited.
 */

package co.acoustic.connect.capacitor

import android.graphics.PointF
import android.graphics.RectF
import android.util.Log
import android.view.View
import com.acoustic.connect.android.connectmod.Connect
import org.json.JSONArray
import org.json.JSONObject
import java.lang.reflect.Constructor
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Method

/**
 * Logs a tap or gesture the page script (src/web-gestures.ts) saw on a page element, through the
 * SDK's plugin-only functions Connect.logWebClick and Connect.logWebGesture. They are found at run
 * time: an SDK older than 11.1.39-beta has none, and then nothing is logged.
 */
internal object WebEventLogger {
    private const val TAG = "AcousticConnect"
    private const val TARGET_CLASS = "com.acoustic.connect.android.connectmod.model.ConnectWebTarget"
    private const val CLICK = "click"

    private class Api(val click: Method, val gesture: Method, val target: Constructor<*>)

    private val api: Api? by lazy { find() }

    private fun find(): Api? = try {
        val target = Class.forName(TARGET_CLASS)
        val connect = Connect::class.java
        val double = Double::class.javaPrimitiveType
        val long = Long::class.javaPrimitiveType
        Api(
            click = connect.getMethod("logWebClick", View::class.java, double, target, PointF::class.java, long),
            gesture = connect.getMethod(
                "logWebGesture", View::class.java, double, String::class.java, target, List::class.java,
                String::class.java, PointF::class.java, long
            ),
            target = target.getConstructor(
                String::class.java, Boolean::class.javaPrimitiveType, String::class.java, String::class.java,
                RectF::class.java
            )
        )
    } catch (e: ReflectiveOperationException) {
        Log.i(TAG, "Connect SDK ${Connect.getLibraryVersion()} cannot log taps and gestures in the page: $e")
        null
    }

    /**
     * Logs [event] as the page script sent it. Call on the main thread.
     *
     * @return Whether the SDK queued it: false while the SDK is not enabled, when it does not
     * capture the screen, and when it has no web capture.
     */
    fun log(webView: View, event: JSONObject): Boolean {
        val found = api ?: return false
        if (!Connect.isEnabled()) return false
        val kind = event.optString("kind")
        return try {
            val target = event.optJSONObject("target")?.let { target(found, it) } ?: return false
            val touches = touches(event.optJSONArray("touches")) ?: return false
            val viewportWidth = event.optDouble("viewportWidth", 0.0)
            val touchedAt = event.optLong("touchedAt", System.currentTimeMillis())
            val queued = if (kind == CLICK) {
                found.click.invoke(Connect, webView, viewportWidth, target, touches[0][0], touchedAt)
            } else {
                val direction = event.optString("direction").ifEmpty { null }
                found.gesture.invoke(
                    Connect, webView, viewportWidth, kind, target, touches, direction,
                    point(event.optJSONObject("velocity")), touchedAt
                )
            }
            queued == true
        } catch (e: InvocationTargetException) {
            Log.w(TAG, "logWebEvent: the SDK failed to log a $kind", e.targetException)
            false
        } catch (e: ReflectiveOperationException) {
            Log.w(TAG, "logWebEvent: cannot call the SDK to log a $kind", e)
            false
        } catch (e: IllegalArgumentException) {
            Log.w(TAG, "logWebEvent: the SDK does not take a $kind as the plugin sends it", e)
            false
        }
    }

    private fun target(found: Api, json: JSONObject): Any? {
        val bounds = json.optJSONObject("bounds") ?: return null
        val x = bounds.optDouble("x").toFloat()
        val y = bounds.optDouble("y").toFloat()
        val box = RectF(x, y, x + bounds.optDouble("width").toFloat(), y + bounds.optDouble("height").toFloat())
        return found.target.newInstance(
            json.optString("id"), json.optBoolean("isDomId"), json.optString("type"), json.optString("tlType"), box
        )
    }

    /** Each finger's points, or null when there is no point at all. */
    private fun touches(json: JSONArray?): List<List<PointF>>? {
        if (json == null) return null
        val fingers = (0 until json.length()).map { finger ->
            val points = json.optJSONArray(finger) ?: JSONArray()
            (0 until points.length()).mapNotNull { point(points.optJSONObject(it)) }
        }
        return fingers.takeIf { it.isNotEmpty() && it.all { points -> points.isNotEmpty() } }
    }

    private fun point(json: JSONObject?): PointF? =
        json?.let { PointF(it.optDouble("x").toFloat(), it.optDouble("y").toFloat()) }
}
