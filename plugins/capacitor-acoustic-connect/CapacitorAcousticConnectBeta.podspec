require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# The oldest Connect iOS SDK the plugin supports, the first build with the iOS screen-capture and WebView fixes: the floor of the release pod
# (useRelease) and of an iosVersion the app names. With no iosVersion the pod floats: CocoaPods takes the newest version.
SDK_FLOOR = '2.1.51'
# The first SDK with the functions that log taps and gestures on page elements, the floor of the beta pod (the default). The beta package's
# Package.swift asks ConnectDebug-SP for the same version.
WEB_CAPTURE_FLOOR = '2.2.35'

# A setting of the plugin block (plugins.AcousticConnect) in the app's config, which `pod install` reads while it evaluates this file,
# as the RN podspec reads ConnectConfig.json. The app's own capacitor.config.json first, then the copy `npx cap sync` leaves in ios/App/App/
# (an app with a capacitor.config.ts has only that one): the order setup-ios-push and doctor read them in. ACOUSTIC_APP_CONFIG names another
# file (the tests use it). Anything that cannot be read is no setting.
pluginSetting = lambda do |key|
  # Outside of `pod install` (`pod spec lint`, a plain evaluation) CocoaPods may have no installation root: then only ACOUSTIC_APP_CONFIG counts.
  root = begin
    Pod::Config.instance.installation_root.to_s
  rescue ::StandardError # not Pod::StandardError, which is what a bare name means while CocoaPods evaluates this file
    nil
  end
  candidates = [ENV['ACOUSTIC_APP_CONFIG']]
  candidates += [File.join(root, '..', '..', 'capacitor.config.json'), File.join(root, 'App', 'capacitor.config.json')] if root && !root.empty?
  candidates.compact!
  found = nil
  candidates.each do |file|
    next unless File.exist?(file)

    begin
      block = JSON.parse(File.read(file)).dig('plugins', 'AcousticConnect')
      if block.is_a?(Hash)
        found = block[key]
        break
      end
    rescue JSON::ParserError
      next
    end
  end
  found
end

# iosVersion pins another Connect iOS SDK (the Cordova plugin's iOSVersion). It has to be x.y.z, and CocoaPods holds it to the floor: a version
# below the plugin's pin cannot be had, and `pod install` says so. Written wrongly it stops here, not ignored.
ios_version = pluginSetting.call('iosVersion')
unless ios_version.nil? || ios_version.is_a?(String)
  raise "AcousticConnect: iosVersion in the plugin block of capacitor.config must be a string, got #{ios_version.class}"
end
ios_version = ios_version.to_s.strip
unless ios_version.empty? || ios_version.match?(/\A\d+\.\d+\.\d+\z/)
  raise "AcousticConnect: iosVersion '#{ios_version}' in the plugin block of capacitor.config is not a version: write it as x.y.z, or leave it empty to use the plugin's default."
end

# useRelease picks the release SDK (AcousticConnect); anything but true keeps the beta SDK (AcousticConnectDebug). On Swift Package Manager
# the npm package decides instead: the beta package links ConnectDebug-SP, the public one Connect-SP.
use_release = pluginSetting.call('useRelease') == true
sdk_pod = use_release ? 'AcousticConnect' : 'AcousticConnectDebug'
if ios_version.empty?
  sdk_requirements = [">= #{use_release ? SDK_FLOOR : WEB_CAPTURE_FLOOR}"]
  web_capture = !use_release
else
  sdk_requirements = [">= #{SDK_FLOOR}", "= #{ios_version}"]
  web_capture = Gem::Version.new(ios_version) >= Gem::Version.new(WEB_CAPTURE_FLOOR)
end

# The beta pod's versions this plugin needs (AcousticConnectDebug 2.2.35 and later) are only in the Acoustic spec repo, and CocoaPods trunk is
# read-only from 2 December 2026, so later AcousticConnect versions are only there too. A pod cannot name its source, so the app's Podfile
# has to. Warn during `pod install` when it does not (an active line; a comment does not count), so a CocoaPods app that never ran
# `npx acoustic-connect setup-ios-pods` or setup-ios-push hears about it. ACOUSTIC_PODFILE names another Podfile (the tests use it). Never
# stops the install: CocoaPods then says itself that it cannot find the beta pod.
podfile_path = ENV['ACOUSTIC_PODFILE']
unless podfile_path
  root = begin
    Pod::Config.instance.installation_root.to_s
  rescue ::StandardError
    nil
  end
  podfile_path = File.join(root, 'Podfile') if root && !root.empty?
end
if podfile_path && File.exist?(podfile_path)
  podspecs_line = %r{^[ \t]*source[ \t]+(['"])https://github\.com/go-acoustic/PodSpecs(?:\.git)?\1}
  unless File.read(podfile_path).match?(podspecs_line)
    reason = if use_release
               'CocoaPods trunk is read-only from 2 December 2026, so later Connect SDK versions cannot be found.'
             else
               'newer versions of the AcousticConnectDebug pod, 2.2.35 (the plugin\'s default) and later among them, are published ' \
               'only there, so `pod install` cannot find them.'
             end
    message = "AcousticConnect: ios/App/Podfile does not name the go-acoustic/PodSpecs source: #{reason} Run " \
              '`npx acoustic-connect setup-ios-pods`, or add ' \
              "`source 'https://github.com/go-acoustic/PodSpecs.git'` above `source 'https://cdn.cocoapods.org/'` in the Podfile."
    if defined?(Pod::UI) && Pod::UI.respond_to?(:warn)
      Pod::UI.warn(message)
    else
      warn message
    end
  end
end

Pod::Spec.new do |s|
  s.name = 'CapacitorAcousticConnectBeta'
  s.version = package['version']
  s.summary = package['description']
  s.license = package['license']
  s.homepage = package['repository']['url']
  s.author = package['author']
  s.source = { :git => package['repository']['url'], :tag => s.version.to_s }
  s.source_files = 'ios/Sources/**/*.{swift,h,m,c,cc,mm,cpp}'
  s.ios.deployment_target = '15.1'
  s.dependency 'Capacitor'
  # The Connect iOS SDK. The adapter that talks to it compiles only when its module can be imported, which the pod dependency makes true.
  s.dependency sdk_pod, *sdk_requirements
  # Compiles the logging of taps and gestures on page elements, only when every version the requirement allows has its functions.
  s.pod_target_xcconfig = { 'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => '$(inherited) CONNECT_WEB_CAPTURE' } if web_capture
  s.swift_version = '5.1'
end
