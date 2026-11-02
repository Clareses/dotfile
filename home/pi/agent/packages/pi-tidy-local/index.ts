/**
 * pi-tidy — a tidy transcript for the pi coding agent: a reply's tool calls
 * fold into one clickable line, every box gets a rounded transparent frame.
 *
 * - every tool box (built-in, MCP, other extensions) gets a self-drawn rounded
 *   frame with status-aware border colors and no background fill
 * - bash commands are syntax-highlighted
 *
 * Configuration (settings.json → "tidy"; the pre-rename "toolbox" key still works):
 *   enabled: boolean        — enable/disable the extension (default: true)
 *   highlightBash: boolean  — syntax-highlight bash commands (default: true)
 *   frameMessages: boolean  — rounded frame on message boxes and on the user's
 *     own `!` / `!!` bash runs (default: true)
 *   userMessageStyle: "frame" | "rail" | "off" — user messages in a rounded
 *     frame hugging the text with the user icon in its top border, as pi's
 *     background fill with an accent rail and no rules, or pi's own (default: frame)
 *   userMessageAlign: "left" | "right" — framed user message and icon (default: left)
 *   collapseTurns: "off" | "afterRun" | "live" — outer process fold (default: off)
 *   frameFinalReply: boolean — frame the settled final reply (default: false)
 *   userMessagePaddingY: number — background rows around a "rail" message's
 *     text (default: 1, at most 3)
 *   userMessageColors: { rail, rule } — theme color names or #rrggbb
 *     (defaults accent / borderMuted; the rail style paints only the rail)
 *   icons: boolean          — Nerd Font icons on boxes (default: true)
 *   groupTools: boolean     — fold each segment's tool calls into one summary
 *     line; click for one row per call, a row for its box (default: true)
 *   groupOpen: boolean      — a new group starts with its `▾` header and every
 *     row showing; `/cot` toggles it for the whole session (default: true here)
 *   alwaysShowTools: string[] — deprecated, folding is uniform now
 *   backgroundJobs: boolean — a call that started a pi-processes job shows the
 *     job's live state on its row (default: true)
 *   hideJobNotifications: boolean — skip drawing that job's notification
 *     messages; the model still gets them (default: true)
 *   splitDiff: boolean      — edit diffs as two panes (old | new) with line
 *     numbers, coloured bars and a tint per changed row (default: true)
 *   splitDiffMinWidth: number — box width below which the split falls back to
 *     pi's unified diff (default: 72)
 *   diffLines: number       — diff rows drawn while an edit box is collapsed
 *     (default: 20, windowed at the first change; `ctrl+o` draws all of it,
 *     0 hides the body). pi's own edit renderer has no budget at all.
 *   thinkingColor: string   — color for thinking rows and the thinking box
 *     (default: warning, a yellow)
 *   gutterColor: string     — color for a group's rail, tick and chevron
 *     (default: muted, a readable slate instead of pi's near-invisible border grey)
 *   thinkingOpen: boolean   — thinking starts expanded instead of as a one-line
 *     preview; a click still folds it. No effect with groupTools: false, where
 *     pi draws thinking itself (default: false)
 *   messageBorderColors: per-kind theme fg colors for message-box borders
 *     (user/compaction/branch/skill/custom; defaults toolTitle/customMessageLabel/
 *      mdCode/accent/warning)
 *   toolColors: per-tool border color on success (replaces defaults when set)
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { keyHint, VERSION } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { formatBashCallHighlighted } from "./bash-highlight.ts";
import { patchContainerBoxes, patchMessageBoxes, patchToolBoxFrames } from "./frame.ts";
import { expandAllToolOutput, refreshToolBoxes } from "./tool-frame.ts";
import { Key } from "@earendil-works/pi-tui";
import { collapsedResultBudget, shrinkResultPreview } from "./result-preview.ts";
import { connectTurns } from "./turn-lifecycle.ts";
import { turnOptions } from "./turn-state.ts";
import { loadConfig, PI_WRITE_PREVIEW_LINES } from "./config.ts";
import { agentRunning, tidyEnabled } from "./live.ts";
import { patchBashExecutions } from "./bash-mode-frame.ts";
import { patchUserMessages } from "./user-message.ts";
import { formatWriteCallText } from "./write-preview.ts";
import { connectJobs, registerNestedJobs, type EventBusLike } from "./background-jobs.ts";
import { groupsOpen, setGroupsOpen } from "./tool-groups.ts";
import type { ThemeLike } from "./theme-access.ts";

export { highlightBashCommand, formatBashCallHighlighted } from "./bash-highlight.ts";
export { stripBackgroundFills, patchContainerBoxes, patchMessageBoxes, patchToolBoxFrames } from "./frame.ts";

interface BashRenderState {
  startedAt?: number;
  endedAt?: number;
  /** Our own slot: the execution extension may be using `callText` itself. */
  tidyCallText?: Text;
}

