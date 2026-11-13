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
import UIKit
import Cordova
#if CONNECT_WEB_CAPTURE
@_spi(ConnectPlugins) import Connect
#endif

extension ConnectPlugin {

    /// Logs a tap or gesture the page script (www/WebGestures.js) saw on a page element, and
    /// resolves whether the SDK queued it. The SDK's functions for it are in 2.2.35 and later: the
    /// after_prepare hook compiles this file with CONNECT_WEB_CAPTURE only when the app's pod asks
    /// for such a version, and without it nothing is logged.
    @objc(logWebEvent:)
    func logWebEvent(command: CDVInvokedUrlCommand) {
        let queued = (command.argument(at: 0) as? [String: Any]).map { logWebEvent($0) } ?? false
        commandDelegate.send(CDVPluginResult(status: .ok, messageAs: queued), callbackId: command.callbackId)
    }

    #if CONNECT_WEB_CAPTURE
    private func logWebEvent(_ event: [String: Any]) -> Bool {
        guard let webView, let target = (event["target"] as? [String: Any]).flatMap(webTarget),
              let touches = webTouches(event["touches"]) else {
            return false
        }
        let kind = event["kind"] as? String ?? ""
        let viewportWidth = webNumber(event["viewportWidth"]) ?? 0
        let touchedAt = webNumber(event["touchedAt"]).map { Date(timeIntervalSince1970: $0 / 1_000) } ?? Date()
        if kind == "click" {
            return ConnectSDK.shared.logWebClick(in: webView, viewportWidth: viewportWidth, target: target,
                                                 at: touches[0][0], touchedAt: touchedAt)
        }
        return ConnectSDK.shared.logWebGesture(in: webView, viewportWidth: viewportWidth, tlEvent: kind, target: target,
                                               touches: touches, direction: event["direction"] as? String,
                                               velocity: webPoint(event["velocity"]), touchedAt: touchedAt)
    }

    private func webTarget(_ json: [String: Any]) -> ConnectWebTarget? {
        guard let bounds = json["bounds"] as? [String: Any] else { return nil }
        let box = CGRect(x: webNumber(bounds["x"]) ?? .nan, y: webNumber(bounds["y"]) ?? .nan,
                         width: webNumber(bounds["width"]) ?? .nan, height: webNumber(bounds["height"]) ?? .nan)
        return ConnectWebTarget(id: json["id"] as? String ?? "", isDomId: json["isDomId"] as? Bool ?? false,
                                type: json["type"] as? String ?? "", tlType: json["tlType"] as? String ?? "",
                                bounds: box)
    }

    /// Each finger's points, or nil when there is no point at all.
    private func webTouches(_ json: Any?) -> [[CGPoint]]? {
        guard let fingers = json as? [Any] else { return nil }
        let touches = fingers.map { ($0 as? [Any] ?? []).compactMap(webPoint) }
        return touches.isEmpty || touches.contains(where: \.isEmpty) ? nil : touches
    }

    private func webPoint(_ json: Any?) -> CGPoint? {
        guard let point = json as? [String: Any] else { return nil }
        return CGPoint(x: webNumber(point["x"]) ?? .nan, y: webNumber(point["y"]) ?? .nan)
    }

    private func webNumber(_ json: Any?) -> Double? {
        (json as? NSNumber)?.doubleValue
    }
    #else
    private func logWebEvent(_ event: [String: Any]) -> Bool {
        false
    }
    #endif
}
