/**
 * explore — ripwire-backed code exploration mode for pi.
 *
 * ripwire (https://github.com/redhat-et/ripwire) is "the ripgrep of AI
 * context": it parses a codebase once and streams a deterministic, ranked
 * call-graph map, so the agent reads only what matters instead of fanning out
 * whole-file reads.
 *
 *   /explore            toggle
 *   /explore on|off     set explicitly
 *   /explore status     show current state
 *
 * Default is OFF, and it resets to OFF at the start of every session — same
 * spirit as /pi-web-access. When ON the `ripwire` tool is exposed to the model
 * and its prompt guidelines are active; when OFF the tool is removed from the
 * active set and direct `ripwire` bash invocations are blocked too.
 *
 * The 17 ripwire agent skills ship in this package's skills/ directory.
 *
 * Binary discovery: $RIPWIRE_BIN, then ~/.local/bin/ripwire, /usr/local/bin,
 * /opt/homebrew/bin, /usr/bin, then plain `ripwire` on PATH.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const TOOL_NAME = "ripwire";
const STATUS_KEY = "explore";

/** Resolve the ripwire executable without relying on the agent process PATH. */
function resolveBin(): string {
	const fromEnv = process.env.RIPWIRE_BIN?.trim();
	if (fromEnv) return fromEnv;
	const candidates = [
		path.join(os.homedir(), ".local", "bin", "ripwire"),
		"/usr/local/bin/ripwire",
		"/opt/homebrew/bin/ripwire",
		"/usr/bin/ripwire",
	];
	for (const candidate of candidates) {
		try {
			if (fs.existsSync(candidate)) return candidate;
		} catch {
			// ignore
		}
	}
	return "ripwire";
}

/**
 * Shell-like argument splitter: honours single quotes (literal), double quotes
 * (backslash escapes) and unquoted backslash escapes. Avoids running through a
 * shell while still letting the model write natural `--for="parse config"`.
 */
export function splitArgs(input: string): string[] {
	const out: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;
	let started = false;
	for (let i = 0; i < input.length; i++) {
		const ch = input[i];
		if (quote === "'") {
			if (ch === "'") quote = null;
			else current += ch;
			started = true;
			continue;
		}
		if (quote === '"') {
			if (ch === '"') quote = null;
			else if (ch === "\\" && i + 1 < input.length) current += input[++i];
			else current += ch;
			started = true;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			started = true;
			continue;
		}
		if (ch === "\\" && i + 1 < input.length) {
			current += input[++i];
			started = true;
			continue;
		}
		if (/\s/.test(ch)) {
			if (started) {
				out.push(current);
				current = "";
				started = false;
			}
			continue;
		}
		current += ch;
		started = true;
	}
	if (started) out.push(current);
	return out;
}

/**
 * Does a bash command line invoke `ripwire` as a command? Splits on shell
 * operators and drops leading env assignments / `command` / `exec` / `env`
 * wrappers before matching the first word.
 */
export function invokesRipwire(command: string): boolean {
	return command.split(/[;&|\n]+/).some((segment) => {
		let s = segment.trim();
		s = s.replace(/^(?:[A-Za-z_]\w*=\S*\s+)+/, ""); // FOO=bar ripwire ...
		s = s.replace(/^(?:command|exec)\s+/, "");
		s = s.replace(/^env\s+(?:[A-Za-z_]\w*=\S*\s+)*/, "");
		return /^(?:\S*[/\\])?ripwire(?:\.exe)?(?:\s|$)/.test(s);
	});
}

const EXIT_HINTS: Record<number, string> = {
	1: "refused the request",
	2: "policy gate fired",
	3: "token budget exceeded",
	4: "test gate found an open obligation",
};

const MAX_OUTPUT_CHARS = 48_000;

function clip(text: string): string {
	if (text.length <= MAX_OUTPUT_CHARS) return text;
	return `${text.slice(0, MAX_OUTPUT_CHARS)}\n\n… [output truncated at ${MAX_OUTPUT_CHARS} chars; narrow it with --top-k / --max-tokens or a more specific flag]`;
}

