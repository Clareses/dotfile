/**
 * The three-level tool grouping: one summary line per assistant segment, one row
 * per call, then the full box. These tests drive the state machine directly —
 * `planFor` is what the render patch asks every frame, and each `frame()` call
 * below replays one render pass over the transcript, top to bottom, the way pi
 * renders it.
 *
 * Tokens: `C3` folded header (`▸ 3 calls`), `V3` open header (`▾ 3 calls`),
 * a leading `|` is the group gutter, `box:x` a full box, `thinking` a carrier.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGroupSummary,
  carrierPlan,
  classifyAssistant,
  noteBoundary,
  planFor,
  resetGroups,
  RUNNING_ROW_DELAY_MS,
  summaryFor,
  takeLateJoin,
  THOUGHT_LIVE_MS,
} from "../tool-groups.ts";
import { agentRunning } from "../live.ts";

interface FakeTool {
  kind: "tool";
  toolName: string;
  toolCallId: string;
  isPartial: boolean;
  expanded: boolean;
  pinned: boolean;
  result: { durationMs?: number };
}

let nextId = 0;

function tool(
  toolName: string,
  extra: Partial<{ isPartial: boolean; expanded: boolean; durationMs: number; pinned: boolean }> = {},
): FakeTool {
  return {
    kind: "tool",
    toolName,
    toolCallId: `call-${++nextId}`,
    isPartial: extra.isPartial ?? false,
    expanded: extra.expanded ?? false,
    pinned: extra.pinned ?? false,
    result: { durationMs: extra.durationMs },
  };
}

/** An always-shown tool (edit/write by default). */
const pinned = (toolName: string) => tool(toolName, { pinned: true });

const boundary = () => ({ kind: "boundary" as const });
/** A tool-only model step; it carries the call that follows it and its thinking. */
const carrier = (carries?: FakeTool, thoughts = 1) => ({
  kind: "carrier" as const,
  ids: carries ? [carries.toolCallId] : [],
  // One run per row; the text only has to differ when a test grows it.
  runs: Array.from({ length: thoughts }, (_unused, i) => `thought ${i}`),
  isStreaming: true,
});
type Entry = FakeTool | ReturnType<typeof boundary> | ReturnType<typeof carrier>;

/**
 * What the screen settles on: one render pass per frame, repeated while the
 * patch would ask pi for another one (a tool joined after its summary drew).
 */
function frame(entries: Entry[]): string[] {
  let out = renderPass(entries);
  for (let i = 0; i < 5 && takeLateJoin(); i++) out = renderPass(entries);
  return out;
}

/** One render pass: what each transcript entry draws, in order. */
function renderPass(entries: Entry[]): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    if (entry.kind === "boundary") {
      noteBoundary(entry);
      out.push("text");
    } else if (entry.kind === "carrier") {
      const plan = carrierPlan(entry, { ids: entry.ids, runs: entry.runs });
      // `plain` is the always-shown-tool interop: pi draws the step itself.
      if (plan.plain) out.push("thinking");
      if (plan.header) out.push(`${plan.header === "open" ? "V" : "C"}${summaryFor(entry)!.count}`);
      if (plan.rows) for (let i = 0; i < entry.runs.length; i++) out.push("|thinking");
    } else {
      const plan = planFor(entry, entry.pinned);
      const bar = plan.gutter ? "|" : "";
      if (plan.header) out.push(`${plan.header === "open" ? "V" : "C"}${summaryFor(entry)!.count}`);
      if (plan.line) out.push(`${bar}B:${entry.toolName}`);
      if (plan.full) out.push(`${bar}box:${entry.toolName}`);
    }
  }
  return out;
}

/** The header click is inert: groups are always open. */
function clickHeader(_anchor: FakeTool): void {}

/** A click on a call's row: that call's box. */
function clickRow(entry: FakeTool): void {
  entry.expanded = true;
}

/** pi's own click on a full box: MouseRegion → setExpanded(!expanded). */
function clickBox(entry: FakeTool): void {
  entry.expanded = !entry.expanded;
}

/** ctrl+o: pi calls setExpanded on every tool box. It never touches the group. */
function ctrlO(entries: Entry[], expanded: boolean): void {
  for (const entry of entries) if (entry.kind === "tool") entry.expanded = expanded;
}

