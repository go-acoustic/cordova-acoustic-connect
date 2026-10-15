/* eslint-disable @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');

const IOS = path.join(__dirname, '..', '..', '..', 'applications', 'DemoCapacitor', 'ios', 'App');
const read = (...p: string[]) => fs.readFileSync(path.join(IOS, ...p), 'utf8');

// What an iOS app needs to receive push, which the Cordova plugin adds with its hooks (entitlements, background mode) and
// Capacitor, which has no hooks, leaves to the app. Without them the simulator reports a registration with an empty token.
describe('DemoCapacitor iOS push set-up', () => {
  const entitlements = () => read('App', 'App.entitlements');

  it('has the push entitlement for a development build', () => {
    expect(entitlements()).toMatch(/<key>aps-environment<\/key>\s*<string>development<\/string>/);
  });

  it('has the App Group of the notification extensions', () => {
    expect(entitlements()).toMatch(
      /com\.apple\.security\.application-groups[\s\S]*group\.co\.acoustic\.connect\.capacitor\.demo/,
    );
  });

  it('uses the entitlements file in every build configuration of the app', () => {
    const project = read('App.xcodeproj', 'project.pbxproj');
    const used = project.match(/CODE_SIGN_ENTITLEMENTS = App\/App\.entitlements;/g) || [];
    expect(used).toHaveLength(2); // Debug and Release
  });

  it('wakes the app for remote notifications in the background', () => {
    expect(read('App', 'Info.plist')).toMatch(
      /<key>UIBackgroundModes<\/key>\s*<array>\s*<string>remote-notification<\/string>/,
    );
  });
});

export {};
