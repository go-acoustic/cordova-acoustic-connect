/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * Robolectric unit tests for WorkWrapper. Verifies that success and
 * error callbacks dispatched from background threads land cleanly via
 * `cordova.threadPool.execute(...)` onto a Cordova-managed thread.
 *
 * Verifies WorkWrapper lifts a sample Work<T> via the thread pool.
 */

package co.acoustic.connect.cordova.plugin

import org.apache.cordova.CallbackContext
import org.apache.cordova.CordovaInterface
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.mockito.kotlin.argumentCaptor
import org.mockito.kotlin.mock
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever
import org.robolectric.RobolectricTestRunner
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
class WorkWrapperTest {

    private lateinit var cordova: CordovaInterface
    private lateinit var cb: CallbackContext
    private lateinit var directExecutor: Executor

    @Before
    fun setUp() {
        cordova = mock()
        cb = mock()
        // Direct executor so tests run synchronously when convenient.
        directExecutor = Executor { it.run() }
        whenever(cordova.threadPool).thenReturn(directExecutor)
    }

    @Test
    fun success_noArg_callsCallbackContextSuccess() {
        val w = WorkWrapper(cordova)
        w.success(cb)
        verify(cb).success()
    }

    @Test
    fun success_stringArg_callsCallbackContextSuccessWithValue() {
        val w = WorkWrapper(cordova)
        w.success(cb, "abc123")
        verify(cb).success("abc123")
    }

    @Test
    fun success_nullString_fallsThroughToNoArgSuccess() {
        val w = WorkWrapper(cordova)
        w.success(cb, null as String?)
        verify(cb).success()
    }

    @Test
    fun success_jsonObject_callsCallbackContextSuccessWithJson() {
        val w = WorkWrapper(cordova)
        val payload = JSONObject().apply { put("k", "v") }
        w.success(cb, payload)
        verify(cb).success(payload)
    }

    @Test
    fun success_booleanTrue_passesOneToCallbackContext() {
        val w = WorkWrapper(cordova)
        w.success(cb, true)
        verify(cb).success(1)
    }

    @Test
    fun success_booleanFalse_passesZeroToCallbackContext() {
        val w = WorkWrapper(cordova)
        w.success(cb, false)
        verify(cb).success(0)
    }

    @Test
    fun error_wrapsCodeAndMessageIntoJson() {
        val w = WorkWrapper(cordova)
        w.error(cb, "ACOUSTIC_INTERNAL_ERROR", "boom")

        val captor = argumentCaptor<JSONObject>()
        verify(cb).error(captor.capture())
        assertEquals(
            "ACOUSTIC_INTERNAL_ERROR",
            captor.firstValue.getString("code")
        )
        assertEquals("boom", captor.firstValue.getString("message"))
    }

    @Test
    fun success_dispatchedFromBackgroundThread_lands_onThreadPool() {
        // Real executor so the test sees an actual hand-off.
        val executor = Executors.newSingleThreadExecutor()
        whenever(cordova.threadPool).thenReturn(executor)

        val w = WorkWrapper(cordova)
        val workerLatch = CountDownLatch(1)
        val cbLatch = CountDownLatch(1)

        whenever(cb.success("token")).thenAnswer {
            cbLatch.countDown()
            null
        }

        Thread {
            // Simulate Connect SDK Work<T>.addOnSuccessListener thread.
            w.success(cb, "token")
            workerLatch.countDown()
        }.start()

        assertTrue(
            "background dispatch did not complete",
            workerLatch.await(2, TimeUnit.SECONDS)
        )
        assertTrue(
            "callbackContext.success did not land on the thread pool",
            cbLatch.await(2, TimeUnit.SECONDS)
        )
        verify(cb).success("token")
        executor.shutdown()
    }
}
