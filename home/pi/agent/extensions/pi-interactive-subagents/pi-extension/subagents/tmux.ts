/**
 * tmux surface layer — the only terminal multiplexer this extension supports.
 *
 * Everything the extension does to a pane goes through the small API in this
 * file: create/split a pane, type a command into it, read its screen, close
 * it, and poll for exit. Keeping the tmux calls isolated here means index.ts
 * stays testable without a multiplexer running.
 *
 * Panes are identified by tmux pane ids (e.g. `%12`). Splits always target
 * the parent pi's pane (`$TMUX_PANE`) so they follow the agent rather than
 * the user's focus.
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);

// ── Availability ──

const commandAvailability = new Map<string, boolean>();

function hasCommand(command: string): boolean {
  if (commandAvailability.has(command)) {
    return commandAvailability.get(command)!;
  }

  let available = false;
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    available = true;
  } catch {
    available = false;
  }

  commandAvailability.set(command, available);
  return available;
}

/**
 * True when running inside tmux with the tmux binary on PATH.
 * `TMUX` is set by tmux in every process it spawns (shell or pane).
 */
export function isTmuxAvailable(): boolean {
  return !!process.env.TMUX && hasCommand("tmux");
}

export function isMuxAvailable(): boolean {
  return isTmuxAvailable();
}

export function muxSetupHint(): string {
  return "Start pi inside tmux (`tmux new -A -s pi 'pi'`).";
}

function requireTmux(): void {
  if (!isTmuxAvailable()) {
    throw new Error(`tmux is required for subagents. ${muxSetupHint()}`);
  }
}

// ── Shell helpers ──

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ── Subagent pane placement & layout ──

/**
 * Layout policy for subagent panes (this fork's custom rule). Which regime
 * applies is decided by whether the parent pi window already holds a foreign
 * pane — one the user opened, i.e. neither the pi pane nor one of ours:
 *
 *  A. Clean parent window (no foreign pane):
 *       subagents live in the right half of the window, stacked top→bottom
 *       (1 = full height, 2 = halves, 3 = thirds, 4 = quarters). Up to
 *       MAX_MAIN_SUBAGENTS_CLEAN fit here.
 *
 *  B. Parent window already has a foreign pane:
 *       never touch the user's panes. The first MAX_MAIN_SUBAGENTS_CROWDED
 *       subagents are added to the right of the pi pane, side by side
 *       (left↔right); any further subagent goes to a dedicated tiled window
 *       named DEDICATED_WINDOW_NAME.
 *
 * Panes are addressed by tmux pane id; splits always target the parent pane
 * (`$TMUX_PANE`) or a sibling so they follow the agent, never the user's focus.
 */
const MAX_MAIN_SUBAGENTS_CLEAN = 4;
const MAX_MAIN_SUBAGENTS_CROWDED = 2;
const DEDICATED_WINDOW_NAME = "subagents";

/** Expose the layout policy so callers (tool descriptions) can stay in sync. */
export function subagentLayoutConfig(): {
  maxClean: number;
  maxCrowded: number;
  dedicatedWindowName: string;
} {
  return {
    maxClean: MAX_MAIN_SUBAGENTS_CLEAN,
    maxCrowded: MAX_MAIN_SUBAGENTS_CROWDED,
    dedicatedWindowName: DEDICATED_WINDOW_NAME,
  };
}

function tmux(args: string[]): string {
  return execFileSync("tmux", args, { encoding: "utf8" });
}

