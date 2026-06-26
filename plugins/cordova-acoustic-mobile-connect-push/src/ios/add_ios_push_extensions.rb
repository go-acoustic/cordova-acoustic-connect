#!/usr/bin/env ruby
# frozen_string_literal: true

# add_ios_push_extensions.rb
#
# Idempotently adds ConnectNSE + ConnectNCE Xcode targets to the host Cordova
# app project and wires all pbxproj relationships needed for Acoustic Connect
# rich push: embed phase, target dependency, system frameworks, xcframeworks
# locking script phase, and App Compile Sources cleanup.
#
# Parameters via ENV (set by after_prepare.js):
#   ACOUSTIC_PROJECT_PATH      absolute path to the .xcodeproj  (required)
#   ACOUSTIC_APP_TARGET        host app target name — "App"     (required)
#   ACOUSTIC_APP_BUNDLE_ID     host bundle identifier            (required)
#   ACOUSTIC_DEVELOPMENT_TEAM  Apple Team ID (10-char)          (optional)
#   ACOUSTIC_DEPLOYMENT_TARGET iOS deployment target            (default 15.1)
#   ACOUSTIC_SWIFT_VERSION     Swift version                    (default 5.0)
#   ACOUSTIC_SDK_VARIANT       AcousticConnect|AcousticConnectDebug (default AcousticConnectDebug)
#
# Requires the xcodeproj gem (ships with CocoaPods).

require 'xcodeproj'

def env!(key)
  value = ENV[key]
  raise "#{key} is required" if value.nil? || value.empty?

  value
end

PROJECT_PATH       = env!('ACOUSTIC_PROJECT_PATH')
APP_TARGET_NAME    = env!('ACOUSTIC_APP_TARGET')
APP_BUNDLE_ID      = env!('ACOUSTIC_APP_BUNDLE_ID')
DEPLOYMENT_TARGET  = ENV.fetch('ACOUSTIC_DEPLOYMENT_TARGET', '15.1')
SWIFT_VERSION      = ENV.fetch('ACOUSTIC_SWIFT_VERSION', '5.0')
SDK_VARIANT        = ENV.fetch('ACOUSTIC_SDK_VARIANT', 'AcousticConnectDebug')
DEVELOPMENT_TEAM   = ENV['ACOUSTIC_DEVELOPMENT_TEAM'].to_s.strip
TEAM_SET           = !DEVELOPMENT_TEAM.empty? && DEVELOPMENT_TEAM != 'YOUR_TEAM_ID'

EXTENSIONS = [
  {
    name:       'ConnectNSE',
    source:     'NotificationService.swift',
    suffix:     'ConnectNSE',
    frameworks: %w[UserNotifications],
  },
  {
    name:       'ConnectNCE',
    source:     'NotificationViewController.swift',
    suffix:     'ConnectNCE',
    # UserNotificationsUI declares the content-extension point and is required or
    # the extension traps: "Unable to find NSExtensionContextClass for content ext"
    frameworks: %w[UserNotificationsUI UserNotifications UIKit],
  },
].freeze

# ConnectPlugin.swift must be in the App target's Compile Sources so the JS
# bridge class is compiled. The file copy is handled by after_prepare.js; this
# script registers it in the pbxproj. The path is relative to SRCROOT.
PLUGIN_COMPILE_FILES = [
  { path: "App/Plugins/co.acoustic.connect.push/ConnectPlugin.swift", type: 'sourcecode.swift' },
].freeze

# Locking wrapper script: prevents concurrent NSE/NCE builds from racing on
# xcframeworks extraction. Uses atomic mkdir (macOS has no flock). VARIANT is
# substituted via gsub at runtime.
XCFRAMEWORKS_SCRIPT_TEMPLATE = <<~'SHELL'
  #!/bin/sh
  DEST="${PODS_XCFRAMEWORKS_BUILD_DIR}/VARIANT/Core"
  LOCK="${TMPDIR}/co.acoustic.xcframeworks.lck"
  if [ -d "${DEST}/Connect.framework" ] && [ -d "${DEST}/Tealeaf.framework" ] && [ -d "${DEST}/EOCore.framework" ]; then
    exit 0
  fi
  if mkdir "${LOCK}" 2>/dev/null; then
    "${PODS_ROOT}/Target Support Files/VARIANT/VARIANT-xcframeworks.sh"
    rmdir "${LOCK}" 2>/dev/null
  else
    I=0
    while [ -d "${LOCK}" ] && [ $I -lt 120 ]; do
      sleep 0.5
      I=$((I + 1))
    done
  fi
