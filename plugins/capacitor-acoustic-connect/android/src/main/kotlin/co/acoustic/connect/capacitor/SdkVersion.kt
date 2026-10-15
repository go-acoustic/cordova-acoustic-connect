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

/** Just enough of a version number to tell whether the SDK is older than a given release. */
internal object SdkVersion {
    private val pattern = Regex("""^(\d+)\.(\d+)\.(\d+)""")

    /** The three numbers of `11.0.21-beta`, or null when the text does not start with them. */
    fun parse(text: String): Triple<Int, Int, Int>? {
        val m = pattern.find(text.trim()) ?: return null
        val (major, minor, patch) = m.destructured
        return Triple(major.toInt(), minor.toInt(), patch.toInt())
    }

    /** True only when both versions read and [version] is the lower; a version that does not read is never old. */
    fun isOlderThan(version: String, release: String): Boolean {
        val v = parse(version) ?: return false
        val r = parse(release) ?: return false
        return compareValuesBy(v, r, { it.first }, { it.second }, { it.third }) < 0
    }
}
