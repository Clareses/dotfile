/**
 * image-preview — inline image previews for pi running inside tmux.
 *
 * Pi's built-in image rendering is disabled under tmux (`detectCapabilities()`
 * returns `images: null` when `$TMUX` is set), and tmux filters raw Kitty APC
 * graphics sequences unless the application wraps them in DCS passthrough.
 * Upstream discussion: earendil-works/pi#2374.
 *
 * This extension:
 *
 * 1. Overrides `read`'s `renderResult` so reading an image shows an inline
 *    thumbnail in the transcript.
 *
 *    When the outer terminal speaks the Kitty graphics protocol, chafa emits
 *    `a=T,U=1` Unicode placeholders wrapped in tmux DCS passthrough. That has
 *    two important properties:
 *      - the image is anchored to text cells, so tmux tracks it per pane and it
 *        does not leak across splits;
 *      - re-rendering only needs the placeholder rows, because the pixel data
 *        was already uploaded once.
 *    The transmission can be multiple MB, and pi-tui rewrites every row of the
 *    viewport whenever an image line changes (typing, autocomplete, scrolling).
 *    So we transmit exactly once per rendered size and then hand back only the
 *    placeholder rows (~hundreds of bytes). Steady-state redraws stay cheap.
 *
 *    When Kitty graphics are unavailable (or `PI_INLINE_KITTY_IMAGES=0`) it
 *    falls back to chafa character art.
 *
 * 2. Adds `/preview [path]`: opens the last-read image (or a given path) in a
 *    tmux popup, using real pixels when the outer terminal supports them.
 *
 * Environment:
 *   PI_INLINE_KITTY_IMAGES=0   force the character-art fallback
 *   PI_IMAGE_* (upstream)      honored by pi's own capability detection
 *
 * Requirements for real pixels:
 *   - tmux with `set -g allow-passthrough on|all` (tmux 3.3+)
 *   - a Kitty-protocol terminal outside tmux (kitty, ghostty, wezterm, ...)
 *   - chafa on PATH
 *
 * Security note: `allow-passthrough` disables tmux's escape-sequence filtering
 * for the active pane, giving applications the same terminal access they have
 * outside tmux.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, isAbsolute, resolve } from "node:path";
import { createReadToolDefinition, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCapabilities, Text, type Component } from "@earendil-works/pi-tui";

const CHAFA_BIN = "chafa";
const MAX_WIDTH_CELLS = 120;
const MIN_WIDTH_CELLS = 24;
const MAX_ROWS_COLLAPSED = 18;
const MAX_ROWS_EXPANDED = 48;
const CHAFA_TIMEOUT_MS = 4000;
const CHAFA_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Inline pixel rendering (real Kitty graphics through tmux passthrough).
 * Set PI_INLINE_KITTY_IMAGES=0 to force the character-art fallback.
 */
const INLINE_KITTY_IMAGES = !["0", "false", "no", "off"].includes(
	(process.env.PI_INLINE_KITTY_IMAGES ?? "").toLowerCase(),
);

/** Most recent image read, used by `/preview` without arguments. */
let last_image_path: string | undefined;

let chafa_checked = false;
let chafa_available = false;

function hasChafa(): boolean {
	if (!chafa_checked) {
		chafa_checked = true;
		try {
			const probe = spawnSync(CHAFA_BIN, ["--version"], { timeout: 1500, stdio: "ignore" });
			chafa_available = !probe.error && probe.status === 0;
		} catch {
			chafa_available = false;
		}
	}
	return chafa_available;
}

