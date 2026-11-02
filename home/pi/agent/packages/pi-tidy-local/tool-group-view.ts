/**
 * How a tool box looks and reacts while it belongs to a group (tool-groups.ts
 * owns the state; this file turns a `ViewPlan` into lines and clicks):
 *
 *    ▸ 3 calls ·  bash×3 · 1 failed · 0.5s     header, carried by the first member
 *    │ ⋯ bash  pnpm test                      a row (only a running call shows while folded)
 *    │ ╭──────────────╮                       a full box, three cells in
 *
 * Also installs the boundary hooks on the message components, which is where
 * the groups get cut.
 */

import { stripVTControlCharacters } from "node:util";
import { MouseRegion, Text, truncateToWidth, TuiAltScreen, visibleWidth, Container, type TuiMouseEvent } from "@earendil-works/pi-tui";
import { AssistantMessageComponent, CustomMessageComponent, UserMessageComponent } from "@earendil-works/pi-coding-agent";
import {
  ANIMATE_MS, closeJobDetails, jobDetails, jobForTool, jobsForTool, noteJobMessage,
  spinnerFrame, toggleJobDetails, type JobDetails, type JobState,
} from "./background-jobs.ts";
import { padToWidth } from "./frame-draw.ts";
import { tidyEnabled } from "./live.ts";
import { presentTurn, TURN_LAYOUT } from "./turn-view.ts";
import { folded, turnFor, turnOptions } from "./turn-state.ts";
import { toggleCodemodeSection, type CodemodeSection } from "./codemode-body.ts";
import { getTheme, type ThemeLike } from "./theme-access.ts";
import { trimBlankEdges } from "./frame-draw.ts";
import {
  formatGroupLine,
  formatThoughtLine,
  formatToolLine,
  formatJobLine,
  GUTTER_CELLS,
  groupGutter,
  formatDuration,
  previewText,
  summarizeResult,
  THOUGHT_LABEL_CELLS,
  THOUGHT_TICK_MS,
} from "./tool-lines.ts";
import {
  carrierPlan,
  classifyAssistant,
  closeGroup,
  currentGroupHasMembers,
  groupMembers,
  groupIsOpen,
  RUNNING_ROW_DELAY_MS,
  noteBoundary,
  noteThinking,
  releaseCarrier,
  thinkingState,
  openGroup,
  planFor,
  summaryFor,
  takeLateJoin,
  thinkingRuns,
  toolCallIds,
  type ViewPlan,
} from "./tool-groups.ts";

/** The slice of ToolExecutionComponent the group view reads. */
export interface GroupedTool {
  toolName: string;
  toolCallId?: string;
  args?: unknown;
  isPartial: boolean;
  expanded: boolean;
  result?: { isError?: boolean; durationMs?: number; content?: unknown; details?: unknown };
  imageComponents?: unknown[];
  ui?: { requestRender?(): void };
  setExpanded(expanded: boolean): void;
}

/**
 * Cells a grouped full box is shifted right by: the gutter plus a space. Boxes
 * with images skip the gutter — their lines carry graphics payloads that must
 * start at the left edge.
 */
