/**
 * The two one-line renderers. Colors are identity here, so assertions read as
 * plain text and the glyph/argument logic is what gets pinned down.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  formatGroupLine,
  formatThoughtLine,
  formatToolLine,
  previewText,
  summarizeArgs,
  summarizeNestedCalls,
  summarizeResult,
} from "../tool-lines.ts";
import { buildGroupSummary } from "../tool-groups.ts";

const theme = { fg: (_token: string, text: string) => text, bold: (text: string) => text } as any;

test("group line names the count, the per-tool breakdown and the duration", () => {
  const line = formatGroupLine(
    buildGroupSummary([
      { toolName: "bash", isPartial: false, durationMs: 1000 },
      { toolName: "bash", isPartial: false, durationMs: 150 },
      { toolName: "read", isPartial: false, durationMs: 50 },
    ]),
    theme,
    { icons: false },
  );
  assert.equal(line, " ▸ 3 calls · bash×2  read×1 · 1.2s");
});

test("group line reports a running tool instead of a duration", () => {
  const line = formatGroupLine(
    buildGroupSummary([{ toolName: "bash", isPartial: true, durationMs: undefined }]),
    theme,
    { icons: false },
  );
  assert.equal(line, " ▸ 1 call · bash×1 · running bash");
});

test("args summary: heredoc collapses to its first line and counts the rest", () => {
  assert.equal(summarizeArgs("bash", { command: "cd ~ && python3 - <<'PY'\nprint(1)\nPY" }), "cd ~ && python3 - <<'PY' (+2 lines)");
  assert.equal(summarizeArgs("read", { path: "src/app.ts" }), "src/app.ts");
  assert.equal(summarizeArgs("bash", {}), "");
  assert.equal(visibleWidth(summarizeArgs("bash", { command: `echo ${"x".repeat(200)}` })), 60);
  // The `(+N lines)` marker rides behind the budget, it does not eat into it.
  assert.equal(visibleWidth(summarizeArgs("bash", { command: `${`echo ${"x".repeat(200)}`}
more` })), 60 + " (+1 lines)".length);
});

test("a multi-line value is one row, whichever argument it arrives in", () => {
  const script = "() => {\n  const f = document.getElementById('ueditor_1');\n  return f.contentWindow.scrollY;\n}";
  // No `command` key: the summary falls through to the first stringish value.
  assert.equal(summarizeArgs("chrome-devtools_evaluate_script", { function: script }), "() => { (+3 lines)");
  const row = formatToolLine(
    { toolName: "chrome-devtools_evaluate_script", args: { function: script }, isPartial: false, result: { durationMs: 200 } },
    theme,
    { icons: false, width: 120 },
  );
  // A row that carries `\n` is several physical rows to the terminal and one to
  // pi's frame: everything below it painted off by the difference.
  assert.ok(!row.includes("\n"), `row carries a newline: ${JSON.stringify(row)}`);
  assert.match(row, /^ ✓ chrome-devtools_evaluate_script \(\) => \{/u);
});

test("tool line carries the status glyph, name and duration", () => {
  const ok = formatToolLine(
    { toolName: "bash", args: { command: "ls -la" }, isPartial: false, result: { durationMs: 340 } },
    theme,
    { icons: false },
  );
  assert.equal(ok, " ✓ bash ls -la  0.3s");

  const running = formatToolLine({ toolName: "bash", args: { command: "sleep 5" }, isPartial: true }, theme, { icons: false });
  assert.equal(running, " ⋯ bash sleep 5");

  const failed = formatToolLine(
    { toolName: "bash", args: { command: "false" }, isPartial: false, result: { isError: true, durationMs: 10 } },
    theme,
    { icons: false },
  );
  assert.equal(failed, " ✗ bash false  0.0s");
});

test("group line counts failures", () => {
  const line = formatGroupLine(
    buildGroupSummary([
      { toolName: "bash", isPartial: false, durationMs: 100 },
      { toolName: "bash", isPartial: false, durationMs: 100, isError: true },
    ]),
    theme,
    { icons: false },
  );
  assert.equal(line, " ▸ 2 calls · bash×2 · 1 failed · 0.2s");
});

const textResult = (text: string, extra: { isError?: boolean; details?: unknown } = {}) => ({
  content: [{ type: "text", text }],
  ...extra,
});

test("result summary: what each built-in tool produced, in a few words", () => {
  assert.equal(summarizeResult("bash", textResult("a\nb\n\nc")), "3 lines");
  assert.equal(summarizeResult("bash", textResult("")), "", "no output: no note");
  assert.equal(summarizeResult("bash", textResult("boom\n\nCommand exited with code 2", { isError: true })), "exit 2");
  // A truncated result reports the original size, not the shown slice.
  assert.equal(
    summarizeResult("bash", textResult("x\n\n[Showing lines 801-1000 of 1000. Full output: /tmp/o]", { details: { truncation: { truncated: true, totalLines: 1000 } } })),
    "1000 lines",
  );
  assert.equal(summarizeResult("read", textResult("one\ntwo\n\n[Showing lines 1-2 of 40. Use offset=3 to continue.]")), "2 lines");
  assert.equal(summarizeResult("read", textResult("x", { isError: true })), "");
  assert.equal(summarizeResult("grep", textResult("a.ts:1: x\nb.ts:2: x")), "2 matches");
  assert.equal(summarizeResult("grep", textResult("No matches found")), "no matches");
  assert.equal(summarizeResult("find", textResult("a.ts")), "1 file");
  assert.equal(summarizeResult("find", textResult("No files found matching pattern")), "no files");
  assert.equal(summarizeResult("ls", textResult("a\nb/")), "2 entries");
  assert.equal(summarizeResult("ls", textResult("(empty directory)")), "empty");
  assert.equal(summarizeResult("mcp__github__search", textResult("lots")), "", "unknown tools get no note");
  assert.equal(summarizeResult("bash", undefined), "");
});

test("tool line puts the result note before the duration", () => {
  const line = formatToolLine(
    { toolName: "grep", args: { pattern: "TODO" }, isPartial: false, result: { durationMs: 300, ...textResult("a:1\nb:2") } },
    theme,
    { icons: false },
  );
  assert.equal(line, " ✓ grep TODO  2 matches · 0.3s");
});

// ─────────────────────────────────────────────────────────────────────────────
// Failure emphasis: one red, and only where there is something to read
// ─────────────────────────────────────────────────────────────────────────────

const named = { fg: (token: string, text: string) => `<${token}>${text}</${token}>`, bold: (text: string) => text } as any;

test("a folded group's failed count is the only red left", () => {
  const line = formatGroupLine(
    buildGroupSummary([
      { toolName: "bash", isPartial: false, durationMs: 100 },
      { toolName: "bash", isPartial: false, durationMs: 100, isError: true },
    ]),
    named,
    { icons: false },
  );
  // Folded: no row hangs below, so this line has to say it — in red.
  assert.match(line, /<error>1 failed<\/error>/);
  // Open: every failed row carries its own ✗, so the count goes quiet.
  const open = formatGroupLine(
    buildGroupSummary([
      { toolName: "bash", isPartial: false, durationMs: 100 },
      { toolName: "bash", isPartial: false, durationMs: 100, isError: true },
    ]),
    named,
    { icons: false, open: true },
  );
  assert.match(open, /<muted>1 failed<\/muted>/);
  assert.doesNotMatch(open, /<error>/);
});

test("a failure's note is data, not an alarm: `exit 1` goes muted", () => {
  const line = formatToolLine(
    { toolName: "bash", args: { command: "sed -n 1,3p app.css" }, isPartial: false, result: textResult("sed: Is a directory\n\nCommand exited with code 1", { isError: true }) },
    named,
    { icons: false },
  );
  assert.match(line, /<error>✗<\/error>/);
  assert.match(line, /<toolTitle>bash<\/toolTitle>/, "an error with output keeps full contrast");
  assert.match(line, /<muted>exit 1<\/muted>/);
});

test("a failure that printed nothing is dimmed, its glyph stays red", () => {
  const line = formatToolLine(
    { toolName: "bash", args: { command: "test -d apps" }, isPartial: false, result: textResult("(no output)\n\nCommand exited with code 1", { isError: true }) },
    named,
    { icons: false },
  );
  assert.match(line, /<error>✗<\/error>/);
  assert.match(line, /<dim>bash<\/dim>/);
  assert.match(line, /<dim> test -d apps<\/dim>/);
  assert.match(line, /<dim>exit 1<\/dim>/);
  assert.doesNotMatch(line, /<toolTitle>/);
});

test("silence is pi's notices only — a timeout or an abort is worth reading", () => {
  const timeout = formatToolLine(
    { toolName: "bash", args: { command: "sleep 30" }, isPartial: false, result: textResult("Command timed out after 30 seconds", { isError: true }) },
    named,
    { icons: false },
  );
  assert.doesNotMatch(timeout, /<dim>/);
  assert.match(timeout, /<toolTitle>bash<\/toolTitle>/);
});

test("hover adds a › hint to a tool row and turns ▸ into ▶ on the summary", () => {
  const row = formatToolLine(
    { toolName: "read", args: { path: "src/app.ts" }, isPartial: false, result: textResult("a\nb") },
    named,
    { icons: false, hovered: true },
  );
  assert.match(row, /›<\/muted>$/);
  const summary = buildGroupSummary([{ toolName: "bash", isPartial: false, durationMs: 100 }]);
  assert.match(formatGroupLine(summary, named, { icons: false, hovered: true }), /<muted>▶<\/muted>/);
  assert.match(formatGroupLine(summary, named, { icons: false, hovered: true, gutterColor: "accent" }), /<accent>▶<\/accent>/);
  assert.doesNotMatch(formatToolLine(
    { toolName: "read", args: { path: "src/app.ts" }, isPartial: false, result: textResult("a\nb") },
    named,
    { icons: false },
  ), /›/);
});

/**
 * Width tests use the identity theme: `named` emits fake tags, and
 * `visibleWidth` would count those as cells.
 */