test("summary counts tools, orders by frequency then name, sums durations", () => {
  assert.deepEqual(
    buildGroupSummary([
      { toolName: "bash", isPartial: false, durationMs: 100 },
      { toolName: "read", isPartial: false, durationMs: 50 },
      { toolName: "bash", isPartial: false, durationMs: 25 },
      { toolName: "bash", isPartial: true },
    ]),
    {
      count: 4,
      breakdown: [
        { name: "bash", count: 3 },
        { name: "read", count: 1 },
      ],
      durationMs: 175,
      running: "bash",
      failed: 0,
      jobsRunning: 0,
      thoughts: 0,
      thinking: false,
    },
  );
});

test("classify: visible text is a boundary, a tool-only step is a carrier", () => {
  const text = (t: string) => ({ type: "text", text: t });
  const call = { type: "toolCall", id: "1", name: "bash", arguments: {} };
  const thinking = { type: "thinking", thinking: "hmm" };
  assert.equal(classifyAssistant({ content: [text("Let me look."), call] }), "boundary");
  assert.equal(classifyAssistant({ content: [text("Done.")] }), "boundary");
  assert.equal(classifyAssistant({ content: [call] }), "carrier");
  assert.equal(classifyAssistant({ content: [thinking, call] }), "carrier");
  assert.equal(classifyAssistant({ content: [text("   "), call] }), "carrier");
  // Still thinking, no tool call yet: render it, don't touch the grouping.
  assert.equal(classifyAssistant({ content: [thinking] }), "plain");
  // pi prints "Response was truncated" under a length stop: never fold it away.
  assert.equal(classifyAssistant({ content: [call], stopReason: "length" }), "plain");
  // Field missing (other pi version): fall back to treating it as a boundary.
  assert.equal(classifyAssistant(undefined), "boundary");
});

test("one segment's tools across several tool-only steps stay in one open group", () => {
  resetGroups();
  // pi: assistant(text + call) → tool, assistant(call) → tool, assistant(call) → tool
  const [a, b, c] = [tool("bash"), tool("bash"), tool("bash")];
  const transcript: Entry[] = [boundary(), a, carrier(b), b, carrier(c), c];
  assert.deepEqual(frame(transcript), ["text", "V3", "|B:bash", "|thinking", "|B:bash", "|thinking", "|B:bash"]);
  assert.equal(summaryFor(c)?.count, 3);
});

test("a text-bearing assistant message starts a new group; carriers don't", () => {
  resetGroups();
  const [a, b, c, d] = [tool("bash"), tool("read"), tool("grep"), tool("edit")];
  const transcript: Entry[] = [boundary(), a, carrier(b), b, boundary(), c, carrier(d), d];
  assert.deepEqual(frame(transcript), [
    "text",
    "V2",
    "|B:bash",
    "|thinking",
    "|B:read",
    "text",
    "V2",
    "|B:grep",
    "|thinking",
    "|B:edit",
  ]);
  assert.deepEqual(
    summaryFor(a)?.breakdown.map((e) => e.name),
    ["bash", "read"],
  );
  assert.deepEqual(
    summaryFor(d)?.breakdown.map((e) => e.name),
    ["edit", "grep"],
  );
});

test("re-rendering the transcript every frame keeps the groups", () => {
  resetGroups();
  // The prototype reset every group whenever the *rendered* boundary changed —
  // which is every frame once there are two boundaries. A click then lasted
  // until the next repaint.
  const [a, b, c] = [tool("bash"), tool("read"), tool("bash")];
  const transcript: Entry[] = [boundary(), a, carrier(b), b, boundary(), c];
  frame(transcript);
  assert.deepEqual(frame(transcript), ["text", "V2", "|B:bash", "|thinking", "|B:read", "text", "V1", "|B:bash"]);
});

