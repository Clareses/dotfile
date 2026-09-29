/**
 * /diff — pick commits (multi-select) and open nvim + diffview in a new tmux window.
 *
 * Flow:
 *   1. Inspect the repo of the current directory (branch / HEAD / recent commits).
 *   2. Show a multi-select commit list. The top row "default" means
 *      "uncommitted changes" (`:DiffviewOpen HEAD`).
 *   3. Open a new tmux window and launch nvim there with
 *      `:DiffviewOpen <target>`.
 *
 * Selection → diffview target:
 *   - nothing selected (= default) → HEAD          (worktree + index vs HEAD)
 *   - 1 commit                     → <sha>          (worktree vs that commit)
 *   - 2+ commits                   → <oldest>..<newest>  (commit range)
 *
 * Keys: j/k ↑/↓ move · Space toggle · / filter · Enter open · q/Esc cancel
 * Usage: /diff            (repo of the pi cwd)
 *        /diff <path>     (repo containing <path>)
 */

import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const MAX_COMMITS = 300;

interface CommitInfo {
	sha: string;
	short: string;
	subject: string;
	author: string;
	relDate: string;
	refs: string;
}

interface RepoInfo {
	root: string;
	branch: string;
	head: string;
	detached: boolean;
	commits: CommitInfo[];
}

type RepoResult = RepoInfo | { error: string };

type Choice = { kind: "default" } | { kind: "commits"; shas: string[] } | null;

interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
	killed: boolean;
}

async function git(
	pi: ExtensionAPI,
	args: string[],
	cwd: string,
): Promise<ExecResult> {
	try {
		return (await pi.exec("git", args, { cwd, timeout: 10000 })) as ExecResult;
	} catch (error) {
		return {
			stdout: "",
			stderr: error instanceof Error ? error.message : String(error),
			code: 1,
			killed: false,
		};
	}
}

async function loadRepo(pi: ExtensionAPI, cwd: string): Promise<RepoResult> {
	const inside = await git(pi, ["rev-parse", "--is-inside-work-tree"], cwd);
	if (inside.code !== 0 || inside.stdout.trim() !== "true") {
		return { error: `not inside a git work tree: ${cwd}` };
	}

	const top = await git(pi, ["rev-parse", "--show-toplevel"], cwd);
	const root = top.stdout.trim() || cwd;

	const branchRes = await git(pi, ["rev-parse", "--abbrev-ref", "HEAD"], cwd);
	const branchRaw = branchRes.stdout.trim();
	const detached = branchRaw === "HEAD";

	const headRes = await git(pi, ["rev-parse", "--short", "HEAD"], cwd);
	const head = headRes.stdout.trim();

	// %x1f = field separator, %x1e = record separator
	const logRes = await git(
		pi,
		[
			"log",
			"-n",
			String(MAX_COMMITS),
			"--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%ar%x1f%D%x1e",
		],
		cwd,
	);
	const commits: CommitInfo[] = [];
	for (const record of logRes.stdout.split("\x1e")) {
		const line = record.replace(/^\n+|\n+$/g, "");
		if (!line) continue;
		const parts = line.split("\x1f");
		if (parts.length < 6) continue;
		commits.push({
			sha: parts[0],
			short: parts[1],
			subject: parts[2],
			author: parts[3],
			relDate: parts[4],
			refs: parts[5].trim(),
		});
	}

	return { root, branch: detached ? "(detached HEAD)" : branchRaw, head, detached, commits };
}

/**
 * Multi-select commit list. Row 0 is the synthetic "default" (uncommitted)
 * entry; rows 1.. are commits. `checked` holds indices into `repo.commits`;
 * an empty set therefore means "default is active".
 */
class CommitSelector {
	private readonly repo: RepoInfo;
	private readonly theme: any;
	private readonly kb: any;
	private readonly rows: number;
	private readonly done: (choice: Choice) => void;
	private readonly requestRender: () => void;

	private cursor = 0;
	private readonly checked = new Set<number>();
	private top = 0;
	private viewHeight = 10;
	private filter = "";
	private filtering = false;
	private filtered: number[] = [];

	constructor(
		repo: RepoInfo,
		theme: any,
		kb: any,
		rows: number,
		done: (choice: Choice) => void,
		requestRender: () => void,
	) {
		this.repo = repo;
		this.theme = theme;
		this.kb = kb;
		this.rows = rows;
		this.done = done;
		this.requestRender = requestRender;
		this.applyFilter();
	}

	private get rowCount(): number {
		return 1 + this.filtered.length;
	}