function boxIndent(tool: GroupedTool, plan: ViewPlan): number {
  return plan.gutter && !(tool.imageComponents?.length ?? 0) ? GUTTER_CELLS + 1 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hover
//
// `move` packets (1003 all-motion tracking, which pi enables outside tmux) are
// routed to the component under the pointer even with no button down, so a
// folded row can react to the pointer without a click. The row handler never
// consumes the event: pi still gets it for text selection, and the repaint is
// requested directly.
// ─────────────────────────────────────────────────────────────────────────────

export type HoverRow = "header" | "turn-header" | "row" | `job:${string}` | `codemode:${CodemodeSection}`;

/**
 * `ui` is kept as the object, not its `requestRender`: pi's TUI is a class, so
 * an extracted method would lose `this`.
 */
type Renderer = { requestRender?(): void };
let hoverState: { tool: object | null; row: HoverRow | null; ui?: Renderer } = { tool: null, row: null };
/** Set by a row that wants this packet; the alt-screen wrapper clears otherwise. */
let hoverClaimed = false;
/** Only tracked once the clear hook is in place — a stale band is worse than none. */
let hoverTracking = false;

/** Next render pass: which row of which tool the pointer is on, if any. */
function setHover(tool: object | null, row: HoverRow | null, ui?: Renderer): boolean {
  if (hoverState.tool === tool && hoverState.row === row) {
    if (ui) hoverState.ui = ui;
    return false;
  }
  hoverState = { tool, row, ui: ui ?? hoverState.ui };
  return true;
}

/** The pointer left our rows (or the app): drop the band and repaint it away. */
function clearHover(): boolean {
  if (!hoverState.tool) return false;
  hoverState = { tool: null, row: null, ui: hoverState.ui };
  hoverState.ui?.requestRender?.();
  return true;
}

/** The alt screen that routes the packets: its renderer is the one that repaints. */
let hoverRenderer: { requestRender?(): void } | undefined;

/** Repaint after the pointer entered or left a row that is not a tool row. */
export function requestHoverRender(): void {
  lastUi?.requestRender?.();
  hoverRenderer?.requestRender?.();
}

/**
 * Turn rows share this state with the tool rows: one source for the band, the
 * hand and the clear-on-leave hook. Only claim while move tracking is live.
 */
export function claimHover(target: object | null, row: HoverRow | null): boolean {
  if (!hoverTracking) return false;
  if (row) hoverClaimed = true;
  return setHover(row ? target : null, row);
}

/** Whether the pointer is on this component's row, after the leave hook ran. */
export function isRowHovered(target: object, row: HoverRow): boolean {
  return hoverState.tool === target && hoverState.row === row;
}

/** A codemode body's fold row the pointer is on, if that is where it is. */
export function codemodeHover(tool: object): CodemodeSection | undefined {
  if (hoverState.tool !== tool) return undefined;
  const row = hoverState.row;
  return row?.startsWith("codemode:") ? (row.slice("codemode:".length) as CodemodeSection) : undefined;
}

/** A full-width band behind the row: the whole row is the click target. */
export function hoverBand(line: string, width: number, theme: ThemeLike): string {
  const padded = padToWidth(line, width);
  return theme.bg ? theme.bg("selectedBg", padded) : padded;
}

const HOVER_HOOK = Symbol.for("pi-toolbox:hover-hook");

/**
 * OSC 22, the pointer shape, in CSS's cursor names (Ghostty, kitty, foot,
 * WezTerm). A lit row is a click target, so it gets the hand. `default` is the
 * arrow a terminal shows while mouse tracking is on — the shape pi runs under —
 * so it is what the pointer goes back to. Terminals without OSC 22 ignore both.
 */
const POINTER_SHAPE = "\x1b]22;pointer\x1b\\";
const DEFAULT_SHAPE = "\x1b]22;default\x1b\\";
/** What the terminal was last told, so a move along the same row writes nothing. */
let pointerShown = false;

type TerminalLike = { write?(data: string): void } | undefined;

function syncPointer(terminal: TerminalLike, lit: boolean): void {
  if (lit === pointerShown || typeof terminal?.write !== "function") return;
  pointerShown = lit;
  terminal.write(lit ? POINTER_SHAPE : DEFAULT_SHAPE);
}

/**
 * Every mouse packet goes through the alt screen. Watching it is what makes
 * hover honest: a pointer that moves off our rows — onto the editor, a message,
 * the scrollbar — produces no event for us at all, so without this hook the
 * last row would stay lit forever. No hook, no hover.
 *
 * The pointer shape follows the band: a hand while a row is lit, the arrow
 * again once nothing is.
 */
export function installHoverTracking(): void {
  const proto = (TuiAltScreen as unknown as { prototype?: Record<PropertyKey, any> })?.prototype;
  if (!proto || proto[HOVER_HOOK]) return;
  const original = proto.handleMouseEvent;
  if (typeof original !== "function") return;
  proto.handleMouseEvent = function (this: { terminal?: TerminalLike; requestRender?(): void }, raw: unknown) {
    hoverRenderer = this;
    hoverClaimed = false;
    const result = original.call(this, raw);
    if (!hoverClaimed && clearHover()) requestHoverRender();
    syncPointer(this.terminal, hoverState.tool !== null);
    return result;
  };
  // Leaving the alt screen (exit, suspend, an external editor) must not leave
  // the hand behind. It goes first: once pi turns mouse tracking off, Ghostty
  // puts its own text cursor back, and an arrow written after that would stick.
  const stop = proto.beforeTerminalStop;
  if (typeof stop === "function") {
    proto.beforeTerminalStop = function (this: { terminal?: TerminalLike }, ...args: unknown[]) {
      syncPointer(this.terminal, false);
      return stop.apply(this, args);
    };
  }
  proto[HOVER_HOOK] = true;
  hoverTracking = true;
}

/** Test seam: pretend the packets are being watched. */
export function enableHoverForTests(): void {
  hoverTracking = true;
}

/** Test seam: pretend nothing is watching the packets. */
export function disableHoverForTests(): void {
  hoverTracking = false;
}

/** Test seam: forget what is hovered. */
export function resetHover(): void {
  hoverState = { tool: null, row: null };
  hoverClaimed = false;
  pointerShown = false;
}

/**
 * The tool's lines while grouping is on, or `undefined` when it is an
 * always-shown tool and should render as a plain box.
 */
export function renderGroupedTool(
  tool: GroupedTool,
  width: number,
  theme: ThemeLike,
  options: { icons: boolean; pinned: boolean },
  frameBox: (width: number, unframed?: boolean) => string[],
): string[] | undefined {
  // Another extension may have patched a boundary render on top of ours
  // since; re-wrap so the boundaries keep being seen.
  installGroupBoundaries();
  nestedRowSpans.delete(tool);
  codemodeSpans.delete(tool);
  const job = options.pinned ? undefined : jobForTool(tool);
  const jobs = options.pinned ? [] : jobsForTool(tool);
  if (tool.ui) lastUi = tool.ui;
  const now = Date.now();
  const plan = planFor(tool, options.pinned, runningJob(jobs) ?? job, now);
  if (takeLateJoin()) tool.ui?.requestRender?.();
  if (plan.revealIn !== undefined) scheduleReveal(tool, plan.revealIn);
  if (!plan.header && !plan.gutter) return undefined;

  const { icons } = options;
  const lines: string[] = [];
  const hovered = hoverState.tool === tool ? hoverState.row : null;
  if (plan.header) {
    const line = groupHeaderLine(tool, plan.header, theme, width, icons, hovered === "header", now);
    if (line !== undefined) lines.push(line);
  }
  const gutter = groupGutter(theme, gutterColorFor());
  if (plan.line || plan.full) {
    const spinner = job ? spinnerFrame(job) : undefined;
    // The tick costs two cells more than the rail does.
    const rowWidth = width - GUTTER_CELLS - (plan.full ? 2 : 0);
    const row = formatToolLine(tool, theme, { icons, job, spinner, hovered: hovered === "row", width: rowWidth, align: groupAlign(tool) });
    // An opened call keeps its row — it does not turn into something else — and
    // takes a tick off the rail to show what hangs below it.
    const line = plan.full ? `${tickGutter(theme)} ${row.trimStart()}` : gutter + row;
    lines.push(hovered === "row" ? hoverBand(line, width, theme) : truncateToWidth(line, width, "…"));
  }
  if (plan.full) {
    // A codemode body keeps the rail: it is a call list with its own fold rows.
    // Every other call opens into a box of its own, under the row that opened
    // it: the border carries the command/path, the body the output only.
    const asRail = (tool as { toolName?: string }).toolName === "codemode";
    const body = asRail
      ? frameBox(Math.max(4, width - BODY_INDENT), true)
      : frameBox(Math.max(4, width), false);
    const base = lines.length;
    const toggles = (tool as { __codemodeToggles?: Array<{ row: number; section: string }> }).__codemodeToggles ?? [];
    for (const [index, line] of body.entries()) {
      if (!asRail) {
        lines.push(line);
        continue;
      }
      const out = `${gutter}${BODY_PAD}${line.trimEnd()}`;
      const section = toggles.find((toggle) => toggle.row === index)?.section;
      lines.push(section !== undefined && hovered === `codemode:${section}` ? hoverBand(out, width, theme) : out);
    }
    // A codemode body folds its script and output to one row each; those rows
    // answer their own clicks (see routeGroupedMouse).
    codemodeSpans.set(
      tool,
      toggles.map((toggle) => ({ row: base + toggle.row, section: toggle.section as CodemodeSection })),
    );
  }
  // Nested starts belong to the wrapper, but do not replace its result/error.
  // Keep them below its body so the body's existing click geometry is unchanged.
  // An opened box hangs them inside the body instead: they are what the script
  // produced, on the same rail as its call rows and its output.
  const inBody = plan.full;
  const rowPad = inBody ? `${gutter}${BODY_PAD}${theme.fg(gutterColorFor(), "│")} ` : `${gutter}  `;
  const detailPad = inBody ? `${gutter}${BODY_PAD}${theme.fg(gutterColorFor(), "│")}     ` : `${gutter}      `;
  const spans: NestedRowSpan[] = [];
  const open = groupIsOpen(tool);
  for (const nested of jobs) {
    if (nested === job) continue;
    const details = jobDetails(nested.id);
    if (!open && !details && (nested.status !== "running" || now - (nested.startTime ?? now) < RUNNING_ROW_DELAY_MS)) continue;
    const from = lines.length;
    const hot = hovered === `job:${nested.id}`;
    const arrow = details ? "▾" : hot ? "▶" : "▸";
    const row = formatJobLine({ toolName: "process", isPartial: false }, nested, theme, icons, spinnerFrame(nested, now));
    const line = `${rowPad}${theme.fg("muted", arrow)}${row}`;
    lines.push(hot ? hoverBand(line, width, theme) : truncateToWidth(line, width, "…"));
    if (details) {
      for (const body of renderJobDetails(nested, details, theme)) {
        lines.push(truncateToWidth(`${detailPad}${body}`, width, "…"));
      }
    }
    spans.push({ id: nested.id, from, to: lines.length - 1 });
  }
  nestedRowSpans.set(tool, spans);
  return lines;
}

interface NestedRowSpan { id: string; from: number; to: number }
const nestedRowSpans = new WeakMap<object, NestedRowSpan[]>();

/** A codemode body's fold labels: one clickable row each. */
export interface CodemodeRowSpan {
  row: number;
  section: CodemodeSection;
}
const codemodeSpans = new WeakMap<object, CodemodeRowSpan[]>();

/** The fold row at `y`, if there is one. */
export function codemodeFoldAt(rows: readonly CodemodeRowSpan[] | undefined, y: unknown): CodemodeRowSpan | undefined {
  return typeof y === "number" ? rows?.find((span) => span.row === y) : undefined;
}

/**
 * A packet on a codemode fold row, grouped or framed: a click opens or shuts
 * that section, motion lights the row. Presses and drags stay pi's: the row is
 * text like any other.
 */
export function routeCodemodeFold(tool: GroupedTool, event: any, section: CodemodeSection): unknown {
  const click = event?.type === "click" && (event.button === "left" || event.button === 0);
  if (click) {
    toggleCodemodeSection(tool, section);
    (tool as { invalidate?(): void }).invalidate?.();
    tool.ui?.requestRender?.();
    return { handled: true };
  }
  if (event?.type === "move" && hoverTracking) {
    hoverClaimed = true;
    if (setHover(tool, `codemode:${section}`, tool.ui)) tool.ui?.requestRender?.();
  }
  return undefined;
}

/** Logs are plain text here: no cursor moves, OSC payloads, tabs or embedded rows. */
function jobText(text: string): string {
  return stripVTControlCharacters(text).replace(/[\x00-\x1f\x7f-\x9f]/g, " ");
}

function renderJobDetails(job: JobState, details: JobDetails, theme: ThemeLike): string[] {
  const lines = [theme.fg("muted", `id: ${jobText(job.id)}`)];
  if (details.command) lines.push(theme.fg("toolOutput", `$ ${jobText(details.command)}`));
  if (details.cwd) lines.push(theme.fg("muted", `cwd: ${jobText(details.cwd)}`));
  if (!details.logs) lines.push(theme.fg("muted", "Logs unavailable."));
  else if (details.logs.length === 0) lines.push(theme.fg("muted", "No output yet."));
  else for (const entry of details.logs) {
    lines.push(theme.fg(entry.type === "stderr" ? "error" : "toolOutput", `${entry.type}: ${jobText(entry.text)}`));
  }
  return lines;
}

function closeGroupJobDetails(component: object): void {
  for (const member of groupMembers(component)) closeJobDetails(jobsForTool(member as GroupedTool).map((job) => job.id));
}

function runningJob(jobs: JobState[]): JobState | undefined {
  return jobs.filter((job) => job.status === "running").sort((a, b) => (a.startTime ?? Infinity) - (b.startTime ?? Infinity))[0];
}

/**
 * The note and duration columns for a group: the widest of each, so every row
 * pads to the same width and the metrics line up down the block. Recomputed
 * when the group's membership changes, not per row — `summarizeResult` walks a
 * result's whole output, and doing that once per row would be quadratic.
 */
const alignCache = new WeakMap<readonly object[], { count: number; name: number; note: number; duration: number }>();

function groupAlign(anchor: object): { name: number; note: number; duration: number } {
  const members = groupMembers(anchor);
  const cached = alignCache.get(members);
  if (cached && cached.count === members.length) return cached;
  let name = 0;
  let note = 0;
  let duration = 0;
  for (const member of members) {
    name = Math.max(name, visibleWidth(member.toolName));
    note = Math.max(note, visibleWidth(summarizeResult(member.toolName, member.result)));
    duration = Math.max(duration, visibleWidth(formatDuration(member.result?.durationMs ?? 0)));
  }
  // One long MCP name would push every argument out of reach; past the cap the
  // column stops growing and those rows keep one space after their name.
  name = Math.min(name, NAME_COLUMN_MAX);
  const entry = { count: members.length, name, note, duration };
  alignCache.set(members, entry);
  return entry;
}

/** Cells the tool-name column may take before an argument column stops paying off. */
const NAME_COLUMN_MAX = 14;

/**
 * The rail with a tick: `├─`. Used by an opened call's row, whose output hangs
 * below it — the horizontal line is what points at the row the block belongs to.
 */
function tickGutter(theme: ThemeLike): string {
  // The same colour as the rail it interrupts, so an opened call still reads as
  // part of one continuous line.
  return ` ${theme.fg(gutterColorFor(), "├─")}`;
}

/** Cells an opened call's body is pushed in by, under its row: the rail plus three. */
const BODY_INDENT = GUTTER_CELLS + 3;
const BODY_PAD = "   ";

/**
 * The group's summary line. Carried by the first member — or by a leading
 * carrier, which renders before that member does (see `carrierPlan`).
 */
function groupHeaderLine(
  anchor: object,
  header: "closed" | "open",
  theme: ThemeLike,
  width: number,
  icons: boolean,
  hovered: boolean,
  now: number,
): string | undefined {
  const jobs: JobState[] = [];
  const summary = summaryFor(
    anchor,
    (member) => {
      const owned = jobsForTool(member as GroupedTool);
      jobs.push(...owned);
      return owned;
    },
    now,
  );
  if (!summary) return undefined;
  // One spinner for the row: a running job, or a thought still arriving.
  const spinner = summary.thinking ? thinkingSpinner(now) : groupSpinner(jobs);
  const thinkingColor = thinkingColorFor();
  const gutterColor = gutterColorFor();
  // Every group's line is drawn on every frame, and building it costs more
  // than it looks: `truncateToWidth` walks a styled row with icons grapheme by
  // grapheme even when it fits. The line is a function of these fields only.
  const key = [
    summary.count,
    summary.breakdown.map(({ name, count }) => `${name}×${count}`).join(" "),
    summary.thoughts,
    summary.thinking,
    summary.durationMs,
    summary.running ?? "",
    summary.failed,
    summary.jobsRunning,
    header,
    spinner,
    hovered,
    width,
    icons,
    thinkingColor,
    gutterColor,
    theme.fg("accent", "·"),
  ].join("\u0000");
  const cached = headerLines.get(anchor);
  if (cached?.key === key) return cached.line;
  const formatted = formatGroupLine(summary, theme, {
    icons,
    open: header === "open",
    spinner,
    thinkingColor,
    gutterColor,
    hovered,
  });
  const line = hovered ? hoverBand(formatted, width, theme) : truncateToWidth(formatted, width, "…");
  headerLines.set(anchor, { key, line });
  return line;
}

/** The summary line each anchor drew last, keyed by everything that went into it. */
const headerLines = new WeakMap<object, { key: string; line: string }>();

/** A quarter-turn frame that follows the wall clock, so any repaint advances it. */
function thinkingSpinner(now: number): string {
  return spinnerFrame({ id: "", name: "", status: "running", startTime: now }, now);
}

const revealScheduled = new WeakSet<object>();

/**
 * A running row hidden for its first second must appear on time even if
 * nothing else repaints (a quiet tool, or a background job's first second).
 */
function scheduleReveal(tool: GroupedTool, ms: number): void {
  if (revealScheduled.has(tool)) return;
  revealScheduled.add(tool);
  const timer = setTimeout(() => {
    revealScheduled.delete(tool);
    tool.ui?.requestRender?.();
  }, Math.max(0, ms) + 20);
  timer.unref?.();
}

/**
 * The repaint that takes a stalled thinking row (and its spinner) off screen.
 * Nothing else will ask for it: the run is quiet and pi is idle by then.
 */
const settleScheduled = new WeakSet<object>();

function scheduleSettle(component: object, ms: number): void {
  if (settleScheduled.has(component)) return;
  settleScheduled.add(component);
  const timer = setTimeout(() => {
    settleScheduled.delete(component);
    lastUi?.requestRender?.();
  }, Math.max(0, ms) + 20);
  timer.unref?.();
}

/** The header's glyph: spinning while any running job is young, then still. */
function groupSpinner(jobs: JobState[]): string {
  const now = Date.now();
  const running = jobs.filter((job) => job.status === "running");
  const young = running.some((job) => job.startTime === undefined || now - job.startTime < ANIMATE_MS);
  return young ? spinnerFrame({ id: "", name: "", status: "running", startTime: now }, now) : "●";
}

/** Which of this tool's clickable rows sits at `y`, if any. */
function hoverRowAt(plan: ViewPlan, y: number | undefined): HoverRow | null {
  if (typeof y !== "number") return null;
  if (plan.header && y === 0) return "header";
  const row = plan.header ? y - 1 : y;
  return plan.line && row === 0 ? "row" : null;
}

/** `routeGroupedMouse` result meaning "not grouped: handle it as a plain box". */
export const NOT_GROUPED = Symbol("not grouped");

export interface MouseRouting {
  pinned: boolean;
  /** Run `fn` as pointer-driven (pi's box toggle must not read as ctrl+o). */
  asPointer<T>(fn: () => T): T;
  /** Hand the event to the full box, shifted by the gutter and header. */
  boxMouse(event: any, dx: number, dy: number): unknown;
}

/**
 * Clicks on a grouped tool. Only left clicks on our own rows are taken —
 * presses and drags fall through so text selection keeps working.
 */
export function routeGroupedMouse(tool: GroupedTool, event: any, routing: MouseRouting): unknown {
  const job = routing.pinned ? undefined : jobForTool(tool);
  const jobs = routing.pinned ? [] : jobsForTool(tool);
  const plan = planFor(tool, routing.pinned, runningJob(jobs) ?? job);
  if (!plan.header && !plan.gutter) return NOT_GROUPED;

  // pi-tui names buttons ("left"); accept the raw SGR code too.
  const click = event?.type === "click" && (event.button === "left" || event.button === 0);
  let y = event?.y;
  // A codemode body's fold labels: the script and the output open in place.
  const fold = codemodeFoldAt(codemodeSpans.get(tool), y);
  if (fold) return routeCodemodeFold(tool, event, fold.section);
  const nested = typeof y === "number" ? nestedRowSpans.get(tool)?.find((span) => y >= span.from && y <= span.to) : undefined;
  if (nested) {
    if (event?.type === "move" && hoverTracking) {
      const row: HoverRow | null = y === nested.from ? `job:${nested.id}` : null;
      if (row) hoverClaimed = true;
      if (setHover(row ? tool : null, row, tool.ui)) tool.ui?.requestRender?.();
    }
    if (click && y === nested.from) {
      toggleJobDetails(nested.id);
      setHover(null, null);
      tool.ui?.requestRender?.();
      return { handled: true };
    }
    // The log body is selectable text, not the enclosing script's expand switch.
    return undefined;
  }

  // Pointer motion: light up the row under it, but never consume the packet —
  // pi still needs it for drag-selection. Repaint only when the row changes.
  if (event?.type === "move") {
    if (!hoverTracking) return undefined;
    hoverClaimed = true;
    const row = hoverRowAt(plan, y);
    const changed = setHover(row ? tool : null, row, tool.ui);
    if (changed) tool.ui?.requestRender?.();
    return undefined;
  }
  if (plan.header) {
    if (y === 0) {
      if (!click) return undefined;
      if (plan.header === "closed") openGroup(tool);
      else {
        closeGroupJobDetails(tool);
        for (const member of closeGroup(tool)) routing.asPointer(() => (member as GroupedTool).setExpanded(false));
      }
      // 行几何变了，上一帧的高亮不再对应原来那一行
      setHover(null, null);
      // 层级是跨组件的状态;pi 每帧都重渲染整个 transcript,请求一帧即可
      tool.ui?.requestRender?.();
      return { handled: true };
    }
    y -= 1;
  }
  if (plan.line) {
    if (y !== 0 || !click) return undefined;
    // A row always means "this call's box" — also the running/failed row
    // under a folded header, which opens the group on the way.
    openGroup(tool);
    setHover(null, null);
    // 走 setExpanded 而不是直接改字段:pi 的 updateDisplay 才会重建盒子
    routing.asPointer(() => tool.setExpanded(true));
    tool.ui?.requestRender?.();
    return { handled: true };
  }
  if (plan.full) {
    // The framed body starts on the row after the tick row; a codemode body is
    // drawn under the rail instead (its rows begin there).
    const asRail = (tool as { toolName?: string }).toolName === "codemode";
    return asRail
      ? routing.boxMouse(event, boxIndent(tool, plan), (plan.header ? 1 : 0) - 1)
      : routing.boxMouse(event, 0, (plan.header ? 1 : 0) + 1);
  }
  return undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Boundary hooks
// ─────────────────────────────────────────────────────────────────────────────

const BOUNDARY_WRAPPER = Symbol.for("pi-toolbox:group-boundary");
/** What a boundary wrapper wrapped, so a later module instance can replace it. */
const PREVIOUS_BOUNDARY_RENDER = Symbol.for("pi-toolbox:boundary-previous");
/**
 * Per *module instance*, not per process: `/reload` builds a new module whose
 * patches must land on top of the ones the previous instance left on the
 * prototype. A global `Symbol.for` marker made every reload a no-op, so edits
 * only ever took effect after a full restart.
 */
const WRAPPER_INSTANCE = Symbol("pi-toolbox:patch-instance");
/** This carrier's thinking was expanded by a click on its `🧠` row. */
/**
 * What did pi actually draw for this run? A hidden run is a `Text` label, a
 * shown one is `Markdown`. Reading that instead of any flag of our own means
 * tidy can never disagree with pi: whatever Ctrl+T, a click, a stream or a
 * reload did, the label is ours only where pi drew a label.
 */
function drewLabel(kid: any): boolean {
  return kid?.child instanceof Text;
}

/** The `MouseRegion` pi wrapped this run in, in content order. */
function thinkingRegion(component: any, index: number): any {
  const kids = component.contentContainer?.children;
  if (!Array.isArray(kids)) return undefined;
  const regions = kids.filter((kid: any) => kid instanceof MouseRegion);
  return regions[index];
}

const CARRIER_MOUSE = Symbol.for("pi-toolbox:carrier-mouse");
/**
 * Where this frame put the rows a click can land on. `null` = this frame drew
 * no carrier rows at all, so nothing here belongs to us — the record has to be
 * per frame because a component's role changes under it: an assistant step
 * streams as a carrier, then its text arrives and it becomes a boundary.
 */
const CARRIER_CLICK = Symbol.for("pi-toolbox:carrier-click");
type CarrierClickMap = { header: number | null; from: number; to: number };

/**
 * Last renderer a tool handed us. Carrier components have no `ui` of their own,
 * and a hovered row needs a repaint, so we borrow the neighbouring tool's.
 */
let lastUi: Renderer | undefined;

/**
 * A carrier message inside an open group: one `🧠` row per thinking run. The
 * collapsed row is the whole point — the group header counts the runs, and the
 * rows are where the model's reasoning actually shows up in the transcript.
 *
 * Clicking a row expands *that message's* thinking: pi draws it (markdown, its
 * own colour) from `thinkingVisibilityOverrides`, the same switch pi's own
 * click uses, so the two can never disagree. pi's `hideThinkingBlock` setting
 * is deliberately ignored here: the row is the one behaviour, open or shut.
 */
function renderCarrier(component: any, width: number): BoundaryDraw {
  const message = component.lastMessage;
  const runs = thinkingRuns(message);
  const plan = carrierPlan(component, { ids: toolCallIds(message), runs });
  // The run count just changed and the summary line is drawn by someone else:
  // ask for the frame that catches it up.
  if (plan.counted) lastUi?.requestRender?.();
  // A live run goes quiet on its own after its last token. By then pi may be
  // painting nothing at all, so the frame that drops the row is ours.
  if (plan.settlesIn !== undefined) scheduleSettle(component, plan.settlesIn);
  if (plan.plain) return "plain";
  const theme = getTheme();
  if (!theme || width <= GUTTER_CELLS + 8) return "plain";
  const icons = iconsEnabled();
  const thinkingColor = thinkingColorFor();
  installCarrierMouse(component);
  const lines: string[] = [];
  // Row indices of what this frame draws, in the component's own coordinates.
  // `from` is -1 while no thought row has been drawn: an empty range.
  const clickMap: CarrierClickMap = { header: null, from: -1, to: -1 };
  component[CARRIER_CLICK] = clickMap;
  if (plan.header) {
    const line = groupHeaderLine(
      component,
      plan.header,
      theme,
      width,
      icons,
      hoverState.tool === component && hoverState.row === "header",
      Date.now(),
    );
    if (line !== undefined) {
      clickMap.header = lines.length;
      lines.push(line);
    }
  }
  if (!plan.rows) return { lines };
  const gutter = groupGutter(theme, gutterColorFor());
  const hovered = hoverState.tool === component && hoverState.row === "row";
  // What pi drew for this run decides the shape: its markdown hangs under the
  // row, its label is replaced by ours. No flag of our own to fall out of sync.
  const open = (() => {
    const region = thinkingRegion(component, 0);
    return region !== undefined && !drewLabel(region);
  })();
  // Folded, a live run is a sliding window: one row, newest words, so the group
  // says what it is working on without being opened. The animation lives on the
  // summary line, not here — and the window moves on a tick, not per frame.
  const now = Date.now();
  const align = groupAlign(component);
  // The label's column moved with the names, so the live window shrinks by as
  // much as the padding grew.
  const context = GUTTER_CELLS + THOUGHT_LABEL_CELLS + Math.max(0, align.name - "thinking".length);
  // No sliding window: a folded row is a still glance at the head of the run.
  // Text that moves on every token is what made the row read as scrolling.
  const liveTexts = undefined as string[] | undefined;
  const firstRow = lines.length;
  // Expanded, the run is pi's own text and nothing else: no label row above it
  // repeating the first words, the way pi draws thinking itself.
  const body = open ? trimBlankEdges(renderThinkingBody(component, iconBodyWidth(width))) : [];
  if (body.length === 0) {
    for (const index of runs.keys()) {
      const text = liveTexts?.[index] ?? settledRowText(runs, width - context)[index];
      const row = formatThoughtLine(text, theme, { icons, thinkingColor, align });
      const line = gutter + row;
      lines.push(hovered ? hoverBand(line, width, theme) : truncateToWidth(line, width, "…"));
    }
  }
  for (const line of body) lines.push(`${gutter}${BODY_PAD}${theme.fg("thinkingText", line)}`);
  clickMap.from = firstRow;
  clickMap.to = lines.length - 1;
  return { lines };
}

/** The width an opened thinking run's text is laid out at, inside its indent. */
function iconBodyWidth(width: number): number {
  return Math.max(8, width - BODY_INDENT);
}

/**
 * pi's own rendering of the expanded run (markdown, its colours, code blocks) —
 * pulled through the message's thinking child rather than re-implemented.
 */function renderThinkingBody(component: any, width: number): string[] {
  const kids = component.contentContainer?.children;
  if (Array.isArray(kids)) {
    for (const kid of kids) if (kid instanceof MouseRegion) return kid.render(width) as string[];
  }
  return [];
}

/**
 * Clicks on a `🧠` row unfold that message's thinking; motion lights the row.
 * Both are ours to route — the component draws the rows itself, so nothing
 * below it is listening.
 *
 * Everything outside the rows this frame drew goes back to the handler that was
 * here before us. A component's role changes under it (a streaming step is a
 * carrier, the same object becomes a boundary when its text arrives), and a
 * handler that answered "row" to every `y` swallowed the whole message: any
 * click below the row opened the thinking instead of reaching the text.
 */
function installCarrierMouse(component: any): void {
  if (component[CARRIER_MOUSE]) return;
  component[CARRIER_MOUSE] = true;
  const previous = component.handleMouse;
  const pass = (event: any) => previous?.call(component, event);
  /** Where `y` sits in what this frame drew, or null when it is not ours. */
  const rowAt = (y: unknown): HoverRow | null => {
    const map = component[CARRIER_CLICK] as CarrierClickMap | null | undefined;
    if (!map || typeof y !== "number" || y < 0) return null;
    if (map.header !== null && y === map.header) return "header";
    return map.from >= 0 && y >= map.from && y <= map.to ? "row" : null;
  };
  component.handleMouse = (event: any) => {
    if (event?.type === "move") {
      if (!hoverTracking) return pass(event);
      const row = rowAt(event.y);
      // Only a row claims the packet; the alt-screen hook drops the band when
      // nothing does, so motion across the rest of the message clears it.
      if (row) hoverClaimed = true;
      if (setHover(row ? component : null, row, lastUi)) lastUi?.requestRender?.();
      return pass(event);
    }
    if (event?.type !== "click" || (event.button !== "left" && event.button !== 0)) return pass(event);
    const theme = getTheme();
    if (!theme) return pass(event);
    const row = rowAt(event.y);
    if (!row) return pass(event);
    // Expanded, the run's box hangs under its row and the whole block is ours:
    // the frame was drawn by us, so the click that folds it back has to be too.
    // Only its own rows: the summary line is a second target on the same
    // component, and an expanded run beside it used to eat the header's click
    // (the group stayed open and the reasoning folded instead).
    // Open or shut is read from what pi drew, exactly like the render does.
    const region = thinkingRegion(component, 0);
    const expanded = region !== undefined && !drewLabel(region);
    if (expanded && row === "row") {
      const overrides = component.thinkingVisibilityOverrides;
      for (let i = 0; i < Math.max(1, thinkingRuns(component.lastMessage).length); i++) overrides?.set?.(i, true);
      component.updateContent?.(component.lastMessage);
      component.invalidate?.();
      setHover(null, null);
      lastUi?.requestRender?.();
      return { handled: true };
    }
    if (row === "header") {
      // Same toggle the first member's header does: shut folds every box inside.
      const { header } = carrierPlan(component);
      if (header === "closed") openGroup(component);
      else {
        closeGroupJobDetails(component);
        for (const member of closeGroup(component)) (member as GroupedTool).setExpanded(false);
      }
      setHover(null, null);
      lastUi?.requestRender?.();
      return { handled: true };
    }
    const overrides = component.thinkingVisibilityOverrides;
    for (let i = 0; i < Math.max(1, thinkingRuns(component.lastMessage).length); i++) overrides?.set?.(i, false);
    component.updateContent?.(component.lastMessage);
    component.invalidate?.();
    setHover(null, null);
    lastUi?.requestRender?.();
    return { handled: true };
  };
}

type RenderFn = ((this: any, ...args: any[]) => string[]) & { [BOUNDARY_WRAPPER]?: true };

/** Whether grouping is on right now (the tool patch keeps this current). */
let groupingActive: () => boolean = () => true;

/** Whether Nerd Font icons are on (`icons: false` on a terminal without one). */
let iconsEnabled: () => boolean = () => true;
/** `tidy.thinkingColor`: the brain, the count and an expanded box border. */
let thinkingColorFor: () => string = () => "warning";
/** `tidy.gutterColor`: the group rail, its `├─` tick and its `▾`. */
let gutterColorFor: () => string = () => "muted";

export function setGroupingActive(active: () => boolean): void {
  groupingActive = active;
}

export function setIconsEnabled(icons: () => boolean): void {
  iconsEnabled = icons;
}

export function setThinkingColor(color: () => string): void {
  thinkingColorFor = color;
}

export function setGutterColor(color: () => string): void {
  gutterColorFor = color;
}

/**
 * A live thinking row changes on a tick, not on every frame: pi repaints while
 * streaming, and a window recomputed per paint slides one cell per token, which
 * reads as flicker. The row keeps its last string until the tick expires.
 */
const liveRows = new Map<object, { at: number; texts: string[] }>();

/**
 * The preview for one live run, held steady between ticks. Text short enough to
 * fit is shown whole and never moves; only an overflowing run slides.
 */
function liveRowText(component: object, runs: readonly string[], budgets: number[], now: number): string[] {
  const cached = liveRows.get(component);
  if (cached && now - cached.at < THOUGHT_TICK_MS && cached.texts.length === runs.length) return cached.texts;
  const texts = runs.map((run, i) => previewText(run, budgets[i] ?? 0, true));
  liveRows.set(component, { at: now, texts });
  return texts;
}

/**
 * The settled preview of each run, at one budget. Flattening a run's whitespace
 * walks all of its text, and every message with thinking asks on every frame;
 * `thinkingRuns` hands back the same array until the text changes, so the
 * previews are kept against it.
 */
const settledRows = new WeakMap<readonly string[], { budget: number; texts: string[] }>();

function settledRowText(runs: readonly string[], budget: number): string[] {
  const cached = settledRows.get(runs);
  if (cached?.budget === budget) return cached.texts;
  const texts = runs.map((run) => previewText(run, budget));
  settledRows.set(runs, { budget, texts });
  return texts;
}

/**
 * What a boundary component draws this frame: `plain` trims pi's padding,
 * `untrimmed` preserves the render verbatim, `rethink` restyles its `Thinking...`
 * labels (see `restyleThinking`), `lines` are drawn verbatim, `hidden` draws
 * nothing.
 */
type BoundaryDraw = "hidden" | "plain" | "untrimmed" | "rethink" | { lines: string[] };

/**
 * pi draws thinking as a child component of the message: a one-line label while
 * it is hidden, the full markdown once it is shown, wrapped in a `MouseRegion`
 * so a click toggles it. That child is where our rows belong, so the message is
 * reassembled child by child: every other child keeps pi's own lines verbatim
 * (they carry the OSC 133 prompt markers), and each thinking child becomes a
 * `thinking` row — or, expanded, the same rounded box a tool result gets.
 *
 * A `MouseRegion` sits around the body, so a click on our row still reaches pi's
 * toggle: collapsed → expanded → collapsed. `hideThinkingBlock` is ignored: the
 * run starts hidden here no matter what pi's setting says, so the first click is
 * always "open it".
 */
/** The presentation tree from the last frame, not a second hit-test table. */
const MESSAGE_VIEW = Symbol.for("pi-toolbox:message-view");
const MESSAGE_MOUSE = Symbol.for("pi-toolbox:message-mouse");

/** Native child routing, with just one transform for the outer edge trim. */
class MessageView extends Container {
  private trimTop = 0;
  private rawHeight = 0;

  override render(width: number): string[] {
    const lines = super.render(width);
    const trimmed = trimMessageEdges(lines);
    this.trimTop = trimmed.top;
    this.rawHeight = lines.length;
    return trimmed.lines;
  }

  override handleMouse(event: TuiMouseEvent) {
    return super.handleMouse({ ...event, y: event.y + this.trimTop, height: this.rawHeight });
  }
}

function installMessageMouse(component: any): void {
  if (component[MESSAGE_MOUSE]) return;
  component[MESSAGE_MOUSE] = true;
  const previous = component.handleMouse;
  component.handleMouse = (event: TuiMouseEvent) => {
    const view = component[MESSAGE_VIEW] as MessageView | undefined;
    // An unhandled event belongs to selection/scrolling, not the old layout.
    return view ? view.handleMouse(event) : previous?.call(component, event);
  };
}

function restyleThinking(component: any, lines: string[] | undefined, width: number, rethink: boolean, hideThinking = false): string[] {
  const kids = component.contentContainer?.children;
  // If pi's structure changes, keep both its rendering and mouse routing intact.
  if (!Array.isArray(kids) || kids.length === 0) return lines ?? [];
  const theme = rethink ? getTheme() : undefined;
  const runs = thinkingRuns(component.lastMessage);
  const overrides = component.thinkingVisibilityOverrides as Map<number, boolean> | undefined;
  const icons = iconsEnabled();
  const color = thinkingColorFor();
  // Keep the existing live preview/spinner; only its layout ownership changes.
  if (theme && runs.length > 0) noteThinking(component, runs);
  const thought = theme && runs.length > 0 ? thinkingState(component) : undefined;
  if (thought?.settlesIn !== undefined) scheduleSettle(component, thought.settlesIn);
  const budget = Math.max(1, width - THOUGHT_LABEL_CELLS - 1);
  const liveTexts = undefined as string[] | undefined;
  const spinner = thought?.live ? thinkingSpinner(Date.now()) : undefined;
  const view = new MessageView();
  const hiddenMarkers: string[] | undefined = hideThinking ? [] : undefined;
  let cursor = 0;
  let run = 0;
  for (const kid of kids) {
    if (hideThinking && kid instanceof MouseRegion && run < runs.length) {
      run++;
      if (lines) {
        const count = (kid.render(width) as string[]).length;
        hiddenMarkers!.push(...(lines.slice(cursor, cursor + count).join("").match(ZONE_MARKERS) ?? []));
        cursor += count;
      }
      continue;
    }
    const own = kid.render(width) as string[];
    const taken = lines?.slice(cursor, cursor + own.length) ?? own;
    cursor += own.length;
    let rows = taken.length === own.length ? taken : own;
    if (theme && runs.length > 0 && kid instanceof MouseRegion) {
      // pi owns the run: its own markdown once shown, its label while hidden.
      // Only that label is ours, restyled to `<brain> thinking  <head>`.
      const index = run++;
      if (drewLabel(kid)) {
        const text = liveTexts?.[index] ?? settledRowText(runs, budget)[index] ?? "";
        const label = formatThoughtLine(text, theme, { icons, thinkingColor: color, spinner });
        rows = [label];
        // The zone markers sit in pi's own render of the run, which the label
        // just replaced: carry them over so the prompt markers stay intact.
        for (const marker of taken.join("").match(ZONE_MARKERS) ?? []) {
          if (marker === "\x1b]133;A\x07") rows[0] = marker + rows[0];
          else rows[rows.length - 1] += marker;
        }
      }
    }
    // Preserve pi's OSC markers and its own mouse target: MouseRegion forwards
    // to the actual child, so the click that toggles thinking stays pi's.
    const region = new MouseRegion(kid, () => undefined);
    region.render = () => rows;
    view.addChild(region);
  }
  const tail = lines?.slice(cursor) ?? [];
  if (tail.length > 0) view.addChild({ render: () => tail, invalidate() {} });
  const rendered = view.render(width);
  if (!lines && rendered.length) {
    rendered[0] = "\x1b]133;A\x07" + rendered[0];
    rendered[rendered.length - 1] = "\x1b]133;B\x07\x1b]133;C\x07" + rendered[rendered.length - 1];
  }
  if (rendered.length && hiddenMarkers) for (const marker of hiddenMarkers) {
    if (marker === "\x1b]133;A\x07") rendered[0] = marker + rendered[0];
    else rendered[rendered.length - 1] += marker;
  }
  component[MESSAGE_VIEW] = view;
  installMessageMouse(component);
  return rendered;
}

/** A rendered row with every escape sequence gone: what the reader sees. */
const WITHOUT_ESCAPES = /\x1b(?:\[[0-9;:?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?)/g;
/** pi's shell-integration zone markers, which ride on the rows we trim. */
const ZONE_MARKERS = /\x1b\]133;[ABC]\x07/g;

/**
 * Trim pi's padding rows off a message block, without dropping the OSC 133 zone
 * markers that sit on them: the terminal uses those to place prompts, so they
 * move onto the rows that survive.
 */
function trimMessageEdges(lines: string[]): { lines: string[]; top: number } {
  const blank = (line: string | undefined) => (line ?? "").replace(WITHOUT_ESCAPES, "").trim() === "";
  let start = 0;
  let end = lines.length;
  while (start < end && blank(lines[start])) start++;
  while (end > start && blank(lines[end - 1])) end--;
  if (start === 0 && end === lines.length) return { lines, top: 0 };
  if (start === end) return { lines: [], top: start };
  const kept = lines.slice(start, end);
  const head = lines.slice(0, start).join("").match(ZONE_MARKERS) ?? [];
  const tail = lines.slice(end).join("").match(ZONE_MARKERS) ?? [];
  if (head.length > 0) kept[0] = head.join("") + kept[0];
  if (tail.length > 0) kept[kept.length - 1] = kept[kept.length - 1] + tail.join("");
  return { lines: kept, top: start };
}

/**
 * Wrap `proto.render` unless the outermost wrapper is already ours. `view`
 * decides per render: draw as usual, draw nothing, draw under the group
 * gutter (two cells narrower, `│` in front), or draw its own rows.
 */
function wrapBoundaryRender(
  proto: { render?: RenderFn } | undefined,
  view: (component: any, width: number) => BoundaryDraw,
  /** How it draws with grouping off; pi's own render when absent. */
  ungrouped?: BoundaryDraw,
): void {
  const top = proto?.render;
  // Skip only *this module instance's* wrapper: it is already in place.
  if (typeof top !== "function" || (top as any)[WRAPPER_INSTANCE] === true) return;
  // A wrapper an earlier module instance left across `/reload` must be
  // *replaced*, not wrapped over: the old one restyles pi's render, and the
  // new one would restyle that result again — every thinking row and line of
  // text came out twice. The old wrapper points at what it wrapped, so unwind
  // to the first non-tidy render and install on top of that.
  let render = top;
  while ((render as any)[BOUNDARY_WRAPPER] === true && (render as any)[PREVIOUS_BOUNDARY_RENDER]) {
    render = (render as any)[PREVIOUS_BOUNDARY_RENDER];
  }
  const assistant = proto === AssistantMessageComponent.prototype;
  const wrapped: RenderFn = function (this: any, ...args: any[]) {
    // Reset before even the disabled path: old handlers survive /reload and
    // streaming carrier/boundary transitions, but their old layout must not.
    this[CARRIER_CLICK] = null;
    this[MESSAGE_VIEW] = undefined;
    const width = typeof args[0] === "number" ? args[0] : 80;
    const how = groupingActive() ? view(this, width) : ungrouped && tidyEnabled.get() ? ungrouped : "untrimmed";
    const options = assistant ? turnOptions.get() : undefined;
    if (!options || (options.collapseTurns === "off" && !options.frameFinalReply)) {
      if (this[TURN_LAYOUT]) this[TURN_LAYOUT] = undefined;
      if (how === "hidden") return [];
      if (how === "untrimmed") return render.apply(this, args);
      if (typeof how === "object") return how.lines;
      // `plain` is a step whose call pi draws itself (an expanded pinned
      // edit) or a message with nothing to fold. Its thinking is still our
      // row: leaving it bare makes pi's `Thinking...` float over the box.
      return restyleThinking(this, render.apply(this, args), width, how === "rethink" || how === "plain");
    }
    const draw = (room: number, hideThinking = false) => {
      if (how === "hidden") return [];
      if (how === "untrimmed") return render.call(this, room, ...args.slice(1));
      if (typeof how === "object") return how.lines;
      // The same native view owns both rendering and mouse geometry.
      const turn = turnOptions.get().collapseTurns !== "off" ? turnFor(this.lastMessage) : undefined;
      const foldedTurn = !!turn && folded(turn);
      const skipThinking = hideThinking || (foldedTurn && Array.isArray(this.contentContainer?.children));
      return restyleThinking(this, skipThinking ? undefined : render.call(this, room, ...args.slice(1)), room, how === "rethink" || how === "plain", hideThinking || foldedTurn);
    };
    return presentTurn(this, width, draw);
  };
  wrapped[BOUNDARY_WRAPPER] = true;
  (wrapped as any)[PREVIOUS_BOUNDARY_RENDER] = render;
  (wrapped as any)[WRAPPER_INSTANCE] = true;
  proto!.render = wrapped;
}

/**
 * Group boundaries are seen through the message components' render. These
 * wrappers must be the *outermost* layer: a restyle patch that never calls its
 * predecessor — tidy's own user-message rail, or another extension's patch
 * installed after tidy's — would hide a wrapper underneath it. Hence this runs
 * at patch time and again from the tool render, by which time every extension
 * has installed its patches.
 */
export function installGroupBoundaries(): void {
  wrapBoundaryRender((AssistantMessageComponent as any)?.prototype, (component, width) => {
    const role = classifyAssistant(component.lastMessage);
    const carrier = role === "carrier" || (role !== "boundary" && component.isStreaming === true && currentGroupHasMembers());
    if (role === "boundary") noteBoundary(component);
    else if (role === "carrier") return renderCarrier(component, width);
    // A step still streaming its thinking mid-segment is, almost always, a
    // carrier whose tool call hasn't arrived yet. Fold it with the group now
    // rather than flash `Thinking...` under the summary for a second; text,
    // if it comes, makes it a boundary and it shows. At a turn's start the
    // group is empty and the label stays as a sign of life.
    else if (component.isStreaming === true && currentGroupHasMembers()) {
      return renderCarrier(component, width);
    }
    // A plain step (no text, no call) was never a row of the group; if it was
    // counted while its thinking streamed, give the run back as well.
    else releaseCarrier(component);
    // A message with both thinking and text is the group *boundary*: its text
    // renders as pi draws it and its thinking stays pi's own label — but the
    // label is the same thing our rows are, so it wears the same format, right
    // above the text. It is not one of the group's rows, so it is not counted.
    return "rethink";
    // Grouping off there is nothing to fold a step into, but its thinking is
    // still tidy's row rather than a bare `Thinking...` floating over the box:
    // the row has nothing to do with folding calls.
  }, "rethink");
  wrapBoundaryRender((UserMessageComponent as any)?.prototype, (component) => {
    noteBoundary(component);
    return "untrimmed";
  });
  // A background job's notifications (`[process] "ticker" matched stdout:
  // READY`) say what its row already shows. The model still receives them —
  // this only skips drawing them. Everything else keeps its own edges: a custom
  // message is pi's `Box(1, 1, customMessageBg)` too, so the same trim that ate
  // the user message's padding was eating its inset as well.
  wrapBoundaryRender((CustomMessageComponent as any)?.prototype, (component) =>
    noteJobMessage(component.message) && turnOptions.get().collapseTurns === "off" ? "hidden" : "untrimmed",
  );
}
