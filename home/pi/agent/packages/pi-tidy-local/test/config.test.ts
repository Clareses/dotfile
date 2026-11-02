/**
 * Settings: the `tidy` key, and the pre-rename `toolbox` key still honoured.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import os, { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../config.ts";

function withSettings(settings: object, fn: () => void): void {
  const dir = mkdtempSync(join(tmpdir(), "pi-tidy-config-"));
  writeFileSync(join(dir, "settings.json"), JSON.stringify(settings));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = dir;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
}

test("settings come from the `tidy` key", () => {
  withSettings({ tidy: { groupTools: false, bashResultLines: 3 } }, () => {
    const config = loadConfig();
    assert.equal(config.groupTools, false);
    assert.equal(config.bashResultLines, 3);
  });
});

test("thinkingOpen defaults on, and only a boolean turns it off", () => {
  withSettings({}, () => assert.equal(loadConfig().thinkingOpen, true));
  withSettings({ tidy: { thinkingOpen: true } }, () => assert.equal(loadConfig().thinkingOpen, true));
  withSettings({ tidy: { thinkingOpen: "yes" } }, () => assert.equal(loadConfig().thinkingOpen, true));
  withSettings({ tidy: { thinkingOpen: false } }, () => assert.equal(loadConfig().thinkingOpen, false));
});

test("groupOpen defaults on, and only a boolean turns it off", () => {
  withSettings({}, () => assert.equal(loadConfig().groupOpen, true));
  withSettings({ tidy: { groupOpen: false } }, () => assert.equal(loadConfig().groupOpen, false));
  withSettings({ tidy: { groupOpen: "yes" } }, () => assert.equal(loadConfig().groupOpen, true));
});

test("gutterColor defaults to muted and accepts any string", () => {
  withSettings({}, () => assert.equal(loadConfig().gutterColor, "muted"));
  withSettings({ tidy: { gutterColor: "mdLink" } }, () => assert.equal(loadConfig().gutterColor, "mdLink"));
  withSettings({ tidy: { gutterColor: 7 } }, () => assert.equal(loadConfig().gutterColor, "muted"));
});

test("the pre-rename `toolbox` key still works, and `tidy` wins over it", () => {
  withSettings({ toolbox: { icons: false } }, () => assert.equal(loadConfig().icons, false));
  withSettings({ toolbox: { icons: false }, tidy: { icons: true } }, () => assert.equal(loadConfig().icons, true));
});

test("settings use the native home directory when HOME is absent", (t) => {
  const home = mkdtempSync(join(tmpdir(), "pi-tidy-home-"));
  const agentDir = join(home, ".pi", "agent");
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ tidy: { bashResultLines: 23 } }));
  const previousHome = process.env.HOME;
  const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  const mockedHome = t.mock.method(os, "homedir", () => home);
  syncBuiltinESMExports();
  delete process.env.HOME;
  delete process.env.PI_CODING_AGENT_DIR;
  try {
    assert.equal(loadConfig().bashResultLines, 23);
  } finally {
    mockedHome.mock.restore();
    syncBuiltinESMExports();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
    rmSync(home, { recursive: true, force: true });
  }
});

test("no settings file: defaults", () => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(tmpdir(), "pi-tidy-does-not-exist");
  try {
    assert.equal(loadConfig().groupTools, true);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
});

test("user messages default to the frame; an unknown style falls back to it", () => {
  withSettings({ tidy: {} }, () => {
    const config = loadConfig();
    assert.equal(config.userMessageStyle, "frame");
    assert.equal(config.userMessagePaddingY, 1);
    assert.deepEqual(config.userMessageColors, { rail: "accent", rule: "borderMuted" });
  });
  withSettings({ tidy: { userMessageStyle: "rail" } }, () => assert.equal(loadConfig().userMessageStyle, "rail"));
  withSettings({ tidy: { userMessageStyle: "off" } }, () => assert.equal(loadConfig().userMessageStyle, "off"));
  // pre-0.5: `false` left user messages to pi-starline, which no longer draws them.
  withSettings({ tidy: { frameUserMessages: false } }, () => assert.equal(loadConfig().userMessageStyle, "frame"));
  withSettings({ tidy: { userMessageStyle: "boxed" } }, () => assert.equal(loadConfig().userMessageStyle, "frame"));
});

test("user alignment defaults left and accepts only right as an override", () => {
  for (const value of [undefined, "left", "right", "center", 1]) {
    withSettings({ tidy: { userMessageAlign: value } }, () => {
      assert.equal(loadConfig().userMessageAlign, value === "right" ? "right" : "left");
    });
  }
});

test("turn folding and final reply frames are independent opt-in settings", () => {
  for (const mode of ["off", "afterRun", "live", true, "unknown", undefined]) {
    withSettings({ tidy: { collapseTurns: mode, frameFinalReply: true } }, () => {
      const config = loadConfig();
      assert.equal(config.collapseTurns, mode === "afterRun" || mode === "live" ? mode : "off");
      assert.equal(config.frameFinalReply, true);
    });
  }
  withSettings({ tidy: {} }, () => {
    assert.equal(loadConfig().collapseTurns, "off");
    assert.equal(loadConfig().frameFinalReply, false);
  });
});

test("user message padding is clamped and colors merge over the defaults", () => {
  withSettings({ tidy: { userMessagePaddingY: 0, userMessageColors: { rail: "#cba6f7", rule: 3 } } }, () => {
    const config = loadConfig();
    assert.equal(config.userMessagePaddingY, 0);
    assert.deepEqual(config.userMessageColors, { rail: "#cba6f7", rule: "borderMuted" });
  });
  withSettings({ tidy: { userMessagePaddingY: 9 } }, () => assert.equal(loadConfig().userMessagePaddingY, 3));
  withSettings({ tidy: { userMessagePaddingY: -1 } }, () => assert.equal(loadConfig().userMessagePaddingY, 1));
  withSettings({ tidy: { userMessagePaddingY: 1.5 } }, () => assert.equal(loadConfig().userMessagePaddingY, 1));
});
