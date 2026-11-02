/**
 * The "rail" user message: pi's own `userMessageBg` fill, an accent `│` in
 * front of every row, no rule rows and no icon. pi's Markdown child still does
 * the text.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
let colorMode = "truecolor";
const fakeTheme = {
  fg: (color: string, text: string) => {
    if (color.startsWith("#")) throw new Error(`Unknown theme color: ${color}`);
    return `<fg:${color}>${text}</fg>`;
  },
  bg: (_color: string, text: string) => `\x1b[48;5;60m${text}\x1b[49m`,
  bold: (text: string) => `<b>${text}</b>`,
  getColorMode: () => colorMode,
};
(globalThis as any)[THEME_KEY] = fakeTheme;

const { patchUserMessages, patchContainerBoxes } = await import("../frame.ts");
const { tidyEnabled } = await import("../live.ts");
const { UserMessageComponent } = await import("@earendil-works/pi-coding-agent");

const BG_FILL_RE = /\x1b\[48;[0-9;]*m|\x1b\[(?:4[0-7]|10[0-7])m/;
const ZONE_START = "\x1b]133;A\x07";
const ZONE_END = "\x1b]133;B\x07\x1b]133;C\x07";
const W = 40;

const RAIL = { style: "rail", railColor: "railCol", ruleColor: "ruleCol", paddingY: 1, icons: false } as const;
const USER_ICON = "\u{f007}";

function plain(line: string): string {
  return line.replace(/\x1b\][^\x07]*\x07/g, "").replace(/<\/?[^>]+>/g, "").replace(/\x1b\[[0-9;]*m/g, "");
}

test("a short message: pi's fill, the rail, padding rows and no rules or icon", () => {
  patchUserMessages(RAIL);
  const lines: string[] = new UserMessageComponent("hi" as never).render(W);

  assert.equal(lines.length, 3, "pad, text, pad");
  assert.ok(lines[0].startsWith(`${ZONE_START}\x1b[48;5;60m<fg:railCol>│</fg>`), lines[0]);
  assert.ok(lines.at(-1)!.startsWith(ZONE_END), "OSC 133 zone on the last line");
  assert.equal(plain(lines[1]).trimEnd(), "│ hi");
  assert.ok(lines[1].includes("\x1b[48;5;60m<fg:railCol>│</fg>\x1b[49m"), "rail rides pi's fill");
  assert.ok(!lines.join("").includes("ruleCol"), "no rule rows");
  assert.ok(!lines.join("").includes(USER_ICON), "no icon");
  assert.ok(BG_FILL_RE.test(lines.join("\n")), "the background fill is kept");
});

test("paddingY 0 drops the background rows", () => {
  patchUserMessages({ ...RAIL, paddingY: 0 });
  const lines: string[] = new UserMessageComponent("hi" as never).render(W);
  assert.equal(lines.length, 1);
  assert.equal(plain(lines[0]).trimEnd(), "│ hi");
});

test("multi-line markdown keeps its rows and every row carries the rail", () => {
  patchUserMessages({ ...RAIL, paddingY: 0 });
  const lines: string[] = new UserMessageComponent("first\n\n- one\n- two" as never).render(W);
  const body = lines.map(plain);
  assert.ok(body.every((l) => l.startsWith("│ ")), "rail on every content row");
  assert.ok(body.some((l) => l.includes("first")));
  assert.ok(body.some((l) => l.includes("one")) && body.some((l) => l.includes("two")));
});

test("registered markdown transformers still run", () => {
  patchUserMessages({ ...RAIL, paddingY: 0 });
  // Short: the fake theme's tags count as visible text, so long rows wrap.
  const transformer = (markdown: string) => `${markdown} (t)`;
  const component = new (UserMessageComponent as any)("hi", undefined, 1, [transformer]);
  assert.ok(component.render(W).map(plain).join("\n").includes("hi (t)"));
});

test("icons are ignored: the rail style never draws the user icon", () => {
  patchUserMessages({ ...RAIL, paddingY: 0, icons: true });
  const lines: string[] = new UserMessageComponent("hi" as never).render(W);
  assert.ok(!lines.join("").includes(USER_ICON));
  assert.equal(plain(lines[0]).trimEnd(), "│ hi");
});

test("hex colors paint truecolor, or the nearest 256-color entry in 256-color mode", () => {
  patchUserMessages({ ...RAIL, railColor: "#cba6f7", paddingY: 0 });
  const truecolor: string[] = new UserMessageComponent("hi" as never).render(W);
  assert.ok(truecolor[0].includes("\x1b[38;2;203;166;247m│\x1b[39m"), truecolor[0]);

  colorMode = "256color";
  try {
    const indexed: string[] = new UserMessageComponent("hi" as never).render(W);
    assert.ok(indexed[0].includes("\x1b[38;5;183m│"), indexed[0]);
  } finally {
    colorMode = "truecolor";
  }
});

test("an unknown color name leaves the cell unpainted instead of breaking the render", () => {
  patchUserMessages({ ...RAIL, railColor: "#nothex", paddingY: 0 });
  const lines: string[] = new UserMessageComponent("hi" as never).render(W);
  assert.equal(plain(lines[0]).trimEnd(), "│ hi");
});

test("an unchanged message hits the cache; new options do not", () => {
  patchUserMessages(RAIL);
  const component = new UserMessageComponent("hi" as never);
  const first = component.render(W);
  assert.strictEqual(component.render(W), first, "same array on a hit");
  patchUserMessages({ ...RAIL, paddingY: 0 });
  assert.equal(component.render(W).length, 1, "padding change re-renders");
  patchUserMessages({ ...RAIL, paddingY: 0, railColor: "otherCol" });
  assert.ok(component.render(W)[0].includes("<fg:otherCol>│"), "color change re-renders");
});

test("off, frame and tidy.enabled: false all pass through to the render underneath", () => {
  patchUserMessages({ ...RAIL, style: "off" });
  assert.ok(!new UserMessageComponent("hi" as never).render(W).some((l) => l.includes("railCol")), "off");

  patchUserMessages({ ...RAIL, style: "frame" });
  patchContainerBoxes({ user: "userCol", custom: "customCol" }, { includeUser: true });
  const framed: string[] = new UserMessageComponent("hi" as never).render(W);
  assert.ok(framed.some((l) => l.includes("<fg:userCol>╭")), "frame style draws the rounded frame");
  assert.ok(!framed.some((l) => l.includes("railCol")), "and no rail");

  patchContainerBoxes({ user: "userCol", custom: "customCol" }, { includeUser: false });
  patchUserMessages(RAIL);
  tidyEnabled.set(false);
  try {
    assert.ok(!new UserMessageComponent("hi" as never).render(W).some((l) => l.includes("railCol")), "disabled");
  } finally {
    tidyEnabled.set(true);
  }
  assert.ok(new UserMessageComponent("hi" as never).render(W)[0].includes("railCol"), "rail again once re-enabled");
});

test("pi's OSC 133 markers stay on the first and last line only", () => {
  patchUserMessages(RAIL);
  const lines: string[] = new UserMessageComponent("a\n\nb" as never).render(W);
  assert.ok(lines[0].startsWith(ZONE_START) && lines.at(-1)!.startsWith(ZONE_END));
  assert.ok(lines.slice(1, -1).every((l) => !l.includes("\x1b]133;")), "no markers in between");
});