/** Strip SGR sequences so we can test whether a line has visible content. */
function isBlankLine(line: string): boolean {
	return line.replace(/\x1b\[[0-9;]*m/g, "").trim() === "";
}

/** Remove the DCS-wrapped transmission from the first image line, keeping its placeholder row. */
function stripKittyTransmission(line: string): string {
	const end = line.lastIndexOf("\x1b\\");
	return end === -1 ? line : line.slice(end + 2);
}

/**
 * Split chafa's kitty output into a transmission line plus placeholder rows.
 *
 * chafa emits `<DCS transmission> <fg><row0> ESC[<n>D ESC D <fg><row1> ...`.
 * tmux passthrough uses `ESC st` as the string terminator, so the last one
 * before the first cursor-back marks the end of the transmission.
 */
function parseKittyOutput(raw: string): string[] | undefined {
	const cleaned = raw.replace(/\x1b\[\?25[lh]/g, "");
	const firstBack = cleaned.search(/\x1b\[\d+D/);
	if (firstBack <= 0) {
		return undefined;
	}
	const transmission = cleaned.slice(0, firstBack);
	const rows = cleaned
		.slice(firstBack)
		// Row separators: cursor-back (`ESC[<n>D`), optionally followed by
		// index (`ESC D`, move down one row keeping the column).
		.split(/\x1b\[\d+D(?:\x1bD)?/)
		.map((row) => row.replace(/\n+$/, ""))
		.filter((row) => row.length > 0);
	if (rows.length === 0) {
		return undefined;
	}
	return [transmission, ...rows];
}

/** Real pixels: Kitty graphics wrapped in tmux DCS passthrough with U=1 placeholders. */
function renderKittyInline(base64: string, width: number, maxRows: number): string[] | undefined {
	const maxWidth = Math.max(MIN_WIDTH_CELLS, Math.min(width - 2, MAX_WIDTH_CELLS));
	const result = spawnSync(
		CHAFA_BIN,
		[
			"--format=kitty",
			"--passthrough=tmux",
			"--scale=max",
			`--size=${maxWidth}x${maxRows}`,
			"--animate=off",
			"--probe=off",
			"--relative=off",
			"-",
		],
		{
			input: Buffer.from(base64, "base64"),
			timeout: CHAFA_TIMEOUT_MS * 2,
			maxBuffer: CHAFA_MAX_BUFFER,
		},
	);

	if (result.error || result.status !== 0 || !result.stdout?.length) {
		return undefined;
	}
	return parseKittyOutput(result.stdout.toString("utf8"));
}

/** Character art: portable fallback that works in any terminal. */
function renderWithChafa(base64: string, width: number, maxRows: number): string[] | undefined {
	const caps = getCapabilities();
	const maxWidth = Math.max(MIN_WIDTH_CELLS, Math.min(width - 2, MAX_WIDTH_CELLS));
	const result = spawnSync(
		CHAFA_BIN,
		[
			"--format=symbols",
			"--symbols=half+braille",
			`--colors=${caps.trueColor === false ? "256" : "full"}`,
			`--size=${maxWidth}x${maxRows}`,
			"--dither=none",
			"--probe=off",
			"--animate=off",
			"--optimize=0",
			"--polite=on",
			"--relative=off",
			"-",
		],
		{
			input: Buffer.from(base64, "base64"),
			timeout: CHAFA_TIMEOUT_MS,
			maxBuffer: CHAFA_MAX_BUFFER,
		},
	);

	if (result.error || result.status !== 0 || !result.stdout?.length) {
		return undefined;
	}

	const lines = result.stdout.toString("utf8").replace(/\r/g, "").split("\n");
	while (lines.length > 0 && isBlankLine(lines[lines.length - 1] ?? "")) {
		lines.pop();
	}
	return lines.length > 0 ? lines : undefined;
}

class ImagePreview implements Component {
	private note = "";
	private data = "";
	private expanded = false;
	private pixelMode = false;
	private fallbackFactory: (() => Component) | undefined;
	private fallbackComponent: Component | undefined;
	private readonly noteText = new Text("", 0, 0);

	private art: string[] | undefined;
	private artWidth = -1;
	private artExpanded: boolean | undefined;
	private artFailed = false;

	private pixelLines: string[] | undefined;
	private pixelWidth = -1;
	private pixelExpanded: boolean | undefined;
	private pixelFailed = false;
	private pixelTransmitted = false;

	update(
		note: string,
		data: string,
		expanded: boolean,
		fallbackFactory: () => Component,
		pixelMode: boolean,
	): void {
		if (this.data !== data || this.note !== note) {
			// New image (or new metadata): drop every cache, including the fact
			// that we already transmitted this image.
			this.art = undefined;
			this.artFailed = false;
			this.pixelLines = undefined;
			this.pixelFailed = false;
			this.pixelTransmitted = false;
		}
		this.note = note;
		this.data = data;
		this.expanded = expanded;
		this.fallbackFactory = fallbackFactory;
		this.fallbackComponent = undefined;
		this.pixelMode = pixelMode;
	}

	invalidate(): void {
		this.art = undefined;
		this.artWidth = -1;
		this.artExpanded = undefined;
		this.artFailed = false;
		this.pixelLines = undefined;
		this.pixelWidth = -1;
		this.pixelExpanded = undefined;
		this.pixelFailed = false;
		this.pixelTransmitted = false;
		this.noteText.invalidate();
	}

	render(width: number): string[] {
		const lines: string[] = [];

		if (this.expanded && this.note) {
			this.noteText.setText(this.note);
			lines.push(...this.noteText.render(width));
		}

		if (width >= MIN_WIDTH_CELLS) {
			const maxRows = this.expanded ? MAX_ROWS_EXPANDED : MAX_ROWS_COLLAPSED;

			if (this.pixelMode && !this.pixelFailed) {
				if (
					this.pixelLines === undefined ||
					this.pixelWidth !== width ||
					this.pixelExpanded !== this.expanded
				) {
					this.pixelLines = renderKittyInline(this.data, width, maxRows);
					this.pixelFailed = this.pixelLines === undefined;
					this.pixelWidth = width;
					this.pixelExpanded = this.expanded;
					this.pixelTransmitted = false;
				}
				if (this.pixelLines && this.pixelLines.length > 0) {
					// The image data only has to reach the terminal once. After
					// that the placeholder rows reference the stored image, so a
					// redraw never re-sends the multi-MB transmission.
					const output = this.pixelTransmitted
						? this.pixelLines.map((line, index) =>
								index === 0 ? stripKittyTransmission(line) : line,
							)
						: this.pixelLines;
					this.pixelTransmitted = true;
					if (lines.length > 0) {
						lines.push("");
					}
					lines.push(...output);
					return lines;
				}
			}

			if (this.art === undefined || this.artWidth !== width || this.artExpanded !== this.expanded) {
				this.art = renderWithChafa(this.data, width, maxRows) ?? [];
				this.artFailed = this.art.length === 0;
				this.artWidth = width;
				this.artExpanded = this.expanded;
			}
			if (this.art.length > 0) {
				if (lines.length > 0) {
					lines.push("");
				}
				lines.push(...this.art);
			}
		}

		// chafa missing or failed: fall back to pi's built-in renderer.
		if (this.artFailed && this.fallbackFactory) {
			this.fallbackComponent ??= this.fallbackFactory();
			return this.fallbackComponent.render(width);
		}

		return lines;
	}
}

function findImageBlock(result: {
	content: Array<{ type: string; data?: string; mimeType?: string }>;
}): { data: string; mimeType: string } | undefined {
	for (const block of result.content) {
		if (block.type === "image" && block.data && block.mimeType) {
			return { data: block.data, mimeType: block.mimeType };
		}
	}
	return undefined;
}

/** Outer terminal name as reported by tmux, used to pick a graphics format. */
function getOuterTerminal(): string | undefined {
	try {
		const result = spawnSync("tmux", ["display-message", "-p", "#{client_termname}"], {
			encoding: "utf8",
			timeout: 500,
			stdio: ["ignore", "pipe", "ignore"],
		});
		const name = result.stdout?.trim();
		return name ? name : undefined;
	} catch {
		return undefined;
	}
}

function supportsKittyGraphics(): boolean {
	const term = getOuterTerminal()?.toLowerCase() ?? "";
	return (
		term.includes("kitty") ||
		term.includes("ghostty") ||
		term.includes("wezterm") ||
		term.includes("warp")
	);
}

/** Whether tmux is configured to let our DCS-wrapped graphics through. */
function tmuxAllowsPassthrough(): boolean {
	try {
		const result = spawnSync("tmux", ["show-options", "-gqv", "allow-passthrough"], {
			encoding: "utf8",
			timeout: 500,
			stdio: ["ignore", "pipe", "ignore"],
		});
		const value = result.stdout?.trim().toLowerCase() ?? "";
		return value === "on" || value === "all";
	} catch {
		return false;
	}
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Open an image in a tmux popup overlay; real pixels when the outer terminal can take them. */
function openPopup(imagePath: string): void {
	const quoted = shellQuote(imagePath);
	const chafa =
		supportsKittyGraphics() && tmuxAllowsPassthrough()
			? `chafa --format=kitty --passthrough=tmux --scale=max --clear --animate=off --probe=off ${quoted}`
			: `chafa --format=symbols --symbols=half+braille --scale=max --colors=full --animate=off --probe=off ${quoted}`;
	// `-E` waits for the popup command, `-k` makes any key close it. The
	// detached spawn keeps pi responsive while the popup is open.
	const child = spawn(
		"tmux",
		[
			"display-popup",
			"-E",
			"-k",
			"-w",
			"90%",
			"-h",
			"90%",
			"-T",
			` ${basename(imagePath)} `,
			`${chafa}; read -rsn1 -t 600 _`,
		],
		{ detached: true, stdio: "ignore" },
	);
	child.unref();
}

function openExternal(imagePath: string): void {
	const command = process.platform === "darwin" ? "open" : "xdg-open";
	const child = spawn(command, [imagePath], { detached: true, stdio: "ignore" });
	child.unref();
}

export default function (pi: ExtensionAPI): void {
	// Remember the most recent image so `/preview` can be called without arguments.
	pi.on("tool_result", (event) => {
		if (event.toolName !== "read") {
			return;
		}
		if (!event.content.some((block) => block.type === "image")) {
			return;
		}
		const path = (event.input as { path?: string } | undefined)?.path;
		if (typeof path === "string" && path.length > 0) {
			last_image_path = path;
		}
	});

	pi.registerCommand("preview", {
		description: "Open an image in a tmux popup (real pixels when supported)",
		handler: async (args, ctx) => {
			const requested = args.trim().replace(/^@/, "");
			const candidate = requested.length > 0 ? requested : last_image_path;
			if (!candidate) {
				ctx.ui.notify("No image read yet. Usage: /preview <path>", "warning");
				return;
			}
			const absolute = isAbsolute(candidate) ? candidate : resolve(ctx.cwd, candidate);
			if (!existsSync(absolute)) {
				ctx.ui.notify(`File not found: ${absolute}`, "error");
				return;
			}

			if (!hasChafa()) {
				ctx.ui.notify("chafa not found on PATH", "error");
				return;
			}

			if (process.env.TMUX) {
				openPopup(absolute);
				return;
			}
			openExternal(absolute);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (!hasChafa()) {
			return;
		}

		// Definition (not the wrapped tool): keeps prompt metadata and renderers.
		const builtinRead = createReadToolDefinition(ctx.cwd);
		const builtinRenderResult = builtinRead.renderResult ?? (() => new Text("", 0, 0));
		const kittyInline =
			INLINE_KITTY_IMAGES &&
			Boolean(process.env.TMUX) &&
			tmuxAllowsPassthrough() &&
			supportsKittyGraphics();

		pi.registerTool({
			...builtinRead,
			renderResult(result, options, theme, context) {
				const previous = context.lastComponent;
				const image = findImageBlock(result);

				// Delegate everything that is not an eligible image preview.
				if (
					!image ||
					!context.showImages ||
					options.isPartial ||
					context.isError ||
					getCapabilities().images
				) {
					const base = previous instanceof ImagePreview ? undefined : previous;
					return builtinRenderResult(result, options, theme, { ...context, lastComponent: base });
				}

				const note = result.content
					.filter((block): block is { type: "text"; text: string } => block.type === "text")
					.map((block) => block.text)
					.join("\n");

				const preview = previous instanceof ImagePreview ? previous : new ImagePreview();
				preview.update(
					note ? theme.fg("toolOutput", note) : "",
					image.data,
					options.expanded,
					() => builtinRenderResult(result, options, theme, { ...context, lastComponent: undefined }),
					kittyInline,
				);
				return preview;
			},
		});
	});
}