const bare = { icons: false };
/** `truncateToWidth` injects an ANSI reset around its ellipsis; drop escapes. */
const text = (line: string) => line.replace(/[[0-9;]*m/g, "");

test("a row spends its width on the command; the metrics give way first", () => {
  const long = {
    toolName: "bash",
    args: { command: "cd /tmp && git clone --depth 1 https://github.com/heyhuynhgiabuu/pi-pretty" },
    isPartial: false,
    result: { ...textResult("a\nb\nc"), durationMs: 1600 },
  };
  // Wide: the command is shown whole, not cut at a fixed 60 cells.
  const wide = text(formatToolLine(long, theme, { ...bare, width: 120 }));
  assert.match(wide, /github\.com\/heyhuynhgiabuu\/pi-pretty {2}3 lines · 1\.6s$/);

  // 90 cells: the arguments stop where the tail begins, and the tail is intact.
  const mid = text(formatToolLine(long, theme, { ...bare, width: 90 }));
  assert.ok(visibleWidth(mid) <= 90, mid);
  assert.match(mid, /… {2}3 lines · 1\.6s$/);

  // Narrow: the command is still readable and the metrics survive.
  const narrow = text(formatToolLine(long, theme, { ...bare, width: 60 }));
  assert.ok(visibleWidth(narrow) <= 60, narrow);
  assert.match(narrow, /^ ✓ bash cd \/tmp && git clone .*… {2}3 lines · 1\.6s$/);

  // Too narrow to say both: the command wins, the numbers go.
  const tiny = text(formatToolLine(long, theme, { ...bare, width: 34 }));
  assert.ok(visibleWidth(tiny) <= 34, tiny);
  assert.match(tiny, /^ ✓ bash cd \/tmp && git clone .*…$/);
  assert.doesNotMatch(tiny, /lines ·/);
});

test("a heredoc's (+N lines) marker is the first thing a narrow row drops", () => {
  const heredoc = {
    toolName: "bash",
    args: { command: "cd ~ && python3 - 'PY'\nprint(1)\nPY" },
    isPartial: false,
    result: { ...textResult("1"), durationMs: 100 },
  };
  assert.match(formatToolLine(heredoc, theme, { icons: false, width: 120 }), /\(\+2 lines\)/);
  const tight = text(formatToolLine(heredoc, theme, { icons: false, width: 30 }));
  assert.doesNotMatch(tight, /\(\+2 lines\)/);
  assert.match(tight, /^ ✓ bash cd ~ && python3/);
});

test("a group's arguments start in one column, whatever the name's length", () => {
  const align = { name: 8, note: 0, duration: 0 };
  const cases = [
    [{ toolName: "codemode", args: { code: "x" }, isPartial: false, result: { durationMs: 1800, details: { calls: [{ name: "bash" }] } } }, "bash×1"],
    [{ toolName: "process", args: { name: "demo-sleeper" }, isPartial: false, result: { durationMs: 3 } }, "demo-sleeper"],
    [{ toolName: "read", args: { path: "a.ts" }, isPartial: false, result: { durationMs: 600 } }, "a.ts"],
  ] as const;
  const rows = cases.map(([row, arg]) => [text(formatToolLine(row, theme, { ...bare, width: 60, align })), arg] as const);
  const column = (row: string, needle: string) => visibleWidth(row.slice(0, row.indexOf(needle)));
  const columns = rows.map(([row, arg]) => column(row, arg));
  assert.ok(columns.every((c) => c > 0), rows.map(([row]) => row).join("\n"));
  assert.equal(new Set(columns).size, 1, rows.map(([row]) => row).join("\n"));
});

test("a thinking row's text starts in the arguments' column", () => {
  const align = { name: 8 };
  const thought = text(formatThoughtLine("consider the layout", theme, { icons: true, align }));
  const tool = text(
    formatToolLine({ toolName: "read", args: { path: "a.ts" }, isPartial: false, result: { durationMs: 1 } }, theme, {
      icons: true,
      align,
    }),
  );
  // Cells, not string indices: a Nerd Font glyph is one cell but two UTF-16 units.
  const column = (row: string, needle: string) => visibleWidth(row.slice(0, row.indexOf(needle)));
  assert.equal(column(thought, "consider"), column(tool, "a.ts"), `${thought}\n${tool}`);
});

test("a group's metrics sit in columns against the row's right edge", () => {
  const one = {
    toolName: "bash",
    args: { command: "ls" },
    isPartial: false,
    result: { ...textResult("a"), durationMs: 1200 },
  };
  const twelve = {
    toolName: "bash",
    args: { command: "pnpm test" },
    isPartial: false,
    result: { ...textResult(Array.from({ length: 12 }, () => "x").join("\n")), durationMs: 100 },
  };
  // What the view measures across the group: `12 lines` and a 4-cell duration.
  const align = { note: 8, duration: 4 };
  const a = text(formatToolLine(one, theme, { ...bare, width: 60, align }));
  const b = text(formatToolLine(twelve, theme, { ...bare, width: 60, align }));

  assert.equal(visibleWidth(a), 60, a);
  assert.equal(visibleWidth(b), 60, b);
  // `1 line` is padded out to `12 lines`, so the ` · ` sits on the same column…
  assert.equal(a.indexOf(" · "), b.indexOf(" · "), `${a}\n${b}`);
  // …and both rows end on their duration, i.e. the same right edge.
  assert.ok(a.endsWith("1.2s"), a);
  assert.ok(b.endsWith("0.1s"), b);
  assert.equal(a.length - "1.2s".length, b.length - "0.1s".length);
});

test("a live preview slides on word breaks, and holds still until it overflows", () => {
  // Short enough to fit: shown whole, nothing slides. This is the first seconds
  // of a step, when the row must not move at all.
  assert.equal(previewText("先看看这个文件", 40, true), "先看看这个文件");

  // Overflowing: the window starts on a word break, never mid-word.
  const text = "alpha beta gamma delta epsilon zeta eta theta";
  const tail = previewText(text, 24, true);
  assert.ok(tail.startsWith("…"), tail);
  const firstWord = tail.slice(1).split(" ")[0] as string;
  assert.ok(text.includes(firstWord), `the window starts at a real word: ${tail}`);
  assert.ok(visibleWidth(tail) <= 24, `${visibleWidth(tail)} <= 24: ${tail}`);
});

test("nested codemode calls are counted by tool, failures included", () => {
  const call = (name: string, status: string) => ({ id: `c/${name}`, name, args: "", status });
  assert.deepEqual(
    summarizeNestedCalls({ calls: [call("bash", "ok"), call("bash", "ok"), call("read", "ok")] }),
    { kinds: "bash×2 read×1", failed: 0, total: 3 },
  );
  assert.deepEqual(
    summarizeNestedCalls({ calls: [call("bash", "ok"), call("bash", "error"), call("read", "cancelled")] }),
    { kinds: "bash×2 read×1", failed: 2, total: 3 },
  );
  assert.deepEqual(summarizeNestedCalls(undefined), { kinds: "", failed: 0, total: 0 });
  assert.deepEqual(summarizeNestedCalls({ calls: [] }), { kinds: "", failed: 0, total: 0 });
  // MCP tools count by server: the tool names alone would fill the row.
  assert.deepEqual(
    summarizeNestedCalls({
      calls: [call("mcp__chrome_devtools__list_pages", "ok"), call("mcp__chrome_devtools__take_screenshot", "ok")],
    }).kinds,
    "chrome_devtools×2",
  );
});

test("a codemode row counts its nested calls instead of quoting the script", () => {
  const details = {
    calls: [
      { id: "c/1", name: "bash", args: '{"command":"pwd"}', status: "ok" },
      { id: "c/2", name: "bash", args: '{"command":"ls"}', status: "ok" },
      { id: "c/3", name: "read", args: '{"path":"a.ts"}', status: "ok" },
    ],
  };
  const row = formatToolLine(
    { toolName: "codemode", args: { code: "const commands = ['pwd']" }, isPartial: false, result: { durationMs: 100, content: [], details } },
    theme,
    { icons: false },
  );
  assert.equal(row, " ✓ codemode bash×2 read×1  0.1s");
});

test("a nested failure shows on a row whose script still succeeded", () => {
  const details = {
    calls: [
      { id: "c/1", name: "bash", args: "", status: "ok" },
      { id: "c/2", name: "bash", args: "", status: "error" },
    ],
  };
  const result = { durationMs: 1400, content: [{ type: "text", text: "Script completed" }], details };
  const row = formatToolLine({ toolName: "codemode", args: { code: "x" }, isPartial: false, result }, theme, { icons: false });
  assert.equal(row, " ✓ codemode bash×2  1 failed · 1.4s");
});

test("a running script counts its calls as they land", () => {
  const details = {
    calls: [
      { id: "c/1", name: "bash", args: "", status: "ok" },
      { id: "c/2", name: "bash", args: "", status: "running" },
    ],
  };
  const row = formatToolLine(
    { toolName: "codemode", args: { code: "x" }, isPartial: true, result: { details } },
    theme,
    { icons: false },
  );
  assert.equal(row, " ⋯ codemode bash×2");
});

test("without nested call details the script's first line comes back", () => {
  // Older pi, or a script that called no tools at all.
  const row = formatToolLine(
    { toolName: "codemode", args: { code: "console.log(1)\nconsole.log(2)" }, isPartial: false, result: { durationMs: 50, content: [] } },
    theme,
    { icons: false },
  );
  assert.equal(row, " ✓ codemode console.log(1) (+1 lines)  0.1s");
});
