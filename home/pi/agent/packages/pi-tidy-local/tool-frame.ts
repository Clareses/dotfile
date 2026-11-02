/**
 * Rounded transparent frames for every tool box, title (kind icon + path) in
 * the top border. A body opened inside a group hangs under the rail instead.
 *
 * Re-registering tools with `renderShell: "self"` only reaches tools this
 * extension registers itself — tools owned by other extensions (MCP via
 * pi-mcp-adapter, subagents, …) keep pi's default filled-background shell,
 * and the extension API exposes no way to wrap another extension's renderers
 * (`getAllTools()` returns name/description/parameters only).
 *
 * So the frame is applied one level lower, on ToolExecutionComponent — the
 * component pi builds for every tool call regardless of who registered it.
 * Extensions import the same live module instance as the host app, so
 * patching the prototype reaches every tool box in the session.
 *
 * The true methods are captured once and every load installs a fresh wrapper
 * over them (see ORIGINAL_RENDER), so a `/reload` picks up both new settings
 * and code edits; the options themselves are read from a global slot.
 */

import { homedir } from "node:os";
import { Box, Container, visibleWidth, type Component } from "@earendil-works/pi-tui";
import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { blankEdges, drawFrame, labeledTopBorder, outsideHyperlink, padToWidth, removeLeadingWord, sameLines, stripBackgroundFills, trimTrailingSpaces, visibleIndexOf, visibleText } from "./frame-draw.ts";
import {
  composeCodemodeBody,
  codemodeSections,
  decorateCodemodeBody,
  type CodemodeBodyOptions,
  type CodemodeToggle,
  type ComposedCodemodeBody,
} from "./codemode-body.ts";
import { sliceByColumn, truncateToWidth } from "@earendil-works/pi-tui";
import { fileIcon, PATH_ARG_TOOLS, toolKindIcon } from "./icons.ts";
import { closeJobDetails, jobsForTool, setJobOptions } from "./background-jobs.ts";
import { liveSlot, tidyEnabled } from "./live.ts";
import { expandTurnForTool, hideTurnTool } from "./turn-state.ts";
import { renderSplitDiff } from "./split-diff.ts";
import { getTheme, type ThemeLike } from "./theme-access.ts";
import { planFor, setGroupsOpen } from "./tool-groups.ts";
import { formatToolLine } from "./tool-lines.ts";
import {
  installGroupBoundaries,
  installHoverTracking,
  codemodeFoldAt,
  codemodeHover,
  hoverBand,
  NOT_GROUPED,
  renderGroupedTool,
  routeCodemodeFold,
  routeGroupedMouse,
  setGroupingActive,
  setGutterColor,
  setIconsEnabled,
  setThinkingColor,
  type CodemodeRowSpan,
  type GroupedTool,
} from "./tool-group-view.ts";

interface MouseTarget {
  render(width: number): string[];
  handleMouse?(event: unknown): unknown;
}

/**
 * Where the box's source rows sit in the framed output, so a click can be
 * translated back into the coordinates pi's own components expect.
 */
interface FrameGeometry {
  /** Output row of source row 0 (rows above it were trimmed padding). */
  top: number;
  /** Source rows rendered, and the width they were rendered at. */
  height: number;
  width: number;
  /** false when the frame was dropped (a body hanging under a group row): column 0 is the body. */
  bordered?: boolean;
}

interface ToolBoxInternals extends GroupedTool {
  __tidyTurnRendered?: boolean;
  /** 0 collapsed, 1 partial (ctrl+o), 2 full (ctrl+shift+o / a click). */
  __tidyExpand?: 0 | 1 | 2;
  hideComponent: boolean;
  toolName: string;
  result?: { isError: boolean; durationMs?: number; content?: unknown; details?: unknown };
  selfRenderContainer: MouseTarget;
  contentBox: MouseTarget;
  contentText: MouseTarget;
  /** The MouseRegion pi wraps around `contentText` (no renderer definition). */
  contentTextRegion?: MouseTarget;
  imageComponents: Array<{ render(width: number): string[] }>;
  imageSpacers: Array<{ render(width: number): string[] }>;
  /** The component pi wrapped around the call renderer's output (the edit Box). */
  callRendererComponent?: {
    preview?: { diff?: unknown; error?: unknown };
    children?: ReadonlyArray<{ render(width: number): string[] }>;
  };
  hasRendererDefinition(): boolean;
  getRenderShell(): "default" | "self";
  __frameCache?: {
    width: number;
    color: string;
    expanded: boolean;
    level: 0 | 1 | 2;
    partial: number;
    icons: boolean;
    unframed: boolean;
    /** The framed codemode fold row wearing the hover band ("" for none). */
    hovered: string;
    raw: string[];
    out: string[];
    geometry: FrameGeometry;
  };
  __frameGeometry?: FrameGeometry;
  /** The split diff last built for this box, and what it was built from. */
  __splitCache?: {
    diff: string;
    width: number;
    maxLines: number | undefined;
    filePath: string | undefined;
    sample: string;
    call: string[];
    value: { raw: string[]; bgRows: ReadonlySet<number> } | undefined;
  };
  /** Row indices of the codemode fold labels in the last framed body. */
  __codemodeToggles?: CodemodeToggle[];
  /** A framed codemode box's fold rows, in its own output rows; unset for every other box. */
  __codemodeFolds?: CodemodeRowSpan[];
  /** The last composed codemode body, and what it was composed from. */
  __codemodeComposed?: {
    body: string[];
    details: unknown;
    script: boolean;
    output: boolean;
    icons: boolean;
    width: number | undefined;
    hovered: string | undefined;
    sample: string;
    value: ComposedCodemodeBody;
  };
  /** The framed list built on the last composed body. */
  __codemodeList?: { composed: ComposedCodemodeBody; w: number; icons: boolean; value: { title: string; lines: string[]; toggles: CodemodeToggle[] } };
  /** The expanded rendering a framed codemode box composes from, and what it was built from. */
  __codemodeFull?: {
    args: unknown;
    result: unknown;
    isPartial: boolean;
    sample: string;
    body: Component | undefined;
  };
  /** pi's own fields, read to draw the body a second time at `expanded: true`. */
  toolDefinition?: {
    renderCall?(args: unknown, theme: unknown, context: unknown): Component;
    renderResult?(result: unknown, options: unknown, theme: unknown, context: unknown): Component;
  };
  cwd?: string;
  outputPad?: number;
  argsComplete?: boolean;
}

