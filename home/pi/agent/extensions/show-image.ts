/**
 * show-image — an LLM-callable tool that opens a focused tmux pane showing an
 * image with `kitten icat`, with a browsable history of previously shown images.
 *
 * Why: pi's shell (and any tool it spawns) runs detached from the terminal, so
 * `kitten icat` invoked from bash fails with:
 *
 *   Error: Failed to open controlling terminal with error:
 *   open /dev/tty: no such device or address
 *
 * This extension opens a real tmux pane next to the pi pane instead. The pane
 * runs a small Python viewer that:
 *   - is auto-focused (a single tmux split),
 *   - renders the image with `kitten icat` (Kitty graphics through tmux DCS
 *     passthrough),
 *   - browses the persistent history with ←/→ (or h/l, p/n),
 *   - closes on Enter/q, returning focus to the pi pane — like the /history
 *     extension does.
 *
 * Tool:
 *   show_image({ path?, size?, focus?, close? })
 *
 * Command:
 *   /imgpanel [path|close]   open/focus the viewer (history if no path)
 *
 * Requirements:
 *   - running inside tmux with `allow-passthrough on|all`
 *   - a Kitty-protocol terminal outside tmux (kitty, ghostty, wezterm, ...)
 *   - `kitten` and `python3` on PATH
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	closeSync,
	constants,
	existsSync,
	mkdirSync,
	openSync,
	readFileSync,
	readdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const KITTEN = "kitten";
const PYTHON = "python3";
const DEFAULT_SIZE = "50%";
const HISTORY_LIMIT = 50;
const SEND_TIMEOUT_MS = 4000;
// ---------------------------------------------------------------------------
// Viewer program (written next to the FIFO at runtime).
// ---------------------------------------------------------------------------
const VIEWER_SCRIPT = String.raw`#!/usr/bin/env python3"""pi image panel viewer: browse history with arrows, Enter/q to close."""
from __future__ import annotations

import os
import random
import select
import subprocess
import sys
import termios
import time
import tty


# Unique per viewer instance so concurrent viewers in different panes do not
# overwrite each other's image; incremented on every render so the Unicode
# placeholder runes change and tmux actually repaints the cell (with a fixed id
# tmux sees identical cells and keeps showing the stale image until focus
# changes). kitty image ids are global per terminal.
STATE = {"next": random.randint(1, 2000000000), "current": None}


def load_history(path):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return [ln.rstrip("\n") for ln in f if ln.strip()]
    except OSError:
        return []


def save_history(path, items):
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write("\n".join(items))
            if items:
                f.write("\n")
    except OSError:
        pass


def term_size():
    try:
        size = os.get_terminal_size(sys.stdout.fileno())
        return size.columns, size.lines
    except OSError:
        return 80, 24


def clip(text, width):
    return text if len(text) <= width else text[: max(0, width - 1)] + "…"


def request_redraw():
    """Ask tmux to redraw the whole client screen.

    A targeted cell update (new placeholder color) is not enough for the
    terminal to repaint a Unicode-placeholder image; forcing a client redraw
    re-sends every cell and the image appears immediately (this is what
    manually switching panes did).
    """
    if not os.environ.get("TMUX"):
        return
    try:
        res = subprocess.run(
            ["tmux", "display-message", "-p", "#{client_name}"],
            capture_output=True, text=True, timeout=2,
        )
        client = res.stdout.strip()
        args = ["tmux", "refresh-client", "-R"]
        if client:
            args += ["-t", client]
        subprocess.run(args, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, timeout=2)
    except Exception:
        pass


def render(paths, idx, note=""):
    cols, rows = term_size()
    out = sys.stdout
    # kitten icat --clear cannot clear images under tmux (a multiplexer), so
    # erase the screen ourselves. That removes the Unicode placeholder cells
    # which the terminal uses to position the previously drawn image.
    out.write("\x1b[2J\x1b[H")
    out.flush()
    # Give tmux a moment to flush the erase to the terminal before the new
    # cells are written, otherwise it coalesces everything and the terminal
    # never sees the placeholder cells erased.
    time.sleep(0.03)

    image_id = STATE["next"]
    STATE["next"] = image_id + 1 if image_id < 2147483647 else 1

    if paths:
        # Width must stay below the pane width, otherwise kitten wraps the
        # placeholder row at the edge and the image comes out interleaved with
        # blank lines. Height leaves room for the header and footer rows.
        rect = "%dx%d@0x1" % (max(1, cols - 1), max(1, rows - 2))
        subprocess.run(
            ["kitten", "icat", "--stdin=no", "--align", "center",
             "--image-id", str(image_id), "--place", rect, "--scale-up=no", paths[idx]],
            stdout=out, stderr=subprocess.DEVNULL, check=False,
        )

    if paths:
        name = os.path.basename(paths[idx])
        header = "🖼  [%d/%d] %s" % (idx + 1, len(paths), name)
    else:
        header = "🖼  (no images yet)"
    hint = "←/→ 切换 · Enter 关闭"
    if note:
        hint = "%s · %s" % (note, hint)

    out.write("\x1b[H" + clip(header, cols - 1) + "\x1b[K")
    out.write("\x1b[%d;1H" % rows + clip(hint, cols - 1) + "\x1b[K")
    # The new image is on screen now; drop the previous one from the terminal.
    old = STATE["current"]
    STATE["current"] = image_id
    if old is not None:
        delete_image(out, old)
    out.write("\x1b[%d;1H" % rows)
    out.flush()
    request_redraw()


def delete_image(out, image_id):
    if image_id is None:
        return
    seq = "\x1b_Ga=d,d=i,i=%d\x1b\\" % image_id
    if os.environ.get("TMUX"):
        out.write("\x1bPtux;" + seq.replace("\x1b", "\x1b\x1b") + "\x1b\\")
    else:
        out.write(seq)
    out.flush()


def main():
    if len(sys.argv) < 3:
        sys.stderr.write("usage: viewer.py <history_file> <fifo> [initial_path]\n")
        return 2

    hist_file, fifo = sys.argv[1], sys.argv[2]
    initial = sys.argv[3] if len(sys.argv) > 3 else None

    paths = load_history(hist_file)
    if initial:
        if initial in paths:
            idx = paths.index(initial)
        else:
            paths.insert(0, initial)
            save_history(hist_file, paths)
            idx = 0
    else:
        idx = 0

    try:
        fifo_fd = os.open(fifo, os.O_RDWR | os.O_NONBLOCK)
    except OSError:
        fifo_fd = None

    stdin_fd = sys.stdin.fileno()
    old_attrs = termios.tcgetattr(stdin_fd)
    tty.setraw(stdin_fd)
    try:
        # Let tmux finish sizing the freshly split pane before the first draw.
        time.sleep(0.15)
        render(paths, idx)
        last_size = term_size()
        while True:
            watch = [stdin_fd] + ([fifo_fd] if fifo_fd is not None else [])
            ready, _, _ = select.select(watch, [], [], 0.2)

            if fifo_fd is not None and fifo_fd in ready:
                try:
                    data = os.read(fifo_fd, 65536).decode("utf-8", "replace")
                except OSError:
                    data = ""
                latest = ""
                for line in data.splitlines():
                    if line.strip():
                        latest = line.strip()
                if latest:
                    paths = load_history(hist_file)
                    if latest in paths:
                        idx = paths.index(latest)
                    else:
                        paths.insert(0, latest)
                        save_history(hist_file, paths)
                        idx = 0
                    render(paths, idx)

            if stdin_fd in ready:
                ch = os.read(stdin_fd, 16)
                if not ch:
                    break
                if ch in (b"\r", b"\n", b"q", b"Q"):
                    break
                if ch in (b"\x1b[D", b"\x1bOD", b"h", b"p", b"k"):
                    if paths and idx > 0:
                        idx -= 1
                        render(paths, idx)
                elif ch in (b"\x1b[C", b"\x1bOC", b"l", b"n", b"j"):
                    if paths and idx < len(paths) - 1:
                        idx += 1
                        render(paths, idx)
                elif ch == b"g" and paths:
                    idx = 0
                    render(paths, idx)
                elif ch == b"G" and paths:
                    idx = len(paths) - 1
                    render(paths, idx)

            # Redraw if the pane was resized (also fixes the initial sizing race).
            size = term_size()
            if size != last_size:
                last_size = size
                render(paths, idx)
    finally:
        termios.tcsetattr(stdin_fd, termios.TCSADRAIN, old_attrs)
        if fifo_fd is not None:
            os.close(fifo_fd)
        sys.stdout.write("\x1b[2J\x1b[H")
        # Drop our image from the terminal (wrap in tmux passthrough if needed).
        delete_image(sys.stdout, STATE["current"])
        sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
`;

// Changes whenever the viewer source changes, so /reload rebuilds a running pane.
const SCRIPT_VERSION = createHash("sha1").update(VIEWER_SCRIPT).digest("hex").slice(0, 10);

// ---------------------------------------------------------------------------
// Paths & process helpers
// ---------------------------------------------------------------------------
function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

function runtimeDir(): string {
	return process.env.XDG_RUNTIME_DIR || tmpdir();
}

function cacheDir(): string {
	const base = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
	const dir = join(base, "pi");
	try {
		mkdirSync(dir, { recursive: true });
	} catch {
		/* ignore */
	}
	return dir;
}