/**
 * Decorate bash's rows without registering a replacement tool.
 *
 * Both changes are presentation only: a syntax-highlighted command row, and a
 * smaller budget for the collapsed result preview. Registering `bash` to get
 * them meant any extension that also owns it (a sandbox, for instance) failed
 * to load with "Tool \"bash\" conflicts with …". As a renderer it composes: the
 * active tool keeps execution, schema, shell and result renderer, and `next()`
 * hands us whatever it has (pi's built-in renderers when it defines none).
 */
function registerBashRenderers(pi: ExtensionAPI, resultLines: number): void {
  if (!hasRendererApi(pi)) return;

  pi.registerToolRenderer((toolName, next) => {
    const renderers = next();
    if (toolName !== "bash" || !renderers) return renderers;

    const renderCall = (args: any, theme: ThemeLike, context: any) => {
      const state = context.state as BashRenderState;
      // The built-in renderResult reads these for the "Took Xs" footer. We
      // replaced the call renderer that normally sets them.
      if (context.executionStarted && state.startedAt === undefined) {
        state.startedAt = Date.now();
        state.endedAt = undefined;
      }
      const text = state.tidyCallText ?? new Text("", 0, 0);
      state.tidyCallText = text;
      // 折叠态(默认)只留命令首行 + `+N more lines`,和 pi 其它工具的折叠行为一致;
      // ctrl+o 展开后恢复整条命令(heredoc 之类)。
      text.setText(
        formatBashCallHighlighted(args, theme, {
          expanded: context.expanded,
          hint: keyHint("app.tools.expand", "to expand"),
        }),
      );
      return text;
    };

    // No result renderer downstream means nothing to budget; leave it absent
    // rather than inventing a bare component.
    const downstream = renderers.renderResult;
    if (!downstream) return { ...renderers, renderCall };

    return {
      ...renderers,
      renderCall,
      renderResult(result: any, options: any, theme: any, context: any) {
        // Whatever the execution extension draws stays: we only lower the
        // preview budget inside it.
        const component = downstream(result, options, theme, context);
        // 内置 bash 结果预览固定 5 行(BASH_PREVIEW_LINES),pi 没给配置项。
        // 折叠态下把它的行数预算改小;展开态和报错时保持原样(一行 traceback 没用)。
        const budget = collapsedResultBudget(resultLines, context.isError);
        if (!options.expanded && budget !== undefined) shrinkResultPreview(component, budget);
        return component;
      },
    };
  });
}

/**
 * Oldest pi everything works on: component mouse events (0.86), the bash
 * preview budget (1.0) and tool durations (1.1). Checked at load rather than
 * as a peer range — pi asks for `"*"` peers, and a peer conflict blocks every
 * npm install in pi's package directory, not just this one.
 */const MIN_PI = "1.1.0";

function olderThan(version: string, min: string): boolean {
  const parse = (v: string) => v.split(/[.-]/).slice(0, 3).map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parse(version), parse(min)];
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/**
 * Decorate write's call preview without registering a replacement tool. The
 * active tool (e.g. pi-playpen's sandboxed write) keeps ownership of execution,
 * and next() preserves its shell and result renderer, including error output.
 */
function registerWritePreview(pi: ExtensionAPI, lines: number): void {
  // No fallback to a tool override: a duplicate registration takes down
  // whoever else owns `write`. The caller has already warned (see entry point).
  if (!hasRendererApi(pi)) return;

  pi.registerToolRenderer((toolName, next) => {
    const renderers = next();
    if (toolName !== "write") return renderers;

    return {
      ...renderers,
      renderCall(args, theme, context) {
        // Rendering state is shared with the execution extension's renderers.
        // Use our own key so its cached components are not overwritten.
        const state = context.state as { tidyWriteCallText?: Text };
        const text = state.tidyWriteCallText ?? new Text("", 0, 0);
        state.tidyWriteCallText = text;
        const writeArgs = args as Parameters<typeof formatWriteCallText>[0];
        text.setText(formatWriteCallText(writeArgs, theme, { expanded: context.expanded, lines }));
        return text;
      },
    };
  });
}

/** `registerToolRenderer` arrived in pi 1.3; peer ranges stay `*` (see MIN_PI). */
function hasRendererApi(pi: ExtensionAPI): boolean {
  return typeof (pi as { registerToolRenderer?: unknown }).registerToolRenderer === "function";
}

/**
 * Say once, at session start, which renderer-backed features this pi cannot
 * have. Only features the user actually asked for — warning someone who left
 * `writeLines` at pi's own default would be pure noise.
 */
function warnUnavailableRenderers(pi: ExtensionAPI, features: string[]): void {
  if (features.length === 0) return;
  pi.on("session_start", (_event, ctx) => {
    const list = features.join(" and ");
    ctx.ui.notify(
      `pi-tidy: ${list} need pi.registerToolRenderer (pi 1.3 or newer). Upgrade pi to turn ${features.length === 1 ? "it" : "them"} on.`,
      "warning",
    );
  });
}

