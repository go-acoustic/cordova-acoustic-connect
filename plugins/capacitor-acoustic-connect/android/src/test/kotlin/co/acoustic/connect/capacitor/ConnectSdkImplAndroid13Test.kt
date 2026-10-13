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

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Notifications are granted at install time before Android 13 and asked for from then on. */
@RunWith(RobolectricTestRunner::class)
class ConnectSdkImplAndroid13Test {

    @Test
    @Config(sdk = [32])
    fun `Android 12 grants notifications at install time`() {
        assertFalse(ConnectSdkImpl({ null }).notificationPermissionNeeded())
    }

    @Test
    @Config(sdk = [33])
    fun `Android 13 asks`() {
        assertTrue(ConnectSdkImpl({ null }).notificationPermissionNeeded())
    }

    @Test
    @Config(sdk = [34])
    fun `Android 14 asks`() {
        assertTrue(ConnectSdkImpl({ null }).notificationPermissionNeeded())
    }
}