	private applyFilter(): void {
		if (!this.filter) {
			this.filtered = this.repo.commits.map((_, i) => i);
		} else {
			const q = this.filter.toLowerCase();
			this.filtered = this.repo.commits
				.map((commit, i) => ({ commit, i }))
				.filter(
					({ commit }) =>
						commit.subject.toLowerCase().includes(q) ||
						commit.sha.startsWith(q) ||
						commit.short.startsWith(q) ||
						commit.author.toLowerCase().includes(q) ||
						commit.refs.toLowerCase().includes(q),
				)
				.map(({ i }) => i);
		}
		if (this.cursor > this.rowCount - 1) this.cursor = this.rowCount - 1;
		if (this.cursor < 0) this.cursor = 0;
	}

	private selectedShas(): string[] {
		// ascending index = newest first; reverse to get chronological order
		return [...this.checked]
			.sort((a, b) => a - b)
			.map((i) => this.repo.commits[i].sha)
			.reverse();
	}

	private targetPreview(): string {
		if (this.checked.size === 0) return "HEAD (uncommitted)";
		const shas = this.selectedShas();
		if (shas.length === 1) return shas[0].slice(0, 12);
		return `${shas[0].slice(0, 8)}..${shas[shas.length - 1].slice(0, 8)}`;
	}

	private move(delta: number): void {
		const count = this.rowCount;
		if (count === 0) return;
		this.cursor = (this.cursor + delta + count) % count;
	}

	private toggle(): void {
		if (this.cursor === 0) {
			this.checked.clear();
			return;
		}
		const idx = this.filtered[this.cursor - 1];
		if (this.checked.has(idx)) this.checked.delete(idx);
		else this.checked.add(idx);
	}

	private confirm(): void {
		if (this.checked.size === 0) {
			this.done({ kind: "default" });
			return;
		}
		this.done({ kind: "commits", shas: this.selectedShas() });
	}

	private finishRow(text: string, width: number, isSelected: boolean): string {
		let line = truncateToWidth(text, width);
		const pad = width - visibleWidth(line);
		if (pad > 0) line += " ".repeat(pad);
		return isSelected ? this.theme.bg("selectedBg", line) : line;
	}

	private renderRow(row: number, width: number): string {
		const t = this.theme;
		const isSelected = row === this.cursor;
		const cursor = isSelected ? t.fg("accent", "› ") : "  ";

		if (row === 0) {
			const on = this.checked.size === 0;
			const box = on ? t.fg("success", "[x]") : t.fg("muted", "[ ]");
			const text = `${cursor}${box} ${t.fg("accent", t.bold("default"))}  ${t.fg(
				"text",
				"uncommitted changes (worktree + index vs HEAD)",
			)}`;
			return this.finishRow(text, width, isSelected);
		}

		const idx = this.filtered[row - 1];
		const commit = this.repo.commits[idx];
		const on = this.checked.has(idx);
		const box = on ? t.fg("success", "[x]") : t.fg("muted", "[ ]");
		const sha = t.fg("warning", commit.short);
		const refs = commit.refs ? ` ${t.fg("accent", commit.refs)}` : "";
		const date = `  ${t.fg("dim", commit.relDate)}`;
		const text = `${cursor}${box} ${sha} ${t.fg("text", commit.subject)}${refs}${date}`;
		return this.finishRow(text, width, isSelected);
	}

	private renderStatus(width: number): string {
		const t = this.theme;
		if (this.filtering) {
			return truncateToWidth(
				t.fg("accent", "filter: ") + t.fg("text", this.filter) + t.fg("accent", "▌") +
					t.fg("dim", "   Enter 完成 / Esc 清除"),
				width,
			);
		}
		const n = this.checked.size;
		const sel = this.checked.size === 0
			? t.fg("success", "→ default")
			: t.fg("success", `→ ${n} selected · ${this.targetPreview()}`);
		const hint = t.fg("dim", "Space 勾选 · Enter 打开 · j/k · / 搜索 · q 取消");
		return truncateToWidth(`${hint}   ${sel}`, width);
	}

	render(width: number): string[] {
		const t = this.theme;
		const out: string[] = [];

		const branchLabel = this.repo.detached
			? this.repo.head
			: `${this.repo.branch} @ ${this.repo.head}`;
		const title =
			t.bold(t.fg("accent", "Diff")) +
			t.fg("muted", `  ${branchLabel}  ·  ${this.repo.commits.length} commits`);
		out.push(truncateToWidth(title, width));
		out.push(t.fg("borderMuted", "─".repeat(width)));

		// Match the built-in tree/history selectors: cap the list to about half
		// the terminal so the chat above stays visible instead of going fullscreen.
		const viewHeight = Math.max(5, Math.floor(this.rows / 2));
		this.viewHeight = viewHeight;
		const total = this.rowCount;

		if (this.cursor < this.top) this.top = this.cursor;
		if (this.cursor >= this.top + viewHeight) this.top = this.cursor - viewHeight + 1;
		const maxTop = Math.max(0, total - viewHeight);
		if (this.top > maxTop) this.top = maxTop;
		if (this.top < 0) this.top = 0;

		for (let i = 0; i < viewHeight; i++) {
			const row = this.top + i;
			out.push(row < total ? this.renderRow(row, width) : "");
		}

		out.push(t.fg("borderMuted", "─".repeat(width)));
		out.push(this.renderStatus(width));
		return out;
	}

