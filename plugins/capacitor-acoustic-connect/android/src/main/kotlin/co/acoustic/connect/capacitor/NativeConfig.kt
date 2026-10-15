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

import org.json.JSONObject

/**
 * The `plugins.AcousticConnect` block of `capacitor.config.ts`, as the Android side reads it. Capacitor
 * copies that block into the app's assets on `cap sync`, so nothing has to be generated at build time.
 * A key of the wrong type is ignored with a warning, never an error: the app still starts.
 *
 * Unset (null) options leave the SDK's own default alone; only the kill switch is decided here, off
 * unless the app opts in, because the SDK ships with it on.
 */
data class NativeConfig(
    val appKey: String? = null,
    val postMessageUrl: String? = null,
    /** Start the SDK when the plugin loads, before the first screen, when both keys above are set. */
    val autoEnable: Boolean = true,
    val useRelease: Boolean = false,
    val killSwitchEnabled: Boolean = false,
    val killSwitchUrl: String? = null,
    val locationLoggingEnabled: Boolean? = null,
    val screenCaptureEnabled: Boolean? = null,
    val notificationIconResName: String? = null,
    /** Push is opt-in. It also decides which Connect artifact the Android build uses (see android/build.gradle). */
    val pushEnabled: Boolean = false,
) {
    companion object {
        fun from(json: JSONObject?, warn: (String) -> Unit = {}): NativeConfig {
            if (json == null) return NativeConfig()

            fun string(key: String): String? {
                if (!json.has(key) || json.isNull(key)) return null
                val value = json.opt(key)
                if (value !is String) {
                    warn("AcousticConnect config: $key must be a string, ignoring it")
                    return null
                }
                return value.trim().ifEmpty { null }
            }

            fun bool(key: String): Boolean? {
                if (!json.has(key) || json.isNull(key)) return null
                val value = json.opt(key)
                if (value !is Boolean) {
                    warn("AcousticConnect config: $key must be a boolean, ignoring it")
                    return null
                }
                return value
            }

            return NativeConfig(
                appKey = string("appKey"),
                postMessageUrl = string("postMessageUrl"),
                autoEnable = bool("autoEnable") ?: true,
                useRelease = bool("useRelease") ?: false,
                killSwitchEnabled = bool("killSwitchEnabled") ?: false,
                killSwitchUrl = string("killSwitchUrl"),
                locationLoggingEnabled = bool("locationLoggingEnabled"),
                screenCaptureEnabled = bool("screenCaptureEnabled"),
                notificationIconResName = string("androidNotificationIconResName"),
                pushEnabled = bool("pushEnabled") ?: false,
            )
        }
    }
}
