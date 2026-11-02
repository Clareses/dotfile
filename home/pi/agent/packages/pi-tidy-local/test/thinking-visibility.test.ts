/**
 * Thinking follows pi's own visibility switch, and nothing else: hidden → tidy's
 * one-line label, shown → pi's markdown. A click and Ctrl+T both go through the
 * same per-run map pi uses, so the three can never disagree.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { AssistantMessageComponent, createBashToolDefinition, initTheme, ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";
import { patchToolBoxFrames } from "../tool-frame.ts";
import { resetGroups } from "../tool-groups.ts";

initTheme("dark");
patchToolBoxFrames({ icons: false, groupTools: true });

const W = 90;
const RUN = "先确认一下这个目录里有什么东西，然后再决定下一步怎么做，最后把结论写进结尾标记里。这一段故意写得很长，用来验证预览行真的会截断。";
const strip = (s: string) => s.replace(/\x1b(?:\[[0-9;:?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|_[^\x07]*\x07)/g, "").trimEnd();
const ui = { requestRender: () => {} };
const cwd = process.cwd();
const bashDef = createBashToolDefinition(cwd);

function frame(chat: Container): string[] {
  chat.render(W);
  chat.render(W);
  return chat.render(W).map(strip);
}
const visible = (lines: string[]) => lines.filter((line) => line.trim());
const click = (chat: Container, needle: string, x = 4) => {
  const lines = frame(chat);
  const y = lines.findIndex((line) => line.includes(needle));
  assert.ok(y >= 0, `no row containing ${JSON.stringify(needle)}:\n${lines.join("\n")}`);
  return chat.handleMouse({ type: "click", button: "left", x, y, screenX: x, screenY: y, width: W, height: lines.length } as any);
};

test("hidden: one label row, a click shows pi's text, a click folds it back", () => {
  resetGroups();
  const chat = new Container();
  const message = new AssistantMessageComponent(
    { role: "assistant", content: [{ type: "thinking", thinking: RUN }, { type: "text", text: "Done." }], stopReason: "stop" } as any,
    true,
  );
  chat.addChild(message);

  const hidden = visible(frame(chat));
  assert.ok(hidden.some((line) => line.includes("thinking  先确认一下这个目录")), hidden.join("\n"));
  assert.ok(!hidden.some((line) => line.includes("结尾标记")), `no text while hidden:\n${hidden.join("\n")}`);
  assert.ok(!hidden.some((line) => line.includes("╭")), "and no frame");

  click(chat, "thinking  先确认一下这个目录");
  const shown = visible(frame(chat));
  assert.ok(shown.some((line) => line.includes("结尾标记")), `pi's own text:\n${shown.join("\n")}`);
  assert.ok(!shown.some((line) => /thinking {2}/.test(line)), `the label gives way to the text:\n${shown.join("\n")}`);

  click(chat, "结尾标记");
  assert.ok(visible(frame(chat)).some((line) => line.includes("thinking  先确认一下这个目录")), "folds back");
});

test("shown by pi: no label, just the run", () => {
  resetGroups();
  const chat = new Container();
  chat.addChild(
    new AssistantMessageComponent(
      { role: "assistant", content: [{ type: "thinking", thinking: "想一下。" }, { type: "text", text: "Done." }], stopReason: "stop" } as any,
      false,
    ),
  );
  const lines = visible(frame(chat));
  assert.ok(lines.some((line) => line.trim().startsWith("想一下。")), lines.join("\n"));
  assert.ok(!lines.some((line) => /thinking {2}/.test(line)), lines.join("\n"));
  assert.ok(!lines.some((line) => line.includes("╭")), "no frame");
});

test("ctrl+t folds and unfolds every run", () => {
  resetGroups();
  const chat = new Container();
  const step = new AssistantMessageComponent(
    { role: "assistant", content: [{ type: "thinking", thinking: RUN }, { type: "text", text: "Done." }], stopReason: "stop" } as any,
    false,
  );
  chat.addChild(step);
  assert.ok(visible(frame(chat)).some((line) => line.includes("结尾标记")), "starts as pi draws it");

  // pi's own toggle: flag every message, clear the per-run map.
  step.setHideThinkingBlock(true);
  const folded = visible(frame(chat));
  assert.ok(!folded.some((line) => line.includes("结尾标记")), folded.join("\n"));
  assert.ok(folded.some((line) => line.includes("thinking  先确认一下这个目录")), folded.join("\n"));

  step.setHideThinkingBlock(false);
  assert.ok(visible(frame(chat)).some((line) => line.includes("结尾标记")), "and back again");
});

test("inside a group the run is a row, and a click hangs pi's text under it", () => {
  resetGroups();
  const chat = new Container();
  const tool = new ToolExecutionComponent("bash", "c1", { command: "ls" }, {}, bashDef, ui, cwd);
  tool.setExpanded(false);
  tool.setArgsComplete();
  tool.markExecutionStarted();
  tool.updateResult({ content: [{ type: "text", text: "x" }], isError: false, durationMs: 10 }, false);
  const step = new AssistantMessageComponent(
    { role: "assistant", content: [{ type: "thinking", thinking: RUN }, { type: "toolCall", id: "c1", name: "bash", arguments: {} }], stopReason: "toolUse" } as any,
    true,
  );
  chat.addChild(step);
  chat.addChild(tool);

  assert.deepEqual(visible(frame(chat)), [
    " ▾ 1 call · bash×1 · 1 thought · 0.0s",
    " │ thinking  先确认一下这个目录里有什么东西，然后再决定下一步怎么做…",
    " │ ✓ bash ls                                                                 1 line · 0.0s",
  ]);
  const opened = visible(frame(chat));
  assert.ok(opened.some((line) => line.includes("thinking  先确认一下这个目录")), opened.join("\n"));
  assert.ok(!opened.some((line) => line.includes("结尾标记")), `hidden until clicked:\n${opened.join("\n")}`);

  click(chat, "thinking  先确认一下这个目录");
  const run = visible(frame(chat));
  assert.ok(run.some((line) => line.includes("结尾标记")), `pi's text hangs under the row:\n${run.join("\n")}`);
  assert.ok(!run.some((line) => /thinking {2}/.test(line)), `no label above it:\n${run.join("\n")}`);
});