function paneField(pane: string, format: string): string | undefined {
  try {
    const value = tmux(["display-message", "-p", "-t", pane, format]).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

/** True when `pane` (e.g. `%12`) still exists. */
export function isPaneAlive(pane: string): boolean {
  return paneField(pane, "#{pane_id}") === pane;
}

function windowOf(pane: string): string | undefined {
  return paneField(pane, "#{window_id}");
}

function sessionOf(pane: string): string | undefined {
  return paneField(pane, "#{session_id}");
}

function listWindowPanes(windowId: string): string[] {
  try {
    return tmux(["list-panes", "-t", windowId, "-F", "#{pane_id}"])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function findDedicatedWindow(sessionId: string): string | undefined {
  try {
    const out = tmux(["list-windows", "-t", sessionId, "-F", "#{window_id}\t#{window_name}"]);
    for (const line of out.split("\n")) {
      const [windowId, windowName] = line.split("\t");
      if (windowName === DEDICATED_WINDOW_NAME) return windowId;
    }
  } catch {}
  return undefined;
}

/** Split `target`, returning the new pane id. `direction` is where the new pane goes. */
function splitPane(target: string, direction: "left" | "right" | "up" | "down"): string {
  const args = ["split-window", "-d"];
  if (direction === "left" || direction === "right") args.push("-h");
  else args.push("-v");
  if (direction === "left" || direction === "up") args.push("-b");
  args.push("-t", target, "-P", "-F", "#{pane_id}");
  const pane = tmux(args).trim();
  if (!pane.startsWith("%")) {
    throw new Error(`Unexpected tmux split-window output: ${pane}`);
  }
  return pane;
}

/**
 * tmux layout-string checksum: rotate the running sum right by one bit, then
 * add each character. Verified against live `#{window_layout}` output.
 */
function layoutChecksum(layout: string): string {
  let csum = 0;
  for (let i = 0; i < layout.length; i++) {
    csum = ((csum >> 1) | ((csum & 1) << 15)) & 0xffff;
    csum = (csum + layout.charCodeAt(i)) & 0xffff;
  }
  return csum.toString(16).padStart(4, "0");
}

/**
 * Build the tmux layout node for the right-hand region holding `subPanes`.
 *  - 1 pane : a single full-size leaf
 *  - 2/3    : stacked top→bottom
 *  - 4      : a 2×2 grid (two rows of two)
 * tmux counts 1 separator cell between neighbours, so every split subtracts 1
 * from the usable space.
 */
function buildRightRegionTree(
  rightX: number,
  rightWidth: number,
  height: number,
  subPanes: string[],
): string {
  const id = (pane: string) => pane.replace(/^%/, "");
  const count = subPanes.length;

  if (count === 1) {
    return `${rightWidth}x${height},${rightX},0,${id(subPanes[0])}`;
  }

  if (count === 4) {
    const colLeft = Math.floor((rightWidth - 1) / 2);
    const colRight = rightWidth - 1 - colLeft;
    const rowTop = Math.floor((height - 1) / 2);
    const rowBottom = height - 1 - rowTop;
    const top =
      `${rightWidth}x${rowTop},${rightX},0{` +
      `${colLeft}x${rowTop},${rightX},0,${id(subPanes[0])},` +
      `${colRight}x${rowTop},${rightX + colLeft + 1},0,${id(subPanes[1])}}`;
    const bottom =
      `${rightWidth}x${rowBottom},${rightX},${rowTop + 1}{` +
      `${colLeft}x${rowBottom},${rightX},${rowTop + 1},${id(subPanes[2])},` +
      `${colRight}x${rowBottom},${rightX + colLeft + 1},${rowTop + 1},${id(subPanes[3])}}`;
    return `${rightWidth}x${height},${rightX},0[${top},${bottom}]`;
  }

  const rowSpace = height - (count - 1);
  const heights = subPanes.map(
    (_, i) => Math.floor(rowSpace / count) + (i < rowSpace % count ? 1 : 0),
  );
  let y = 0;
  const rows = subPanes.map((pane, i) => {
    const row = `${rightWidth}x${heights[i]},${rightX},${y},${id(pane)}`;
    y += heights[i] + 1;
    return row;
  });
  return `${rightWidth}x${height},${rightX},0[${rows.join(",")}]`;
}

/**
 * Arrange the parent window as: pi pane on the left (50% width, full height)
 * and `subPanes` in the right half. 4 subagents become a 2×2 grid; 1/2/3 are
 * stacked top→bottom. Keeps the region evenly divided after splits/close drift.
 * Best-effort: cosmetic only, never throws.
 */
function applyRightStackLayout(mainPane: string, subPanes: string[]): void {
  if (subPanes.length === 0) return;
  try {
    // tmux counts 1 separator cell between neighbouring panes, and
    // `window_width`/`window_height` include them.
    const width = Number(paneField(mainPane, "#{window_width}"));
    const height = Number(paneField(mainPane, "#{window_height}"));
    if (!width || !height) return;

    const mainWidth = Math.round((width - 1) / 2);
    const rightX = mainWidth + 1;
    const rightWidth = width - 1 - mainWidth;
    if (rightWidth <= 0) return;

    const rightTree = buildRightRegionTree(rightX, rightWidth, height, subPanes);
    const mainLeaf = `${mainWidth}x${height},0,0,${mainPane.replace(/^%/, "")}`;
    const tree = `${width}x${height},0,0{${mainLeaf},${rightTree}}`;
    tmux(["select-layout", "-t", mainPane, `${layoutChecksum(tree)},${tree}`]);
  } catch {}
}

/**
 * Pick and create the pane for a new subagent (see the policy comment above).
 *
 * `existingSurfaces` is the current set of live subagent panes (including any
 * reserved for parallel in-flight spawns); dead ids are ignored.
 */
export function placeSubagentSurface(name: string, existingSurfaces: string[]): string {
  requireTmux();
  const mainPane = process.env.TMUX_PANE;
  const live = existingSurfaces.filter((s) => s && isPaneAlive(s));
  const mainWindow = mainPane ? windowOf(mainPane) : undefined;

  if (mainPane && mainWindow) {
    const allPanes = listWindowPanes(mainWindow);
    const inMain = live.filter((s) => windowOf(s) === mainWindow);
    const foreignPanes = allPanes.filter((p) => p !== mainPane && !inMain.includes(p));
    const crowded = foreignPanes.length > 0;
    const limit = crowded ? MAX_MAIN_SUBAGENTS_CROWDED : MAX_MAIN_SUBAGENTS_CLEAN;

    if (inMain.length < limit) {
      if (!crowded) {
        // Clean window: extend the right column, then stack (2×2 at four).
        const anchor = inMain.length > 0 ? inMain[inMain.length - 1] : mainPane;
        const pane = splitPane(anchor, "right");
        applyRightStackLayout(mainPane, [...inMain, pane]);
        return pane;
      }
      // Crowded window: never touch the main pane's width. Place our first
      // pane *above* the user's right-hand pane (top-right of the pi pane);
      // later ones sit beside it. Any further subagents go to the dedicated
      // window below.
      if (inMain.length === 0) {
        const mainLeft = Number(paneField(mainPane, "#{pane_left}") ?? "0");
        const rightOfMain = foreignPanes
          .filter((p) => Number(paneField(p, "#{pane_left}") ?? "0") > mainLeft)
          .sort(
            (a, b) =>
              Number(paneField(b, "#{pane_left}") ?? "0") -
              Number(paneField(a, "#{pane_left}") ?? "0"),
          );
        const anchor = rightOfMain[0] ?? foreignPanes[foreignPanes.length - 1] ?? mainPane;
        return splitPane(anchor, "up");
      }
      return splitPane(inMain[inMain.length - 1], "right");
    }
  }

  return placeInDedicatedWindow(name, mainPane);
}

function placeInDedicatedWindow(name: string, mainPane: string | undefined): string {
  const sessionId = mainPane ? sessionOf(mainPane) : undefined;
  const existing = sessionId ? findDedicatedWindow(sessionId) : undefined;

  if (existing) {
    const panes = listWindowPanes(existing);
    const anchor = panes[panes.length - 1] ?? existing;
    const pane = splitPane(anchor, "down");
    reTile(existing);
    return pane;
  }

  if (sessionId) {
    const pane = tmux([
      "new-window", "-d", "-t", `${sessionId}:`, "-n", DEDICATED_WINDOW_NAME,
      "-P", "-F", "#{pane_id}",
    ]).trim();
    if (!pane.startsWith("%")) {
      throw new Error(`Unexpected tmux new-window output: ${pane}`);
    }
    return pane;
  }

  // No session context: fall back to a plain right split in the parent window.
  return createSurfaceSplit(name, "right", mainPane);
}

/**
 * Even layout for the dedicated subagent window: 1–2 panes sit side by side
 * (左右), 3+ fall back to tmux's tiled grid (2×2 for four).
 */
function reTile(windowId: string): void {
  try {
    // Cosmetic only — never let a resize break a spawn or a watcher cleanup.
    const count = listWindowPanes(windowId).length;
    tmux(["select-layout", "-t", windowId, count <= 2 ? "even-horizontal" : "tiled"]);
  } catch {}
}

/**
 * Re-apply even layout after a pane exits (tmux dumps freed space onto one
 * neighbor). Only a clean parent window is re-stacked and the dedicated window
 * re-tiled; a window holding the user's panes is left alone.
 */
export function rebalanceSubagentLayout(surfaces: string[] = []): void {
  if (!isTmuxAvailable()) return;
  const mainPane = process.env.TMUX_PANE;
  if (!mainPane) return;
  const mainWindow = windowOf(mainPane);
  if (mainWindow) {
    const inMain = surfaces.filter(
      (s) => s && isPaneAlive(s) && windowOf(s) === mainWindow,
    );
    const crowded = listWindowPanes(mainWindow).some(
      (p) => p !== mainPane && !inMain.includes(p),
    );
    if (!crowded) applyRightStackLayout(mainPane, inMain);
  }
  const sessionId = sessionOf(mainPane);
  if (!sessionId) return;
  const windowId = findDedicatedWindow(sessionId);
  if (windowId) reTile(windowId);
}

// ── Surface primitives ──

/**
 * Create a new pane for a subagent: a right split off the parent pi's pane,
 * so new panes follow the agent rather than the user's focus.
 * See https://github.com/HazAT/pi-interactive-subagents/issues/12
 *
 * Returns the new pane id (e.g. `%12`).
 */
export function createSurface(name: string): string {
  void name; // tmux panes are not named; the pi process inside shows its own title.
  return createSurfaceSplit(name, "right", process.env.TMUX_PANE);
}

/**
 * Create a new split in the given direction from an optional source pane.
 * Returns the new pane id (e.g. `%12`).
 */
export function createSurfaceSplit(
  name: string,
  direction: "left" | "right" | "up" | "down",
  fromSurface?: string,
): string {
  void name;
  requireTmux();

  const args = ["split-window", "-d"];
  if (direction === "left" || direction === "right") {
    args.push("-h");
  } else {
    args.push("-v");
  }
  if (direction === "left" || direction === "up") {
    args.push("-b");
  }
  if (fromSurface) {
    args.push("-t", fromSurface);
  }
  args.push("-P", "-F", "#{pane_id}");

  const pane = execFileSync("tmux", args, { encoding: "utf8" }).trim();
  if (!pane.startsWith("%")) {
    throw new Error(`Unexpected tmux split-window output: ${pane}`);
  }

  return pane;
}

/**
 * Send a command string to a pane and execute it.
 * Typed literally (`-l`) so special characters are not interpreted as keys,
 * then submitted with Enter.
 */
export function sendCommand(surface: string, command: string): void {
  requireTmux();
  execFileSync("tmux", ["send-keys", "-t", surface, "-l", command], { encoding: "utf8" });
  execFileSync("tmux", ["send-keys", "-t", surface, "Enter"], { encoding: "utf8" });
}

/**
 * Send a long command to a pane by writing it to a script file first.
 * This avoids terminal line-wrapping issues that break commands exceeding the
 * pane's column width when sent character-by-character via sendCommand.
 *
 * By default the script is written to a temp directory, but callers can pass a
 * stable path (for example under session artifacts) so the exact invocation is
 * preserved for debugging.
 *
 * Returns the script path.
 */
export function sendLongCommand(
  surface: string,
  command: string,
  options?: { scriptPath?: string; scriptPreamble?: string },
): string {
  const scriptPath =
    options?.scriptPath ??
    join(
      tmpdir(),
      "pi-subagent-scripts",
      `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.sh`,
    );
  mkdirSync(dirname(scriptPath), { recursive: true });

  const scriptParts = ["#!/bin/bash"];
  if (options?.scriptPreamble) {
    scriptParts.push(options.scriptPreamble.trimEnd());
  }
  scriptParts.push(command);

  writeFileSync(scriptPath, scriptParts.join("\n") + "\n", {
    mode: 0o755,
  });
  sendCommand(surface, `bash ${shellEscape(scriptPath)}`);
  return scriptPath;
}

/**
 * Read the screen contents of a pane (sync).
 */
export function readScreen(surface: string, lines = 50): string {
  requireTmux();
  return execFileSync(
    "tmux",
    ["capture-pane", "-p", "-t", surface, "-S", `-${Math.max(1, lines)}`],
    {
      encoding: "utf8",
    },
  );
}

/**
 * Read the screen contents of a pane (async).
 */
export async function readScreenAsync(surface: string, lines = 50): Promise<string> {
  requireTmux();
  const { stdout } = await execFileAsync(
    "tmux",
    ["capture-pane", "-p", "-t", surface, "-S", `-${Math.max(1, lines)}`],
    { encoding: "utf8" },
  );
  return stdout;
}

/**
 * Close a pane.
 */
export function closeSurface(surface: string, remainingSurfaces: string[] = []): void {
  requireTmux();
  execFileSync("tmux", ["kill-pane", "-t", surface], { encoding: "utf8" });
  rebalanceSubagentLayout(remainingSurfaces);
}

// ── Exit polling ──

export interface PollResult {
  /** How the subagent exited */
  reason: "done" | "sentinel" | "error";
  /** Shell exit code (from sentinel). 0 for file-based exits. */
  exitCode: number;
  /** Error message if reason is "error" (auto-retry exhausted, provider overload, etc.) */
  errorMessage?: string;
}

/**
 * Interpret an `.exit` sidecar payload (written by the error path in
 * subagent-done.ts). Centralized so both the fast and slow paths in
 * pollForExit decode the payload the same way. Clean completions write no
 * sidecar and are detected via the terminal sentinel instead.
 *
 * Note: ask_question does NOT write a `.exit` sidecar — it keeps the session
 * open and signals the parent via a separate `.ask` file (see deliverPendingQuestion).
 */
function interpretExitSidecar(data: any): PollResult {
  if (data?.type === "error") {
    const errorMessage =
      typeof data.errorMessage === "string" && data.errorMessage.trim() !== ""
        ? data.errorMessage
        : "Subagent exited with stopReason=error (no errorMessage in sidecar).";
    return { reason: "error", exitCode: 1, errorMessage };
  }
  return { reason: "done", exitCode: 0 };
}

export const __pollForExitTest__ = { interpretExitSidecar };

/**
 * Poll until the subagent exits. Checks for a `.exit` sidecar file first
 * (written by the error path), falling back to the terminal sentinel for
 * clean-completion and crash detection.
 */
export async function pollForExit(
  surface: string,
  signal: AbortSignal,
  options: {
    interval: number;
    sessionFile?: string;
    sentinelFile?: string;
    onTick?: (elapsed: number) => void;
  },
): Promise<PollResult> {
  const start = Date.now();

  for (;;) {
    if (signal.aborted) {
      throw new Error("Aborted while waiting for subagent to finish");
    }

    // Fast path: check for .exit sidecar file (written by the error path)
    if (options.sessionFile) {
      try {
        const exitFile = `${options.sessionFile}.exit`;
        if (existsSync(exitFile)) {
          const data = JSON.parse(readFileSync(exitFile, "utf-8"));
          rmSync(exitFile, { force: true });
          return interpretExitSidecar(data);
        }
      } catch {}
    }

    // Check Claude sentinel file (written by plugin Stop hook)
    if (options.sentinelFile) {
      try {
        if (existsSync(options.sentinelFile)) {
          return { reason: "sentinel", exitCode: 0 };
        }
      } catch {}
    }

    // Slow path: read terminal screen for sentinel (crash detection)
    try {
      const screen = await readScreenAsync(surface, 5);
      const match = screen.match(/__SUBAGENT_DONE_(\d+)__/);
      if (match) {
        return { reason: "sentinel", exitCode: parseInt(match[1], 10) };
      }
    } catch {
      // Surface may have been destroyed — check if .exit file appeared in the meantime
      if (options.sessionFile) {
        try {
          const exitFile = `${options.sessionFile}.exit`;
          if (existsSync(exitFile)) {
            const data = JSON.parse(readFileSync(exitFile, "utf-8"));
            rmSync(exitFile, { force: true });
            return interpretExitSidecar(data);
          }
        } catch {}
      }
    }

    const elapsed = Math.floor((Date.now() - start) / 1000);
    options.onTick?.(elapsed);

    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("Aborted"));
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, options.interval);
      function onAbort() {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
