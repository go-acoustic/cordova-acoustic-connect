/* eslint-disable @typescript-eslint/no-var-requires */
const host = require('../../../applications/DemoCapacitor/e2e/ios-host.js');

describe('iOS e2e host (a CocoaPods app that links the Connect pod)', () => {
  it('raises the Podfile platform to the SDK minimum, iOS 15.1', () => {
    expect(host.patchPodfile("require_relative\nplatform :ios, '15.0'\nuse_frameworks!")).toContain(
      "platform :ios, '15.1'",
    );
    expect(host.patchPodfile("platform :ios, '16.0'")).toContain("platform :ios, '16.0'");
  });

  it('raises the project deployment target to 15.1 everywhere', () => {
    const text = 'IPHONEOS_DEPLOYMENT_TARGET = 15.0;\nIPHONEOS_DEPLOYMENT_TARGET = 15.0;';
    expect(host.patchProject(text)).toBe('IPHONEOS_DEPLOYMENT_TARGET = 15.1;\nIPHONEOS_DEPLOYMENT_TARGET = 15.1;');
  });
});

export {};