export default function exploreExtension(pi: ExtensionAPI): void {
	let enabled = false;

	/** Reconcile the active-tool set with the toggle state. */
	function apply(): string[] {
		const others = pi.getActiveTools().filter((name) => name !== TOOL_NAME);
		const next = enabled ? [...others, TOOL_NAME] : others;
		const unique = [...new Set(next)];
		pi.setActiveTools(unique);
		return unique;
	}

	function setStatus(ctx: ExtensionContext): void {
		ctx.ui.setStatus(STATUS_KEY, enabled ? ctx.ui.theme.fg("accent", "🧭 explore") : undefined);
	}

	pi.registerTool({
		name: TOOL_NAME,
		label: "ripwire",
		description:
			"Run the `ripwire` code-intelligence CLI (\"the ripgrep of AI context\") on a repository. " +
			"Use it to orient in a codebase, find the task-relevant code, trace callers/callees/impact, " +
			"plan which tests to run, and check an edit's blast radius or new quality debt — instead of " +
			"grepping and reading whole files. Pass the repo directory first (usually `.`), then ripwire " +
			"flags, e.g. `. --report`, `. --for=\"parse config files\"`, `. --callers=myFunc`, " +
			"`. --impact=myFunc`, `. --edit-check=myFunc`, `. --test-gate`, `. --quality-delta`. " +
			"Output is deterministic XML whose first line is a legend comment (add --json for JSON). " +
			"Exit 2/3/4 mean a policy/token/test gate fired and is still informative.",
		promptSnippet: "Map a repo, answer call-graph questions, or check an edit's blast radius with ripwire",
		promptGuidelines: [
			"Use the ripwire tool at the start of an unfamiliar-codebase task: `. --report` to orient, then `. --for=\"<task>\"` to find what to read first — before opening files.",
			"Use the ripwire tool to answer who-calls-what and which tests to run: `. --callers=SYM`, `. --callees=SYM`, `. --impact=SYM`, `. --uses=SYM`, `. --test-gate`.",
			"Use the ripwire tool right after an edit: `. --edit-check=SYM` for contract breakage and `. --quality-delta` before declaring the change done.",
		],
		parameters: Type.Object({
			args: Type.String({
				description:
					'Arguments passed to ripwire, including the repo directory, e.g. ". --report", ' +
					'". --for=\'parse config\' --top-k=20", ". --callers=main", "--help=--edit-check".',
			}),
			cwd: Type.Optional(
				Type.String({
					description: "Directory to run in (defaults to the session working directory).",
				}),
			),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			if (!enabled) {
				return {
					content: [
						{
							type: "text",
							text: "ripwire explore mode is off. Run /explore on to enable it.",
						},
					],
					details: {},
				};
			}

			const argv = splitArgs(params.args ?? "");
			if (argv.length === 0) argv.push(".");

			const cwd = params.cwd?.trim() || ctx.cwd;
			const bin = resolveBin();

			const result = await pi.exec(bin, argv, { cwd, signal, timeout: 180_000 });

			const parts: string[] = [];
			const stdout = result.stdout.trimEnd();
			const stderr = result.stderr.trimEnd();
			if (stdout) parts.push(stdout);
			if (stderr) parts.push(`[stderr]\n${stderr}`);
			let text = parts.join("\n\n") || "(ripwire produced no output)";
			text = clip(text);

			if (result.code !== 0) {
				const hint = EXIT_HINTS[result.code];
				text += `\n\n[ripwire exit ${result.code}${hint ? ` — ${hint}` : ""}${result.killed ? ", killed" : ""}]`;
			}

			return {
				content: [{ type: "text", text }],
				details: { bin, argv, cwd, code: result.code, killed: result.killed },
			};
		},
	});

	pi.registerCommand("explore", {
		description: "Enable/disable the ripwire code-exploration tool (on|off|status)",
		getArgumentCompletions: (prefix: string) =>
			["on", "off", "status"].filter((v) => v.startsWith(prefix)).map((v) => ({ value: v, label: v })),
		handler: async (args: string, ctx: ExtensionContext) => {
			const a = args.trim().toLowerCase();
			if (a === "status") {
				ctx.ui.notify(`explore is ${enabled ? "on" : "off"}`, "info");
				return;
			}
			if (a === "on") enabled = true;
			else if (a === "off") enabled = false;
			else if (a === "" || a === "toggle") enabled = !enabled;
			else {
				ctx.ui.notify("usage: /explore [on|off|status]", "warning");
				return;
			}

			apply();
			setStatus(ctx);
			ctx.ui.notify(
				enabled ? "explore on — ripwire tool enabled" : "explore off — ripwire tool disabled",
				"info",
			);
		},
	});

	// Default OFF at the start of every session; re-assert on tree changes and
	// right before each run so another extension's tool bookkeeping can't drop it.
	pi.on("session_start", (_event, ctx) => {
		enabled = false;
		apply();
		setStatus(ctx);
	});
	pi.on("session_tree", () => {
		apply();
	});
	pi.on("before_agent_start", () => {
		apply();
	});

	// While OFF, also block direct `ripwire` bash invocations, so the toggle
	// actually means something even when a bundled skill says to use it.
	pi.on("tool_call", async (event) => {
		if (enabled || event.toolName !== "bash") return;
		const command = String((event.input as { command?: unknown })?.command ?? "");
		if (invokesRipwire(command)) {
			return { block: true, reason: "ripwire explore mode is off. Run /explore on to enable it." };
		}
	});
}
