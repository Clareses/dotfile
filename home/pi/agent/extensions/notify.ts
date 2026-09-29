/**
 * notify — desktop notifications, both automatic and on demand.
 *
 * Auto: when the agent settles (finishes and will not continue on its own,
 * e.g. it is now waiting for your next prompt), a normal-urgency notification
 * is raised so you can leave the terminal. The body is the first line of the
 * last reply. By default it fires on EVERY completed turn
 * (PI_NOTIFY_MIN_SECONDS defaults to 0); set a positive
 * PI_NOTIFY_MIN_SECONDS to only ping for longer runs.
 * This is on by default; disable it with `/notify auto off` or
 * `PI_NOTIFY_AUTO=0`, or silence everything with `/notify off`.
 *
 * The agent can also raise one on purpose by calling the `notify` tool (e.g.
 * for a long-running task, or when a result is worth flagging).
 *
 * Why terminal escape codes instead of hyprctl/notify-send:
 *   pi may run on a REMOTE host over ssh (kitty -> ssh -> tmux -> pi). There is
 *   no Hyprland / D-Bus on that host, so the only channel that crosses ssh is
 *   the terminal byte stream. kitty supports OSC 99 notifications (with an
 *   urgency field), and tmux forwards them with `allow-passthrough on` using a
 *   DCS wrapper:
 *
 *       ESC P tmux ;  ESC ESC ] 99 ; ... ST  ESC \
 *
 *   kitty (running locally) then raises the notification via the local D-Bus
 *   daemon (mako). This works both locally and over ssh.
 *
 *   OSC 99 (not OSC 777) is used because it carries an urgency: normal notices
 *   use `u=1` (auto-expiring), while the `notify` tool may pass `u=2`
 *   (critical) which mako keeps on screen forever via
 *   `[urgency=critical] default-timeout=0`. Automatic completion notices are
 *   always normal, so they never stick around.
 *
 * Backends (auto):
 *   1. inside tmux              -> OSC 99 through tmux passthrough (pane tty)
 *   2. behind a tmux over ssh   -> OSC 99 through tmux passthrough (/dev/tty)
 *      (pi on a remote host: TMUX is unset, but ssh forwards TERM=tmux-256color)
 *   3. local kitty (no tmux)    -> OSC 99 written to the tty
 *   4. local Hyprland           -> `hyprctl notify`
 *   5. otherwise                -> `notify-send`
 *   Force with PI_NOTIFY_BACKEND=osc|hyprctl|notify-send.
 *
 * Grouping: each notification gets a fresh OSC 99 id (`i`) so later ones no
 * longer replace earlier ones — they stack. To let the notification daemon
 * cluster by session, the OSC 99 application name (`f=`) is set to
 * `pi · <session> · <id>`: swaync's `notification-grouping` groups by
 * desktop-entry (unset here) or app name, so same-session notifications land
 * in one group while other sessions stay separate. A short suffix of the
 * stable session id is always included because the session name (often unset)
 * and the cwd basename (often shared, e.g. several sessions in one directory)
 * are not unique. The session is also attached as a notification type
 * (`t=pi.session.<name>`, base64), which kitty forwards as the freedesktop
 * `category` hint for daemons that group by it (mako: `group-by=category`).
 *
 * Config:
 *   PI_NOTIFY_DURATION_MS   duration for hyprctl/notify-send (default 6000)
 *   PI_NOTIFY_BACKEND       backend override
 *   PI_NOTIFY_AUTO          set to 0 to disable automatic completion notices
 *                           while keeping the manual `notify` tool
 *   PI_NOTIFY_MIN_SECONDS   only auto-notify when a run lasted at least this
 *                           many seconds (default 0 = every completed turn;
 *                           set e.g. 30 to skip quick back-and-forth)
 *
 * Commands:
 *   /notify            toggle master on/off
 *   /notify on|off     set master explicitly
 *   /notify auto on|off  enable/disable the automatic completion notice
 *
 * Tool (so the agent can notify on purpose):
 *   notify(message, title?, urgency?)  -> raises a notification immediately
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Type } from "typebox";
import { StringEnum } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ESC = "\x1b";
const ST = "\x1b\\";

function stripControl(text: string): string {
	// remove C0 control characters (we re-add ESC/ST ourselves)
	return text.replace(/[\x00-\x1f\x7f]/g, " ");
}

function clean(text: string): string {
	return text
		.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "") // strip ANSI
		.replace(/\s+/g, " ")
		.trim();
}

function oneLine(text: string, max: number): string {
	const s = clean(text);
	return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** First non-empty line of the last assistant text in a set of messages. */
function lastAssistantLine(messages: unknown): string {
	if (!Array.isArray(messages)) return "";
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i] as { role?: string; content?: unknown } | undefined;
		if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;
		for (const block of msg.content as Array<{ type?: string; text?: unknown }>) {
			if (block?.type !== "text" || typeof block.text !== "string") continue;
			const line = block.text
				.split("\n")
				.map((s) => s.trim())
				.find((s) => s.length > 0);
			if (line) return line;
		}
	}
	return "";
}

