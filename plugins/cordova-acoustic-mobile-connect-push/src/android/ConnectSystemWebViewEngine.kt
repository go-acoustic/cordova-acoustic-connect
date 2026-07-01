/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * NOTICE: This file contains material that is confidential and proprietary to
 * Acoustic, L.P. and/or other developers. No license is granted under any intellectual or
 * industrial property rights of Acoustic, L.P. except as may be provided in an agreement with
 * Acoustic, L.P. Any unauthorized copying or distribution of content from this file is prohibited.
 */

package co.acoustic.connect.cordova.plugin

import android.content.Context
import android.util.Log
import org.apache.cordova.CordovaPreferences
import org.apache.cordova.engine.SystemWebViewEngine

/**
 * Cordova WebView engine that supplies [ConnectSystemWebView] to Cordova so
 * that Analytics's TLFWebViewClient injection does not crash.
 *
 * **Previous approach (reflection — now removed)**
 * The engine was constructed with `SystemWebViewEngine(Context, CordovaPreferences)`,
 * which allocates a plain `SystemWebView` internally, and then the `protected final webView`
 * field was overwritten via `getDeclaredField("webView").set(...)`. That approach
 * was fragile: it relied on the field name not changing across Cordova versions and
 * on the JVM/ART not enforcing the `final` modifier for reflective writes.
 *
 * **Current approach (clean constructor delegation)**
 * `SystemWebViewEngine` exposes a second public constructor:
 * ```java
 * public SystemWebViewEngine(SystemWebView webView, CordovaPreferences preferences)
 * ```
 * We delegate to that constructor with a `ConnectSystemWebView` instance.
 * No reflection, no double-allocation, no fragility — the type is guaranteed
 * at construction time.
 *
 * Registered as CordovaWebViewEngine in plugin.xml so Cordova loads it
 * automatically for the host app.
 */
class ConnectSystemWebViewEngine(
    context: Context,
    preferences: CordovaPreferences
) : SystemWebViewEngine(ConnectSystemWebView(context), preferences) {

    init {
        // Verify the installation actually landed. `webView` is `protected` in
        // SystemWebViewEngine so it is readable here without reflection. If the
        // parent constructor silently stored a different type (e.g. Cordova changed
        // internals), we must know immediately rather than discovering the failure
        // later when Analytics's TLFWebViewClient injection crashes the stock view.
        if (webView is ConnectSystemWebView) {
            Log.d(TAG, "ConnectSystemWebView installed successfully")
        } else {
            Log.e(TAG, "ConnectSystemWebView installation failed: " +
                    "webView is ${webView?.javaClass?.name ?: "null"} — " +
                    "Analytics TLFWebViewClient injection may crash at runtime")
        }
    }

    private companion object {
        private const val TAG = "ConnectSystemWebViewEngine"
    }
}
