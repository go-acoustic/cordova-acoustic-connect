// Copyright (C) 2026 Acoustic, L.P. All rights reserved.
//
// Notification Service Extension of Acoustic Connect, added by `npx acoustic-connect setup-ios-push`.
//
// It inherits everything from ConnectNotificationService (Connect SDK): it downloads rich-media attachments and records
// the PushReceived signal into the shared App Group store before iOS delivers the notification.

import Connect

final class NotificationService: ConnectNotificationService, @unchecked Sendable {
    override var appGroupIdentifier: String? {
        "group.co.acoustic.connect.capacitor.demo"
    }
}
