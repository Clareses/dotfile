/**
 * Rounded transparent frames for the message boxes pi draws outside tool
 * calls: compaction / branch / skill summaries, extension custom messages and
 * user messages in the "frame" style.
 *
 * Options live in global slots (see live.ts): every call updates them, and only
 * the first one installs the prototype patches, so a `/reload` with different
 * settings — including `frameMessages: false` — takes effect without a restart.
 */

import {
  BranchSummaryMessageComponent,
  CompactionSummaryMessageComponent,
  CustomMessageComponent,
  InteractiveMode,
  SkillInvocationMessageComponent,
  UserMessageComponent,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  drawFrame,
  formatMessageTime,
  italicDim,
  labeledTopBorder,
  sameLines,
  stripBackgroundFills,
  trimBlankEdges,
  trimTrailingSpaces,
} from "./frame-draw.ts";
import { MESSAGE_ICONS } from "./icons.ts";
import { liveSlot, tidyEnabled } from "./live.ts";
import { getTheme } from "./theme-access.ts";

// ═══════════════════════════════════════════════════════════════════════════
// Message boxes (compaction / branch summary)
// ═══════════════════════════════════════════════════════════════════════════

interface MessageBoxInternals {
  children: Array<{ render(width: number): string[] }>;
  expanded: boolean;
  render(width: number): string[];
  __msgFrameCache?: { width: number; sample: string; icons: boolean; lines: string[]; out: string[] };
}

interface MessageBoxOptions {
  enabled: boolean;
  borderColors: { compaction: string; branch: string; skill: string };
  icons: boolean;
}

const messageOptions = liveSlot<MessageBoxOptions | undefined>("message-box-options", undefined);

/**
 * Compaction, branch-summary, and skill-invocation boxes are plain `Box`es
 * with a filled `customMessageBg` background — ToolExecutionComponent never
 * sees them, so the tool frame patch leaves them in pi's default style. They
 * get the same rounded, transparent frame here, each drawn in its own color
 * from `borderColors` to keep them distinct from the tool state colors and
 * from each other. Children are rendered directly, skipping the Box's
 * background fill and padding, so the frame is the only chrome; on any
 * mismatch the original Box render runs.
 *
 * `enabled: false` turns installed patches into pass-throughs and installs
 * nothing new.
 */
