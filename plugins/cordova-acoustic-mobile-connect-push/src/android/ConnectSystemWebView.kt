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
import android.graphics.Bitmap
import android.util.AttributeSet
import android.util.Log
import android.webkit.WebView
import android.webkit.WebViewClient
import org.apache.cordova.engine.SystemWebView
import org.apache.cordova.engine.SystemWebViewClient
import org.apache.cordova.engine.SystemWebViewEngine

/**
 * SystemWebView that chains Analytics's TLFWebViewClient alongside Cordova's
 * SystemWebViewClient without crashing and without silently dropping the
 * Analytics bridge setup.
 *
 * **The problem with the previous approach (silently ignoring TLFWebViewClient)**
 *
 * Cordova's stock SystemWebView casts every setWebViewClient() argument to
 * SystemWebViewClient, which crashes when Analytics's Logger.a() injects
 * TLFWebViewClient (ClassCastException). The previous fix silently ignored
 * non-Cordova clients, which prevented the crash but also prevented
 * TLFWebViewClient.onPageFinished() from ever running. That method is
 * responsible for injecting the Analytics JavaScript library into the page.
 * Without it, tlBridge.setDCID() is never called, the SDK waits 5+ seconds
 * for a DCID that never arrives, and WebView JS events are not captured.
 *
 * **The fix: AnalyticsAwareClient**
 *
 * When Logger.a() passes TLFWebViewClient, we create a AnalyticsAwareClient
 * that extends SystemWebViewClient (satisfying the cast check in SystemWebView)
 * and delegates onPageStarted / onPageFinished to both:
 *   - super (SystemWebViewClient) — handles Cordova JS bridge setup
 *   - analytics (TLFWebViewClient) — injects Analytics JS, enabling DCID resolution
 *
 * If TLFWebViewClient arrives before SystemWebViewClient (rare, but possible
 * on very fast cold starts), it is queued and chained as soon as
 * SystemWebViewClient is set.
 */
class ConnectSystemWebView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : SystemWebView(context, attrs) {

    // Holds TLFWebViewClient when it arrives before the Cordova client is set.
    private var pendingAnalyticsClient: WebViewClient? = null

    override fun setWebViewClient(client: WebViewClient) {
        if (client is SystemWebViewClient) {
            val pending = pendingAnalyticsClient
            if (pending != null) {
                pendingAnalyticsClient = null
                val engine = extractEngine(client)
                if (engine != null) {
                    super.setWebViewClient(AnalyticsAwareClient(engine, pending))
                    return
                }
                // extractEngine returned null — cannot build AnalyticsAwareClient.
                // Analytics JS injection will not happen for this page load.
                Log.w(TAG, "setWebViewClient: engine not found — Analytics client dropped; Analytics JS will not be injected")
            }
            super.setWebViewClient(client)
            return
        }

        // Non-Cordova client (TLFWebViewClient from Logger.a()): we cannot pass
        // it directly to super without a ClassCastException. Chain it with the
        // currently active Cordova client instead.
        val current = webViewClient as? SystemWebViewClient
        if (current == null) {
            // Cordova client not yet set — store for chaining when it arrives.
            pendingAnalyticsClient = client
            return
        }
        val engine = extractEngine(current) ?: run {
            Log.w(TAG, "setWebViewClient: engine not found in current client, TLF client dropped")
            return
        }
        super.setWebViewClient(AnalyticsAwareClient(engine, client))
    }

    /**
     * Walks [client]'s class hierarchy to find the SystemWebViewEngine field
     * that SystemWebViewClient stores under "parentEngine" (Cordova ≥ 7) or
     * "engine" (older releases). Returns null if the field cannot be found or
     * accessed — callers must handle this gracefully.
     *
     * Reflection is used because Cordova does not expose a public API to
     * retrieve the engine from a WebViewClient reference. The field names
     * "parentEngine" / "engine" are implementation details of
     * `SystemWebViewClient` (cordova-android 7.x – 13.x); if Cordova adds a
     * public accessor in a future release this method can be replaced with
     * the direct call and the reflection path removed.
     */
    private fun extractEngine(client: WebViewClient): SystemWebViewEngine? {
        var clazz: Class<*>? = client.javaClass
        while (clazz != null && clazz != Any::class.java) {
            for (name in listOf("parentEngine", "engine")) {
                try {
                    val f = clazz.getDeclaredField(name)
                    f.isAccessible = true
                    return f.get(client) as? SystemWebViewEngine
                } catch (_: NoSuchFieldException) {
                } catch (e: Exception) {
                    Log.w(TAG, "extractEngine '$name': ${e.message}")
                }
            }
            clazz = clazz.superclass
        }
        return null
    }

    /**
     * Extends [SystemWebViewClient] so that [SystemWebView.setWebViewClient]
     * can cast it without a ClassCastException, while forwarding
     * [onPageStarted] and [onPageFinished] to [analyticsClient] so the Analytics JS
     * library is injected and the DCID is resolved.
     *
     * Only page lifecycle events are forwarded; all navigation decisions
     * (shouldOverrideUrlLoading, shouldInterceptRequest, etc.) remain with
     * the Cordova client via [super].
     */
    private inner class AnalyticsAwareClient(
        engine: SystemWebViewEngine,
        private val analyticsClient: WebViewClient
    ) : SystemWebViewClient(engine) {

        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
            super.onPageStarted(view, url, favicon)
            try {
                analyticsClient.onPageStarted(view, url, favicon)
            } catch (e: Exception) {
                Log.w(TAG, "AnalyticsAwareClient.onPageStarted: ${e.message}")
            }
        }

        override fun onPageFinished(view: WebView, url: String) {
            super.onPageFinished(view, url)
            try {
                analyticsClient.onPageFinished(view, url)
            } catch (e: Exception) {
                Log.w(TAG, "AnalyticsAwareClient.onPageFinished: ${e.message}")
            }
        }
    }

    companion object {
        private const val TAG = "ConnectSystemWebView"
    }
}