SHELL

MAC_CATALYST_SETTINGS = {
  'SUPPORTS_MACCATALYST'                  => 'NO',
  'SUPPORTS_MAC_DESIGNED_FOR_IPHONE_IPAD' => 'YES',
}.freeze

# ---------------------------------------------------------------------------
# Open project
# ---------------------------------------------------------------------------

project    = Xcodeproj::Project.open(PROJECT_PATH)
app_target = project.targets.find { |t| t.name == APP_TARGET_NAME }
# Cordova always produces App.xcodeproj with an 'App' native target, so stem == target name.
# Guard against any edge case where they diverge by falling back to the first app target.
app_target ||= project.targets.find { |t| t.product_type == 'com.apple.product-type.application' }
raise "No application target found in #{PROJECT_PATH} (looked for '#{APP_TARGET_NAME}')" unless app_target

# ---------------------------------------------------------------------------
# 1. Ensure "Embed Foundation Extensions" copy-files phase on App target
# ---------------------------------------------------------------------------

embed_phase = app_target.copy_files_build_phases.find { |p| p.symbol_dst_subfolder_spec == :plug_ins }
unless embed_phase
  embed_phase = app_target.new_copy_files_build_phase('Embed Foundation Extensions')
  embed_phase.symbol_dst_subfolder_spec = :plug_ins
  puts 'App: created Embed Foundation Extensions phase.'
end

# ---------------------------------------------------------------------------
# 2. Mac Catalyst + signing on App target and project-level configurations
# ---------------------------------------------------------------------------

app_target.build_configurations.each do |config|
  MAC_CATALYST_SETTINGS.each { |k, v| config.build_settings[k] = v }
  config.build_settings['DEVELOPMENT_TEAM'] = DEVELOPMENT_TEAM if TEAM_SET
end

project.build_configuration_list.build_configurations.each do |config|
  MAC_CATALYST_SETTINGS.each { |k, v| config.build_settings[k] = v }
end

# ---------------------------------------------------------------------------
# 3. Extension targets
# ---------------------------------------------------------------------------