export interface ToolFrameOptions {
  /** Prepend a Nerd Font icon (tool kind or target file type) to the call row. */
  icons?: boolean;
  /** Per-tool-name border color for successful executions (theme fg color names). */
  toolColors?: Record<string, string>;
  /**
   * Collapse each assistant segment's tool calls into one summary line
   * (`▸ 4 calls · bash×3 read×1`), expanding to one row per call, then to the
   * full box. Click a line to step down a level; `ctrl+o` still expands all.
   */
  groupTools?: boolean;
  /** Groups start open (default true); `/cot` flips it at runtime. */
  groupOpen?: boolean;
  /** Tools that never fold into a group (default edit/write: the diff is the point). */
  alwaysShowTools?: string[];
  /**
   * Track background jobs a call started (pi-processes): the row shows the
   * job's live state instead of the call's.
   */
  backgroundJobs?: boolean;
  /** Skip drawing a job's notification messages when its row shows the same. */
  hideJobNotifications?: boolean;
  /** Render the edit diff as two panes (old | new) when the box is wide enough. */
  splitDiff?: boolean;
  /** Box width below which the split falls back to pi's unified diff (default 72). */
  splitDiffMinWidth?: number;
  /** Diff rows shown while the box is collapsed (default 20; `0` shows none). */
  diffLines?: number;
  /**
   * Rows of an *expanded* box shown before ctrl+shift+o asks for the rest
   * (default 12; `0` shows the whole output at ctrl+o already).
   */
  partialLines?: number;
  /** Theme color for thinking rows and the expanded thinking box (default `warning`). */
  thinkingColor?: string;
  /** Theme color for a group's rail, `├─` tick and `▾`/`▸` (default `muted`). */
  gutterColor?: string;
  /** Thinking starts expanded instead of as a one-line preview (default false). */
  thinkingOpen?: boolean;
}

interface ResolvedToolFrameOptions {
  icons: boolean;
  toolColors: Record<string, string>;
  groupTools: boolean;
  groupOpen: boolean;
  alwaysShow: Set<string>;
  splitDiff: boolean;
  splitDiffMinWidth: number;
  diffLines: number;
  partialLines: number;
  thinkingColor: string;
  gutterColor: string;
  thinkingOpen: boolean;
}

const toolOptions = liveSlot<ResolvedToolFrameOptions>("tool-frame-options", {
  icons: false,
  toolColors: {},
  groupTools: true,
  groupOpen: true,
  alwaysShow: new Set(["edit", "write"]),
  splitDiff: true,
  splitDiffMinWidth: 72,
  diffLines: 20,
  partialLines: 12,
  thinkingColor: "warning",
  gutterColor: "muted",
  thinkingOpen: false,
});

const grouping = () => tidyEnabled.get() && toolOptions.get().groupTools;

/** A codemode box drawn in a frame of its own: grouping off, or codemode in `alwaysShowTools`. */
const framedCodemode = (tool: ToolBoxInternals) =>
  tidyEnabled.get() && (!toolOptions.get().groupTools || toolOptions.get().alwaysShow.has(tool.toolName));

/** The component pi routes a box's clicks through (its result MouseRegions live inside). */
function mouseTarget(tool: ToolBoxInternals): MouseTarget | undefined {
  if (!tool.hasRendererDefinition()) return tool.contentTextRegion;
  return tool.getRenderShell() === "self" ? tool.selfRenderContainer : tool.contentBox;
}

/**
 * Every tool component that has rendered, so ctrl+shift+o can reach them all.
 * `WeakRef`s keep the transcript collectable; the registry itself lives on
 * globalThis so a `/reload` keeps seeing the boxes the previous load drew.
 */
