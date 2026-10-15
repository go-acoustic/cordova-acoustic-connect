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
import org.junit.Assert.assertEquals
import org.junit.Test

class TlBridgeShimTest {
    @Test
    fun exposesEveryMethodTheSdkScriptsCall() {
        val exposed = TlBridgeShim::class.java.declaredMethods
            .filter { it.isAnnotationPresent(JavascriptInterface::class.java) }
            .map { it.name }
            .toSet()
        assertEquals(setOf("setDCID", "setTLTInitialized", "addMessage", "screenCapture"), exposed)
    }
}
