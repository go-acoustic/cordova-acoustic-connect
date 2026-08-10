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
# Host app's <widget version="..."> from config.xml — must match the App target's own
# MARKETING_VERSION/CURRENT_PROJECT_VERSION (cordova-ios sets both to this same value),
# since Apple requires an extension's CFBundleVersion to match its containing app's.
APP_VERSION        = ENV.fetch('ACOUSTIC_APP_VERSION', '1.0.0')
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
  {
    path: "App/Plugins/co.acoustic.connect.push/ConnectPlugin.swift",
    type: 'sourcecode.swift',
    # Real, physical group a freshly-created reference is parented under —
    # NOT a group per path segment below this point (see the fix comment at
    # its point of use for why). Paired explicitly here rather than derived
    # from `path` via File.dirname(File.dirname(...)): a derived depth
    # assumption breaks silently (wrong group, no error) if `path` ever
    # gains/loses a segment; an explicit, paired anchor fails loudly instead
    # (see the start_with? check at its point of use).
    group_anchor: "App/Plugins",
  },
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
# 0. Legacy CordovaLib.xcodeproj deployment target (cordova-ios <8.0 only)
# ---------------------------------------------------------------------------
#
# cordova-ios 8.0+ vends CordovaLib as a local Swift Package instead
# (packages/cordova-ios/Package.swift declares `.iOS(.v13)`) with no
# .xcodeproj anywhere in the App project's build graph — project_references
# is empty and this loop is a verified no-op against that layout.
#
# On cordova-ios <8.0 — still within this plugin's stated
# `<engine name="cordova-ios" version=">=7.0.0">` — CordovaLib is instead an
# embedded PBXProject subproject reference whose own IPHONEOS_DEPLOYMENT_TARGET
# ships hardcoded well below the 12.0 Xcode 15+ requires. The App target's own
# deployment-target preference never reaches it: cordova-ios's
# updateBuildProperty() call only ever patches App.xcodeproj itself, not a
# project it references.
#
# NOTE on the related "import Cordova fails — no such module 'Cordova'"
# report: that failure mode is specific to the same legacy subproject
# architecture (a plain static-library target with no generated modulemap).
# It is intentionally NOT patched here — synthesizing a correct
# module.modulemap + SWIFT_INCLUDE_PATHS blind, with no cordova-ios <8.0
# checkout available in this repo to build and verify against, risks
# corrupting the working cordova-ios 8.x/SPM case (where `import Cordova`
# already works via the package's auto-vended module) for an unverified fix
# to a path this plugin cannot test. Flagged as a known gap rather than guessed.
MIN_XCODE15_DEPLOYMENT_TARGET = '12.0'

project.root_object.project_references.each do |ref|
  file_ref = ref[:project_ref]
  next unless file_ref && File.basename(file_ref.real_path.to_s) == 'CordovaLib.xcodeproj'

  cordovalib_path = file_ref.real_path.to_s
  unless File.exist?(cordovalib_path)
    puts "CordovaLib: referenced project not found on disk at #{cordovalib_path} — skipping."
    next
  end

  # This whole block is best-effort defense for a legacy (cordova-ios <8.0)
  # layout that doesn't exist in any project this plugin is actually tested
  # against (see note above) — it must never be able to abort the surrounding
  # `cordova prepare` run. A permissions error, a locked file, or a read-only
  # checkout should surface as a clear one-line diagnostic and let the rest of
  # this script (App target settings, NSE/NCE creation) proceed normally.
  begin
    cordovalib_project = Xcodeproj::Project.open(cordovalib_path)
    changed = false
    cordovalib_project.targets.each do |t|
      t.build_configurations.each do |config|
        current = config.build_settings['IPHONEOS_DEPLOYMENT_TARGET']
        if current.nil? || Gem::Version.new(current.to_s) < Gem::Version.new(MIN_XCODE15_DEPLOYMENT_TARGET)
          config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = MIN_XCODE15_DEPLOYMENT_TARGET
          changed = true
        end
      end
    end

    if changed
      cordovalib_project.save
      puts "CordovaLib: bumped legacy subproject's IPHONEOS_DEPLOYMENT_TARGET to " \
           "#{MIN_XCODE15_DEPLOYMENT_TARGET} at #{cordovalib_path}."
    else
      puts 'CordovaLib: legacy subproject found but deployment target already '\
           "meets #{MIN_XCODE15_DEPLOYMENT_TARGET} — no change."
    end
  rescue StandardError => e
    puts "CordovaLib: could not patch deployment target at #{cordovalib_path} " \
         "(#{e.class}: #{e.message}) — skipping, App build will proceed unpatched."
  end