const REGISTRY_KEY = Symbol.for("pi-tidy:tool-registry");
type ToolRef = WeakRef<ToolBoxInternals>;
function toolRegistry(): Set<ToolRef> {
  const store = globalThis as unknown as Record<symbol, Set<ToolRef> | undefined>;
  return (store[REGISTRY_KEY] ??= new Set<ToolRef>());
}
function trackTool(tool: ToolBoxInternals): void {
  const marked = tool as ToolBoxInternals & { __tidyTracked?: boolean };
  if (marked.__tidyTracked) return;
  marked.__tidyTracked = true;
  toolRegistry().add(new WeakRef(tool));
}
let fullExpand = false;
/** Full output for every known box (ctrl+shift+o), partial or collapsed healed. */
export function expandAllToolOutput(): number {
  let count = 0;
  for (const ref of toolRegistry()) {
    const tool = ref.deref();
    if (!tool) {
      toolRegistry().delete(ref);
      continue;
    }
    fullExpand = true;
    try {
      tool.__tidyExpand = 2;
      tool.setExpanded(true);
    } finally {
      fullExpand = false;
    }
    tool.ui?.requestRender?.();
    count++;
  }
  return count;
}

/** Redraw every live tool box, e.g. after `/cot` changed the group default. */
export function refreshToolBoxes(): number {
  let count = 0;
  for (const ref of toolRegistry()) {
    const tool = ref.deref();
    if (!tool) {
      toolRegistry().delete(ref);
      continue;
    }
    tool.ui?.requestRender?.();
    count++;
  }
  return count;
}

/** The true pi methods, kept across `/reload` so each load wraps them fresh. */
const ORIGINAL_RENDER = Symbol.for("pi-tidy:tool-original-render");
const ORIGINAL_MOUSE = Symbol.for("pi-tidy:tool-original-mouse");
const ORIGINAL_EXPAND = Symbol.for("pi-tidy:tool-original-expand");

