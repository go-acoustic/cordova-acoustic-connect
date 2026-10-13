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

import android.app.Activity
import android.app.Application
import android.content.res.Resources
import androidx.activity.ComponentActivity
import com.acoustic.connect.android.connectmod.Connect
import com.acoustic.connect.android.connectmod.push.PushApi
import com.acoustic.connect.android.connectmod.push.PushPermissionState
import com.acoustic.connect.android.connectmod.push.core.MobileServiceType
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkObject
import io.mockk.unmockkAll
import io.mockk.verify
import io.mockk.verifyOrder
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** The real bridge to the Connect SDK, with the SDK's `Connect` object and the host activity replaced. */
class ConnectSdkImplTest {

    private val resources = mockk<Resources>()
    private val application = mockk<Application>()
    private val activity = mockk<Activity>()
    private val push = mockk<PushApi>(relaxed = true)

    private fun sdk(
        fcmServiceClass: String = StubFcmService::class.java.name,
        tealeafClass: String = StubTealeaf::class.java.name,
    ) = ConnectSdkImpl({ activity }, fcmServiceClass, tealeafClass)

    @Before
    fun setUp() {
        mockkObject(Connect)
        every { Connect.push } returns push
        every { activity.resources } returns resources
        every { activity.packageName } returns "com.example.app"
        every { activity.application } returns application
        StubTealeaf.lastFlushAll = null
    }

    @After
    fun tearDown() {
        unmockkAll()
    }

    // enable

    @Test
    fun `enable puts the key and the URL into the config, then enables without arguments`() {
        every { Connect.updateConfig(any<String>(), any<String>(), any<String>()) } returns true
        every { Connect.enable() } returns Unit

        sdk().enable("key", "https://collector.example.com/post")

        verifyOrder {
            Connect.updateConfig("AppKey", "key", "Tealeaf")
            Connect.updateConfig("PostMessageUrl", "https://collector.example.com/post", "Tealeaf")
            Connect.enable()
        }
    }

    @Test
    fun `enable fails, and does not enable, when the SDK is not initialised`() {
        every { Connect.updateConfig("AppKey", any<String>(), "Tealeaf") } returns false

        val error = assertThrows(IllegalStateException::class.java) { sdk().enable("key", "https://c.example.com") }

        assertTrue(error.message!!.contains("AppKey"))
        verify(exactly = 0) { Connect.enable() }
    }

    @Test
    fun `enable fails, and does not enable, when the URL cannot be set`() {
        every { Connect.updateConfig("AppKey", any<String>(), "Tealeaf") } returns true
        every { Connect.updateConfig("PostMessageUrl", any<String>(), "Tealeaf") } returns false

        val error = assertThrows(IllegalStateException::class.java) { sdk().enable("key", "https://c.example.com") }

        assertTrue(error.message!!.contains("PostMessageUrl"))
        verify(exactly = 0) { Connect.enable() }
    }

    @Test
    fun `calls that need the host activity say there is none`() {
        val none = ConnectSdkImpl({ null })
        val error = assertThrows(IllegalStateException::class.java) { none.init() }
        assertEquals("no host activity", error.message)
        assertThrows(IllegalStateException::class.java) { none.requestNotificationPermission { } }
        assertThrows(IllegalStateException::class.java) { none.pushPermissionState() }
    }

    // the notification icon

    private fun drawable(name: String, id: Int) {
        every { resources.getIdentifier(name, "drawable", "com.example.app") } returns id
    }

    @Test
    fun `the icon is the named drawable when the app has it`() {
        drawable("ic_push", 11)
        drawable("ic_notification", 22)
        assertEquals(11, sdk().resolveIconRes("ic_push"))
    }

    @Test
    fun `the icon is ic_notification when the named drawable is missing`() {
        drawable("ic_push", 0)
        drawable("ic_notification", 22)
        assertEquals(22, sdk().resolveIconRes("ic_push"))
    }

    @Test
    fun `the icon is ic_notification when no name is given`() {
        drawable("ic_notification", 22)
        assertEquals(22, sdk().resolveIconRes(null))
        assertEquals(22, sdk().resolveIconRes(""))
    }

    @Test
    fun `there is no icon, and never the launcher icon, when neither exists`() {
        drawable("ic_push", 0)
        drawable("ic_notification", 0)
        every { resources.getIdentifier("ic_launcher", any(), any()) } returns 99

        assertEquals(0, sdk().resolveIconRes("ic_push"))
        verify(exactly = 0) { resources.getIdentifier("ic_launcher", any(), any()) }
    }

    // push

    @Test
    fun `push is available when the FCM transport is on the classpath`() {
        assertTrue(sdk().pushAvailable())
    }

    @Test
    fun `push is not available when the FCM transport is missing`() {
        assertFalse(sdk(fcmServiceClass = "com.example.NoSuchFcmService").pushAvailable())
    }

    @Test
    fun `push is enabled non-strictly with FCM, the icon and the application`() {
        sdk().pushEnable(7) { }
        verify { push.enable(application, false, 7, MobileServiceType.FCM, any()) }
    }

    @Test
    fun `the permission dialog needs a component activity`() {
        val error = assertThrows(IllegalStateException::class.java) { sdk().requestNotificationPermission { } }
        assertEquals("activity-not-component-activity", error.message)
    }

    @Test
    fun `the permission dialog is asked of the component activity and its answer comes back`() {
        val component = mockk<ComponentActivity>()
        val answers = mutableListOf<Boolean>()
        every { push.requestNotificationPermission(component, any()) } answers {
            secondArg<(Boolean) -> Unit>().invoke(true)
        }

        ConnectSdkImpl({ component }, StubFcmService::class.java.name, StubTealeaf::class.java.name)
            .requestNotificationPermission { answers.add(it) }

        assertEquals(listOf(true), answers)
    }

    @Test
    fun `the permission state is true, false or null`() {
        every { push.getPushPermissionState(activity) } returns PushPermissionState.GRANTED
        assertEquals(true, sdk().pushPermissionState())
        every { push.getPushPermissionState(activity) } returns PushPermissionState.DENIED
        assertEquals(false, sdk().pushPermissionState())
        every { push.getPushPermissionState(activity) } returns PushPermissionState.NOT_DETERMINED
        assertNull(sdk().pushPermissionState())
    }

    // flushing

    @Test
    fun `flushImmediately posts the queue through Tealeaf with a boxed false`() {
        sdk().flushImmediately()
        assertEquals(java.lang.Boolean.FALSE, StubTealeaf.lastFlushAll)
        verify(exactly = 0) { Connect.flushQueues() }
    }

    @Test
    fun `flushImmediately falls back to flushQueues when Tealeaf cannot be reached`() {
        every { Connect.flushQueues() } returns true
        sdk(tealeafClass = "com.example.NoSuchTealeaf").flushImmediately()
        verify(exactly = 1) { Connect.flushQueues() }
    }

    // the maps the SDK takes

    @Test
    fun `custom event values are handed over as a copy with the same entries`() {
        val sent = mutableListOf<Map<String?, String?>>()
        every { Connect.logCustomEvent(any<String>(), any<HashMap<String?, String?>>(), any<Int>()) } answers {
            sent.add(secondArg<HashMap<String?, String?>>())
            true
        }
        val values = mapOf("a" to "1", "b" to "2")

        assertTrue(sdk().logCustomEvent("event", values, 2))

        assertEquals(values, sent.single())
    }
}