/** Pi extension entry point. */
export default function (pi: ExtensionAPI): void {
  const config = loadConfig();
  if (typeof VERSION === "string" && olderThan(VERSION, MIN_PI)) {
    pi.on("session_start", (_event, ctx) => {
      ctx.ui.notify(`pi-tidy needs pi ≥ ${MIN_PI} (this is ${VERSION}): clicks and durations won't work.`, "warning");
    });
  }
  // Patches installed by an earlier load (before a /reload) read this live,
  // so turning the extension off takes effect without a restart.
  turnOptions.set({ collapseTurns: config.collapseTurns, frameFinalReply: config.frameFinalReply, icons: config.icons });
  tidyEnabled.set(config.enabled);
  agentRunning.set(false);
  if (!config.enabled) return;
  if (config.collapseTurns !== "off" || config.frameFinalReply) connectTurns(pi);

  // The thinking row's "is this still arriving" cannot trust pi's private
  // `isStreaming` flag (it is not always settled), and a text-growth window
  // alone would keep spinning for a moment after the turn. The run's own
  // boundaries are the authority: set on start, cleared when the loop ends.
  pi.on("agent_start", () => agentRunning.set(true));
  pi.on("agent_end", () => agentRunning.set(false));
  pi.on("agent_settled", () => agentRunning.set(false));

  const unavailable: string[] = [];
  if (!hasRendererApi(pi)) {
    if (config.highlightBash) unavailable.push("bash highlighting and the `bashResultLines` budget");
    if (config.writeLines !== PI_WRITE_PREVIEW_LINES) unavailable.push("the custom write preview (`writeLines`)");
  }
  warnUnavailableRenderers(pi, unavailable);

  try {
    patchToolBoxFrames({
      icons: config.icons,
      toolColors: config.toolColors,
      groupTools: config.groupTools,
      groupOpen: config.groupOpen,
      alwaysShowTools: config.alwaysShowTools,
      backgroundJobs: config.backgroundJobs,
      hideJobNotifications: config.hideJobNotifications,
      splitDiff: config.splitDiff,
      splitDiffMinWidth: config.splitDiffMinWidth,
      diffLines: config.diffLines,
      partialLines: config.partialLines,
      thinkingColor: config.thinkingColor,
      gutterColor: config.gutterColor,
      thinkingOpen: config.thinkingOpen,
    });
    // ctrl+o stays pi's own "expand, but only the first rows" view; this is
    // the second level: every tool box's whole output.
    pi.registerShortcut(Key.ctrlShift("o"), {
      description: "Expand tool output in full",
      handler: () => {
        expandAllToolOutput();
      },
    });
    // `/cot`: open or fold every tool group at runtime (settings seed it).
    pi.registerCommand("cot", {
      description: "Toggle pi-tidy tool groups open/folded",
      handler: async (_args, ctx) => {
        const open = !groupsOpen.get();
        setGroupsOpen(open);
        refreshToolBoxes();
        ctx.ui.notify(`pi-tidy: tool groups ${open ? "open" : "folded"}`, "info");
      },
    });
    // Live job updates (pi-processes broadcasts on the shared extension bus).
    connectJobs(config.backgroundJobs ? (pi as { events?: EventBusLike }).events : undefined);
    if (config.backgroundJobs) registerNestedJobs(pi);
  } catch (error) {
    console.debug("[pi-tidy] tool box frame patch failed:", error);
  }

  try {
    // Called even when off: `enabled: false` turns patches from an earlier
    // load into pass-throughs.
    patchMessageBoxes(config.messageBorderColors, config.icons, config.frameMessages);
    patchContainerBoxes(config.messageBorderColors, {
      icons: config.icons,
      includeUser: config.userMessageStyle === "frame",
      userAlign: config.userMessageAlign,
      enabled: config.frameMessages,
    });
    patchUserMessages({
      style: config.userMessageStyle,
      railColor: config.userMessageColors.rail,
      ruleColor: config.userMessageColors.rule,
      paddingY: config.userMessagePaddingY,
      icons: config.icons,
    });
    patchBashExecutions({
      enabled: config.frameMessages,
      icons: config.icons,
      // The user's own commands wear the user's color, whichever style draws them.
      color:
        config.userMessageStyle === "rail" ? config.userMessageColors.rail : config.messageBorderColors.user,
    });
  } catch (error) {
    console.debug("[pi-tidy] message box frame patch failed:", error);
  }

  if (config.highlightBash) {
    try {
      registerBashRenderers(pi, config.bashResultLines);
    } catch (error) {
      console.debug("[pi-tidy] bash renderer failed:", error);
    }
  }

  try {
    registerWritePreview(pi, config.writeLines);
  } catch (error) {
    console.debug("[pi-tidy] write preview renderer failed:", error);
  }
}