export function patchMessageBoxes(
  borderColors: { compaction: string; branch: string; skill: string },
  icons = false,
  enabled = true,
): void {
  messageOptions.set({ enabled, borderColors, icons });
  if (!enabled) return;
  for (const [cls, kind] of [
    [CompactionSummaryMessageComponent, "compaction"],
    [BranchSummaryMessageComponent, "branch"],
    [SkillInvocationMessageComponent, "skill"],
  ] as const) {
    const proto = cls.prototype as unknown as MessageBoxInternals & { __toolboxFramed?: boolean };
    if (proto.__toolboxFramed) continue;
    proto.__toolboxFramed = true;

    const originalRender = proto.render;
    const icon = MESSAGE_ICONS[kind];

    proto.render = function (this: MessageBoxInternals, width: number): string[] {
      const options = messageOptions.get();
      const theme = getTheme();
      if (!theme || !options?.enabled || !tidyEnabled.get()) return originalRender.call(this, width);
      try {
        const { icons } = options;
        const borderColor = options.borderColors[kind];
        const w = Math.max(4, width);
        // Frame + one cell of horizontal padding on each side (+2 for the icon).
        const contentWidth = Math.max(1, icons ? w - 6 : w - 4);
        const content: string[] = [];
        for (const child of this.children) {
          for (const line of child.render(contentWidth)) {
            content.push(stripBackgroundFills(line));
          }
        }
        if (content.length === 0) return [];
        // The border color escape acts as a theme sample — a theme switch
        // with identical content must not hit the cache.
        const sample = theme.fg(borderColor, "·");
        const cache = this.__msgFrameCache;
        if (
          cache &&
          cache.width === w &&
          cache.sample === sample &&
          cache.icons === icons &&
          sameLines(cache.lines, content)
        )
          return cache.out;
        const padded = content.map((line, i) => (icons && i === 0 ? ` ${icon} ${line}` : ` ${line}`));
        // No blank row above the frame: pi puts a `Spacer(1)` in front of a
        // compaction, branch and skill box already (interactive-mode), and the
        // border is a separation in itself. A second row read as a stray gap
        // (issue #29).
        const out = drawFrame(padded, w, theme, borderColor);
        this.__msgFrameCache = { width: w, sample, icons, lines: content, out };
        return out;
      } catch {
        return originalRender.call(this, width);
      }
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Container boxes (user messages / extension custom messages)
// ═══════════════════════════════════════════════════════════════════════════

// OSC 133 zone markers UserMessageComponent puts on its first/last line —
// terminals use them for prompt navigation, so the framed output keeps them
// in the same positions.
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

interface ContainerBoxInternals {
  children: Array<{ render(width: number): string[] }>;
  /** CustomMessageComponent's default box; absent on UserMessageComponent. */
  box?: { render(width: number): string[] };
  /** Set when an extension renderer supplies its own styled component. */
  customComponent?: unknown;
  render(width: number): string[];
  __msgFrameCache?: { width: number; sample: string; icons: boolean; align: "left" | "right"; label: string; lines: string[]; out: string[] };
}

/**
 * User and extension custom messages are `Container`s whose visible box is an
 * inner `Box` with a filled background. The frame replaces that chrome: the
 * inner box renders one frame-width narrower, its background fills and
 * vertical padding rows are stripped, and the rounded border takes over —
 * the box's own horizontal padding is kept as the insets.
 */
export interface ContainerBoxOptions {
  icons?: boolean;
  /**
   * Frame user messages too (`userMessageStyle: "frame"`). The default
   * "rail" style is drawn by user-message.ts. While false, this patch leaves
   * UserMessageComponent alone (and is not installed if it never was).
   */
  includeUser?: boolean;
  /** Align the framed user message and its label; other message kinds stay left. */
  userAlign?: "left" | "right";
  /** False turns installed patches into pass-throughs and installs nothing new. */
  enabled?: boolean;
}

interface ResolvedContainerOptions {
  enabled: boolean;
  borderColors: { user: string; custom: string };
  icons: boolean;
  includeUser: boolean;
  userAlign: "left" | "right";
}

const containerOptions = liveSlot<ResolvedContainerOptions | undefined>("container-box-options", undefined);

/**
 * A user message's frame hugs its text: a one-word prompt gets a small box
 * instead of a full-width one, and a long one still stops at the full width.
 * The text keeps the one-cell inset it has on the left on its right as well,
 * and the box is never narrower than the icon in its top border.
 */
function hugContent(content: string[], width: number, labelWidth: number): { lines: string[]; width: number } {
  const lines = content.map(trimTrailingSpaces);
  const widest = lines.reduce((max, line) => Math.max(max, visibleWidth(line)), 0);
  const floor = labelWidth > 0 ? labelWidth + 6 : 0;
  return { lines, width: Math.min(width, Math.max(widest + 3, floor)) };
}

/** Where the user message's clock is kept: pi's component only holds the text. */
export const USER_MESSAGE_TIME = Symbol.for("pi-tidy:user-message-time");
const USER_TIME_PATCH = Symbol.for("pi-tidy:user-time-patch");

function installUserMessageTimes(): void {
  const proto = (InteractiveMode as any)?.prototype;
  const original = proto?.addMessageToChat;
  if (typeof original !== "function" || original[USER_TIME_PATCH]) return;
  const wrapped = function (this: any, message: any, options?: any) {
    const chat = this?.chatContainer;
    const before = Array.isArray(chat?.children) ? chat.children.length : -1;
    const result = original.call(this, message, options);
    if (message?.role === "user" && typeof message.timestamp === "number" && before >= 0) {
      for (let i = before; i < chat.children.length; i++) {
        const child = chat.children[i];
        if (child instanceof UserMessageComponent) (child as any)[USER_MESSAGE_TIME] = message.timestamp;
      }
    }
    return result;
  };
  (wrapped as any)[USER_TIME_PATCH] = true;
  proto.addMessageToChat = wrapped;
}

export function patchContainerBoxes(
  borderColors: { user: string; custom: string },
  options: ContainerBoxOptions = {},
): void {
  const { icons = false, includeUser = false, enabled = true, userAlign = "left" } = options;
  containerOptions.set({ enabled, borderColors, icons, includeUser, userAlign });
  if (!enabled) return;
  if (includeUser) installUserMessageTimes();

  const patch = (cls: { prototype: unknown }, kind: "user" | "custom") => {
    const proto = cls.prototype as ContainerBoxInternals & { __toolboxFramed?: boolean };
    if (proto.__toolboxFramed) return;
    proto.__toolboxFramed = true;

    const originalRender = proto.render;
    const icon = MESSAGE_ICONS[kind];
    const isUserMessage = kind === "user";

    proto.render = function (this: ContainerBoxInternals, width: number): string[] {
      const live = containerOptions.get();
      const theme = getTheme();
      if (!theme || !live?.enabled || !tidyEnabled.get() || (isUserMessage && !live.includeUser)) {
        return originalRender.call(this, width);
      }
      try {
        // An extension's custom renderer owns its styling — never frame it.
        if (this.customComponent) return originalRender.call(this, width);
        const box = this.box ?? this.children[0];
        if (!box) return originalRender.call(this, width);

        const { icons } = live;
        const align = isUserMessage ? live.userAlign : "left";
        const borderColor = live.borderColors[kind];
        const userTime = isUserMessage ? (this as any)[USER_MESSAGE_TIME] : undefined;
        const label = isUserMessage && icons
          ? theme.fg(borderColor, icon) + (typeof userTime === "number" ? ` ${italicDim(theme, formatMessageTime(userTime))}` : "")
          : "";
        const w = Math.max(4, width);
        // A custom message's icon takes two cells of its first row; rendering
        // the box narrower keeps every line lossless. A user message carries
        // its icon in the label instead.
        const iconInRow = icons && !isUserMessage;
        const raw = box.render(iconInRow ? w - 4 : w - 2).map(stripBackgroundFills);
        const content = trimBlankEdges(raw);
        if (content.length === 0) return [];
        if (iconInRow) content[0] = ` ${icon} ${content[0].replace(/^ +/, "")}`;

        const sample = theme.fg(borderColor, "·");
        const cache = this.__msgFrameCache;
        if (
          cache &&
          cache.width === w &&
          cache.sample === sample &&
          cache.icons === icons &&
          cache.align === align &&
          cache.label === label &&
          sameLines(cache.lines, content)
        )
          return cache.out;

        // A leading blank row separates the box from the transcript above it.
        // Custom messages need it: pi adds no spacer of its own there. A user
        // message gets a `Spacer(1)` from pi already, and its top border is a
        // separation in itself, so a second row reads as a stray gap.
        let out: string[];
        if (isUserMessage) {
          // `╭─  ─╮`: the icon is the frame's, so the text starts on its own
          // row and copies without it. No icons, no label: a plain top border.
          const framed = hugContent(content, w, visibleWidth(label));
          const frame = drawFrame(framed.lines, framed.width, theme, borderColor);
          if (label) frame[0] = labeledTopBorder(framed.width, theme, borderColor, label, align);
          const indent = align === "right" ? " ".repeat(w - framed.width) : "";
          out = indent ? frame.map((line) => indent + line) : frame;
        } else {
          out = ["", ...drawFrame(content, w, theme, borderColor)];
        }
        if (isUserMessage) {
          out[0] = OSC133_ZONE_START + out[0];
          out[out.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + out[out.length - 1];
        }
        this.__msgFrameCache = { width: w, sample, icons, align, label, lines: content, out };
        return out;
      } catch {
        return originalRender.call(this, width);
      }
    };
  };

  if (includeUser) patch(UserMessageComponent, "user");
  patch(CustomMessageComponent, "custom");
}