test("a group opens as rows; a row opens its box; the header never folds it", () => {
  resetGroups();
  const [a, b, c] = [tool("bash"), tool("bash"), tool("bash")];
  const transcript: Entry[] = [boundary(), a, carrier(b), b, carrier(c), c];
  assert.deepEqual(
    frame(transcript),
    ["text", "V3", "|B:bash", "|thinking", "|B:bash", "|thinking", "|B:bash"],
    "N rows under a ▾ header, each step's thinking above its call",
  );

  clickRow(b); // b's box opens; every carrier keeps its row
  assert.deepEqual(frame(transcript), [
    "text",
    "V3",
    "|B:bash",
    "|thinking",
    "|box:bash",
    "|thinking",
    "|B:bash",
  ]);

  clickBox(b);
  assert.deepEqual(frame(transcript), ["text", "V3", "|B:bash", "|thinking", "|B:bash", "|thinking", "|B:bash"]);

  clickHeader(a); // inert
  assert.deepEqual(frame(transcript), ["text", "V3", "|B:bash", "|thinking", "|B:bash", "|thinking", "|B:bash"]);
});

test("the header click never folds the group or its boxes", () => {
  resetGroups();
  const [a, b] = [tool("bash"), tool("read")];
  const transcript: Entry[] = [boundary(), a, carrier(b), b];
  frame(transcript);
  clickRow(a); // the anchor's own row → its box (the header stays above it)
  clickRow(b);
  assert.deepEqual(frame(transcript), ["text", "V2", "|box:bash", "|thinking", "|box:read"]);
  clickHeader(a);
  assert.deepEqual(frame(transcript), ["text", "V2", "|box:bash", "|thinking", "|box:read"]);
});

test("a running call keeps its row and the summary says running", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  resetGroups();
  const a = tool("bash");
  const b = tool("bash", { isPartial: true });
  const transcript: Entry[] = [boundary(), a, carrier(b), b];
  assert.deepEqual(frame(transcript), ["text", "V2", "|B:bash", "|thinking", "|B:bash"]);
  assert.equal(summaryFor(a)?.running, undefined);
  assert.equal(planFor(b).revealIn, undefined, "the row is already there: no repaint to schedule");
  t.mock.timers.tick(RUNNING_ROW_DELAY_MS);
  assert.equal(summaryFor(a)?.running, "bash");

  // The running tool is also the anchor when it's the first call.
  resetGroups();
  const only = tool("bash", { isPartial: true });
  assert.deepEqual(frame([boundary(), only]).slice(1), ["V1", "|B:bash"]);
  only.isPartial = false;
  assert.deepEqual(frame([boundary(), only]).slice(1), ["V1", "|B:bash"]);
});

test("a quick call causes no extra repaints", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  resetGroups();
  const [a, b] = [tool("bash"), tool("process", { isPartial: true })];
  const transcript: Entry[] = [boundary(), a, carrier(b), b];
  const seen: string[][] = [frame(transcript)];
  t.mock.timers.tick(40);
  b.isPartial = false; // finished in 40ms
  seen.push(frame(transcript));
  assert.deepEqual(seen, [
    ["text", "V2", "|B:bash", "|thinking", "|B:process"],
    ["text", "V2", "|B:bash", "|thinking", "|B:process"],
  ]);
});

test("a background job gets its row after its first second, and only while running", () => {
  resetGroups();
  const [a, start] = [tool("bash"), tool("process")];
  const transcript: Entry[] = [boundary(), a, carrier(start), start];
  frame(transcript);
  const now = 50_000;
  const job = (startTime: number, status: "running" | "killed" | "failed" = "running") => ({ status, startTime });
  assert.equal(planFor(start, false, job(now - 200), now).line, true, "the row is there from the start");
  assert.equal(planFor(start, false, job(now - 1200), now).line, true);
  assert.equal(planFor(start, false, job(now - 600, "killed"), now).line, true, "its row shows what it became");
  assert.equal(planFor(start, false, job(now - 600, "failed"), now).line, true, "a failed job's row stays; the count carries it too");
  assert.equal(summaryFor(a, () => job(now - 200), now)?.jobsRunning, 0);
  assert.equal(summaryFor(a, () => job(now - 1200), now)?.jobsRunning, 2);
});

test("a failed call keeps its row and the count carries the failure", () => {
  resetGroups();
  const a = tool("bash", { durationMs: 100 });
  const b = tool("bash", { durationMs: 50 });
  (b.result as { isError?: boolean }).isError = true;
  const transcript: Entry[] = [boundary(), a, carrier(b), b];
  assert.deepEqual(frame(transcript), ["text", "V2", "|B:bash", "|thinking", "|B:bash"]);
  assert.equal(summaryFor(a)?.failed, 1, "the count is where it shows");
  clickRow(b);
  assert.deepEqual(frame(transcript), ["text", "V2", "|B:bash", "|thinking", "|box:bash"]);
});