EXTENSIONS.each do |ext|
  # ── Create target (skip if already present) ──────────────────────────────

  target = project.targets.find { |t| t.name == ext[:name] }

  unless target
    puts "#{ext[:name]}: creating app-extension target."
    target = project.new_target(:app_extension, ext[:name], :ios, DEPLOYMENT_TARGET, nil, :swift)

    # Group + source file reference (add_file_references adds to Compile Sources)
    group      = project.main_group.find_subpath(ext[:name], true)
    source_ref = group.new_reference("#{ext[:name]}/#{ext[:source]}")
    target.add_file_references([source_ref])
    group.new_reference("#{ext[:name]}/Info.plist")
    group.new_reference("#{ext[:name]}/#{ext[:name]}.entitlements")

    target.build_configurations.each do |config|
      bs = config.build_settings
      bs['PRODUCT_BUNDLE_IDENTIFIER']    = "#{APP_BUNDLE_ID}.#{ext[:suffix]}"
      bs['PRODUCT_NAME']                 = '$(TARGET_NAME)'
      bs['INFOPLIST_FILE']               = "#{ext[:name]}/Info.plist"
      bs['GENERATE_INFOPLIST_FILE']      = 'NO'
      bs['CODE_SIGN_ENTITLEMENTS']       = "#{ext[:name]}/#{ext[:name]}.entitlements"
      bs['CODE_SIGN_STYLE']              = 'Automatic'
      bs['IPHONEOS_DEPLOYMENT_TARGET']   = DEPLOYMENT_TARGET
      bs['SWIFT_VERSION']                = SWIFT_VERSION
      bs['SKIP_INSTALL']                 = 'YES'
      bs['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
      bs['CLANG_ENABLE_MODULES']         = 'YES'
      bs['MARKETING_VERSION']            = '1.0'
      bs['CURRENT_PROJECT_VERSION']      = '1'
      bs['TARGETED_DEVICE_FAMILY']       = '1,2'
      bs['LD_RUNPATH_SEARCH_PATHS']      = [
        '$(inherited)',
        '@executable_path/Frameworks',
        '@executable_path/../../Frameworks',
      ]
    end

    # Wire embed phase (RemoveHeadersOnCopy) and target dependency.
    # add_dependency creates both PBXTargetDependency + PBXContainerItemProxy.
    app_target.add_dependency(target)
    embed_build_file = embed_phase.add_file_reference(target.product_reference)
    embed_build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
    puts "#{ext[:name]}: target created, embedded, added as App dependency."
  end

  # Refresh reference after possible creation above
  target = project.targets.find { |t| t.name == ext[:name] }
  next unless target

  # ── Purge Cordova-injected sources ───────────────────────────────────────
  # Cordova's plugin-add injects plugin ObjC/Swift files into ALL targets,
  # including NSE/NCE. Remove everything except the one allowed Swift file.

  sources = target.source_build_phase
  if sources
    spurious = sources.files.reject { |bf| bf.display_name == ext[:source] }
    spurious.each do |bf|
      puts "#{ext[:name]}: removing spurious source #{bf.display_name}"
      sources.remove_build_file(bf)
    end

    # Ensure the allowed source is in Compile Sources
    unless sources.files.any? { |bf| bf.display_name == ext[:source] }
      group = project.main_group.find_subpath(ext[:name], false)
      if group
        ref = group.files.find { |f| (f.path || '').end_with?(ext[:source]) }
        if ref
          sources.add_file_reference(ref)
          puts "#{ext[:name]}: added #{ext[:source]} to Compile Sources"
        end
      end
    end
  end

  # ── xcframeworks locking script phase (before Compile Sources) ───────────
  xcfw_phase_name = "[CP] Prepare #{SDK_VARIANT} xcframeworks"
  has_xcfw = target.build_phases.any? do |p|
    p.respond_to?(:name) && p.name == xcfw_phase_name
  end

  unless has_xcfw
    xcfw_phase = target.new_shell_script_build_phase(xcfw_phase_name)
    xcfw_phase.shell_script = XCFRAMEWORKS_SCRIPT_TEMPLATE.gsub('VARIANT', SDK_VARIANT)
    xcfw_phase.input_file_list_paths = [
      "${PODS_ROOT}/Target Support Files/#{SDK_VARIANT}/#{SDK_VARIANT}-xcframeworks-input-files.xcfilelist",
    ]
    xcfw_phase.show_env_vars_in_log = '0'

    # Move xcfw_phase to immediately before Compile Sources
    phases    = target.build_phases
    src_phase = target.source_build_phase
    if src_phase
      phases.delete(xcfw_phase)
      src_idx = phases.index(src_phase)
      phases.insert(src_idx, xcfw_phase) if src_idx
    end
    puts "#{ext[:name]}: added xcframeworks locking script phase"
  end

  # ── System frameworks ─────────────────────────────────────────────────────
  linked = target.frameworks_build_phase.files.map(&:display_name)
  ext[:frameworks].each do |fw|
    fw_name = "#{fw}.framework"
    if linked.include?(fw_name)
      puts "#{ext[:name]}: #{fw_name} already linked."
    else
      target.add_system_framework(fw)
      puts "#{ext[:name]}: linked #{fw_name}."
    end
  end

  # ── Mac Catalyst + signing on extension targets (idempotent) ─────────────
  target.build_configurations.each do |config|
    MAC_CATALYST_SETTINGS.each { |k, v| config.build_settings[k] = v }
    config.build_settings['DEVELOPMENT_TEAM'] = DEVELOPMENT_TEAM if TEAM_SET
  end
end

# ---------------------------------------------------------------------------
# 4. ConnectPlugin.swift in App target Compile Sources
#    File copy is handled by after_prepare.js; this registers it in pbxproj.
# ---------------------------------------------------------------------------

app_sources = app_target.source_build_phase
if app_sources
  PLUGIN_COMPILE_FILES.each do |pf|
    already_present = app_sources.files.any? do |bf|
      ref = bf.file_ref
      ref && (ref.path || '').end_with?(File.basename(pf[:path]))
    end
    next if already_present

    # Reuse an existing PBXFileReference if present anywhere in the project.
    basename = File.basename(pf[:path])
    ref = project.files.find { |f| (f.path || '').end_with?(basename) && (f.path || '').include?('Plugins') }

    unless ref
      group_path = File.dirname(pf[:path])
      group = project.main_group.find_subpath(group_path, true)
      ref   = group.new_reference(basename)
    end

    app_sources.add_file_reference(ref) if ref
    puts "App: added #{basename} to Compile Sources"
  end
end

# ---------------------------------------------------------------------------
# Save
# ---------------------------------------------------------------------------

project.save
puts "Saved #{PROJECT_PATH}"
