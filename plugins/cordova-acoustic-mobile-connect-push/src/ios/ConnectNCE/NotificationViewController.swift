// Copyright (C) 2026 Acoustic, L.P. All rights reserved.
//
// Notification Content Extension — Acoustic Connect Cordova Plugin.
//
// The CONNECT_APP_GROUP_IDENTIFIER_PLACEHOLDER token is replaced by the
// Cordova after_prepare hook with the value of iOSAppGroupIdentifier from
// ConnectConfig.json at prepare time.
//
// Inherits all behaviour from ConnectNotificationContentExtension (Connect SDK):
// renders the expanded rich-push UI (media + body) when the user
// long-presses or force-touches an Acoustic notification.

import Connect

final class NotificationViewController: ConnectNotificationContentExtension {
    override var appGroupIdentifier: String? {
        "CONNECT_APP_GROUP_IDENTIFIER_PLACEHOLDER"
    }
}