function urgencyValue(name: string | undefined): number {
	if (name === "low") return 0;
	if (name === "critical") return 2;
	return 1; // normal
}

const URGENCY_NAMES = ["low", "normal", "critical"];

function b64(s: string): string {
	return Buffer.from(s, "utf8").toString("base64");
}

let notifSeq = 0;

/**
 * A fresh notification id per notification. OSC 99 replaces the notification
 * when the `i` key repeats, so a unique id is what makes notifications stack
 * instead of overwriting each other. Must stay within [a-zA-Z0-9_-+.] (no
 * session name here; that goes into the `t` type tag).
 */
function uniqueNotifId(): string {
	notifSeq = (notifSeq + 1) % 0xffffff;
	return `pi-${Date.now().toString(36)}-${notifSeq.toString(36)}`;
}

/**
 * OSC 99 notification, as understood by kitty. `u=` = urgency (0 low / 1 normal
 * / 2 critical), `f=` = base64 application name (`pi · <session>`, so the
 * daemon can group per session), `t=` = base64 notification type (used to tag the session).
 *
 * The title/body are two chunks sharing the same `i` id: the first sets `d=0`
 * and the final one `d=1`, which is what actually raises the notification.
 */
function osc99(title: string, body: string, urgency = 2, id = uniqueNotifId(), type?: string, appName = "pi"): string {
	const app = b64(appName);
	// The payload is everything after the FIRST ';', so ';' / ':' inside the
	// title/body are fine; only control characters need stripping.
	const t = stripControl(title);
	const b = stripControl(body);
	const typePart = type ? `:t=${b64(type)}` : "";
	return (
		`${ESC}]99;i=${id}:u=${urgency}:f=${app}${typePart}:d=0:p=title;${t}${ST}` +
		`${ESC}]99;i=${id}:d=1:p=body;${b}${ST}`
	);
}

/** Wrap a sequence so tmux forwards it to the outer terminal (allow-passthrough). */
function tmuxPassthrough(seq: string): string {
	return `${ESC}Ptmux;${seq.split(ESC).join(ESC + ESC)}${ST}`;
}

