// Copyright (C) 2026 Acoustic, L.P. All rights reserved.
//
// Notification Service Extension — Acoustic Connect Cordova Plugin.
//
// The CONNECT_APP_GROUP_IDENTIFIER_PLACEHOLDER token is replaced by the
// Cordova after_prepare hook with the value of iOSAppGroupIdentifier from
// ConnectConfig.json at prepare time.
//
// Inherits all behaviour from ConnectNotificationService (Connect SDK):
// downloads rich-media attachments and records the PushReceived signal into
// the shared App Group store before iOS delivers the notification.

import Connect

final class NotificationService: ConnectNotificationService, @unchecked Sendable {
    override var appGroupIdentifier: String? {
        "CONNECT_APP_GROUP_IDENTIFIER_PLACEHOLDER"
    }
}
