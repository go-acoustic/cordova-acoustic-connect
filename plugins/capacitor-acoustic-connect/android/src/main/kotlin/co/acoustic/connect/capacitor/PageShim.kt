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

import android.webkit.JavascriptInterface

/**
 * What the Connect SDK expects to find in a WebView page: the Tealeaf script (`TLT`) and its bridge (`tlBridge`).
 * The plugin keeps the SDK's own page injection out (`GoogleWebViewEnabled=false`), so neither exists, and the SDK's
 * DOM capture script, run at every screen transition, then logs `TLT is undefined!` and calls `tlBridge.setDCID(...)`
 * regardless, which throws a ReferenceError that apps with a global error handler (Angular) show as `Script error.`
 *
 * `tlBridge` is given to the page here, before any page script runs; the inert `TLT` is defined by the plugin's
 * JavaScript (src/tlt-stub.ts). Both do nothing, so the capture and the events are unchanged.
 */
internal class TlBridgeShim {
    @JavascriptInterface fun setDCID(webViewId: String?, dcid: String?, scriptId: String?) = Unit
    @JavascriptInterface fun setTLTInitialized(webViewId: String?, initialized: String?) = Unit
    @JavascriptInterface fun addMessage(message: String?) = Unit
    @JavascriptInterface fun screenCapture() = Unit

    companion object {
        const val NAME = "tlBridge"
    }
}
