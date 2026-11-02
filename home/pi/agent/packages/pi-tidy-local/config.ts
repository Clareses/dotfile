import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { UserMessageStyle } from "./user-message.ts";
import type { CollapseTurns } from "./turn-state.ts";

export interface MessageBorderColors {
  user: string;
  compaction: string;
  branch: string;
  skill: string;
  custom: string;
}

export interface TidyConfig {
  enabled: boolean;
  highlightBash: boolean;
  /** Give message boxes the same rounded transparent frame as tool boxes. */
  frameMessages: boolean;
  /**
   * How user messages look: "frame" (the rounded message frame, hugging the
   * text, the user icon in its top border), "rail" (rules above and below, an
   * accent `│` in front of the text) or "off" (pi's own).
   */
  userMessageStyle: UserMessageStyle;
  /** Alignment of a framed user message and its border icon. */
  userMessageAlign: "left" | "right";
  /** Fold a whole run live or only after settlement. */
  collapseTurns: CollapseTurns;
  /** Frame only the settled final assistant reply, independently of folding. */
  frameFinalReply: boolean;
  /** Rail-only rows between each rule and the text of a "rail" user message. */
  userMessagePaddingY: number;
  /** "rail" user message colors: theme color names or `#rrggbb`. */
  userMessageColors: { rail: string; rule: string };
  /** Prepend Nerd Font icons (tool kind / file type / message kind). */
  icons: boolean;
  /**
   * Collapsed bash result preview height, in visual lines (default 1). pi's own
   * bash renderer hard-codes 5 and has no setting; `ctrl+o` still shows everything.
   */
  bashResultLines: number;
  /**
   * Collapsed write preview height, in visual lines (default 10, pi's own
   * number). `0` hides the preview until the box is expanded.
   */
  writeLines: number;
  /**
   * Collapse one assistant segment's tool calls into a single summary line.
   * Click the line for one row per call, click a row for the full box.
   */
  groupTools: boolean;
  /** Groups start open instead of folded; `/cot` toggles it at runtime. */
  groupOpen: boolean;
  /**
   * Deprecated: every call folds to a row and opens into a box of its own, so
   * this no longer changes folding. Kept for settings compatibility; it still
   * suppresses background-job tracking on those tools.
   */
  alwaysShowTools: string[];
  /** Track background jobs (pi-processes) on the row of the call that started them. */
  backgroundJobs: boolean;
  /** Hide a job's notification messages when its row already shows them. */
  hideJobNotifications: boolean;
  /**
   * Render an edit's diff as two panes (old | new) with line numbers, a
   * coloured bar and a tinted row per changed line. Falls back to pi's
   * unified diff when the box is too narrow (see `splitDiffMinWidth`).
   */
  splitDiff: boolean;
  /** Box width below which the split becomes unreadable; pi's diff is used. */
  splitDiffMinWidth: number;
  /**
   * Diff body rows shown while the box is collapsed (default 20). The window
   * follows the first changed line, not the top of the file; `ctrl+o` shows all.
   * edit has no such budget of its own — pi draws the whole diff.
   */
  diffLines: number;
  /** Per-kind theme fg colors for message-box borders (any ThemeColor name). */
  messageBorderColors: MessageBorderColors;
  /**
   * Theme color for thinking: the `🧠` row, the counting entry in the summary
   * line, and the border of an expanded thinking box. Any theme color name or
   * `#rrggbb`.
   */
  thinkingColor: string;
  /** Theme color for a tool group's rail, tick and chevron (default `muted`). */
  gutterColor: string;
  /**
   * Thinking starts expanded: a run's full text instead of its one-line
   * preview, inside a group and outside one. A click still folds it.
   */
  thinkingOpen: boolean;
  /**
   * Per-tool border color for successful executions (theme fg color names;
   * pending stays grey, error stays red). When set in settings, the map
   * REPLACES the defaults entirely — `{}` disables per-tool colors.
   */
  toolColors: Record<string, string>;
}

/** pi's own collapsed write preview height; `writeLines` defaults to it. */
export const PI_WRITE_PREVIEW_LINES = 10;

const DEFAULT_TOOL_COLORS: Record<string, string> = {
  bash: "bashMode",
  read: "toolTitle",
  edit: "syntaxVariable",
  write: "syntaxVariable",
  grep: "syntaxOperator",
  find: "syntaxOperator",
  ls: "syntaxOperator",
  mcp: "customMessageLabel",
};