function piPaneId(): string | undefined {
	return process.env.TMUX_PANE || undefined;
}

function panelPaths(pane: string) {
	const base = pane.replace(/[^A-Za-z0-9_.-]/g, "_");
	const dir = runtimeDir();
	return {
		viewer: join(dir, `pi-image-viewer-${base}.py`),
		fifo: join(dir, `pi-image-viewer-${base}.fifo`),
		state: join(dir, `pi-image-viewer-${base}.pane`),
		history: join(cacheDir(), "image-panel-history.txt"),
	};
}

function runTmux(args: string[]): { ok: boolean; out: string } {
	try {
		const r = spawnSync("tmux", args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return { ok: !r.error && r.status === 0, out: (r.stdout ?? "").trim() };
	} catch {
		return { ok: false, out: "" };
	}
}

function listPanes(): string[] {
	const r = runTmux(["list-panes", "-a", "-F", "#{pane_id}"]);
	return r.out ? r.out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
}

/** True only if the pane still exists AND is running our viewer. */
function panelAlive(pane: string | undefined): boolean {
	if (!pane || !listPanes().includes(pane)) return false;
	const start = runTmux(["display-message", "-p", "-t", pane, "#{pane_start_command}"]).out;
	return start.includes("pi-image-viewer-") && start.includes(`PI_IMG_VER=${SCRIPT_VERSION}`);
}

function readState(file: string): string | undefined {
	try {
		const v = readFileSync(file, "utf8").trim();
		return v || undefined;
	} catch {
		return undefined;
	}
}

function hasBin(bin: string, args: string[] = ["--version"]): boolean {
	try {
		const r = spawnSync(bin, args, { stdio: "ignore" });
		return !r.error && r.status === 0;
	} catch {
		return false;
	}
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function ensureFifo(path: string): boolean {
	if (existsSync(path)) return true;
	try {
		const r = spawnSync("mkfifo", [path], { stdio: "ignore" });
		return !r.error && r.status === 0;
	} catch {
		return false;
	}
}

function createPanel(
	pane: string,
	image: string | undefined,
	size: string,
	focus: boolean,
): string | undefined {
	const { viewer, fifo, state, history } = panelPaths(pane);
	writeFileSync(viewer, VIEWER_SCRIPT, { mode: 0o755 });
	if (!ensureFifo(fifo)) return undefined;

	// Drop a stale viewer pane (e.g. after a /reload changed the script).
	const stored = readState(state);
	if (stored && listPanes().includes(stored)) runTmux(["kill-pane", "-t", stored]);

	const initial = image ? ` ${shellQuote(image)}` : "";
	const command = `PI_IMG_VER=${SCRIPT_VERSION} ${PYTHON} ${shellQuote(viewer)} ${shellQuote(history)} ${shellQuote(fifo)}${initial}`;
	const args = ["split-window", "-h", "-P", "-F", "#{pane_id}", "-t", pane, "-l", size];
	if (!focus) args.push("-d");
	args.push(command);

	const r = runTmux(args);
	if (!r.ok || !r.out) return undefined;
	const newPane = r.out.split("\n").pop()?.trim();
	if (!newPane) return undefined;

	runTmux(["select-pane", "-t", newPane, "-T", "🖼 images"]);
	writeFileSync(state, newPane);
	return newPane;
}

function focusPanel(pane: string, image?: string): boolean {
	const { fifo } = panelPaths(pane);
	if (image && !sendToPanel(fifo, image)) return false;
	runTmux(["select-pane", "-t", pane]);
	return true;
}

/** Open the FIFO non-blocking and retry while the viewer is still starting. */
async function sendToPanel(fifo: string, imagePath: string, timeoutMs = SEND_TIMEOUT_MS): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		let fd: number | undefined;
		try {
			fd = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException)?.code;
			if (code === "ENXIO" || code === "EAGAIN") {
				await sleep(100);
				continue;
			}
			return false;
		}
		try {
			writeSync(fd, `${imagePath}\n`);
		} finally {
			closeSync(fd);
		}
		return true;
	}
	return false;
}

