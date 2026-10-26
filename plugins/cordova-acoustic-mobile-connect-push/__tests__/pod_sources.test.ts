/*
 * Copyright (C) 2026 Acoustic, L.P. All rights reserved.
 *
 * The CocoaPods sources the iOS hooks write, and the pod install they run.
 */

import * as fs from "fs";
import * as path from "path";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const sources = require("../src/ios/hooks/pod_sources.js");

const PODSPECS = "https://github.com/go-acoustic/PodSpecs.git";
const CDN = "https://cdn.cocoapods.org/";
const SPECS = "https://github.com/CocoaPods/Specs.git";
const MIRROR = "https://specs.example.com/mirror.git";

describe("the source list", () => {
  it("is the Acoustic spec repo, then the CDN, then the git Specs repo", () => {
    expect(sources.ACOUSTIC_POD_SOURCES).toEqual([PODSPECS, CDN, SPECS]);
  });

  it("is what plugin.xml declares, in the same order", () => {
    const xml = fs.readFileSync(
      path.join(__dirname, "..", "plugin.xml"),
      "utf8",
    );
    const declared = Array.from(
      xml.matchAll(/<source url="([^"]+)"/g),
      (m) => m[1],
    );
    expect(declared.length).toBeGreaterThan(0);
    expect(declared).toEqual(
      sources.ACOUSTIC_POD_SOURCES.slice(0, declared.length),
    );
  });
});

describe("existingSources", () => {
  it("reads the active source lines of a Podfile, either quote style, and skips comments", () => {
    const podfile = `# source '${MIRROR}'\nsource "${MIRROR}"\n  source '${CDN}'\nplatform :ios, '15.1'`;
    expect(sources.existingSources(podfile, null)).toEqual([MIRROR, CDN]);
  });

  it("adds the sources pods.json lists", () => {
    const podsJson = { sources: { [MIRROR]: { source: MIRROR, count: 1 } } };
    expect(sources.existingSources("", podsJson)).toEqual([MIRROR]);
  });
});

describe("sourceLines", () => {
  it("writes the Acoustic list first, then the other sources once each", () => {
    expect(sources.sourceLines([CDN, MIRROR, MIRROR, `${PODSPECS}`])).toEqual([
      `source '${PODSPECS}'`,
      `source '${CDN}'`,
      `source '${SPECS}'`,
      `source '${MIRROR}'`,
    ]);
  });
});

describe("runPodInstall", () => {
  const fail = (message: string) => {
    throw new Error(message);
  };

  it("runs pod install once, in the iOS folder, when it succeeds", () => {
    const calls: string[] = [];
    sources.runPodInstall(
      "/ios",
      (cmd: string, cwd: string) => {
        calls.push(`${cwd}: ${cmd}`);
      },
      () => undefined,
    );
    expect(calls).toEqual(["/ios: pod install"]);
  });

  it("retries once with --repo-update, so a version newer than the local copy of a git spec repo is found", () => {
    const calls: string[] = [];
    sources.runPodInstall(
      "/ios",
      (cmd: string) => {
        calls.push(cmd);
        if (cmd === "pod install") fail("Unable to find a specification");
      },
      () => undefined,
    );
    expect(calls).toEqual(["pod install", "pod install --repo-update"]);
  });

  it("throws the error of the retry when that fails too", () => {
    expect(() =>
      sources.runPodInstall(
        "/ios",
        (cmd: string) => fail(cmd + " failed"),
        () => undefined,
      ),
    ).toThrow("pod install --repo-update failed");
  });
});
