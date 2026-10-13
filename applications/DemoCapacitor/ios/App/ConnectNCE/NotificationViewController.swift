// Copyright (C) 2026 Acoustic, L.P. All rights reserved.
//
// Notification Content Extension of Acoustic Connect, added by `npx acoustic-connect setup-ios-push`.
//
// It inherits everything from ConnectNotificationContentExtension (Connect SDK): it renders the expanded rich-push UI
// (media and body) when the user long-presses an Acoustic notification.

import Connect

final class NotificationViewController: ConnectNotificationContentExtension {
    override var appGroupIdentifier: String? {
        "group.co.acoustic.connect.capacitor.demo"
    }
}