end

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

  # Defensive default only, never an overwrite — cordova-ios's own
  # App.xcodeproj template has set SWIFT_VERSION on every configuration for
  # years (verified: already 5.0 here). Guards this plugin's stated
  # `cordova-ios >=7.0.0` minimum against an older/blank template that leaves
  # it unset, which defaults new/edited targets to Swift 3 and fails to
  # compile ConnectPlugin.swift.
  if config.build_settings['SWIFT_VERSION'].to_s.strip.empty?
    config.build_settings['SWIFT_VERSION'] = SWIFT_VERSION
    puts "App: SWIFT_VERSION was unset — defaulted to #{SWIFT_VERSION}."
  end

  # $(inherited) guard, not an unconditional overwrite — the App target's
  # LD_RUNPATH_SEARCH_PATHS is normally owned by CocoaPods' generated
  # xcconfig include (verified: already includes $(inherited) here via
  # `pod install`), so this only ever fires against a template/CocoaPods
  # setup that dropped it, and never clobbers paths CocoaPods added.
  runpaths = config.build_settings['LD_RUNPATH_SEARCH_PATHS']
  case runpaths
  when Array
    unless runpaths.include?('$(inherited)')
      config.build_settings['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)'] + runpaths
      puts 'App: LD_RUNPATH_SEARCH_PATHS was missing $(inherited) — prepended it.'
    end
  when String
    unless runpaths.include?('$(inherited)')
      config.build_settings['LD_RUNPATH_SEARCH_PATHS'] = "$(inherited) #{runpaths}"
      puts 'App: LD_RUNPATH_SEARCH_PATHS was missing $(inherited) — prepended it.'
    end
  when nil
    config.build_settings['LD_RUNPATH_SEARCH_PATHS'] = ['$(inherited)', '@executable_path/Frameworks']
    puts 'App: LD_RUNPATH_SEARCH_PATHS was unset — defaulted with $(inherited).'
  end
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
    plist_path       = "#{ext[:name]}/#{ext[:name]}-Info.plist"
    entitlements_path = "#{ext[:name]}/#{ext[:name]}.entitlements"
    group.new_reference(plist_path)       unless group.files.any? { |f| f.path == plist_path }
    group.new_reference(entitlements_path) unless group.files.any? { |f| f.path == entitlements_path }

    target.build_configurations.each do |config|
      bs = config.build_settings
      bs['PRODUCT_BUNDLE_IDENTIFIER']    = "#{APP_BUNDLE_ID}.#{ext[:suffix]}"
      bs['PRODUCT_NAME']                 = '$(TARGET_NAME)'
      # cordova-ios's own pbxproj parser (used on every `prepare`/`build`, not just
      # ours) scans all native targets for a file matching *-Info.plist and throws
      # "Could not find *-Info.plist file, or config.xml file." if a target's
      # INFOPLIST_FILE doesn't match — a plain "Info.plist" (the usual Xcode
      # extension-target default) fails that check on the *second* prepare, once
      # this target already exists. Must stay prefixed with the target name.
      bs['INFOPLIST_FILE']               = "#{ext[:name]}/#{ext[:name]}-Info.plist"
      bs['GENERATE_INFOPLIST_FILE']      = 'NO'
      bs['CODE_SIGN_ENTITLEMENTS']       = "#{ext[:name]}/#{ext[:name]}.entitlements"
      bs['CODE_SIGN_STYLE']              = 'Automatic'
      bs['IPHONEOS_DEPLOYMENT_TARGET']   = DEPLOYMENT_TARGET
      bs['SWIFT_VERSION']                = SWIFT_VERSION
      bs['SKIP_INSTALL']                 = 'YES'
      bs['APPLICATION_EXTENSION_API_ONLY'] = 'YES'
      bs['CLANG_ENABLE_MODULES']         = 'YES'
      # MARKETING_VERSION/CURRENT_PROJECT_VERSION are set below, unconditionally
      # on every run (not just here at first creation) — see the comment there.
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

  # Re-applied on every run (not just first creation, unlike the settings block
  # above): the host app's version can change between prepares, and a stale
  # extension version silently reintroduces the CFBundleVersion mismatch Apple
  # rejects at App Store submission.
  target.build_configurations.each do |config|
    config.build_settings['MARKETING_VERSION']       = APP_VERSION
    config.build_settings['CURRENT_PROJECT_VERSION'] = APP_VERSION
  end

  # ── Migrate legacy bare "Info.plist" -> "<Ext>-Info.plist" ──────────────
  # Projects whose target predates this fix still have INFOPLIST_FILE
  # pointing at the old bare "Info.plist" and a matching stale
  # PBXFileReference in the group — the `unless target` block above only
  # runs at creation, so it never touches an already-existing target.
  # Re-applied on every run, like MARKETING_VERSION above, so upgrading the
  # plugin heals existing projects instead of only fixing new ones.
  legacy_plist_path  = "#{ext[:name]}/Info.plist"
  correct_plist_path = "#{ext[:name]}/#{ext[:name]}-Info.plist"

  target.build_configurations.each do |config|
    if config.build_settings['INFOPLIST_FILE'] == legacy_plist_path
      puts "#{ext[:name]}: migrating INFOPLIST_FILE #{legacy_plist_path} -> #{correct_plist_path}"
      config.build_settings['INFOPLIST_FILE'] = correct_plist_path
    end
  end

  plist_group = project.main_group.find_subpath(ext[:name], false)
  if plist_group
    stale_plist_ref = plist_group.files.find { |f| f.path == legacy_plist_path }
    if stale_plist_ref
      puts "#{ext[:name]}: removing stale file reference '#{legacy_plist_path}'"
      stale_plist_ref.remove_from_project
    end

    unless plist_group.files.any? { |f| f.path == correct_plist_path }
      plist_group.new_reference(correct_plist_path)
    end
  end

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

  # Remove any stale phase left over from a previous SDK_VARIANT. A
  # Debug<->Release pod switch (useRelease toggled, then `cordova plugin
  # rm`/`add`) changes SDK_VARIANT (AcousticConnectDebug <-> AcousticConnect)
  # but previously left the OLD variant's phase in place — this check only
  # ever looked for the CURRENT variant's exact name, never cleaned up a
  # mismatched one. The stale phase's input_file_list_paths then points at a
  # Target Support Files directory for a pod that's no longer installed, and
  # Xcode fails hard with "Unable to load contents of file list: ...
  # .xcfilelist" (in target 'ConnectNSE'/'ConnectNCE'). Removing any
  # non-matching "[CP] Prepare ... xcframeworks" phase here lets a
  # Debug<->Release switch via plugin rm/add clean up after itself, instead
  # of requiring a full `cordova platform rm/add ios` rebuild.
  target.build_phases.select do |p|
    p.respond_to?(:name) && p.name.to_s.match?(/\A\[CP\] Prepare .+ xcframeworks\z/) && p.name != xcfw_phase_name
  end.each do |stale_phase|
    puts "#{ext[:name]}: removing stale xcframeworks phase '#{stale_phase.name}' (SDK variant changed to #{SDK_VARIANT})"
    stale_phase.remove_from_project
  end

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

  # Silences "will be run during every build because it does not specify any
  # outputs" WITHOUT declaring outputs. Declaring output_paths here was tried
  # and reverted: ${PODS_XCFRAMEWORKS_BUILD_DIR}/.../Core/Connect.framework is
  # produced by THREE racing script phases (this one on both NSE and NCE, plus
  # the App target's own CocoaPods-generated "[CP] Copy XCFrameworks" phase)
  # coordinated via the lock file in XCFRAMEWORKS_SCRIPT_TEMPLATE above
  # specifically so only one of them does the work — Xcode requires each
  # declared output to have exactly one producer, so that caused "Multiple
  # commands produce ... Connect.framework" and failed the build outright.
  #
  # always_out_of_date is the pbxproj attribute behind "Based on dependency
  # analysis" in Xcode's own UI — the warning's own suggested alternative fix
  # ("...or configure it to run in every build by unchecking Based on
  # dependency analysis"). Setting it tells Xcode this phase is *intentionally*
  # always-run, which suppresses the warning without touching outputs at all —
  # no collision risk. The phase's own shell script already exits immediately
  # once the frameworks exist (see the `if [ -d ... ]; then exit 0; fi` guard
  # in XCFRAMEWORKS_SCRIPT_TEMPLATE), so this doesn't add meaningful build time
  # — it just stops Xcode from second-guessing a script that already runs on
  # every build today, just with a warning attached.
  #
  # Explicitly cleared output_paths (not just left unset) because an earlier,
  # reverted version of this script did declare it — pbxproj is a persistent
  # file, so simply no longer assigning it here would leave that stale value
  # in place for any project prepared while that version was active.
  xcfw_phase = target.build_phases.find { |p| p.respond_to?(:name) && p.name == xcfw_phase_name }
  if xcfw_phase
    xcfw_phase.output_paths = []
    xcfw_phase.always_out_of_date = '1'
  else
    # Should be unreachable — the phase was just created or already existed
    # under this exact name a few lines above. Logged rather than silently
    # skipped so a future rename/refactor that breaks this lookup shows up in
    # `cordova prepare` output instead of quietly leaving the Xcode warning in
    # place with zero diagnostic.
    puts "#{ext[:name]}: WARNING — xcframeworks phase '#{xcfw_phase_name}' not found; " \
         "always_out_of_date not applied, Xcode's every-build warning will persist."
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
    expected_path = pf[:path]
    basename = File.basename(expected_path)

    # Purge any stale reference for this file whose actual (group-hierarchy)
    # path doesn't match the current expected, subdirectoried location — both
    # from Compile Sources and from the project's file list generally.
    #
    # Previously this matched by basename suffix only ("ends_with?(basename)"),
    # not the full path, so a stale reference at an older/wrong location (e.g.
    # a bare "Plugins/ConnectPlugin.swift", missing the per-plugin-id
    # subdirectory this file actually lives in on disk — see
    # copyPluginSourceFiles() in after_prepare.js) was treated as "already
    # present" / reused as-is, and never replaced. Xcode then tries to compile
    # a PBXBuildFile pointing at a path that doesn't exist, failing the build
    # with "Build input file cannot be found: .../Plugins/ConnectPlugin.swift"
    # — reported against a real cordova-ios 7.x app after a useRelease
    # false->true `plugin rm`/`add` cycle. pbxproj is edited in place across
    # those cycles (never regenerated from scratch), so a stale reference like
    # this survives indefinitely once introduced.
    #
    # full_path (not path, which is only relative to the immediate parent
    # group) reconstructs the SRCROOT-relative path through the whole group
    # hierarchy — confirmed against a real generated project that it exactly
    # matches PLUGIN_COMPILE_FILES' own path format.
    stale_build_files = app_sources.files.select do |bf|
      ref = bf.file_ref
      ref && ref.path.to_s.end_with?(basename) && ref.full_path.to_s != expected_path
    end
    stale_build_files.each do |bf|
      puts "App: removing stale Compile Sources entry '#{bf.file_ref.full_path}' for #{basename} (expected #{expected_path})"
      app_sources.remove_build_file(bf)
    end

    stale_refs = project.files.select do |f|
      f.path.to_s.end_with?(basename) && f.full_path.to_s != expected_path
    end
    stale_refs.each do |f|
      puts "App: removing stale file reference '#{f.full_path}' for #{basename} (expected #{expected_path})"
      f.remove_from_project
    end

    already_present = app_sources.files.any? do |bf|
      ref = bf.file_ref
      ref && ref.full_path.to_s == expected_path
    end
    next if already_present

    # Reuse an existing PBXFileReference if present anywhere in the project.
    ref = project.files.find { |f| f.full_path.to_s == expected_path }

    unless ref
      # Parent under the real, physical "Plugins" group (the one Cordova's own
      # plugman uses, with an actual .path set) — NOT a group per path segment.
      # find_subpath(..., true) creates any missing intermediate group with
      # .path = nil (Xcode's own convention for a name-only/virtual group,
      # e.g. the plugin-id folder shown in the file navigator), and full_path
      # silently skips concatenating a nil-path group. Nesting a group per
      # segment down to the plugin ID, as an earlier version of this code did,
      # produced a virtual "co.acoustic.connect.push" group with no .path, so
      # the reference's full_path silently dropped that whole segment
      # ("App/Plugins/ConnectPlugin.swift" instead of
      # "App/Plugins/co.acoustic.connect.push/ConnectPlugin.swift") — the file
      # reference resolved to the same nonexistent parent-level path as the
      # original bug this code exists to purge. Confirmed by inspecting a real
      # generated project: the correct reference has parent group "Plugins"
      # (.path == "Plugins") and the file's own .path is
      # "co.acoustic.connect.push/ConnectPlugin.swift" — the subdirectory is
      # embedded in the file reference's path string, not a separate group.
      #
      # In every real cordova-ios-generated project "App"/"Plugins" already
      # exist with real .path values set by cordova-ios's own template, so
      # the walk below always finds (never creates) them here. The
      # explicit-path helper only matters for a hypothetical project missing
      # that structure — it keeps this script correct regardless of what
      # already exists, rather than relying on it.
      #
      # group_anchor is paired explicitly with pf[:path] (not derived via
      # File.dirname(File.dirname(...))) so a future change to path's depth
      # fails loudly here instead of silently parenting the reference under
      # the wrong group.
      plugins_dir = pf.fetch(:group_anchor)
      unless expected_path.start_with?("#{plugins_dir}/")
        raise "PLUGIN_COMPILE_FILES misconfigured: path #{expected_path.inspect} " \
              "does not start with group_anchor #{plugins_dir.inspect}"
      end
      relative_path = expected_path.sub(/\A#{Regexp.escape(plugins_dir)}\//, '')
      group = plugins_dir.split('/').reduce(project.main_group) do |parent, segment|
        child = parent.children.find { |c| c.respond_to?(:display_name) && c.display_name == segment }
        if child
          # Found by name, but verify — not just assume — its .path actually
          # matches. Reusing a same-named group whose .path is nil or wrong
          # would silently reproduce this exact bug one level up the
          # hierarchy: full_path skips concatenating a mismatched/nil-path
          # group, so the reference would resolve to a shorter path than
          # intended, same failure mode as the original stale reference this
          # code exists to purge.
          child.set_path(segment) unless child.path == segment
        else
          child = parent.new_group(segment)
          child.set_path(segment)
        end
        child
      end
      ref = group.new_reference(relative_path)
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