	handleInput(data: string): void {
		const kb = this.kb;

		if (this.filtering) {
			if (data === "\x1b") {
				this.filter = "";
				this.filtering = false;
			} else if (kb.matches(data, "tui.select.confirm") || data === "\r" || data === "\n") {
				this.filtering = false;
			} else if (data === "\x7f" || data === "\b") {
				this.filter = this.filter.slice(0, -1);
			} else if (data.length === 1 && data >= " ") {
				this.filter += data;
			} else {
				return;
			}
			this.applyFilter();
			this.top = 0;
			this.requestRender();
			return;
		}

		if (kb.matches(data, "tui.select.cancel")) {
			this.done(null);
			return;
		}
		if (kb.matches(data, "tui.select.up") || data === "k") this.move(-1);
		else if (kb.matches(data, "tui.select.down") || data === "j") this.move(1);
		else if (kb.matches(data, "tui.select.pageUp") || data === "\x1b[5~") this.move(-this.viewHeight);
		else if (kb.matches(data, "tui.select.pageDown") || data === "\x1b[6~") this.move(this.viewHeight);
		else if (data === "g" || data === "\x1b[H" || data === "\x1b[1~") this.cursor = 0;
		else if (data === "G" || data === "\x1b[F" || data === "\x1b[4~") this.cursor = this.rowCount - 1;
		else if (data === " ") this.toggle();
		else if (data === "/") {
			this.filtering = true;
			this.requestRender();
			return;
		} else if (kb.matches(data, "tui.select.confirm") || data === "\r" || data === "\n") {
			this.confirm();
			return;
		} else {
			return;
		}
		this.requestRender();
	}

	invalidate(): void {}
}

export default function (pi: ExtensionAPI) {
	const runDiff = async (ctx: ExtensionContext, args: string): Promise<void> => {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("/diff requires interactive mode", "error");
			return;
		}
		const pane = process.env.TMUX_PANE;
		if (!process.env.TMUX || !pane) {
			ctx.ui.notify("/diff requires tmux (TMUX_PANE is not set)", "error");
			return;
		}

		const trimmed = args.trim();
		const cwd = trimmed ? path.resolve(ctx.cwd, trimmed) : ctx.cwd;
		const info = await loadRepo(pi, cwd);
		if ("error" in info) {
			ctx.ui.notify(`/diff: ${info.error}`, "error");
			return;
		}
		if (!info.head) {
			ctx.ui.notify("/diff: repository has no commits yet", "warning");
			return;
		}

		let target = "HEAD";
		let label = info.detached ? info.head : `${info.branch} @ ${info.head}`;

		if (info.commits.length > 0) {
			const choice = await ctx.ui.custom<Choice>((tui, theme, keybindings, done) =>
				new CommitSelector(info, theme, keybindings, tui.terminal.rows, done, () =>
					tui.requestRender(),
				),
			);
			if (!choice) return;
			if (choice.kind === "commits" && choice.shas.length > 0) {
				const shas = choice.shas;
				target = shas.length === 1
					? shas[0]
					: `${shas[0]}..${shas[shas.length - 1]}`;
				label = shas.length === 1
					? `${info.branch} · ${shas[0].slice(0, 10)}`
					: `${info.branch} · ${shas[0].slice(0, 8)}..${shas[shas.length - 1].slice(0, 8)}`;
			}
		}

		// Resolve the session of the pi pane so the new window lands next to it.
		const sessionRes = await pi.exec(
			"tmux",
			["display-message", "-p", "-t", pane, "#{session_id}"],
			{ timeout: 5000 },
		);
		const session = sessionRes.stdout.trim() || pane;

		const nvimCommand = `nvim -c 'DiffviewOpen ${target}'`;
		const created = await pi.exec(
			"tmux",
			[
				"new-window",
				"-t",
				session,
				"-c",
				info.root,
				"-n",
				`diff·${label}`,
				"-P",
				"-F",
				"#{window_id}",
				nvimCommand,
			],
			{ timeout: 10000 },
		);
		if (created.code !== 0) {
			ctx.ui.notify(
				`/diff: tmux new-window failed: ${created.stderr.trim() || created.stdout.trim()}`,
				"error",
			);
			return;
		}
		const windowId = created.stdout.trim();
		if (windowId) {
			// Keep our name instead of letting automatic-rename switch it to "nvim".
			await pi.exec("tmux", ["set-option", "-w", "-t", windowId, "automatic-rename", "off"], {
				timeout: 5000,
			});
		}
		ctx.ui.notify(`Opened diffview in a new window: ${target}`, "info");
	};

	pi.registerCommand("diff", {
		description: "Pick commits and open nvim + diffview in a new tmux window",
		handler: (args, ctx) => runDiff(ctx, args),
	});
}
