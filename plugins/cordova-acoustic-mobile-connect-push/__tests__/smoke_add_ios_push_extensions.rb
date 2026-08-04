#!/usr/bin/env ruby
# frozen_string_literal: true

# Smoke test for add_ios_push_extensions.rb
#
# Creates a minimal in-memory xcodeproj (App target), runs the script against it,
# and asserts that ConnectNSE + ConnectNCE targets are created with the expected
# build phases and embed wiring. Then runs a second time to verify idempotency.
#
# Run: ruby __tests__/smoke_add_ios_push_extensions.rb
# Requires: xcodeproj gem (ships with CocoaPods)

require 'xcodeproj'
require 'tmpdir'
require 'fileutils'

SCRIPT   = File.expand_path('../src/ios/add_ios_push_extensions.rb', __dir__)
BUNDLE_ID = 'co.acoustic.smoke.test'
VARIANT   = 'AcousticConnectDebug'

abort "Script not found: #{SCRIPT}" unless File.exist?(SCRIPT)

def assert(condition, message)
  if condition
    puts "  ✓ #{message}"
  else
    abort "  ✗ FAILED: #{message}"
  end
end

Dir.mktmpdir('acoustic-smoke-') do |tmp|
  # ── Build minimal xcodeproj ─────────────────────────────────────────────────
  proj_path = File.join(tmp, 'App.xcodeproj')
  proj = Xcodeproj::Project.new(proj_path)
  app_target = proj.new_target(:application, 'App', :ios, '15.1')
  app_target.build_configurations.each do |c|
    c.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = BUNDLE_ID
  end
  proj.save

  # Directories expected by the script (source refs are relative to SRCROOT = tmp)
  {
    'ConnectNSE' => 'NotificationService.swift',
    'ConnectNCE' => 'NotificationViewController.swift',
  }.each do |ext, src|
    dir = File.join(tmp, ext)
    FileUtils.mkdir_p(dir)
    File.write(File.join(dir, src),               "// placeholder\n")
    File.write(File.join(dir, 'Info.plist'),       "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict/></plist>\n")
    File.write(File.join(dir, "#{ext}.entitlements"), "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict/></plist>\n")
  end

  env = {
    'ACOUSTIC_PROJECT_PATH'  => proj_path,
    'ACOUSTIC_APP_TARGET'    => 'App',
    'ACOUSTIC_APP_BUNDLE_ID' => BUNDLE_ID,
    'ACOUSTIC_SDK_VARIANT'   => VARIANT,
  }

  # ── First run ───────────────────────────────────────────────────────────────
  puts "\nRun 1:"
  ok = system(env, 'ruby', SCRIPT, exception: false)
  assert ok, 'script exits 0'

  proj2 = Xcodeproj::Project.open(proj_path)

  %w[ConnectNSE ConnectNCE].each do |name|
    t = proj2.targets.find { |x| x.name == name }
    assert t, "#{name} target exists"

    has_xcfw = t.build_phases.any? { |p| p.respond_to?(:name) && p.name&.include?('xcframeworks') }
    assert has_xcfw, "#{name} has xcframeworks locking script phase"

    src_idx  = t.build_phases.index(t.source_build_phase)
    xcfw_idx = t.build_phases.index { |p| p.respond_to?(:name) && p.name&.include?('xcframeworks') }
    assert xcfw_idx && src_idx && xcfw_idx < src_idx,
           "#{name} xcframeworks phase is before Compile Sources"
  end

  app = proj2.targets.find { |t| t.name == 'App' }
  embed = app.copy_files_build_phases.find { |p| p.symbol_dst_subfolder_spec == :plug_ins }
  assert embed, 'App has Embed Foundation Extensions phase'

  embed_names = embed.files.map(&:display_name)
  %w[ConnectNSE ConnectNCE].each do |name|
    assert embed_names.any? { |n| n.include?(name) }, "#{name} is embedded in App"
  end

  deps = app.dependencies.map { |d| d.name }
  %w[ConnectNSE ConnectNCE].each do |name|
    assert deps.include?(name), "#{name} is a dependency of App"
  end

  # ── Second run (idempotency) ─────────────────────────────────────────────────
  puts "\nRun 2 (idempotency):"
  ok2 = system(env, 'ruby', SCRIPT, exception: false)
  assert ok2, 'second run exits 0'

  proj3 = Xcodeproj::Project.open(proj_path)
  nse_count = proj3.targets.count { |t| t.name == 'ConnectNSE' }
  nce_count = proj3.targets.count { |t| t.name == 'ConnectNCE' }
  assert nse_count == 1, 'no duplicate ConnectNSE target'
  assert nce_count == 1, 'no duplicate ConnectNCE target'

  app3      = proj3.targets.find { |t| t.name == 'App' }
  embed3    = app3.copy_files_build_phases.find { |p| p.symbol_dst_subfolder_spec == :plug_ins }
  embed3_ct = embed3&.files&.count { |f| %w[ConnectNSE ConnectNCE].any? { |n| f.display_name.include?(n) } }
  assert embed3_ct == 2, 'no duplicate embed entries (exactly 2 extension files)'

  # ── Run 3 (SDK variant switch, e.g. useRelease false -> true) ───────────────
  # Regression coverage for: stale "[CP] Prepare <old variant> xcframeworks"
  # phase left behind after a Debug<->Release pod switch, whose xcfilelist no
  # longer exists post-switch and fails the Xcode build outright.
  new_variant = 'AcousticConnect'
  puts "\nRun 3 (SDK variant switch #{VARIANT} -> #{new_variant}):"
  ok3 = system(env.merge('ACOUSTIC_SDK_VARIANT' => new_variant), 'ruby', SCRIPT, exception: false)
  assert ok3, 'third run (variant switch) exits 0'

  proj4 = Xcodeproj::Project.open(proj_path)
  %w[ConnectNSE ConnectNCE].each do |name|
    t = proj4.targets.find { |x| x.name == name }
    xcfw_phases = t.build_phases.select { |p| p.respond_to?(:name) && p.name&.include?('xcframeworks') }
    assert xcfw_phases.length == 1, "#{name} has exactly one xcframeworks phase after variant switch"
    assert xcfw_phases.first.name.include?(new_variant), "#{name}'s xcframeworks phase reflects the new variant (#{new_variant})"
    assert xcfw_phases.none? { |p| p.name.include?(VARIANT) }, "#{name} has no stale #{VARIANT} xcframeworks phase left behind"
  end

  # ── Run 4 (stale ConnectPlugin.swift reference recovery) ────────────────────
  # Regression coverage for a real bug report: after a plugin rm/add cycle, a
  # stale PBXFileReference/PBXBuildFile for ConnectPlugin.swift at the bare
  # parent path ("App/Plugins/ConnectPlugin.swift", missing the per-plugin-id
  # subdirectory the file actually lives in on disk) survived because the
  # previous matching logic only checked basename suffix, not the full path —
  # Xcode then failed the build with "Build input file cannot be found"
  # since no file exists at that stale path. Reproduced end-to-end against a
  # real generated project and confirmed a real xcodebuild fails/succeeds
  # accordingly; this asserts the pbxproj-level recovery in isolation.
  expected_path = 'App/Plugins/co.acoustic.connect.push/ConnectPlugin.swift'

  puts "\nRun 4 (stale ConnectPlugin.swift reference recovery):"
  proj5 = Xcodeproj::Project.open(proj_path)
  app5  = proj5.targets.find { |t| t.name == 'App' }
  sources5 = app5.source_build_phase

  correct_ct = proj5.files.count { |f| f.full_path.to_s == expected_path }
  assert correct_ct == 1, 'exactly one correct ConnectPlugin.swift reference before corruption'

  # Simulate the bug: remove the correct reference, add a stale bare one.
  sources5.files.select { |bf| bf.file_ref && bf.file_ref.path.to_s.include?('ConnectPlugin') }.each do |bf|
    sources5.remove_build_file(bf)
  end
  proj5.files.select { |f| f.full_path.to_s == expected_path }.each(&:remove_from_project)
  plugins_group = proj5.main_group.find_subpath('App/Plugins', false)
  stale_ref = plugins_group.new_reference('ConnectPlugin.swift')
  sources5.add_file_reference(stale_ref)
  proj5.save

  ok4 = system(env.merge('ACOUSTIC_SDK_VARIANT' => new_variant), 'ruby', SCRIPT, exception: false)
  assert ok4, 'fourth run (stale reference recovery) exits 0'

  proj6 = Xcodeproj::Project.open(proj_path)
  app6  = proj6.targets.find { |t| t.name == 'App' }

  matching_refs = proj6.files.select { |f| f.full_path.to_s.end_with?('ConnectPlugin.swift') }
  assert matching_refs.length == 1, 'exactly one ConnectPlugin.swift reference after recovery (stale one purged)'
  assert matching_refs.first.full_path.to_s == expected_path, 'surviving reference is at the correct, full subdirectoried path'

  compile_sources_refs = app6.source_build_phase.files.select { |bf| bf.file_ref && bf.file_ref.full_path.to_s.end_with?('ConnectPlugin.swift') }
  assert compile_sources_refs.length == 1, 'exactly one ConnectPlugin.swift entry in Compile Sources after recovery'
  assert compile_sources_refs.first.file_ref.full_path.to_s == expected_path, 'Compile Sources entry is at the correct, full subdirectoried path'

  # ── Run 5 (idempotency after recovery) ───────────────────────────────────────
  # Guards against a second regression found while fixing this: creating the
  # ConnectPlugin.swift reference via a group per path segment (rather than
  # under the real physical "Plugins" group with the subdirectory embedded in
  # the file's own relative path) produced a virtual, unpathed intermediate
  # group — full_path silently dropped that segment, so every subsequent run
  # saw a "mismatch" and re-purged/re-created the same reference forever.
  puts "\nRun 5 (idempotency after recovery):"
  ok5 = system(env.merge('ACOUSTIC_SDK_VARIANT' => new_variant), 'ruby', SCRIPT, exception: false)
  assert ok5, 'fifth run exits 0'

  proj7 = Xcodeproj::Project.open(proj_path)
  app7  = proj7.targets.find { |t| t.name == 'App' }
  final_refs = proj7.files.select { |f| f.full_path.to_s.end_with?('ConnectPlugin.swift') }
  assert final_refs.length == 1, 'still exactly one ConnectPlugin.swift reference — no re-purge churn on a stable project'
  final_cs = app7.source_build_phase.files.select { |bf| bf.file_ref && bf.file_ref.full_path.to_s.end_with?('ConnectPlugin.swift') }
  assert final_cs.length == 1, 'still exactly one Compile Sources entry — no re-purge churn on a stable project'

  puts "\nAll smoke tests passed.\n"
end