test("edit/write fold like any call: rows when collapsed, a box when opened", () => {
  resetGroups();
  const [r1, r2, e, b1] = [tool("read"), tool("read"), pinned("edit"), tool("bash")];
  const transcript: Entry[] = [boundary(), r1, carrier(r2), r2, carrier(e), e, carrier(b1), b1];
  assert.deepEqual(frame(transcript), [
    "text",
    "V4",
    "|B:read",
    "|thinking",
    "|B:read",
    "|thinking",
    "|B:edit",
    "|thinking",
    "|B:bash",
  ]);
  assert.equal(summaryFor(r1)?.count, 4, "the edit is a member now");

  // An opened edit is a box of its own in the list.
  resetGroups();
  const e2 = pinned("edit");
  e2.expanded = true;
  assert.deepEqual(frame([boundary(), e2]), ["text", "V1", "|box:edit"]);
});

test("an edit's thinking follows the edit's own expand state", () => {
  resetGroups();
  const [r, e] = [tool("read"), pinned("edit")];
  const transcript: Entry[] = [boundary(), r, carrier(e), e];
  assert.deepEqual(frame(transcript), ["text", "V2", "|B:read", "|thinking", "|B:edit"]);
  assert.equal(summaryFor(r)?.thoughts, 1, "the step is in the group, and its run is a row");
  ctrlO(transcript, true);
  assert.deepEqual(frame(transcript), ["text", "V2", "|box:read", "thinking", "|box:edit"]);
  // pi draws that step itself now (its box, and its thinking with it): the run is
  // no longer a row of this group, so the count must not keep it.
  assert.equal(summaryFor(r)?.thoughts, 0);
  ctrlO(transcript, false);
  frame(transcript);
  assert.equal(summaryFor(r)?.thoughts, 1, "folded back in, it is listed again");
});

test("ctrl+o expands every box, ctrl+o again folds back to the C line", () => {
  resetGroups();
  const [a, b, c] = [tool("bash"), tool("read"), tool("grep")];
  const transcript: Entry[] = [boundary(), a, carrier(b), b, boundary(), c];
  frame(transcript);

  ctrlO(transcript, true);
  // Everything back, thinking included: what pi's own transcript looks like.
  assert.deepEqual(frame(transcript), ["text", "V2", "|box:bash", "|thinking", "|box:read", "text", "V1", "|box:grep"]);

  // Clicking one full box folds only that box into its row.
  clickBox(b);
  assert.deepEqual(frame(transcript), ["text", "V2", "|box:bash", "|thinking", "|B:read", "text", "V1", "|box:grep"]);

  // ctrl+o's collapse-all closes the boxes; the groups stay open.
  ctrlO(transcript, false);
  assert.deepEqual(frame(transcript), [
    "text",
    "V2",
    "|B:bash",
    "|thinking",
    "|B:read",
    "text",
    "V1",
    "|B:grep",
  ]);
});

test("a box born while ctrl+o is on opens its group", () => {
  resetGroups();
  // pi calls setExpanded(toolOutputExpanded) before the first render; the
  // component is unknown then, so the flag is picked up when it joins.
  const a = tool("bash", { expanded: true });
  assert.deepEqual(frame([boundary(), a]), ["text", "V1", "|box:bash"]);
});

test("a tool joining after its group's summary drew asks for one more frame", () => {
  resetGroups();
  const [a, b] = [tool("bash"), tool("read")];
  const transcript: Entry[] = [boundary(), a, carrier(b), b];
  // First pass: the anchor drew "1 call" before b joined.
  assert.deepEqual(renderPass(transcript), ["text", "V1", "|B:bash", "|thinking", "|B:read"]);
  assert.equal(takeLateJoin(), true);
  assert.deepEqual(renderPass(transcript), ["text", "V2", "|B:bash", "|thinking", "|B:read"]);
  assert.equal(takeLateJoin(), false, "settled: no further frames");
});

