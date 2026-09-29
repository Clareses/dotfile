/**
 * /history — pick a message in the real session-tree UI and jump tmux
 * copy-mode to where it appears in the pane's scrollback.
 *
 * Reuses pi's own TreeSelectorComponent (the same component `/tree` uses), so
 * navigation, highlighting, search, folding and filters all behave identically.
 * Defaults to the "user-only" filter, so only your own messages are listed.
 * Selecting a node does NOT navigate the session — it only moves the terminal
 * view (enter copy mode + search the scrollback for a text snippet).
 *
 * Why the extra machinery:
 *   pi clears the pane's scrollback (`ESC[2J ESC[H ESC[3J`) whenever it rebuilds
 *   the chat after a context compaction, so messages from before the compaction
 *   are no longer present in tmux. This extension therefore:
 *     A) only reports a successful jump when a snippet is really present in the
 *        captured scrollback, otherwise it says so instead of faking success;
 *     B) when a jump is impossible it renders the current-branch conversation
 *        like pi's own transcript (pi-tui Markdown + theme: user messages get
 *        the userMessageBg background, assistant messages are plain) in a new
 *        tmux pane above the pi pane (4/5 of pi's column height, auto-focused),
 *        auto-enters copy-mode at the selected message, and closes on Enter
 *        (focus returns to pi). If that pane cannot be created it falls back to
 *        an in-pi overlay. The tree marks already-compacted messages.
 *
 * Env: PI_HIST_CONTEXT (limit context to +/-N messages; default 0 = whole
 *      branch).
 *
 * Usage: /history   (pick a node; in the pane use copy-mode, Enter to close)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	copyToClipboard,
	getMarkdownTheme,
	TreeSelectorComponent,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Box, Markdown, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

const ARCHIVE_KEEP = 20; // keep at most this many compact archives per session
const ARCHIVE_CONTEXT = 40; // lines of context around a match in an archive
const JUMP_LENGTHS = [32, 20, 12, 8]; // snippet lengths to try, longest first

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const block of content) {
			if (
				block &&
				typeof block === "object" &&
				(block as { type?: unknown }).type === "text" &&
				typeof (block as { text?: unknown }).text === "string"
			) {
				parts.push((block as { text: string }).text);
			}
		}
		return parts.join("\n");
	}
	return "";
}

/** First meaningful line, shortened for notifications. */
function oneLine(text: string, max = 60): string {
	const line =
		text
			.split(/\r?\n/)
			.map((l) => l.trim())
			.find((l) => l.length > 0) ?? "";
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/**
 * Candidate plain-text snippets, longest first. tmux searches literally, so we
 * strip markdown and progressively shorten in case the rendered line wraps.
 */
function candidateSnippets(text: string): string[] {
	for (const rawLine of text.split(/\r?\n/)) {
		const line = rawLine
			.replace(/`+/g, "")
			.replace(/\*+/g, "")
			.replace(/^\s*[#>]+\s*/, "")
			.replace(/^\s*[-•]\s+/, "")
			.replace(/\s+/g, " ")
			.trim();
		if (line.length < 6) continue;
		const out: string[] = [];
		for (const len of JUMP_LENGTHS) out.push(line.length > len ? line.slice(0, len) : line);
		return [...new Set(out)].filter((s) => s.length >= 6);
	}
	return [];
}

async function captureScrollback(pi: ExtensionAPI, pane: string): Promise<string> {
	try {
		const result = await pi.exec("tmux", ["capture-pane", "-p", "-S", "-", "-t", pane], {
			timeout: 5000,
		});
		return result.code === 0 ? result.stdout : "";
	} catch {
		return "";
	}
}

async function jumpToSnippet(pi: ExtensionAPI, pane: string, snippet: string): Promise<void> {
	await pi.exec("tmux", ["copy-mode", "-t", pane]);
	await pi.exec("tmux", ["send-keys", "-t", pane, "-X", "history-top"]);
	await pi.exec("tmux", ["send-keys", "-t", pane, "-X", "search-forward-text", snippet]);
	await pi.exec("tmux", ["send-keys", "-t", pane, "-X", "scroll-middle"]);
}

/**
 * After we auto-enter copy-mode on the hist pane, close the pane as soon as the
 * user leaves copy-mode (Enter or q) — so a single keypress returns to pi,
 * instead of the first Enter only leaving copy-mode and a second one closing
 * the pane. If copy-mode was never entered, the pane's own `head -n1` wait
 * still handles Enter.
 */
async function closePaneWhenCopyModeEnds(pi: ExtensionAPI, pane: string): Promise<void> {
	const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
	const modeOf = async (): Promise<string | null> => {
		try {
			const r = await pi.exec(
				"tmux",
				["display-message", "-p", "-t", pane, "-F", "#{pane_in_mode}"],
				{ timeout: 2000 },
			);
			return r.code === 0 ? r.stdout.trim() : null;
		} catch {
			return null;
		}
	};

	// Wait briefly for copy-mode to actually start.
	const start = Date.now();
	let entered = false;
	while (Date.now() - start < 3000) {
		const m = await modeOf();
		if (m === null) return; // pane gone
		if (m === "1") {
			entered = true;
			break;
		}
		await sleep(100);
	}
	if (!entered) return;

	// Then wait until copy-mode is left (or the pane disappears) and close it.
	const deadline = Date.now() + 6 * 60 * 60 * 1000;
	while (Date.now() < deadline) {
		const m = await modeOf();
		if (m === null) return; // pane gone
		if (m !== "1") {
			try {
				await pi.exec("tmux", ["kill-pane", "-t", pane], { timeout: 2000 });
			} catch {
				// ignore
			}
			return;
		}
		await sleep(500);
	}
}

function sessionDir(ctx: ExtensionContext): string | undefined {
	const file = ctx.sessionManager.getSessionFile();
	return file ? path.dirname(file) : undefined;
}

function sessionBase(ctx: ExtensionContext): string | undefined {
	const file = ctx.sessionManager.getSessionFile();
	return file ? path.basename(file).replace(/\.jsonl$/i, "") : undefined;
}

/** Archive files for this session, newest first. */
function listArchives(ctx: ExtensionContext): string[] {
	const dir = sessionDir(ctx);
	const base = sessionBase(ctx);
	if (!dir || !base) return [];
	try {
		return fs
			.readdirSync(dir)
			.filter((f) => f.startsWith(`${base}__`) && f.endsWith(".txt"))
			.map((f) => path.join(dir, f))
			.sort()
			.reverse();
	} catch {
		return [];
	}
}

/** Find the first archive containing one of the snippets; return a context window. */
function findArchiveWindow(ctx: ExtensionContext, snippets: string[]): string | null {
	for (const file of listArchives(ctx)) {
		let lines: string[];
		try {
			lines = fs.readFileSync(file, "utf8").split("\n");
		} catch {
			continue;
		}
		for (const snippet of snippets) {
			const idx = lines.findIndex((line) => line.includes(snippet));
			if (idx >= 0) {
				const from = Math.max(0, idx - ARCHIVE_CONTEXT);
				const to = Math.min(lines.length, idx + ARCHIVE_CONTEXT + 1);
				return lines.slice(from, to).join("\n");
			}
		}
	}
	return null;
}

function renderedEntryIds(ctx: ExtensionContext): Set<string> {
	const ids = new Set<string>();
	try {
		for (const entry of ctx.sessionManager.buildContextEntries()) ids.add(entry.id);
	} catch {
		// ignore
	}
	return ids;
}

/**
 * Render the conversation the way pi's own transcript does, using pi-tui's
 * Markdown with the current theme: user messages get the `userMessageBg`
 * background, assistant messages are plain markdown (no role label or emoji).
 * Returns the ANSI body and the 0-based line where the selected message starts
 * (so we can jump there with copy-mode's goto-line).
 */
function renderConversation(
	theme: any,
	slice: { id: string; role: "user" | "assistant"; text: string }[],
	selectedId: string,
	width: number,
	marker: string,
): string {
	const mdTheme = getMarkdownTheme();
	const lines: string[] = [];

	for (let i = 0; i < slice.length; i++) {
		const m = slice[i];
		if (i > 0) lines.push("");
		// A unique, dim marker line before the selected message; copy-mode searches
		// for its token to jump there (goto-line numbering proved unreliable).
		if (m.id === selectedId) lines.push(theme.fg("dim", `── ${marker} ──`));

		if (m.role === "user") {
			const box = new Box(1, 1, (content: string) => theme.bg("userMessageBg", content));
			box.addChild(
				new Markdown(m.text, 0, 0, mdTheme, {
					color: (content: string) => theme.fg("userMessageText", content),
				}),
			);
			lines.push(...box.render(width));
		} else {
			const md = new Markdown(m.text, 0, 0, mdTheme);
			lines.push(...md.render(width));
		}
	}

	return lines.join("\n");
}

/** Single-quote a string for /bin/sh. */
function shq(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * Show pre-rendered ANSI in a new tmux pane above the pi pane (4/5 of the pi
 * column height, auto-focused). The pane `cat`s the content, then waits for
 * Enter; on Enter the shell exits, tmux closes the pane and focus returns to pi.
 * Because it is a real pane, tmux copy-mode works normally, and we auto-enter it
 * at the selected message.
 *
 * Returns false if the pane could not be created (caller falls back to the
 * in-pi overlay).
 */
async function openInSplitPane(pi: ExtensionAPI, body: string, marker: string): Promise<boolean> {
	if (!body.trim()) return false;
	const pane = process.env.TMUX_PANE;
	if (!pane) return false;

	const file = path.join(os.tmpdir(), `pi-hist-${process.pid}-${Date.now()}.ansi`);
	const readyFile = path.join(os.tmpdir(), `pi-hist-ready-${process.pid}-${Date.now()}`);
	try {
		fs.writeFileSync(file, body);
	} catch {
		return false;
	}

	// cat the ANSI, touch the ready file, then wait for Enter. Use `head -n1`
	// instead of `read _` (tmux runs this via fish, where `_` is read-only, so
	// `read _` would fail and the pane would flash closed).
	const cmd =
		`cat ${shq(file)}; : > ${shq(readyFile)}; ` +
		`printf '\\n[copy-mode: q/Enter to close]\\n'; ` +
		`head -n1 >/dev/null; rm -f ${shq(file)} ${shq(readyFile)}`;

	try {
		// -v above, -b before (above), -l 80% of the pi column height. No -f, so the
		// new pane covers only the pi pane's column, not the whole window.
		const r = await pi.exec(
			"tmux",
			["split-window", "-v", "-b", "-l", "80%", "-t", pane, "-P", "-F", "#{pane_id}", cmd],
			{ timeout: 5000 },
		);
		if (r.code !== 0) {
			try {
				fs.unlinkSync(file);
			} catch {
				// ignore
			}
			return false;
		}

		const newPane = r.stdout.trim();
		if (newPane) {
			// Wait until `cat` finished (ready file), then auto-enter copy-mode at
			// the selected message.
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline && !fs.existsSync(readyFile)) {
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
			if (fs.existsSync(readyFile)) {
				try {
					await jumpToSnippet(pi, newPane, marker);
					// Closing the pane as soon as the user leaves copy-mode means a
					// single Enter returns to pi.
					void closePaneWhenCopyModeEnds(pi, newPane);
				} catch {
					// ignore; the user can still scroll manually
				}
			}
		}
		return true;
	} catch {
		try {
			fs.unlinkSync(file);
		} catch {
			// ignore
		}
		return false;
	}
}

/** Simple scrollable read-only text overlay. */
class TextViewer {
	private top = 0;
	private wrappedCount = 0;
	private viewHeight = 1;
	private readonly body: string;
	private readonly header: string;
	private readonly theme: any;
	private readonly rows: number;
	private readonly kb: any;
	private readonly done: () => void;
	private readonly requestRender: () => void;
	private readonly scrollTo?: string;
	private cursor = 0;
	private located = false;
	private cachedWidth = -1;
	private cachedWrapped: string[] = [];

	constructor(
		header: string,
		body: string,
		theme: any,
		rows: number,
		kb: any,
		done: () => void,
		requestRender: () => void,
		scrollTo?: string,
	) {
		this.header = header;
		this.body = body.length > 0 ? body : "(empty)";
		this.theme = theme;
		this.rows = rows;
		this.kb = kb;
		this.done = done;
		this.requestRender = requestRender;
		this.scrollTo = scrollTo;
	}

	render(width: number): string[] {
		const inner = Math.max(10, width - 2);
		// Cache the wrapped lines: a whole-conversation body is large and render()
		// runs on every keypress, so wrapping once per width matters a lot.
		if (width !== this.cachedWidth) {
			const wrapped: string[] = [];
			for (const line of this.body.split("\n")) {
				const parts = wrapTextWithAnsi(line, inner);
				if (parts.length === 0) wrapped.push("");
				else for (const part of parts) wrapped.push(part);
			}
			this.cachedWrapped = wrapped;
			this.cachedWidth = width;
			// Width changed => line wrapping changed => re-find the marker.
			this.located = false;
		}
		const wrapped = this.cachedWrapped;
		this.wrappedCount = wrapped.length;

		const viewHeight = Math.max(3, this.rows - 6);
		this.viewHeight = viewHeight;

		// Put the cursor on the selected message's marker the first time (and after
		// a resize), then keep the cursor visible.
		if (!this.located) {
			const idx = this.scrollTo ? wrapped.findIndex((l) => l.includes(this.scrollTo as string)) : -1;
			this.cursor = idx >= 0 ? idx : 0;
			this.top = Math.max(0, this.cursor - Math.floor(viewHeight / 2));
			this.located = true;
		}
		const maxCursor = Math.max(0, wrapped.length - 1);
		if (this.cursor < 0) this.cursor = 0;
		if (this.cursor > maxCursor) this.cursor = maxCursor;
		const maxTop = Math.max(0, wrapped.length - viewHeight);
		if (this.cursor < this.top) this.top = this.cursor;
		if (this.cursor >= this.top + viewHeight) this.top = this.cursor - viewHeight + 1;
		if (this.top > maxTop) this.top = maxTop;
		if (this.top < 0) this.top = 0;

		const total = wrapped.length;
		const end = Math.min(total, this.top + viewHeight);
		const pct = total <= viewHeight ? "all" : `${Math.round((end / total) * 100)}%`;
		const title = this.theme.fg("accent", this.theme.bold(this.header));
		const hint = this.theme.fg(
			"dim",
			`  line ${total === 0 ? 0 : this.cursor + 1}/${total}  [${this.top + 1}-${end}] ${pct}  j/k ^d/^u PgUp/PgDn g/G q`,
		);
		const rule = this.theme.fg("dim", "─".repeat(Math.max(1, width)));

		const out: string[] = [truncateToWidth(title + hint, width), rule];
		for (let i = 0; i < viewHeight; i++) {
			const abs = this.top + i;
			const line = wrapped[abs];
			if (line === undefined) {
				out.push("");
				continue;
			}
			let text = truncateToWidth(` ${line}`, width);
			if (abs === this.cursor) {
				// Pad to full width so the cursor highlight spans the whole row.
				const pad = " ".repeat(Math.max(0, width - visibleWidth(text)));
				text = this.theme.bg("selectedBg", text + pad);
			}
			out.push(text);
		}
		out.push(rule);
		return out;
	}

	handleInput(data: string): void {
		const kb = this.kb;
		const page = Math.max(1, this.viewHeight - 1);
		const half = Math.max(1, Math.floor(this.viewHeight / 2));
		if (kb.matches(data, "tui.select.cancel") || data === "q") {
			this.done();
			return;
		}
		if (kb.matches(data, "tui.select.up") || data === "k") this.cursor -= 1;
		else if (kb.matches(data, "tui.select.down") || data === "j") this.cursor += 1;
		else if (kb.matches(data, "tui.select.pageUp") || data === "\x1b[5~") this.cursor -= page;
		else if (kb.matches(data, "tui.select.pageDown") || data === "\x1b[6~") this.cursor += page;
		else if (data === "\x15") this.cursor -= half; // Ctrl+U
		else if (data === "\x04") this.cursor += half; // Ctrl+D
		else if (data === "g" || data === "\x1b[H" || data === "\x1b[1~") this.cursor = 0;
		else if (data === "G" || data === "\x1b[F" || data === "\x1b[4~") this.cursor = this.wrappedCount - 1;
		else return;
		this.requestRender();
	}

	invalidate(): void {}
}

export default function (pi: ExtensionAPI) {
	// ---- B: archive the pane scrollback before pi wipes it on compaction ----
	pi.on("session_before_compact", async (_event, ctx) => {
		const pane = process.env.TMUX_PANE;
		const dir = sessionDir(ctx);
		const base = sessionBase(ctx);
		if (!pane || !dir || !base) return;
		const captured = await captureScrollback(pi, pane);
		if (!captured.trim()) return;
		try {
			const ts = new Date().toISOString().replace(/[:.]/g, "-");
			fs.writeFileSync(path.join(dir, `${base}__${ts}.txt`), captured);
			for (const old of listArchives(ctx).slice(ARCHIVE_KEEP)) {
				try {
					fs.unlinkSync(old);
				} catch {
					// ignore
				}
			}
		} catch {
			// ignore archive failures; jumping still works for live scrollback
		}
	});

	const showViewer = async (
		ctx: ExtensionContext,
		header: string,
		body: string,
		scrollTo?: string,
	): Promise<void> => {
		await ctx.ui.custom<void>((tui, theme, keybindings, done) => {
			return new TextViewer(
				header,
				body,
				theme,
				tui.terminal.rows,
				keybindings,
				() => done(undefined),
				() => tui.requestRender(),
				scrollTo,
			);
		});
	};

	// Only the ancestry of the current leaf (the active branch), not sibling branches.
	const currentBranchTree = (
		sessionManager: ExtensionContext["sessionManager"],
		isCompacted?: (id: string) => boolean,
	): any[] => {
		const tree = sessionManager.getTree() as any[];
		const leafId = sessionManager.getLeafId();
		if (!leafId) return [];

		const byId = new Map<string, any>();
		const index = (nodes: any[]): void => {
			for (const node of nodes) {
				byId.set(node.entry.id, node);
				index(node.children ?? []);
			}
		};
		index(tree);

		// Walk parentId from the current leaf up to the root.
		const keep = new Set<string>();
		let cursor: string | null | undefined = leafId;
		while (cursor && !keep.has(cursor)) {
			keep.add(cursor);
			cursor = byId.get(cursor)?.entry?.parentId ?? null;
		}

		const prune = (nodes: any[]): any[] =>
			nodes
				.filter((node) => keep.has(node.entry.id))
				.map((node) => {
					const copy = { ...node, children: prune(node.children ?? []) };
					// Annotate compacted messages so the tree shows them (rendered as
					// a `[compacted]` prefix by TreeSelectorComponent).
					if (node.entry.type === "message" && isCompacted?.(node.entry.id)) {
						copy.label = copy.label ? `${copy.label} · compacted` : "compacted";
					}
					return copy;
				});

		return prune(tree);
	};

	// Ordered user/assistant messages on the current branch (with non-empty text).
	const branchMessageEntries = (ctx: ExtensionContext): { id: string; role: "user" | "assistant"; text: string }[] => {
		const out: { id: string; role: "user" | "assistant"; text: string }[] = [];
		const walk = (nodes: any[]): void => {
			for (const node of nodes) {
				const entry = node.entry;
				if (
					entry?.type === "message" &&
					(entry.message.role === "user" || entry.message.role === "assistant")
				) {
					const text = messageText(entry.message.content);
					if (text.trim().length > 0) out.push({ id: entry.id, role: entry.message.role, text });
				}
				walk(node.children ?? []);
			}
		};
		walk(currentBranchTree(ctx.sessionManager));
		return out;
	};

	const runHistory = async (ctx: ExtensionContext): Promise<void> => {
		const pane = process.env.TMUX_PANE;
		if (!pane) {
			ctx.ui.notify("/history requires tmux (TMUX_PANE is not set)", "error");
			return;
		}
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/history requires interactive mode", "error");
			return;
		}

		const leafId = ctx.sessionManager.getLeafId();
		const entryId = await ctx.ui.custom<string | null>((tui, _theme, _kb, done) => {
			const renderedIds = renderedEntryIds(ctx);
			const selector = new TreeSelectorComponent(
				currentBranchTree(ctx.sessionManager, (id) => !renderedIds.has(id)),
				leafId,
				tui.terminal.rows,
				(id) => done(id),
				() => done(null),
				(id, label) => pi.setLabel(id, label),
				leafId ?? undefined,
				"user-only",
			);
			selector.onCopy = async (text) => {
				if (!text) return;
				try {
					await copyToClipboard(text);
					ctx.ui.notify("Copied to clipboard", "info");
				} catch {
					// ignore clipboard failures
				}
			};
			return selector;
		});

		if (!entryId) return;

		const entry = ctx.sessionManager.getEntry(entryId);
		if (
			!entry ||
			entry.type !== "message" ||
			(entry.message.role !== "user" && entry.message.role !== "assistant")
		) {
			ctx.ui.notify("Selected node has no jumpable message text", "warning");
			return;
		}

		const text = messageText(entry.message.content);
		const role = entry.message.role;
		const snippets = candidateSnippets(text);
		// A message no longer in the rendered context was cleared from the pane's
		// scrollback on compaction, so never run the tmux jump for it: a short
		// snippet could match unrelated output and land somewhere wrong.
		const compacted = !renderedEntryIds(ctx).has(entryId);

		// ---- A: only jump if the snippet is really in the current scrollback ----
		if (!compacted && snippets.length > 0) {
			const captured = await captureScrollback(pi, pane);
			const snippet = snippets.find((s) => captured.includes(s));
			if (snippet) {
				try {
					await jumpToSnippet(pi, pane, snippet);
					ctx.ui.notify(`Jumped to [${role}] ${oneLine(text, 40)}`, "info");
				} catch (error) {
					ctx.ui.notify(
						`tmux jump failed: ${error instanceof Error ? error.message : String(error)}`,
						"error",
					);
				}
				return;
			}
		}

		// ---- B: not in the terminal — render the conversation like pi's own
		//         transcript, falling back to the compaction archive / raw message ----
		const archived = findArchiveWindow(ctx, snippets);
		const reason = compacted
			? "before the last compaction; no longer in the terminal"
			: "not found in the terminal scrollback";

		// Whole current branch by default; PI_HIST_CONTEXT=N limits to +/-N messages.
		const branch = branchMessageEntries(ctx);
		const limit = Math.max(0, Math.trunc(Number(process.env.PI_HIST_CONTEXT ?? "0")) || 0);
		const selIdx = branch.findIndex((m) => m.id === entryId);
		const slice =
			limit > 0 && selIdx >= 0
				? branch.slice(Math.max(0, selIdx - limit), Math.min(branch.length, selIdx + limit + 1))
				: branch.length > 0
					? branch
					: [{ id: entryId, role, text }];

		// Render with pi's own Markdown/theme at (almost) the full pane width.
		let wrapWidth = 100;
		try {
			const w = await pi.exec("tmux", ["display-message", "-p", "-t", pane, "-F", "#{pane_width}"], {
				timeout: 3000,
			});
			const paneWidth = parseInt(w.stdout.trim(), 10);
			if (Number.isFinite(paneWidth) && paneWidth > 2) wrapWidth = paneWidth - 1;
		} catch {
			// ignore; use default width
		}
		// Unique token inserted before the selected message; copy-mode searches it.
		const marker = `HIST${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
		const body = renderConversation(ctx.ui.theme, slice, entryId, wrapWidth, marker);

		// Primary: show it in a real tmux pane so tmux copy-mode works.
		if (await openInSplitPane(pi, body, marker)) {
			return;
		}

		ctx.ui.notify(
			archived
				? `Not in terminal — showing archived scrollback [${role}]`
				: `Not in terminal (${reason}) — showing message text [${role}]`,
			"warning",
		);
		const header = archived
			? `archive (pre-compaction terminal)  [${role}] ${oneLine(text, 40)}`
			: `conversation  [${role}] ${oneLine(text, 40)}`;
		await showViewer(ctx, header, archived ?? body);
	};

	pi.registerCommand("history", {
		description: "Pick a message in a tree view and jump tmux copy-mode to it",
		handler: (_args, ctx) => runHistory(ctx),
	});

	// Alias: same handler, so /hist works too.
	pi.registerCommand("hist", {
		description: "Alias of /history",
		handler: (_args, ctx) => runHistory(ctx),
	});
}
