/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Unit tests for ConnectSystemWebView — covers the four scenarios
 * identified in the code review:
 *
 *  1. SystemWebViewClient (Cordova) path — client set directly, no chaining.
 *  2. Non-SystemWebViewClient (Analytics) path — AnalyticsAwareClient installed.
 *  3. Ordering: Analytics arrives before Cordova — queued and chained on arrival.
 *  4. extractEngine reflection failure — graceful degradation, no crash.
 *
 * Plus supplementary cases: hierarchy walking, field-alias ("engine"),
 * AnalyticsAwareClient delegation, and exception-safety of the Analytics delegate.
 */

package co.acoustic.connect.cordova.plugin

import android.content.Context
import android.graphics.Bitmap
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.test.core.app.ApplicationProvider
import org.apache.cordova.engine.SystemWebViewClient
import org.apache.cordova.engine.SystemWebViewEngine
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.kotlin.any
import org.mockito.kotlin.mock
import org.mockito.kotlin.never
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.lang.reflect.Method

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class ConnectSystemWebViewTest {

    private lateinit var webView: ConnectSystemWebView

    @Before
    fun setUp() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        webView = ConnectSystemWebView(ctx)
    }

    // ── Scenario 1: SystemWebViewClient path ──────────────────────────────

    @Test
    fun setWebViewClient_systemWebViewClient_noPending_setsClientDirectly() {
        val cordovaClient = createCordovaClient(mock())

        webView.setWebViewClient(cordovaClient)

        // No Analytics involved — the Cordova client itself must be active.
        assertSame(cordovaClient, webView.webViewClient)
        assertNull(pendingAnalyticsClient())
    }

    // ── Scenario 2: Non-SystemWebViewClient (Analytics) path ────────────────

    @Test
    fun setWebViewClient_analyticsAfterCordova_installsAnalyticsAwareClient() {
        val cordovaClient = createCordovaClient(mock())
        val analyticsClient = mock<WebViewClient>()

        webView.setWebViewClient(cordovaClient)
        webView.setWebViewClient(analyticsClient)

        val active = webView.webViewClient
        // AnalyticsAwareClient extends SystemWebViewClient but is not cordovaClient.
        assertTrue("active client must be a SystemWebViewClient subtype",
            active is SystemWebViewClient)
        assertNotSame("active client must be AnalyticsAwareClient, not the raw Cordova client",
            cordovaClient, active)
    }

    // ── Scenario 3: Analytics arrives before Cordova ────────────────────────

    @Test
    fun setWebViewClient_analyticsBeforeCordova_storedAsPending() {
        val analyticsClient = mock<WebViewClient>()

        webView.setWebViewClient(analyticsClient)

        assertSame(analyticsClient, pendingAnalyticsClient())
    }

    @Test
    fun setWebViewClient_cordovaArrivesAfterAnalytics_clearsPendingAndChains() {
        val analyticsClient = mock<WebViewClient>()
        val cordovaClient = createCordovaClient(mock())

        webView.setWebViewClient(analyticsClient)   // queued
        assertNotNull(pendingAnalyticsClient())

        webView.setWebViewClient(cordovaClient)   // chains + clears queue

        assertNull("pending must be cleared after Cordova client arrives",
            pendingAnalyticsClient())
        val active = webView.webViewClient
        assertTrue(active is SystemWebViewClient)
        assertNotSame("AnalyticsAwareClient must be installed, not raw Cordova client",
            cordovaClient, active)
    }

    // ── Scenario 4: extractEngine reflection failure ──────────────────────

    @Test
    fun setWebViewClient_analyticsAfterCordova_nullEngine_dropsanAlyticsGracefully() {
        // Cordova client whose parentEngine field holds null →
        // extractEngine finds the field but returns null → analytics is dropped.
        val cordovaClientNullEngine = NullEngineCordovaClient()
        val analyticsClient = mock<WebViewClient>()

        webView.setWebViewClient(cordovaClientNullEngine)
        // Must not throw; active client must remain unchanged.
        webView.setWebViewClient(analyticsClient)

        assertSame(
            "active client must be unchanged when engine extraction fails",
            cordovaClientNullEngine,
            webView.webViewClient
        )
    }

    @Test
    fun setWebViewClient_cordovaArrivesWithNullEngine_noPendingChaining_setsDirectly() {
        val analyticsClient = mock<WebViewClient>()
        val cordovaClientNullEngine = NullEngineCordovaClient()

        webView.setWebViewClient(analyticsClient)          // queued
        webView.setWebViewClient(cordovaClientNullEngine) // engine null → can't chain → direct set

        // Pending is cleared even if chaining failed; Cordova client is active.
        assertNull(pendingAnalyticsClient())
        assertSame(cordovaClientNullEngine, webView.webViewClient)
    }

    // ── extractEngine unit tests ──────────────────────────────────────────

    @Test
    fun extractEngine_findsParentEngineField_returnsEngine() {
        val engine = mock<SystemWebViewEngine>()
        val client = object : WebViewClient() {
            @Suppress("unused")
            private val parentEngine: SystemWebViewEngine = engine
        }
        assertSame(engine, invokeExtractEngine(client))
    }

    @Test
    fun extractEngine_findsEngineFieldAlias_returnsEngine() {
        val engine = mock<SystemWebViewEngine>()
        val client = object : WebViewClient() {
            @Suppress("unused")
            private val engine: SystemWebViewEngine = engine
        }
        assertSame(engine, invokeExtractEngine(client))
    }

    @Test
    fun extractEngine_fieldInSuperclass_walksHierarchyAndFinds() {
        val engine = mock<SystemWebViewEngine>()
        // Engine field lives in a base class, not the leaf class.
        open class BaseClient : WebViewClient() {
            @Suppress("unused")
            private val parentEngine: SystemWebViewEngine = engine
        }
        val client = object : BaseClient() {}
        assertSame(engine, invokeExtractEngine(client))
    }

    @Test
    fun extractEngine_noMatchingField_returnsNull() {
        // Plain WebViewClient has no parentEngine / engine field.
        val client = mock<WebViewClient>()
        assertNull(invokeExtractEngine(client))
    }

    // ── AnalyticsAwareClient delegation ─────────────────────────────────────

    @Test
    fun analyticsAwareClient_onPageFinished_forwardsToAnalyticsDelegate() {
        val cordovaClient = createCordovaClient(mock())
        val analyticsClient = mock<WebViewClient>()
        val view = mock<WebView>()

        webView.setWebViewClient(cordovaClient)
        webView.setWebViewClient(analyticsClient)

        webView.webViewClient.onPageFinished(view, "https://example.com")

        verify(analyticsClient).onPageFinished(view, "https://example.com")
    }

    @Test
    fun analyticsAwareClient_onPageStarted_forwardsToAnalyticsDelegate() {
        val cordovaClient = createCordovaClient(mock())
        val analyticsClient = mock<WebViewClient>()
        val view = mock<WebView>()

        webView.setWebViewClient(cordovaClient)
        webView.setWebViewClient(analyticsClient)

        webView.webViewClient.onPageStarted(view, "https://example.com", null)

        verify(analyticsClient).onPageStarted(view, "https://example.com", null)
    }

    @Test
    fun analyticsAwareClient_onPageFinished_analyticsThrows_doesNotCrash() {
        val cordovaClient = createCordovaClient(mock())
        val analyticsClient = mock<WebViewClient>()
        whenever(analyticsClient.onPageFinished(any(), any()))
            .thenThrow(RuntimeException("Analytics exploded"))

        webView.setWebViewClient(cordovaClient)
        webView.setWebViewClient(analyticsClient)

        // Must not propagate the exception.
        webView.webViewClient.onPageFinished(mock(), "https://example.com")
    }

    @Test
    fun analyticsAwareClientonPageStarted_analyticsThrows_doesNotCrash() {
        val cordovaClient = createCordovaClient(mock())
        val analyticsClient = mock<WebViewClient>()
        whenever(analyticsClient.onPageStarted(any(), any(), any()))
            .thenThrow(RuntimeException("Analytics exploded"))

        webView.setWebViewClient(cordovaClient)
        webView.setWebViewClient(analyticsClient)

        webView.webViewClient.onPageStarted(mock(), "https://example.com", null)
    }

    @Test
    fun analyticsAwareClient_onPageFinished_cordovaClientReplaced_analyticsNotCalledByOldClient() {
        // Verifies that replacing the client stops old analytics from receiving events.
        val cordovaClient = createCordovaClient(mock())
        val analyticsClientOld = mock<WebViewClient>()
        val cordovaClient2 = createCordovaClient(mock())

        webView.setWebViewClient(cordovaClient)
        webView.setWebViewClient(analyticsClientOld)  // AnalyticsAwareClient with old analytics
        webView.setWebViewClient(cordovaClient2)    // plain Cordova client replaces it

        webView.webViewClient.onPageFinished(mock(), "url")

        verify(analyticsClientOld, never()).onPageFinished(any(), any())
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    /**
     * Creates a [SystemWebViewClient] stub with [engine] and no-op lifecycle
     * methods, avoiding Cordova internals that NPE when the engine is a mock.
     */
    private fun createCordovaClient(engine: SystemWebViewEngine): SystemWebViewClient =
        object : SystemWebViewClient(engine) {
            override fun onPageFinished(view: WebView, url: String) {}
            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {}
        }

    /**
     * A [SystemWebViewClient] whose inherited [parentEngine] field is null.
     * [extractEngine] will find the field but return null, simulating
     * reflection-based engine extraction failure.
     */
    private inner class NullEngineCordovaClient : SystemWebViewClient(null) {
        override fun onPageFinished(view: WebView, url: String) {}
        override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {}
    }

    /** Reflective accessor for the private [pendingAnalyticsClient] field. */
    private fun pendingAnalyticsClient(): WebViewClient? {
        val f = ConnectSystemWebView::class.java.getDeclaredField("pendingAnalyticsClient")
        f.isAccessible = true
        return f.get(webView) as? WebViewClient
    }

    /** Reflective invoker for the private [extractEngine] method. */
    private fun invokeExtractEngine(client: WebViewClient): SystemWebViewEngine? {
        val m: Method = ConnectSystemWebView::class.java
            .getDeclaredMethod("extractEngine", WebViewClient::class.java)
        m.isAccessible = true
        return m.invoke(webView, client) as? SystemWebViewEngine
    }
}
