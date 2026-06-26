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

  puts "\nAll smoke tests passed.\n"
end
