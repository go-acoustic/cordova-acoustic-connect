#!/usr/bin/env ruby
# frozen_string_literal: true

# Copyright (C) 2026 Acoustic, L.P. All rights reserved.
#
# Adds the Connect rich-push extensions (ConnectNSE, ConnectNCE) to the Xcode project of a Capacitor app. Run by
# `npx acoustic-connect setup-ios-push` after it has written the extensions' sources next to the project. Needs the `xcodeproj`
# gem (it comes with CocoaPods). Safe to run again: it adds what is missing and brings the rest back in line (the version
# numbers, the team, the SDK version) without adding anything twice.
#
# Input, from the environment:
#   ACOUSTIC_PROJECT_PATH     the App.xcodeproj
#   ACOUSTIC_APP_GROUP        the App Group the extensions and the app share
#   ACOUSTIC_SDK_VERSION      the Connect-SP version the plugin requires at least
#   ACOUSTIC_DEVELOPMENT_TEAM optional
#   ACOUSTIC_LINK_SDK         'spm' (default): the extensions get the Connect SDK as a Swift package of the project;
#                             'pods': the app uses CocoaPods, the Podfile gives them the AcousticConnect pod, and the project gets no package

require 'xcodeproj'

def env!(key)
  value = ENV[key].to_s.strip
  raise "#{key} is required" if value.empty?

  value
end

PROJECT_PATH = env!('ACOUSTIC_PROJECT_PATH')
APP_GROUP    = env!('ACOUSTIC_APP_GROUP')
SDK_VERSION  = env!('ACOUSTIC_SDK_VERSION')
TEAM         = ENV['ACOUSTIC_DEVELOPMENT_TEAM'].to_s.strip
LINK_SDK     = ENV['ACOUSTIC_LINK_SDK'].to_s.strip.empty? ? 'spm' : ENV['ACOUSTIC_LINK_SDK'].to_s.strip
raise "ACOUSTIC_LINK_SDK must be spm or pods, not #{LINK_SDK}" unless %w[spm pods].include?(LINK_SDK)
USE_SPM      = LINK_SDK == 'spm'
SDK_URL      = 'https://github.com/go-acoustic/Connect-SP.git'
EXTENSIONS   = {
  'ConnectNSE' => 'NotificationService.swift',
  'ConnectNCE' => 'NotificationViewController.swift'
}.freeze

project = Xcodeproj::Project.open(PROJECT_PATH)
project_dir = File.dirname(PROJECT_PATH)
app = project.native_targets.find { |t| t.name == 'App' && t.product_type == 'com.apple.product-type.application' } ||
      project.native_targets.find { |t| t.product_type == 'com.apple.product-type.application' }
raise "no application target in #{PROJECT_PATH}" unless app

def setting(target, config_name, key)
  target.build_configurations.find { |c| c.name == config_name }.build_settings[key]
end

app_bundle_id = setting(app, 'Debug', 'PRODUCT_BUNDLE_IDENTIFIER').to_s
raise 'the app has no PRODUCT_BUNDLE_IDENTIFIER' if app_bundle_id.empty?

# --- the Connect SDK, as a Swift package of the project, for the extensions -----------------------------------------------------------
# With CocoaPods the SDK reaches the extensions through the Podfile instead, and linking the package too would put it there twice.
if USE_SPM
  package = project.root_object.package_references.find { |r| r.respond_to?(:repositoryURL) && r.repositoryURL.to_s =~ /Connect-SP/ }
  unless package
    package = project.new(Xcodeproj::Project::Object::XCRemoteSwiftPackageReference)
    package.repositoryURL = SDK_URL
    project.root_object.package_references << package
  end
  package.requirement = { 'kind' => 'upToNextMajorVersion', 'minimumVersion' => SDK_VERSION }
end

# --- the app: entitlements and background mode ---------------------------------------------------------------------------------------
# One group of files per extension, next to the project: the folder named like the extension.
def group_for(project, name)
  project.main_group.find_subpath(name, false) || project.main_group.new_group(name, name)
end

def file_in(group, name)
  group.files.find { |f| f.path == name } || group.new_file(name)
end

app_info_path = setting(app, 'Debug', 'INFOPLIST_FILE').to_s
app_dir = app_info_path.empty? ? 'App' : File.dirname(app_info_path)
entitlements_setting = setting(app, 'Debug', 'CODE_SIGN_ENTITLEMENTS').to_s
entitlements_rel = entitlements_setting.empty? ? "#{app_dir}/#{app.name}.entitlements" : entitlements_setting
entitlements_path = File.join(project_dir, entitlements_rel)

