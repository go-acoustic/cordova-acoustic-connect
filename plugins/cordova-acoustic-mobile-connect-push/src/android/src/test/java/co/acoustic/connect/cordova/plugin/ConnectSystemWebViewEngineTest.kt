/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Unit tests for ConnectSystemWebViewEngine — verifies the constructor-delegation
 * install actually lands.
 *
 * `webView` is `protected` on the Java superclass SystemWebViewEngine, so it is
 * only visible from within a subclass (as the engine's own init block does) —
 * not from an external test class in a different package. Instead this suite
 * asserts on the class's own observable behavior: the Log.d "installed
 * successfully" / Log.e "installation failed" pair that the init block emits
 * specifically so a broken installation is caught immediately rather than
 * surfacing later as a TLFWebViewClient ClassCastException.
 */

package co.acoustic.connect.cordova.plugin

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.apache.cordova.CordovaPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class ConnectSystemWebViewEngineTest {

    private val TAG = "ConnectSystemWebViewEngine"

    @Before
    fun setUp() {
        ShadowLog.clear()
    }

    @Test
    fun constructing_logsSuccessfulInstallation() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()

        ConnectSystemWebViewEngine(ctx, CordovaPreferences())

        val success = ShadowLog.getLogs().any {
            it.tag == TAG && it.msg == "ConnectSystemWebView installed successfully"
        }
        assertTrue("expected the success log confirming ConnectSystemWebView installation", success)
    }

    @Test
    fun constructing_neverLogsAFailureMessage() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()

        ConnectSystemWebViewEngine(ctx, CordovaPreferences())

        val failure = ShadowLog.getLogs().any {
            it.tag == TAG && it.msg.orEmpty().contains("installation failed")
        }
        assertFalse("no failure log expected on a normal install", failure)
    }

    @Test
    fun eachConstructedInstance_installsIndependently() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()

        val engine1 = ConnectSystemWebViewEngine(ctx, CordovaPreferences())
        val engine2 = ConnectSystemWebViewEngine(ctx, CordovaPreferences())

        assertTrue(engine1 !== engine2)
        val successCount = ShadowLog.getLogs().count {
            it.tag == TAG && it.msg == "ConnectSystemWebView installed successfully"
        }
        assertEquals("expected exactly one success log per constructed instance", 2, successCount)
    }
}