function closePanel(pane: string): boolean {
	const { state, fifo, viewer } = panelPaths(pane);
	const stored = readState(state);
	if (stored && listPanes().includes(stored)) runTmux(["kill-pane", "-t", stored]);
	for (const f of [state, fifo, viewer]) {
		try {
			unlinkSync(f);
		} catch {
			/* ignore */
		}
	}
	return true;
}

// ---------------------------------------------------------------------------
// History & image resolution
// ---------------------------------------------------------------------------
function loadHistory(file: string): string[] {
	try {
		return readFileSync(file, "utf8")
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean);
	} catch {
		return [];
	}
}

function appendHistory(file: string, image: string): void {
	const items = loadHistory(file).filter((p) => p !== image);
	items.unshift(image);
	try {
		writeFileSync(file, `${items.slice(0, HISTORY_LIMIT).join("\n")}\n`);
	} catch {
		/* ignore */
	}
}

function latestClipboardImage(): string | undefined {
	try {
		const dir = tmpdir();
		let best: string | undefined;
		let bestTime = -1;
		for (const f of readdirSync(dir)) {
			if (!/^pi-clipboard-.*\.(png|jpe?g|gif|webp|bmp|tiff?)$/i.test(f)) continue;
			const full = join(dir, f);
			try {
				const t = statSync(full).mtimeMs;
				if (t > bestTime) {
					bestTime = t;
					best = full;
				}
			} catch {
				/* ignore */
			}
		}
		return best;
	} catch {
		return undefined;
	}
}

