/**
 * User messages as a rail on pi's own fill: the message keeps pi's full-width
 * `userMessageBg` background, an accent `│` leads every row, and there are no
 * rules above/below and no icon. Rows after the first hang under the text.
 *
 * pi's UserMessageComponent is one Markdown child that already carries the
 * markdown theme, pi's markdown options, the registered markdown transformers
 * (pi-ide-context's selection references among them) and the `userMessageBg`
 * fill. The rail renders that child one cell narrower and only prepends the
 * rail cell, so the text pipeline — and its background — stay pi's own.
 *
 * `userMessageStyle: "frame"` is drawn by message-frame.ts instead; this patch
 * passes through for every style but "rail", so the two stack in either order.
 */

import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import { padToWidth, sameLines, trimBlankEdges } from "./frame-draw.ts";
import { liveSlot, tidyEnabled } from "./live.ts";
import { paint } from "./paint.ts";
import { getTheme, type ThemeLike } from "./theme-access.ts";

export type UserMessageStyle = "rail" | "frame" | "off";

export interface UserMessageOptions {
  style: UserMessageStyle;
  /** Theme color name or `#rrggbb`. */
  railColor: string;
  /** Kept for the config shape; the rail style draws no rules. */
  ruleColor: string;
  /** Background-filled rows above and below the text. */
  paddingY: number;
  /** Kept for the config shape; the rail style draws no icon. */
  icons: boolean;
}

/**
 * The rail glyph is fixed: pi-starline's clean copy recognises user message
 * rows by it and strips it from the clipboard.
 */
export const USER_RAIL_GLYPH = "│";

// OSC 133 zone markers pi puts on the first/last line — terminals use them for
// prompt navigation, so the rail keeps them in the same positions.
const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

interface UserMessageInternals {
  children: Array<{ render(width: number): string[] }>;
  /** Horizontal padding pi gives the Markdown child (1 by default). */
  outputPad?: number;
  render(width: number): string[];
  __tidyRailCache?: { width: number; sample: string; paddingY: number; icons: boolean; raw: string[]; out: string[] };
}

const userMessageOptions = liveSlot<UserMessageOptions | undefined>("user-message-options", undefined);

function renderRail(
  component: UserMessageInternals,
  width: number,
  theme: ThemeLike,
  options: UserMessageOptions,
): string[] | undefined {
  // Row layout: rail, a space, text. The child's own `outputPad` gives it a
  // one-cell left margin; at that setting the rail takes that cell's place and
  // the margin becomes the gap. Its `userMessageBg` fill already spans the row.
  const childPad = (component.outputPad ?? 1) > 0;
  const childWidth = childPad ? width - 1 : width - 2;
  const raw: string[] = [];
  for (const child of component.children) raw.push(...child.render(childWidth));

  const rail = paint(theme, options.railColor, USER_RAIL_GLYPH);
  // pi paints the message with `userMessageBg`; the rail rides that fill, so
  // nothing is stripped and there are no rule rows to paint.
  const bg = (text: string): string => (theme.bg ? theme.bg("userMessageBg", text) : text);
  const lead = bg(childPad ? rail : `${rail} `);
  // The painted cell doubles as a theme sample: a theme switch with identical
  // content must not hit the cache.
  const sample = lead;
  const cache = component.__tidyRailCache;
  if (
    cache &&
    cache.width === width &&
    cache.sample === sample &&
    cache.paddingY === options.paddingY &&
    sameLines(cache.raw, raw)
  )
    return cache.out;

  const content = trimBlankEdges(raw);
  if (content.length === 0) return undefined;

  const padRows = Array.from({ length: options.paddingY }, () => bg(padToWidth(rail, width)));
  const rows = content.map((line) => lead + line);
  const out = [...padRows, ...rows, ...padRows];
  out[0] = OSC133_ZONE_START + out[0];
  out[out.length - 1] = OSC133_ZONE_END + OSC133_ZONE_FINAL + out[out.length - 1];
  component.__tidyRailCache = { width, sample, paddingY: options.paddingY, icons: false, raw, out };
  return out;
}

/**
 * The true pi render, captured once for the process. A `/reload` builds a new
 * module instance whose wrapper must replace the previous one (not stack on
 * it), so edits to `renderRail` land on reload instead of needing a restart.
 */
const ORIGINAL_RENDER = Symbol.for("pi-tidy:user-message-original-render");

/**
 * Install the rail patch. Any style but "rail", `tidy.enabled: false`, a
 * missing theme or a render error falls through to the render underneath.
 */
export function patchUserMessages(options: UserMessageOptions): void {
  userMessageOptions.set(options);
  const proto = UserMessageComponent.prototype as unknown as UserMessageInternals;
  const holder = proto as unknown as Record<symbol, unknown>;
  if (!holder[ORIGINAL_RENDER]) holder[ORIGINAL_RENDER] = proto.render;
  const originalRender = holder[ORIGINAL_RENDER] as (width: number) => string[];

  proto.render = function (this: UserMessageInternals, width: number): string[] {
    const live = userMessageOptions.get();
    const theme = getTheme();
    if (!theme || live?.style !== "rail" || !tidyEnabled.get() || width < 6) {
      return originalRender.call(this, width);
    }
    try {
      return renderRail(this, width, theme, live) ?? originalRender.call(this, width);
    } catch {
      return originalRender.call(this, width);
    }
  };
}
