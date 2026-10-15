/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * NOTICE: This file contains material that is confidential and proprietary to
 * Acoustic, L.P. and/or other developers. No license is granted under any intellectual or
 * industrial property rights of Acoustic, L.P. except as may be provided in an agreement with
 * Acoustic, L.P. Any unauthorized copying or distribution of content from this file is
 * prohibited.
 */

import Capacitor
import Foundation

/// How a bridge method answers; `CallReply` sends the answer to the JavaScript caller.
protocol Reply: AnyObject {
    func resolve(_ data: [String: Any]?)
    func reject(code: String, message: String)
}

extension Reply {
    func resolve() { resolve(nil) }
}

final class CallReply: Reply {
    private let call: CAPPluginCall

    init(_ call: CAPPluginCall) { self.call = call }

    func resolve(_ data: [String: Any]?) {
        if let data {
            call.resolve(data)
        } else {
            call.resolve()
        }
    }

    func reject(code: String, message: String) {
        call.reject(message, code)
    }
}

/// The answer of a start-up call nobody is waiting for: logged, not sent.
final class LogReply: Reply {
    func resolve(_ data: [String: Any]?) { NSLog("[AcousticConnect] auto-enable done") }

    func reject(code: String, message: String) { NSLog("[AcousticConnect] auto-enable failed: \(code) \(message)") }
}