function resolveImage(input: string | undefined, cwd: string): string | undefined {
	let p = input?.trim();
	const lower = p?.toLowerCase();
	if (!p || lower === "last" || lower === "clipboard" || lower === "latest") {
		p = latestClipboardImage();
	}
	if (!p) return undefined;
	p = p.replace(/^@/, "");
	if (p === "~") p = homedir();
	else if (p.startsWith("~/") || p.startsWith("~\\")) p = join(homedir(), p.slice(2));
	return isAbsolute(p) ? p : resolve(cwd, p);
}

// ---------------------------------------------------------------------------
// Core actions
// ---------------------------------------------------------------------------
interface ActionResult {
	text: string;
	details: Record<string, unknown>;
}

function requireEnvironment(): string {
	const pane = piPaneId();
	if (!process.env.TMUX || !pane) {
		throw new Error("Not running inside tmux (TMUX / TMUX_PANE unset) — no image pane available.");
	}
	if (!hasBin(KITTEN)) throw new Error(`\`${KITTEN}\` not found on PATH.`);
	if (!hasBin(PYTHON, ["--version"])) throw new Error(`\`${PYTHON}\` not found on PATH.`);
	return pane;
}

async function showImage(
	imagePath: string | undefined,
	cwd: string,
	size: string,
	focus: boolean,
	requireImage: boolean,
): Promise<ActionResult> {
	const pane = requireEnvironment();
	const { state, history } = panelPaths(pane);

	const image = resolveImage(imagePath, cwd);
	if (image) {
		if (!existsSync(image)) throw new Error(`File not found: ${image}`);
		appendHistory(history, image);
	} else if (requireImage) {
		throw new Error("No image path given and no pasted clipboard image found.");
	}

	if (panelAlive(readState(state))) {
		const panel = readState(state) as string;
		if (image) await sendToPanel(panelPaths(pane).fifo, image);
		if (focus) focusPanel(panel);
		return {
			text: image
				? `Showing ${basename(image)} in image pane ${panel}.`
				: `Focused image pane ${panel}.`,
			details: { pane: panel, path: image ?? null },
		};
	}

	const panel = createPanel(pane, image, size, focus);
	if (!panel) throw new Error("Failed to create the tmux image pane.");
	return {
		text: image
			? `Opened image pane ${panel} with ${basename(image)}.`
			: `Opened image pane ${panel} (history only).`,
		details: { pane: panel, path: image ?? null },
	};
}

