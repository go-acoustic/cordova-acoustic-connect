/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * NOTICE: This file contains material that is confidential and proprietary to
 * Acoustic, L.P. and/or other developers. No license is granted under any intellectual or
 * industrial property rights of Acoustic, L.P. except as may be provided in an agreement with
 * Acoustic, L.P. Any unauthorized copying or distribution of content from this file is
 * prohibited.
 */

import Foundation

/// The `plugins.AcousticConnect` block of `capacitor.config.ts`, as the iOS side reads it. Capacitor
/// copies that block into the app on `cap sync`, so nothing has to be generated at build time.
/// A key of the wrong type is ignored with a warning, never an error: the app still starts.
///
/// Unset (nil) options leave the SDK's own default alone; only the kill switch is decided here, off
/// unless the app opts in, because the SDK ships with it on.
struct NativeConfig {
    var appKey: String?
    var postMessageUrl: String?
    /// Start the SDK when the plugin loads, when both keys above are set.
    var autoEnable = true
    var useRelease = false
    var killSwitchEnabled = false
    var killSwitchUrl: String?
    var locationLoggingEnabled: Bool?
    var screenCaptureEnabled: Bool?
    var pushMode: PushMode?
    var appGroupIdentifier: String?
    /// Push is opt-in: while it is off the SDK runs without it, whatever `pushMode` says.
    var pushEnabled = false
    /// `layoutConfig` with `layoutConfigIos` merged over it; nil when neither is set.
    var layout: [String: Any]?

    /// The layout sections the SDK reads.
    static let layoutKeys = ["AutoLayout", "AppendMapIds"]

    init() {}

    init(json: [String: Any]?, warn: (String) -> Void = { _ in }) {
        guard let json else { return }

        func string(_ key: String) -> String? {
            guard let value = json[key], !(value is NSNull) else { return nil }
            guard let text = value as? String, !(value is NSNumber) else {
                warn("AcousticConnect config: \(key) must be a string, ignoring it")
                return nil
            }
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }

        func bool(_ key: String) -> Bool? {
            guard let value = json[key], !(value is NSNull) else { return nil }
            // A JSON number reaches Swift as an NSNumber too; only a real boolean counts.
            guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else {
                warn("AcousticConnect config: \(key) must be a boolean, ignoring it")
                return nil
            }
            return number.boolValue
        }

        func layoutBlock(_ key: String) -> [String: Any]? {
            guard let value = json[key], !(value is NSNull) else { return nil }
            guard let block = value as? [String: Any] else {
                warn("AcousticConnect config: \(key) must be an object, ignoring it")
                return nil
            }
            return block.filter { entry in
                let known = NativeConfig.layoutKeys.contains(entry.key)
                if !known { warn("AcousticConnect config: \(key).\(entry.key) is not a recognised layout key (expected AutoLayout and/or AppendMapIds), ignoring it") }
                return known
            }
        }

        appKey = string("appKey")
        postMessageUrl = string("postMessageUrl")
        autoEnable = bool("autoEnable") ?? true
        useRelease = bool("useRelease") ?? false
        killSwitchEnabled = bool("killSwitchEnabled") ?? false
        killSwitchUrl = string("killSwitchUrl")
        locationLoggingEnabled = bool("locationLoggingEnabled")
        screenCaptureEnabled = bool("screenCaptureEnabled")
        appGroupIdentifier = string("iosAppGroupIdentifier")
        pushEnabled = bool("pushEnabled") ?? false
        if let raw = string("iosPushMode") {
            pushMode = PushMode(rawValue: raw).flatMap { $0 == .off ? nil : $0 }
            if pushMode == nil { warn("AcousticConnect config: iosPushMode must be 'automatic' or 'manual', ignoring it") }
        }
        let merged = NativeConfig.deepMerging(layoutBlock("layoutConfig") ?? [:], layoutBlock("layoutConfigIos") ?? [:])
        layout = merged.isEmpty ? nil : merged
    }

    /// Recursively merges `override` over `base` into a new dictionary: dictionaries present on both
    /// sides merge key by key; anything else from `override` (arrays, scalars, a dictionary where
    /// `base` has none) replaces the base value.
    static func deepMerging(_ base: [String: Any], _ override: [String: Any]) -> [String: Any] {
        var result = base
        for (key, value) in override {
            if let overrideDict = value as? [String: Any], let baseDict = base[key] as? [String: Any] {
                result[key] = deepMerging(baseDict, overrideDict)
            } else {
                result[key] = value
            }
        }
        return result
    }
}