const DEFAULTS: TidyConfig = {
  enabled: true,
  highlightBash: true,
  frameMessages: true,
  userMessageStyle: "frame",
  userMessageAlign: "left",
  collapseTurns: "off",
  frameFinalReply: false,
  userMessagePaddingY: 1,
  userMessageColors: { rail: "accent", rule: "borderMuted" },
  icons: true,
  bashResultLines: 1,
  writeLines: PI_WRITE_PREVIEW_LINES,
  groupTools: true,
  groupOpen: true,
  alwaysShowTools: ["edit", "write"],
  backgroundJobs: true,
  hideJobNotifications: true,
  splitDiff: true,
  splitDiffMinWidth: 72,
  diffLines: 20,
  partialLines: 12,
  thinkingColor: "warning",
  gutterColor: "muted",
  thinkingOpen: true,
  messageBorderColors: {
    user: "toolTitle",
    compaction: "customMessageLabel",
    branch: "mdCode",
    skill: "accent",
    custom: "warning",
  },
  toolColors: DEFAULT_TOOL_COLORS,
};

const USER_MESSAGE_STYLES: readonly UserMessageStyle[] = ["rail", "frame", "off"];

// The pre-0.5 `frameUserMessages` needs no reading: `true` asked for the frame,
// which is the default now, and `false` meant "leave them to pi-starline",
// which no longer draws them.
function userMessageStyle(toolbox: any): UserMessageStyle {
  const style = toolbox?.userMessageStyle;
  return USER_MESSAGE_STYLES.includes(style) ? style : DEFAULTS.userMessageStyle;
}

function stringEntries(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function readSettings(): any {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf-8"));
}

export function loadConfig(): TidyConfig {
  try {
    // `tidy` since the rename from pi-toolbox; the old key keeps working.
    const settings = readSettings();
    const toolbox = settings?.tidy ?? settings?.toolbox;
    return {
      enabled: toolbox?.enabled ?? DEFAULTS.enabled,
      highlightBash: toolbox?.highlightBash ?? DEFAULTS.highlightBash,
      frameMessages: toolbox?.frameMessages ?? DEFAULTS.frameMessages,
      userMessageStyle: userMessageStyle(toolbox),
      userMessageAlign: toolbox?.userMessageAlign === "right" ? "right" : "left",
      collapseTurns: ["afterRun", "live"].includes(toolbox?.collapseTurns) ? toolbox.collapseTurns : "off",
      frameFinalReply: typeof toolbox?.frameFinalReply === "boolean" ? toolbox.frameFinalReply : false,
      userMessagePaddingY:
        Number.isInteger(toolbox?.userMessagePaddingY) && toolbox.userMessagePaddingY >= 0
          ? Math.min(3, toolbox.userMessagePaddingY)
          : DEFAULTS.userMessagePaddingY,
      userMessageColors: {
        ...DEFAULTS.userMessageColors,
        ...stringEntries(toolbox?.userMessageColors),
      },
      icons: toolbox?.icons ?? DEFAULTS.icons,
      bashResultLines: typeof toolbox?.bashResultLines === "number" ? toolbox.bashResultLines : DEFAULTS.bashResultLines,
      writeLines: typeof toolbox?.writeLines === "number" ? toolbox.writeLines : DEFAULTS.writeLines,
      groupTools: typeof toolbox?.groupTools === "boolean" ? toolbox.groupTools : DEFAULTS.groupTools,
      groupOpen: typeof toolbox?.groupOpen === "boolean" ? toolbox.groupOpen : DEFAULTS.groupOpen,
      alwaysShowTools: Array.isArray(toolbox?.alwaysShowTools)
        ? toolbox.alwaysShowTools.filter((name: unknown): name is string => typeof name === "string")
        : DEFAULTS.alwaysShowTools,
      backgroundJobs: typeof toolbox?.backgroundJobs === "boolean" ? toolbox.backgroundJobs : DEFAULTS.backgroundJobs,
      hideJobNotifications:
        typeof toolbox?.hideJobNotifications === "boolean" ? toolbox.hideJobNotifications : DEFAULTS.hideJobNotifications,
      splitDiff: typeof toolbox?.splitDiff === "boolean" ? toolbox.splitDiff : DEFAULTS.splitDiff,
      splitDiffMinWidth:
        typeof toolbox?.splitDiffMinWidth === "number" ? toolbox.splitDiffMinWidth : DEFAULTS.splitDiffMinWidth,
      diffLines: typeof toolbox?.diffLines === "number" ? toolbox.diffLines : DEFAULTS.diffLines,
      partialLines:
        typeof toolbox?.partialLines === "number" && toolbox.partialLines >= 0
          ? toolbox.partialLines
          : DEFAULTS.partialLines,
      thinkingColor: typeof toolbox?.thinkingColor === "string" ? toolbox.thinkingColor : DEFAULTS.thinkingColor,
      gutterColor: typeof toolbox?.gutterColor === "string" ? toolbox.gutterColor : DEFAULTS.gutterColor,
      thinkingOpen: typeof toolbox?.thinkingOpen === "boolean" ? toolbox.thinkingOpen : DEFAULTS.thinkingOpen,
      messageBorderColors: {
        ...DEFAULTS.messageBorderColors,
        ...toolbox?.messageBorderColors,
      },
      // Replace, not merge: removing a tool's color must be expressible.
      toolColors: toolbox?.toolColors ?? DEFAULTS.toolColors,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