export default function (pi: ExtensionAPI) {
	let enabled = true;
	let auto = (process.env.PI_NOTIFY_AUTO ?? "1") !== "0";

	const durationMs = Number(process.env.PI_NOTIFY_DURATION_MS ?? "6000") || 6000;
	const minSeconds = Math.max(0, Number(process.env.PI_NOTIFY_MIN_SECONDS ?? "0") || 0);

	// Timing/summary state for the automatic completion notice. `runStartedAt`
	// is set on the first agent_start of a turn and cleared on settle, so
	// retries/continuations within one turn don't reset the clock.
	let runStartedAt = 0;
	let lastLine = "";
	const forced = (process.env.PI_NOTIFY_BACKEND ?? "").toLowerCase();

	const writeToPaneTty = async (seq: string): Promise<boolean> => {
		try {
			const r = await pi.exec("tmux", ["display-message", "-p", "#{pane_tty}"], { timeout: 3000 });
			const tty = r.stdout.trim();
			if (!tty) return false;
			const fd = fs.openSync(tty, "w");
			try {
				fs.writeSync(fd, seq);
			} finally {
				fs.closeSync(fd);
			}
			return true;
		} catch {
			return false;
		}
	};

	const writeToOwnTty = (seq: string): boolean => {
		try {
			const fd = fs.openSync("/dev/tty", "w");
			try {
				fs.writeSync(fd, seq);
			} finally {
				fs.closeSync(fd);
			}
			return true;
		} catch {
			try {
				process.stdout.write(seq);
				return true;
			} catch {
				return false;
			}
		}
	};

	// swaync groups by `desktop_entry ?? app_name` (not by category), and OSC 99
	// has no desktop-entry key, so the app name must be unique per session or
	// every pi notification collapses into one group. Session display names and
	// the cwd basename are often shared (e.g. several unnamed sessions in one
	// directory), so always append a short suffix of the stable session id.
	const sessionIdentity = (ctx: ExtensionContext) => {
		const base = (pi.getSessionName() ?? "").trim() || path.basename(ctx.cwd) || "pi";
		const sid = String(ctx.sessionManager.getSessionId() ?? "").replace(/[^a-zA-Z0-9]/g, "");
		const short = sid.slice(-4) || "0000";
		return { label: base, key: `${base}-${short}`, appName: `pi · ${base} · ${short}` };
	};

	const send = async (title: string, body: string, urgency = 2, session?: string, appName = "pi"): Promise<boolean> => {
		// Fresh id per notification => they stack (same id would replace).
		// The session is attached as the notification type for filtering/grouping.
		const id = uniqueNotifId();
		const type = session ? `pi.session.${session}` : undefined;
		const term = (process.env.TERM ?? "").toLowerCase();
		const inTmux = !!process.env.TMUX;
		// pi on a remote host over ssh: TMUX/KITTY_WINDOW_ID are not forwarded, but
		// ssh does forward TERM, which the local tmux pane set to tmux/screen-*.
		const behindTmux = !inTmux && (term.startsWith("tmux") || term.startsWith("screen"));
		const inKitty = !!process.env.KITTY_WINDOW_ID || !!process.env.KITTY_PID || term.includes("kitty");
		const inHypr = !!process.env.HYPRLAND_INSTANCE_SIGNATURE;

		// 1/2/3. terminal-native (survives ssh)
		if (forced === "osc" || (!forced && (inTmux || behindTmux))) {
			const seq = tmuxPassthrough(osc99(title, body, urgency, id, type, appName));
			if (inTmux) {
				if (await writeToPaneTty(seq)) return true;
			} else {
				// Only the outer tmux is in the way -> DCS-wrap and write to our tty.
				if (writeToOwnTty(seq)) return true;
			}
			if (forced === "osc") return false;
		} else if (!forced && inKitty) {
			if (writeToOwnTty(osc99(title, body, urgency, id, type, appName))) return true;
		}

		// 3. Hyprland built-in (local only)
		if (forced === "hyprctl" || (!forced && inHypr)) {
			try {
				const r = await pi.exec(
					"hyprctl",
					["notify", "-1", String(durationMs), "rgb(1e1e2e)", `${title} · ${body}`],
					{ timeout: 5000 },
				);
				if (r.code === 0) return true;
			} catch {
				// fall through
			}
			if (forced === "hyprctl") return false;
		}

		// 4. libnotify
		try {
			const r = await pi.exec(
				"notify-send",
				["-a", appName, "-t", String(durationMs), "-u", URGENCY_NAMES[urgency] ?? "normal", title, body],
				{ timeout: 5000 },
			);
			return r.code === 0;
		} catch {
			return false;
		}
	};

	// Automatic completion notice: when the agent settles (it will not continue
	// on its own), ping the user once with NORMAL urgency so the notice expires
	// on its own. Critical is reserved for explicit `notify` tool calls. Fires
	// on every completed turn by default (minSeconds defaults to 0), and carries
	// the last reply's first line as the body.
	pi.on("agent_start", async () => {
		if (!runStartedAt) {
			runStartedAt = Date.now();
			lastLine = "";
		}
	});

	pi.on("agent_end", async (event) => {
		const line = lastAssistantLine(event.messages);
		if (line) lastLine = line;
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const elapsedMs = runStartedAt ? Date.now() - runStartedAt : 0;
		runStartedAt = 0;
		if (!enabled || !auto) return;
		if (minSeconds > 0 && elapsedMs < minSeconds * 1000) return;
		const { label, key, appName } = sessionIdentity(ctx);
		const body = lastLine ? oneLine(lastLine, 140) : "任务完成";
		await send(`pi · ${label}`, body, 1, key, appName);
	});

	// The agent raises notifications on purpose by calling this tool.
	pi.registerTool({
		name: "notify",
		label: "Notify",
		description:
			"Send a desktop notification to the user. Use it when the user asks to be notified, or to flag an important result they may be waiting for.",
		promptSnippet: "Send a desktop notification to the user",
		promptGuidelines: [
			"Use notify only when the user asks to be notified or to flag a genuinely important result; do not send one for every step.",
			'Set urgency to "critical" only when the user should see it even while away; critical notifications stay on screen until dismissed.',
		],
		parameters: Type.Object({
			message: Type.String({ description: "Notification body text" }),
			title: Type.Optional(Type.String({ description: 'Notification title (defaults to "pi · <session>")' })),
			urgency: Type.Optional(
				StringEnum(["low", "normal", "critical"] as const, {
					description: "normal (default) auto-expires; critical stays until dismissed",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!enabled) {
				return {
					content: [{ type: "text", text: "Desktop notifications are disabled (/notify on to enable)." }],
				};
			}
			const urgency = urgencyValue(params.urgency);
			const { label, key, appName } = sessionIdentity(ctx);
			const title = (params.title ?? "").trim() || `pi · ${label}`;
			const body = oneLine(params.message, 400);
			const ok = await send(title, body, urgency, key, appName);
			return {
				content: [
					{
						type: "text",
						text: ok ? `Notification sent (${URGENCY_NAMES[urgency]}): ${title} — ${body}` : "Failed to send notification.",
					},
				],
			};
		},
	});

	pi.registerCommand("notify", {
		description: "Enable/disable notifications (on|off|auto on|auto off)",
		handler: (args, ctx) => {
			const parts = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
			if (parts[0] === "auto") {
				if (parts[1] === "on") auto = true;
				else if (parts[1] === "off") auto = false;
				else auto = !auto;
				ctx.ui.notify(`auto completion notifications ${auto ? "on" : "off"}`, "info");
				return;
			}
			const a = parts[0] ?? "";
			if (a === "on") enabled = true;
			else if (a === "off") enabled = false;
			else enabled = !enabled;
			ctx.ui.notify(
				`notifications ${enabled ? "on" : "off"}${auto ? " (auto on)" : ""}`,
				"info",
			);
		},
	});
}
