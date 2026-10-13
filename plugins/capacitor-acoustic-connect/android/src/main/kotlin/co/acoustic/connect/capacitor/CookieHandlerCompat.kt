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

import java.net.CookieHandler
import java.net.CookieManager
import java.net.URI

/**
 * Capacitor installs its own `CapacitorCookieManager` as the process-wide default `CookieHandler`,
 * whether or not the app uses its cookie feature, and that class throws
 * `UnsupportedOperationException` from `getCookieStore()`. The Connect SDK's HTTP client asks the
 * default handler for its store when it posts, so with Capacitor's handler in place every post fails
 * and no event ever leaves the device.
 *
 * [install] puts a handler in front that passes `get` and `put` to the original, so Capacitor's cookie
 * sync keeps working, and answers `getCookieStore()` with a store of its own.
 */
internal object CookieHandlerCompat {

    fun install() {
        val current = CookieHandler.getDefault() ?: return
        if (current is StoreExposingCookieHandler || exposesStore(current)) return
        CookieHandler.setDefault(StoreExposingCookieHandler(current))
    }

    private fun exposesStore(handler: CookieHandler): Boolean {
        if (handler !is CookieManager) return false
        return try {
            handler.cookieStore
            true
        } catch (_: UnsupportedOperationException) {
            false
        }
    }

    private class StoreExposingCookieHandler(private val delegate: CookieHandler) : CookieManager() {
        override fun get(uri: URI, requestHeaders: Map<String, List<String>>): Map<String, List<String>> =
            delegate.get(uri, requestHeaders)

        override fun put(uri: URI, responseHeaders: Map<String, List<String>>) = delegate.put(uri, responseHeaders)
    }
}