function closeImagePane(): ActionResult {
	const pane = piPaneId();
	if (pane) closePanel(pane);
	return { text: "Closed the image pane.", details: { closed: true } };
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------
export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: "show_image",
		label: "Show Image",
		description:
			"Show an image in a focused tmux pane using `kitten icat`. The pane supports a history of previously shown images (←/→ to browse) and closes on Enter. Use this instead of running `kitten icat` via bash, which fails because tool shells have no controlling terminal.",
		promptSnippet: "Show an image in a focused tmux pane (kitten icat) with history",
		promptGuidelines: [
			"Use show_image when the user wants to see or preview an image in the terminal.",
			"Prefer show_image over `kitten icat` in bash: tool shells are detached and kitten fails with 'open /dev/tty: no such device or address'.",
			"When the user pastes an image, call show_image with no path to display the newest pasted clipboard image, or pass its /tmp/pi-clipboard-*.png path explicitly.",
		],
		parameters: Type.Object({
			path: Type.Optional(
				Type.String({
					description:
						"Image file path. Omit, or use 'clipboard'/'latest', to show the newest pasted image.",
				}),
			),
			size: Type.Optional(
				Type.String({ description: "Pane size as a tmux fraction, e.g. '55%' (default)." }),
			),
			focus: Type.Optional(
				Type.Boolean({ description: "Focus the image pane (default true)." }),
			),
			close: Type.Optional(
				Type.Boolean({ description: "Close the image pane instead of showing an image." }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (params.close) {
				const r = closeImagePane();
				return { content: [{ type: "text", text: r.text }], details: r.details };
			}
			const r = await showImage(
				params.path,
				ctx.cwd,
				params.size ?? DEFAULT_SIZE,
				params.focus ?? true,
				true,
			);
			return { content: [{ type: "text", text: r.text }], details: r.details };
		},
	});

	pi.registerCommand("imgpanel", {
		description: "Open/focus the image pane: /imgpanel [path|close]  (no path = browse history)",
		handler: async (args, ctx) => {
			const value = args.trim();
			if (value.toLowerCase() === "close") {
				const r = closeImagePane();
				ctx.ui.notify(r.text, "info");
				return;
			}
			try {
				const r = await showImage(value || undefined, ctx.cwd, DEFAULT_SIZE, true, false);
				ctx.ui.notify(r.text, "info");
			} catch (error) {
				ctx.ui.notify((error as Error).message, "error");
			}
		},
	});

	pi.on("session_shutdown", () => {
		const pane = piPaneId();
		if (pane) closePanel(pane);
	});
}
