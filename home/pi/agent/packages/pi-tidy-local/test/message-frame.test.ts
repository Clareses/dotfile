/**
 * Smoke test for the message-box frame patch: compaction and branch-summary
 * boxes must render with the same rounded, transparent frame as tool boxes,
 * in the configured border color, with no background fill escapes.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

// Minimal theme singleton — getTheme() reads this well-known symbol.
// bg() must emit a real fill sequence so stripBackgroundFills can remove it
// and visibleWidth treats it as zero-width.
const THEME_KEY = Symbol.for("@earendil-works/pi-coding-agent:theme");
(globalThis as any)[THEME_KEY] = {
  fg: (color: string, text: string) => `<fg:${color}>${text}</fg>`,
  bg: (_color: string, text: string) => `\x1b[48;5;60m${text}\x1b[49m`,
  bold: (text: string) => `<b>${text}</b>`,
};

const { patchContainerBoxes, patchMessageBoxes } = await import("../frame.ts");
const { USER_MESSAGE_TIME } = await import("../message-frame.ts");
const {
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  SkillInvocationMessageComponent,
  UserMessageComponent,
} = await import("@earendil-works/pi-coding-agent");
const { Text } = await import("@earendil-works/pi-tui");

const BG_FILL_RE = /\x1b\[48;[0-9;]*m|\x1b\[(?:4[0-7]|10[0-7])m/;

// One distinct fake color per message-box kind — assertions key off these.
const COLORS = {
  user: "userCol",
  compaction: "compCol",
  branch: "branchCol",
  skill: "skillCol",
  custom: "customCol",
};

function fakeMessage() {
  return { tokensBefore: 357695, summary: "summary text" } as any;
}

for (const [name, Component, arg, color, icon] of [
  ["compaction", CompactionSummaryMessageComponent, fakeMessage(), COLORS.compaction, "\u{f066}"],
  ["branch summary", BranchSummaryMessageComponent, fakeMessage(), COLORS.branch, "\u{f126}"],
  ["skill invocation", SkillInvocationMessageComponent, { name: "demo", content: "skill text" }, COLORS.skill, "\u{f0d0}"],
] as const) {
  test(`${name} box gets a rounded transparent frame in its own color`, () => {
    patchMessageBoxes(COLORS, true);
    const component = new (Component as any)(arg);
    const lines: string[] = component.render(60);

    assert.ok(lines.length >= 3, "frame top + content + frame bottom");
    assert.match(lines[0], new RegExp(`^<fg:${color}>╭─+╮</fg>$`), "rounded top border in kind color, no blank row above it");
    assert.match(lines.at(-1)!, new RegExp(`^<fg:${color}>╰─+╯</fg>$`), "rounded bottom border in kind color");
    for (const line of lines.slice(1, -1)) {
      assert.match(line, new RegExp(`^<fg:${color}>│</fg>`), "left border");
      assert.match(line, new RegExp(`<fg:${color}>│</fg>$`), "right border");
    }
    const body = lines.join("\n");
    assert.ok(
      body.includes("[compaction]") || body.includes("[branch]") || body.includes("[skill]"),
      "label kept",
    );
    assert.ok(lines[1].includes(icon), "kind icon on the first content line");
    if (name === "compaction") assert.ok(body.includes("357,695"), "token count kept");
    assert.ok(!BG_FILL_RE.test(body), "no background fill escapes");
  });
}

test("expanded compaction box renders its summary inside the frame", () => {
  patchMessageBoxes(COLORS, true);
  const component = new CompactionSummaryMessageComponent(fakeMessage() as any);
  component.setExpanded(true);
  const lines: string[] = component.render(60);
  const body = lines.join("\n");
  assert.match(lines[0], new RegExp(`^<fg:${COLORS.compaction}>╭─+╮</fg>$`), "still framed when expanded");
  assert.ok(body.includes("summary text"), "summary kept");
});

test("user message gets a frame in the user color and keeps its OSC133 zone markers", () => {
  patchContainerBoxes(COLORS, { icons: true, includeUser: true });
  const component = new UserMessageComponent("hello **world**" as never);
  const lines: string[] = component.render(60);

  assert.match(lines[0], /^\x1b\]133;A\x07/, "zone start on first line");
  assert.match(lines.at(-1)!, /^\x1b\]133;B\x07\x1b\]133;C\x07/, "zone end+final on last line");
  // Issue #29: pi already puts a `Spacer(1)` in front of a user message, so
  // tidy must not add a blank row of its own above the frame.
  assert.match(
    lines[0].replace("\x1b]133;A\x07", ""),
    new RegExp(`^<fg:${COLORS.user}>╭─ `),
    "the top border is the first line",
  );
  assert.ok(lines.some((l) => l.includes(`<fg:${COLORS.user}>╭`)), "rounded top border in user color");
  assert.ok(lines.some((l) => l.includes(`<fg:${COLORS.user}>╰`)), "rounded bottom border in user color");
  assert.ok(lines.join("\n").includes("\u{f007}"), "user icon present");
  assert.ok(lines.join("\n").includes("hello"), "content kept");
  assert.ok(!BG_FILL_RE.test(lines.join("\n")), "no background fill escapes");
});

test("a framed user message hugs its text and carries the user icon in its top border", () => {
  // Zero-width colors for this one: the fake theme's tags would count as text
  // and widen the measured row.
  const tagged = (globalThis as any)[THEME_KEY];
  (globalThis as any)[THEME_KEY] = {
    ...tagged,
    fg: (_color: string, text: string) => `\x1b[36m${text}\x1b[39m`,
    bold: (text: string) => text,
  };
  try {
    patchContainerBoxes(COLORS, { icons: false, includeUser: true });
    const plain = (line: string) => line.replace(/\x1b\][^\x07]*\x07/g, "").replace(/\x1b\[[0-9;]*m/g, "");
    // No blank row above the frame: pi puts a `Spacer(1)` in front of a user
    // message already, and a second one read as a stray gap (issue #29).
    const short = new UserMessageComponent("hi" as never).render(60).map(plain);
    assert.deepEqual(short, ["╭────╮", "│ hi │", "╰────╯"]);

    // With icons the icon sits in the top border, not on the text's row, and
    // the box is never narrower than it needs.
    patchContainerBoxes(COLORS, { icons: true, includeUser: true });
    const iconedShort = new UserMessageComponent("hi" as never).render(60).map(plain);
    assert.deepEqual(iconedShort, ["╭─ \u{f007} ─╮", "│ hi  │", "╰─────╯"]);
    const iconed = new UserMessageComponent("hello there" as never).render(60).map(plain);
    assert.deepEqual(iconed, ["╭─ \u{f007} ─────────╮", "│ hello there │", "╰─────────────╯"]);
    patchContainerBoxes(COLORS, { icons: false, includeUser: true });

    // A long one wraps, and the frame hugs the widest wrapped row, never past 60.
    const long = new UserMessageComponent("word ".repeat(40) as never).render(60).map(plain);
    const widths = long.map((line) => [...line].length);
    assert.ok(widths[0] <= 60 && widths[0] > 50, String(widths[0]));
    assert.ok(widths.every((width) => width === widths[0]), "every row the frame's width");
    assert.ok(long.length > 4, "wrapped onto several rows");
  } finally {
    (globalThis as any)[THEME_KEY] = tagged;
  }
});

test("a user message puts a muted clock next to its icon", () => {
  patchContainerBoxes(COLORS, { icons: true, includeUser: true });
  const component: any = new UserMessageComponent("hi" as never);
  const at = new Date();
  at.setHours(14, 32, 0, 0);
  component[USER_MESSAGE_TIME] = at.getTime();
  const top = component.render(60)[0];
  assert.ok(top.includes("\u{f007}"), "the icon stays");
  assert.ok(top.includes("14:32"), "the clock follows it");
  assert.ok(top.includes("<fg:dim>"), "the clock is muted");
});

test("custom message with default rendering gets a frame in the custom color", () => {
  patchContainerBoxes(COLORS, { icons: true, includeUser: true });
  const component = new CustomMessageComponent({ customType: "notice", content: "pay attention" } as any);
  const lines: string[] = component.render(60);
  assert.ok(lines.some((l) => l.includes(`<fg:${COLORS.custom}>╭`)), "rounded top border in custom color");
  const body = lines.join("\n");
  assert.ok(body.includes("[notice]"), "label kept");
  assert.ok(body.includes("pay attention"), "content kept");
  assert.ok(body.includes("\u{f12e}"), "puzzle icon present");
});

test("custom message with an extension renderer is left alone", () => {
  patchContainerBoxes(COLORS, { icons: true, includeUser: true });
  const renderer = () => new Text("extension-owned styling", 0, 0);
  const component = new CustomMessageComponent(
    { customType: "fancy", content: "ignored" } as any,
    renderer as any,
  );
  const lines: string[] = component.render(60);
  assert.ok(!lines.some((l) => l.includes("╭")), "no frame around renderer output");
  assert.ok(lines.join("\n").includes("extension-owned styling"), "renderer output kept");
});

test("unknown border color falls back to the original render", () => {
  patchMessageBoxes(COLORS, true);
  const component = new CompactionSummaryMessageComponent(fakeMessage() as any);
  (globalThis as any)[THEME_KEY] = {
    fg: () => {
      throw new Error("unknown color");
    },
    bg: (c: string, t: string) => t,
    bold: (t: string) => t,
  };
  const lines: string[] = component.render(60);
  // Original Box render has no rounded border.
  assert.ok(!lines.some((l) => l.includes("╭")), "no frame on fallback");
});
