package co.acoustic.connect.capacitor

import java.net.CookieHandler
import java.net.CookieManager
import java.net.CookiePolicy
import java.net.CookieStore
import java.net.URI
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/** Capacitor's cookie manager: works through get/put, refuses to hand out its store. */
private class NoStoreCookieManager : CookieManager(null, CookiePolicy.ACCEPT_ALL) {
    val puts = mutableListOf<Map<String, List<String>>>()
    var cookieHeader = "a=b"

    override fun get(uri: URI, requestHeaders: Map<String, List<String>>): Map<String, List<String>> =
        mapOf("Cookie" to listOf(cookieHeader))

    override fun put(uri: URI, responseHeaders: Map<String, List<String>>) {
        puts += responseHeaders
    }

    override fun getCookieStore(): CookieStore = throw UnsupportedOperationException()
}

class CookieHandlerCompatTest {
    private var original: CookieHandler? = null

    @Before fun saveDefault() {
        original = CookieHandler.getDefault()
    }

    @After fun restoreDefault() {
        CookieHandler.setDefault(original)
    }

    @Test fun install_wrapsAHandlerThatRefusesToExposeItsStore() {
        val capacitor = NoStoreCookieManager()
        CookieHandler.setDefault(capacitor)
        CookieHandlerCompat.install()
        val installed = CookieHandler.getDefault() as CookieManager
        assertNotSame(capacitor, installed)
        assertNotNull(installed.cookieStore)
    }

    @Test fun install_keepsReadingAndWritingThroughTheOriginalHandler() {
        val capacitor = NoStoreCookieManager()
        CookieHandler.setDefault(capacitor)
        CookieHandlerCompat.install()
        val uri = URI("http://10.0.2.2:9877/collector")
        assertEquals(mapOf("Cookie" to listOf("a=b")), CookieHandler.getDefault().get(uri, emptyMap()))
        CookieHandler.getDefault().put(uri, mapOf("Set-Cookie" to listOf("x=y")))
        assertEquals(listOf(mapOf("Set-Cookie" to listOf("x=y"))), capacitor.puts)
    }

    @Test fun install_leavesAHandlerThatExposesItsStoreAlone() {
        val plain = CookieManager()
        CookieHandler.setDefault(plain)
        CookieHandlerCompat.install()
        assertSame(plain, CookieHandler.getDefault())
    }

    @Test fun install_doesNothingWithoutADefaultHandler() {
        CookieHandler.setDefault(null)
        CookieHandlerCompat.install()
        assertEquals(null, CookieHandler.getDefault())
    }

    @Test fun install_isIdempotent() {
        CookieHandler.setDefault(NoStoreCookieManager())
        CookieHandlerCompat.install()
        val first = CookieHandler.getDefault()
        CookieHandlerCompat.install()
        assertSame(first, CookieHandler.getDefault())
        assertTrue(first is CookieManager)
    }
}