export function patchToolBoxFrames(options: ToolFrameOptions = {}): void {
  const {
    icons = false,
    toolColors = {},
    groupTools = true,
    groupOpen = true,
    alwaysShowTools = ["edit", "write"],
    backgroundJobs = true,
    hideJobNotifications = true,
    splitDiff = true,
    splitDiffMinWidth = 72,
    diffLines = 20,
    partialLines = 12,
    thinkingColor = "warning",
    gutterColor = "muted",
    thinkingOpen = false,
  } = options;
  toolOptions.set({
    icons,
    toolColors,
    groupTools,
    groupOpen,
    alwaysShow: new Set(alwaysShowTools),
    splitDiff,
    splitDiffMinWidth,
    diffLines,
    partialLines,
    thinkingColor,
    gutterColor,
    thinkingOpen,
  });
  setJobOptions({ enabled: backgroundJobs, hideNotifications: hideJobNotifications });

  const proto = ToolExecutionComponent.prototype as unknown as ToolBoxInternals & {
    render(width: number): string[];
  };
  const anyProto = proto as unknown as Record<string, any>;
  // Captured once for the process: a `/reload` builds a new module whose
  // wrappers must replace the previous instance's (not stack on them), so the
  // true pi methods are kept under global symbols and every load installs a
  // fresh wrapper over them.
  if (!anyProto[ORIGINAL_RENDER]) {
    anyProto[ORIGINAL_RENDER] = proto.render;
    anyProto[ORIGINAL_MOUSE] = anyProto.handleMouse;
    anyProto[ORIGINAL_EXPAND] = anyProto.setExpanded;
  }
  const originalRender = anyProto[ORIGINAL_RENDER] as (width: number) => string[];
  const originalHandleMouse = anyProto[ORIGINAL_MOUSE];
  const originalSetExpanded = anyProto[ORIGINAL_EXPAND];

  setGroupingActive(grouping);
  setGroupsOpen(groupOpen);
  setIconsEnabled(() => toolOptions.get().icons);
  setThinkingColor(() => toolOptions.get().thinkingColor);
  setGutterColor(() => toolOptions.get().gutterColor);
  installGroupBoundaries();
  installHoverTracking();

  // >0 while pi's own mouse handling runs: its box click reaches setExpanded
  // from in here, ctrl+o's expand/collapse-all from anywhere else.
  let pointerDepth = 0;
  const asPointer = <T>(fn: () => T): T => {
    pointerDepth++;
    try {
      return fn();
    } finally {
      pointerDepth--;
    }
  };

  /**
   * A click on the framed box, translated into the source component's own
   * coordinates. pi's handler would measure the *unframed* layout (and, for
   * `renderShell: "self"` tools, read a height only its own render records),
   * so clicks landed on the wrong row or — for edit and MCP boxes — nowhere.
   */
  function boxMouse(this: ToolBoxInternals, event: any, dx = 0, dy = 0): unknown {
    // A framed codemode call list is tidy's own rows, not pi's layout: its fold
    // rows open their section, and every other cell is the box's expand switch.
    const folds = this.__codemodeFolds;
    if (folds) {
      const fold = codemodeFoldAt(folds, event?.y - dy);
      if (fold) return routeCodemodeFold(this, event, fold.section);
      const click = event?.type === "click" && (event.button === "left" || event.button === 0);
      if (!click) return undefined;
      asPointer(() => this.setExpanded(!this.expanded));
      return { handled: true };
    }
    const geometry = this.__frameGeometry;
    const target = mouseTarget(this);
    if (!geometry || typeof target?.handleMouse !== "function") {
      return asPointer(() => originalHandleMouse?.call(this, event));
    }
    const y = event.y - dy - geometry.top;
    if (y >= 0 && y < geometry.height) {
      // Column 0 of the source sits right of the left border — unless the frame
      // was dropped, in which case the body starts where the row does.
      const x = event.x - dx - (geometry.bordered === false ? 0 : 1);
      const handled = asPointer(() =>
        target.handleMouse!({ ...event, x, y, width: geometry.width, height: geometry.height }),
      );
      if (handled !== undefined) return handled;
    }
    // Nothing under the pointer took it. The rows we draw are not always rows
    // pi's own layout knows about: a split diff is painted here, so pi's
    // sub-components keep the height they had before the preview arrived (a
    // streamed frame leaves them at two or three rows), and an unframed body is
    // shifted by the gutter. Every cell of the box is the expand switch, so a
    // click that found no owner toggles it here instead of doing nothing.
    const click = event?.type === "click" && (event.button === "left" || event.button === 0);
    if (!click) return undefined;
    asPointer(() => this.setExpanded(!this.expanded));
    return { handled: true };
  }

  anyProto.handleMouse = function (this: ToolBoxInternals, event: any) {
    if (!tidyEnabled.get()) return originalHandleMouse?.call(this, event);
    if (hideTurnTool(this.toolCallId)) return undefined;
    if (grouping()) {
      const routed = routeGroupedMouse(this, event, {
        pinned: toolOptions.get().alwaysShow.has(this.toolName),
        asPointer,
        boxMouse: (shifted, dx, dy) => boxMouse.call(this, shifted, dx, dy),
      });
      if (routed !== NOT_GROUPED) return routed;
    }
    return boxMouse.call(this, event);
  };

  // ctrl+o 与 pi 自己的展开都走 setExpanded:先改层级,再让 pi 记自己的状态
  anyProto.setExpanded = function (this: ToolBoxInternals, expanded: boolean) {
    // Two levels of "expanded": ctrl+o (keyboard) is the partial view,
    // ctrl+shift+o and a click open the whole output.
    this.__tidyExpand = expanded ? (fullExpand || pointerDepth > 0 ? 2 : 1) : 0;
    if (tidyEnabled.get() && pointerDepth === 0 && (this.__tidyTurnRendered || expanded)) {
      expandTurnForTool(this.toolCallId, expanded);
    }
    if (grouping() && !expanded && pointerDepth === 0 && !toolOptions.get().alwaysShow.has(this.toolName)) {
      // Closing the box is the box's own business: the group stays open.
      closeJobDetails(jobsForTool(this).map((job) => job.id));
    }
    // A framed codemode box draws its call list whatever pi's flag says (see
    // fullCodemodeBody), so what expanding opens there is the script and the
    // output: ctrl+o shows everything, and a click on the box does the same for
    // that one box. Its fold rows still open one section at a time.
    if (this.toolName === "codemode" && framedCodemode(this)) {
      const sections = codemodeSections(this);
      sections.script = expanded;
      sections.output = expanded;
    }
    return originalSetExpanded.call(this, expanded);
  };

  /**
 * Tools whose body is a diff worth splitting. pi's write box previews the new
 * file as highlighted source, not a diff, so it is not one of them.
 */
const SPLIT_DIFF_TOOLS = new Set(["edit"]);

/**
 * Rebuild an edit box's rows as two panes.
 *
 * pi's edit renderer keeps the unified diff string on its call component
 * (`preview.diff`) and renders it with `renderDiff`; the coloured lines are not
 * reversible, so the panes are built from that string instead. Undefined means
 * "keep what pi drew": no preview yet (streaming), a preview error, a narrow
 * box, or a diff that cannot be laid out.
 */
function splitEditBody(
  tool: ToolBoxInternals,
  innerWidth: number,
  callWidth: number,
  theme: ThemeLike,
): { raw: string[]; bgRows: ReadonlySet<number> } | undefined {
  const { splitDiff, splitDiffMinWidth, diffLines } = toolOptions.get();
  if (!splitDiff || !SPLIT_DIFF_TOOLS.has(tool.toolName) || innerWidth < splitDiffMinWidth) return undefined;
  const component = tool.callRendererComponent;
  const preview = component?.preview;
  if (!preview || "error" in preview) return undefined;
  const diff = typeof preview.diff === "string" ? preview.diff : undefined;
  if (!diff) return undefined;
  const path = (tool.args as { path?: unknown } | undefined)?.path;
  const filePath = typeof path === "string" ? path : undefined;
  // Collapsed, the body is a window on the diff; `ctrl+o` draws all of it.
  const maxLines = tool.expanded ? undefined : diffLines;
  // Row 0 is the call row (`edit ~/x.ts`), which keeps pi's rendering so the
  // icon prefix and path shortening still apply; the body starts with its own
  // summary row (`↳ diff +1 -1 [...]`).
  const call = component?.children?.[0]?.render(callWidth) ?? [];
  // pi renders the whole transcript every frame — every wheel tick, every
  // streamed token — so each edit box in the history comes through here each
  // time. Rebuilding (and re-highlighting) its panes is what made scrolling a
  // long session crawl; the panes only change with these inputs. A theme
  // switch changes the sample.
  const sample = theme.fg("toolDiffAdded", "x");
  const cache = tool.__splitCache;
  if (
    cache &&
    cache.diff === diff &&
    cache.width === innerWidth &&
    cache.maxLines === maxLines &&
    cache.filePath === filePath &&
    cache.sample === sample &&
    sameLines(cache.call, call)
  ) {
    return cache.value;
  }
  const body = renderSplitDiff({ diff, width: innerWidth, theme, filePath, maxLines });
  const offset = call.length;
  const value = body
    ? { raw: [...call, ...body.lines], bgRows: new Set(body.bgRows.map((row) => row + offset)) }
    : undefined;
  tool.__splitCache = { diff, width: innerWidth, maxLines, filePath, sample, call, value };
  return value;
}

/**
 * A codemode box's body as pi draws it expanded, without expanding the box.
 *
 * Collapsed, pi's renderer keeps ten script lines, the last eight calls and five
 * output lines, so a call list folded from that would drop calls and miscount
 * both sections. The framed call list is composed from a second rendering by
 * the same renderers at `expanded: true`, with components and state of its own:
 * pi's box, and anything another renderer keeps on its state, are never touched.
 * `executionStarted: false` keeps pi's timer out of it (it would arm an interval
 * on that state); the timer row is dropped from the composed body anyway.
 */
function fullCodemodeBody(tool: ToolBoxInternals, width: number, theme: ThemeLike): string[] | undefined {
  const definition = tool.toolDefinition;
  if (typeof definition?.renderCall !== "function") return undefined;
  const sample = theme.fg("toolTitle", "x");
  let cache = tool.__codemodeFull;
  if (
    !cache ||
    cache.args !== tool.args ||
    cache.result !== tool.result ||
    cache.isPartial !== tool.isPartial ||
    cache.sample !== sample
  ) {
    const state = {};
    const context = {
      args: tool.args,
      toolCallId: tool.toolCallId,
      invalidate: () => {
        tool.__codemodeFull = undefined;
        tool.ui?.requestRender?.();
      },
      lastComponent: undefined,
      state,
      cwd: tool.cwd,
      executionStarted: false,
      argsComplete: tool.argsComplete,
      isPartial: tool.isPartial,
      expanded: true,
      showImages: false,
      isError: tool.result?.isError ?? false,
      durationMs: tool.isPartial ? undefined : tool.result?.durationMs,
      outputPad: tool.outputPad ?? 1,
    };
    let body: Component | undefined;
    try {
      // The same shell pi draws into, so the rows line up with what it would show.
      const shell = tool.getRenderShell() === "self" ? new Container() : new Box(tool.outputPad ?? 1, 1);
      shell.addChild(definition.renderCall(tool.args, theme, context));
      if (tool.result && typeof definition.renderResult === "function") {
        const { content, details } = tool.result;
        shell.addChild(definition.renderResult({ content, details }, { expanded: true, isPartial: tool.isPartial }, theme, context));
      }
      body = shell;
    } catch {
      body = undefined;
    }
    cache = { args: tool.args, result: tool.result, isPartial: tool.isPartial, sample, body };
    tool.__codemodeFull = cache;
  }
  return cache.body?.render(width);
}

/**
 * `composeCodemodeBody`, kept per box. Every framed codemode box in the history
 * is composed on every frame, and every grouped one once it is open (all of
 * them after ctrl+o); splitting a body walks the text of each of its rows.
 */
function composedCodemode(
  tool: ToolBoxInternals,
  body: string[],
  theme: ThemeLike,
  options: CodemodeBodyOptions,
): ComposedCodemodeBody {
  const state = codemodeSections(tool);
  const details = tool.result?.details;
  const sample = theme.fg("accent", "x");
  const cache = tool.__codemodeComposed;
  if (
    cache &&
    cache.details === details &&
    cache.script === state.script &&
    cache.output === state.output &&
    cache.icons === options.icons &&
    cache.width === options.width &&
    cache.hovered === options.hovered &&
    cache.sample === sample &&
    sameLines(cache.body, body)
  ) {
    return cache.value;
  }
  const value = composeCodemodeBody(body, details, state, theme, options);
  tool.__codemodeComposed = {
    body,
    details,
    script: state.script,
    output: state.output,
    icons: options.icons,
    width: options.width,
    hovered: options.hovered,
    sample,
    value,
  };
  return value;
}

/**
 * A framed codemode box as a call list: the row a group would show for it
 * (`✓ codemode bash×2 read×1 · 0.1s`) in place of pi's title, then the calls,
 * with the script and the output folded to one row each. The row is handed
 * back apart from the body: every other framed tool puts its title in the top
 * border, and this one had no title of its own to put there. Undefined keeps
 * pi's layout: no renderer to draw it again, or nothing to fold yet (the
 * script is still streaming, or the output cannot be told from the calls).
 */
function composeFramedCodemode(
  tool: ToolBoxInternals,
  w: number,
  theme: ThemeLike,
  icons: boolean,
): { title: string; lines: string[]; toggles: CodemodeToggle[] } | undefined {
  const width = w - 2;
  const body = fullCodemodeBody(tool, width, theme);
  if (!body) return undefined;
  // The rules and the title stop a cell short of the right border: pi's rows
  // keep a cell of padding there, as they do on the left.
  const composed = composedCodemode(tool, body, theme, { icons, width: width - 1, hovered: codemodeHover(tool) });
  if (composed.toggles.length === 0) return undefined;
  // The title reads the result, which the body was drawn from: a new result is
  // a new body, and so a new composition.
  const cache = tool.__codemodeList;
  if (cache && cache.composed === composed && cache.w === w && cache.icons === icons) return cache.value;
  // The row goes into the top border, so it has to pay for the border's own
  // `╭─ ` and ` ─╮` cells before the body does: laid out at the full width it
  // would be clipped there, and the clip takes the duration first.
  const title = formatToolLine(tool, theme, { icons, width: Math.max(1, w - 6) });
  const value = { title, lines: composed.lines, toggles: composed.toggles };
  tool.__codemodeList = { composed, w, icons, value };
  return value;
}

/** The rounded box at width `w` (what pi would draw, reframed). */
  function frameBox(this: ToolBoxInternals, w: number, theme: ThemeLike, unframed = false): string[] {
    trackTool(this);
    const { icons, toolColors, partialLines } = toolOptions.get();
    // 0 collapsed, 1 the partial view ctrl+o gives, 2 the whole output.
    const level: 0 | 1 | 2 = this.expanded ? (this.__tidyExpand ?? 1) : 0;
    const partial = level === 1 ? Math.max(0, partialLines) : 0;
    const source = !this.hasRendererDefinition()
      ? this.contentText
      : this.getRenderShell() === "self"
        ? this.selfRenderContainer
        : this.contentBox;
    // The icon cells come off the call row's render width so nothing
    // truncates. Layout: ` <kind> <file> /tmp/x.ts` — the kind icon leads
    // (replacing the tool-name word, which is removed as redundant), the
    // file-type icon sits directly in front of the path (the same role
    // `$` plays for bash). When the path can't be located in the rendered
    // row, the file icon falls back into the prefix.
    let kindPrefix = "";
    let fileGlyph = "";
    let filePath = "";
    if (icons) {
      kindPrefix = ` ${toolKindIcon(this.toolName)} `;
      if (PATH_ARG_TOOLS.has(this.toolName)) {
        const p = (this.args as { path?: unknown } | undefined)?.path;
        if (typeof p === "string" && p) {
          fileGlyph = fileIcon(p);
          filePath = p;
        }
      }
    }
    const iconCells = (kindPrefix ? visibleWidth(kindPrefix) : 0) + (fileGlyph ? visibleWidth(fileGlyph) + 1 : 0);
    const sourceWidth = w - 2 - iconCells;
    const split = splitEditBody(this, w - 2, sourceWidth, theme);
    // Inside a group a codemode body is a call list: the script and the output
    // fold to one row each (they open on click, see tool-group-view.ts), and
    // every row sits one rail deeper than the call it belongs to. In a frame of
    // its own it is the same list, under the row a group would show for it.
    const codemode = this.toolName === "codemode";
    const collapse = codemode && unframed;
    const listed = codemode && !unframed ? composeFramedCodemode(this, w, theme, icons) : undefined;
    const railCells = collapse ? 2 : 0;
    const codemodeRows: CodemodeToggle[] = [];
    let raw: string[];
    if (collapse) {
      const body = source.render(sourceWidth - railCells);
      const composed = composedCodemode(this, body, theme, {
        icons,
        width: sourceWidth - railCells,
        hovered: codemodeHover(this),
      });
      const rail = `${theme.fg(toolOptions.get().gutterColor, "│")} `;
      raw = composed.lines.map((line) => rail + line);
      codemodeRows.push(...composed.toggles);
    } else if (listed) {
      raw = listed.lines;
    } else {
      raw = codemode
        ? decorateCodemodeBody(split ? split.raw : source.render(sourceWidth), this.result?.details, { icons, width: sourceWidth })
        : split
          ? split.raw
          : source.render(sourceWidth);
    }
    this.__codemodeToggles = codemodeRows;
    // The framed list's fold rows, as rows of this box's output: the top border
    // is row 0 and the body starts under it, so every row is one deeper.
    this.__codemodeFolds = listed?.toggles.map((toggle) => ({ row: toggle.row + 1, section: toggle.section }));
    // An open fold row reads the same hovered or not; only the band tells.
    const hovered = listed ? (codemodeHover(this) ?? "") : "";

    // The whole returned array is cached, not just the framed body.
    // pi-powerline-footer's compositor re-renders the entire root on every
    // mouse packet while scrolling, so an unchanged box must cost a key
    // check and nothing more — no re-framing its lines.
    //
    // Border color tracks tool state, then per-tool identity: pending is
    // grey and error is red no matter what; a successful box takes its
    // tool's configured color, falling back to the theme accent.
    const color = this.isPartial ? "borderMuted" : this.result?.isError ? "error" : toolColors[this.toolName] || "accent";
    // An expanded box gets a blank row before and after; a diff body is always
    // "expanded" (it is the point of the box), so it always does. An opened
    // body inside a group is expanded by definition.
    // (A codemode body under a group keeps its own rail and fold rows, so the
    // breathing rows would shift them; it hangs under a tick already.)
    const padBox = !collapse && (this.expanded || !!split || unframed);
    // Image boxes skip the cache entirely: the line key says nothing about
    // an image component being swapped in (kitty PNG conversion finishes
    // asynchronously and rebuilds them), so a hit would freeze the box on
    // its pre-conversion frame.
    const cacheable = this.imageComponents.length === 0;
    const cache = this.__frameCache;
    if (
      cacheable &&
      cache &&
      cache.width === w &&
      cache.color === color &&
      cache.expanded === this.expanded &&
      cache.level === level &&
      cache.partial === partial &&
      cache.icons === icons &&
      cache.unframed === unframed &&
      cache.hovered === hovered &&
      sameLines(cache.raw, raw)
    ) {
      this.__frameGeometry = cache.geometry;
      return cache.out;
    }

    // pi's default shell pads content by one cell on every side; the frame
    // supplies the vertical part, so only the blank padding rows are dropped.
    // `Text` hands back its own cached array — never write into `raw`.
    const edges = blankEdges(raw);
    let content = edges.start === 0 && edges.end === raw.length ? raw : raw.slice(edges.start, edges.end);
    // The kind icon prefixes the call row that pi drew first. A composed codemode
    // body has no call row: its first row is the script's fold label, which the
    // row above already introduces, and prefixing it pushed that row off the
    // body's rail (issue #31 review).
    if (icons && content.length > 0 && !collapse && !listed) {
      let first = content[0];
      // The kind icon already names the tool — drop the redundant word.
      if (PATH_ARG_TOOLS.has(this.toolName)) {
        const stripped = removeLeadingWord(first, this.toolName);
        if (stripped !== first) first = stripped.replace(/^ +/, "");
      }
      let row = kindPrefix + first;
      if (fileGlyph) {
        // renderToolPath shortens $HOME to `~` in the display text — try
        // the raw path first, then its shortened form.
        const home = homedir();
        const candidates = filePath.startsWith(home) ? [filePath, `~${filePath.slice(home.length)}`] : [filePath];
        let at = -1;
        for (const candidate of candidates) {
          const idx = visibleIndexOf(row, candidate);
          if (idx >= 0) {
            at = outsideHyperlink(row, idx);
            break;
          }
        }
        row = at >= 0 ? row.slice(0, at) + fileGlyph + " " + row.slice(at) : kindPrefix + fileGlyph + " " + first;
      }
      content = [row, ...content.slice(1)];
    }
    // Unframed means the call row is already the row above it: the body is the
    // output, not the command again. The blank row that separated them goes too.
    // A composed codemode body has already dropped pi's call row, and its first
    // row is the script's fold label, which is the body's to keep.
    if (unframed && content.length > 0 && !collapse) {
      content = content.slice(1);
      const rest = blankEdges(content);
      content = rest.start === 0 && rest.end === content.length ? content : content.slice(rest.start, rest.end);
    }
    // bash's result renderer ends with a "Took 0.1s" footer (and the blank row
    // above it). The box shows output only; the duration is on the row.
    if (!unframed && this.toolName === "bash" && content.length > 0) {
      let end = content.length;
      while (end > 0 && !visibleText(content[end - 1]!).trim()) end--;
      const last = end > 0 ? visibleText(content[end - 1]!) : "";
      if (/^\s*Took\s/.test(last)) {
        end--;
        while (end > 0 && !visibleText(content[end - 1]!).trim()) end--;
        content = content.slice(0, end);
      }
    }
    // A file tool's call row is a title (`󰛦 󰈔 path`), not body: the frame's top
    // border is where a title belongs. bash's command row is one too. So is a framed codemode list's summary
    // row, which a group draws above the box — the same row, one line up. Only
    // framed boxes have a border; inside a group the row above already carries
    // the call.
    const titleFromCall = PATH_ARG_TOOLS.has(this.toolName) || this.toolName === "bash";
    const pathTitle = !unframed && !collapse && !listed && titleFromCall && content.length > 1
      ? trimTrailingSpaces(stripBackgroundFills(content[0])).trim()
      : "";
    let titleShift = 0;
    if (pathTitle) {
      // The write preview puts a blank row between its title and the text;
      // the border already separates them, so the body never starts with one.
      let lead = 1;
      while (lead < content.length && !visibleText(content[lead]).trim()) lead++;
      content = content.slice(lead);
      titleShift = lead;
    }
    const title = pathTitle || (listed?.title.trim() ?? "");
    // ctrl+o is the partial view: the expanded rendering, cut to the first few
    // rows with a hint to the full one.
    if (partial > 0 && content.length > partial) {
      const hidden = content.length - partial;
      content = [
        ...content.slice(0, partial),
        theme.fg("muted", `… (+${hidden} lines, ctrl+shift+o to expand)`),
      ];
    }
    // The fold row under the pointer wears the hover band, inside the frame.
    let banded: ReadonlySet<number> | undefined;
    const bandRow = hovered ? listed?.toggles.find((toggle) => toggle.section === hovered)?.row : undefined;
    if (bandRow !== undefined && bandRow < content.length) {
      content = content.slice();
      content[bandRow] = hoverBand(content[bandRow]!, w - 2, theme);
      banded = new Set([bandRow]);
    }
    const drawn: string[] = [];
    if (content.length > 0) {
      // Split-diff rows carry their own tint, as does a hovered fold row;
      // everything else stays transparent.
      const splitBg = split && edges.start > 0
        ? new Set([...split.bgRows].map((row) => row - edges.start).filter((row) => row >= 0))
        : split?.bgRows;
      let bgRows = banded ?? (splitBg && titleShift
        ? new Set([...splitBg].map((row) => row - titleShift).filter((row) => row >= 0))
        : splitBg);
      // The breathing rows are part of the box: blank rows inside the frame.
      let body = content;
      if (padBox) {
        body = ["", ...content, ""];
        if (bgRows) bgRows = new Set([...bgRows].map((row) => row + 1));
      }
      const framed = drawFrame(body, w, theme, color, bgRows);
      if (title) framed[0] = labeledTopBorder(w, theme, color, truncateToWidth(title, Math.max(1, w - 6), "…"));
      // Unframed: the row above already carries the frame of reference (the
      // group rail), so only the body is drawn — borders dropped, cells kept.
      if (unframed) {
        // Borders dropped, cells kept: the body is the content columns only.
        for (const line of framed.slice(1, -1)) drawn.push(sliceByColumn(line, 1, Math.max(1, w - 2)));
      } else {
        for (const line of framed) drawn.push(line);
      }
    }
    // No leading spacer: the box butts against whatever came before it. pi
    // puts one there for its own unframed shell, which we replaced with the
    // frame — inside a transcript it just reads as a stray blank row.
    const out: string[] = drawn;
    // Output: [spacer, top border, content…, bottom border] — content row 0
    // is source row `edges.start`. Unframed drops the spacer and both borders,
    // so the body starts on the first line. A filled box has no borders: the
    // title row (if any) sits above content row 0 and the body starts one cell in.
    const geometry: FrameGeometry = unframed
      ? {
          top: (padBox ? 1 : 0) - (edges.start + 1),
          height: raw.length,
          width: sourceWidth - 2,
          bordered: false,
        }
      : {
          top: (title ? 1 : 0) + (padBox ? 1 : 0) - edges.start - titleShift,
          height: raw.length,
          width: sourceWidth,
        };
    this.__frameGeometry = content.length > 0 ? geometry : undefined;
    // Images stay outside the frame: their lines carry terminal graphics
    // payloads that padding/truncation would corrupt.
    for (let i = 0; i < this.imageComponents.length; i++) {
      const spacer = this.imageSpacers[i];
      if (spacer) for (const line of spacer.render(w)) out.push(line);
      const image = this.imageComponents[i];
      if (image) for (const line of image.render(w)) out.push(line);
    }

    if (out.length === 0) return [];
    if (cacheable) this.__frameCache = { width: w, color, expanded: this.expanded, level, partial, icons, unframed, hovered, raw, out, geometry };
    return out;
  }

  proto.render = function (this: ToolBoxInternals, width: number): string[] {
    const theme = getTheme();
    if (!theme || !tidyEnabled.get()) {
      this.__frameGeometry = undefined;
      return originalRender.call(this, width);
    }
    try {
      this.__tidyTurnRendered = true;
      if (this.hideComponent) return [];
      if (hideTurnTool(this.toolCallId)) {
        // Carriers still register while the turn is folded. Its tools must
        // register too, especially the pinned boundaries that split groups.
        if (grouping()) planFor(this, toolOptions.get().alwaysShow.has(this.toolName));
        return [];
      }
      const w = Math.max(4, width);
      if (grouping()) {
        const { icons, alwaysShow } = toolOptions.get();
        const grouped = renderGroupedTool(
          this,
          w,
          theme,
          { icons, pinned: alwaysShow.has(this.toolName) },
          (boxWidth, unframed) => frameBox.call(this, boxWidth, theme, unframed),
        );
        if (grouped) return grouped;
      }
      return frameBox.call(this, w, theme);
    } catch {
      this.__frameGeometry = undefined;
      return originalRender.call(this, width);
    }
  };
}