test("the summary reads live state: a member finishing updates the header at once", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  resetGroups();
  const a = tool("bash", { durationMs: 100 });
  const b = tool("bash", { isPartial: true });
  const transcript: Entry[] = [boundary(), a, carrier(b), b];
  frame(transcript);
  t.mock.timers.tick(RUNNING_ROW_DELAY_MS);
  assert.equal(summaryFor(a)?.running, "bash");
  // b finishes; the anchor renders before b in the next pass and must see it.
  b.isPartial = false;
  b.result.durationMs = 200;
  assert.deepEqual(summaryFor(a), {
    count: 2,
    breakdown: [{ name: "bash", count: 2 }],
    durationMs: 300,
    running: undefined,
    failed: 0,
    jobsRunning: 0,
    thoughts: 1,
    thinking: false,
  });
});

test("tools before any boundary still group", () => {
  resetGroups();
  const [a, b] = [tool("bash"), tool("read")];
  assert.deepEqual(frame([a, b]), ["V2", "|B:bash", "|B:read"]);
});

test("a live thinking run is driven by growth, the open run and the stream flag", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  resetGroups();
  // A restored session: the component already carries its runs, but they never
  // arrived in front of us.
  const restored = { ids: [] as string[], runs: ["旧想法"], isStreaming: true };
  // pi's own steps start empty (`message_start` creates the component with no
  // content) and gain text as the tokens land.
  const step = { ids: [] as string[], runs: [] as string[], isStreaming: true };
  try {
    assert.equal(carrierPlan(restored, { runs: restored.runs }).live, false, "no run: nothing animates");
    agentRunning.set(true);
    assert.equal(
      carrierPlan(restored, { runs: restored.runs }).live,
      false,
      "a new turn must not resurrect old thinking",
    );
    assert.equal(carrierPlan(step, { runs: step.runs }).live, false, "no token yet");
    step.runs = ["先想"];
    assert.equal(carrierPlan(step, { runs: step.runs }).live, true, "the first token starts it");

    // No new token: the run settles on its own, whatever pi's flag says.
    t.mock.timers.tick(THOUGHT_LIVE_MS);
    assert.equal(carrierPlan(step, { runs: step.runs }).live, false);
    // The next token brings it back.
    step.runs = ["先想多一点"];
    assert.equal(carrierPlan(step, { runs: step.runs }).live, true);
    // A settled message stops immediately, even inside the window.
    step.isStreaming = false;
    assert.equal(carrierPlan(step, { runs: step.runs }).live, false);

    // pi leaves `isStreaming` true after a run: the run's end is what stops it.
    step.isStreaming = true;
    step.runs = ["先想多一点，再想一点"];
    assert.equal(carrierPlan(step, { runs: step.runs }).live, true);
    agentRunning.set(false);
    assert.equal(carrierPlan(step, { runs: step.runs }).live, false, "the turn is over");
  } finally {
    agentRunning.set(false);
  }
});

test("a settled run keeps its row and stops the spinner", (t) => {
  t.mock.timers.enable({ apis: ["Date"] });
  resetGroups();
  const a = tool("bash", { durationMs: 100 });
  const b = tool("bash", { durationMs: 50 });
  const step = carrier(b, 1);
  const transcript: Entry[] = [boundary(), a, step, b];
  try {
    agentRunning.set(true);
    const live = frame(transcript);
    assert.deepEqual(live, ["text", "V2", "|B:bash", "|thinking", "|B:bash"]);
    assert.equal(summaryFor(a)?.thinking, true, "and the summary spins");
    t.mock.timers.tick(THOUGHT_LIVE_MS);
    const settled = frame(transcript);
    assert.deepEqual(settled, ["text", "V2", "|B:bash", "|thinking", "|B:bash"], "the row stays");
    assert.equal(summaryFor(a)?.thinking, false);
    assert.equal(summaryFor(a)?.thoughts, 1);
  } finally {
    agentRunning.set(false);
  }
});

test("a boundary's own thinking is not part of the group's count", () => {
  resetGroups();
  const a = tool("bash");
  // The boundary draws its thinking itself, above the text: the group lists
  // nothing for it, so counting it would promise a row that cannot appear.
  noteBoundary(boundary());
  const group = planFor(a);
  assert.equal(group.header, "open");
  assert.equal(summaryFor(a)?.thoughts, 0);
});
