/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * NOTICE: This file contains material that is confidential and proprietary to
 * Acoustic, L.P. and/or other developers. No license is granted under any intellectual or
 * industrial property rights of Acoustic, L.P. except as may be provided in an agreement with
 * Acoustic, L.P. Any unauthorized copying or distribution of content from this file is
 * prohibited.
 */

#import <UIKit/UIKit.h>

// The Swift holder, forward-declared instead of importing the generated "-Swift.h" header: that
// header's name and availability depend on the host app's module name and build settings, which
// a plugin cannot control. The class is exposed to Objective-C by `@objc(ACConnectPushLaunchHolder)`
// in ConnectPushLaunchHolder.swift.
@interface ACConnectPushLaunchHolder : NSObject
+ (void)installIfNeeded;
@end

/// Installs the launch-time notification-center delegate that keeps a notification tap until the
/// JavaScript `enable()` call has enabled the Connect SDK (see ConnectPushLaunchHolder.swift).
///
/// A Cordova plugin gets no `application:didFinishLaunchingWithOptions:` callback, and its
/// `pluginInitialize` runs later, once the web view controller has loaded its view. So this
/// registers from `+load`, which runs before `main()`, for the notification UIKit posts as the app
/// finishes launching. `queue:nil` runs the block synchronously on the posting (main) thread.
@interface ACConnectPushLaunchHook : NSObject
@end

@implementation ACConnectPushLaunchHook

+ (void)load {
    [[NSNotificationCenter defaultCenter]
        addObserverForName:UIApplicationDidFinishLaunchingNotification
                    object:nil
                     queue:nil
                usingBlock:^(NSNotification * _Nonnull note) {
                    [ACConnectPushLaunchHolder installIfNeeded];
                }];
}

@end