entitlements = File.exist?(entitlements_path) ? Xcodeproj::Plist.read_from_path(entitlements_path) : {}
entitlements['aps-environment'] ||= 'development'
groups = Array(entitlements['com.apple.security.application-groups'])
groups << APP_GROUP unless groups.include?(APP_GROUP)
entitlements['com.apple.security.application-groups'] = groups
FileUtils.mkdir_p(File.dirname(entitlements_path))
Xcodeproj::Plist.write_to_path(entitlements, entitlements_path)

if entitlements_setting.empty?
  app_group = project.main_group.find_subpath(app_dir, false) || project.main_group.new_group(app_dir, app_dir)
  file_in(app_group, File.basename(entitlements_rel))
  app.build_configurations.each { |c| c.build_settings['CODE_SIGN_ENTITLEMENTS'] = entitlements_rel }
end

# Remote notifications wake the app in the background (the Cordova plugin adds the same mode to the app's Info.plist).
unless app_info_path.empty?
  info_path = File.join(project_dir, app_info_path)
  if File.exist?(info_path)
    info = Xcodeproj::Plist.read_from_path(info_path)
    modes = Array(info['UIBackgroundModes'])
    unless modes.include?('remote-notification')
      info['UIBackgroundModes'] = modes + ['remote-notification']
      Xcodeproj::Plist.write_to_path(info, info_path)
    end
  end
end

# --- the extensions ------------------------------------------------------------------------------------------------------------------
embed = app.copy_files_build_phases.find { |p| p.name == 'Embed Foundation Extensions' }
unless embed
  embed = app.new_copy_files_build_phase('Embed Foundation Extensions')
  embed.symbol_dst_subfolder_spec = :plug_ins
end

EXTENSIONS.each do |name, source|
  ext = project.native_targets.find { |t| t.name == name }
  ext ||= project.new_target(:app_extension, name, :ios, setting(app, 'Debug', 'IPHONEOS_DEPLOYMENT_TARGET') || '15.0')

  group = group_for(project, name)
  source_ref = file_in(group, source)
  ext.add_file_references([source_ref]) unless ext.source_build_phase.files_references.include?(source_ref)
  file_in(group, "#{name}-Info.plist")
  file_in(group, "#{name}.entitlements")

  ext.build_configurations.each do |config|
    s = config.build_settings
    s['PRODUCT_BUNDLE_IDENTIFIER'] = "#{app_bundle_id}.#{name}"
    s['PRODUCT_NAME'] = '$(TARGET_NAME)'
    s['INFOPLIST_FILE'] = "#{name}/#{name}-Info.plist"
    s['CODE_SIGN_ENTITLEMENTS'] = "#{name}/#{name}.entitlements"
    s['CODE_SIGN_STYLE'] = 'Automatic'
    s['SKIP_INSTALL'] = 'YES'
    s['SWIFT_VERSION'] = setting(app, config.name, 'SWIFT_VERSION') || '5.0'
    s['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
    s['TARGETED_DEVICE_FAMILY'] = '1,2'
    s['LD_RUNPATH_SEARCH_PATHS'] = '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks'
    s['IPHONEOS_DEPLOYMENT_TARGET'] = setting(app, config.name, 'IPHONEOS_DEPLOYMENT_TARGET') || '15.0'
    # An extension and the app that contains it must carry the same version, or the App Store refuses the upload.
    %w[MARKETING_VERSION CURRENT_PROJECT_VERSION].each do |key|
      value = setting(app, config.name, key)
      s[key] = value unless value.nil?
    end
  end

  if USE_SPM && ext.package_product_dependencies.none? { |d| d.product_name == 'Connect' }
    dependency = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
    dependency.product_name = 'Connect'
    dependency.package = package
    ext.package_product_dependencies << dependency
    build_file = project.new(Xcodeproj::Project::Object::PBXBuildFile)
    build_file.product_ref = dependency
    ext.frameworks_build_phase.files << build_file
  end

  unless embed.files_references.include?(ext.product_reference)
    build_file = embed.add_file_reference(ext.product_reference, true)
    build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
  end
  app.add_dependency(ext) unless app.dependencies.any? { |d| d.target == ext }
end

# --- the team ------------------------------------------------------------------------------------------------------------------------
unless TEAM.empty?
  ([app] + project.native_targets.select { |t| EXTENSIONS.key?(t.name) }).each do |target|
    target.build_configurations.each { |c| c.build_settings['DEVELOPMENT_TEAM'] = TEAM }
  end
end

project.save
puts "ConnectNSE and ConnectNCE are in #{File.basename(PROJECT_PATH)} (#{USE_SPM ? "Connect-SP #{SDK_VERSION}" : 'AcousticConnect pod'})"
