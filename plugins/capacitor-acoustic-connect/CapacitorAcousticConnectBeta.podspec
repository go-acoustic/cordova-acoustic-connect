require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

# The Connect iOS SDK the plugin is built and tried against. It is the version when the app names none, and the floor of the one it names.
SDK_PIN = '2.1.15'

# A setting of the plugin block (plugins.AcousticConnect) in the app's config, which `pod install` reads while it evaluates this file,
# as the RN podspec reads ConnectConfig.json. `npx cap sync` leaves the config in ios/App/App/; the app's own file is the fallback.
# ACOUSTIC_APP_CONFIG names another file (the tests use it). Anything that cannot be read is no setting.
pluginSetting = lambda do |key|
  # Outside of `pod install` (`pod spec lint`, a plain evaluation) CocoaPods may have no installation root: then only ACOUSTIC_APP_CONFIG counts.
  root = begin
    Pod::Config.instance.installation_root.to_s
  rescue ::StandardError # not Pod::StandardError, which is what a bare name means while CocoaPods evaluates this file
    nil
  end
  candidates = [ENV['ACOUSTIC_APP_CONFIG']]
  candidates += [File.join(root, 'App', 'capacitor.config.json'), File.join(root, '..', '..', 'capacitor.config.json')] if root && !root.empty?
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
sdk_requirements = ios_version.empty? ? [SDK_PIN] : [">= #{SDK_PIN}", "= #{ios_version}"]

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
  s.dependency 'AcousticConnect', *sdk_requirements
  s.swift_version = '5.1'
end
