/**
 * codemode-toggle — a manual on/off switch for the built-in `codemode` tool.
 *
 * `codemode` is registered inactive; normally you turn it on through the
 * `defaultTools` setting or `--tools`. This extension gives you a live toggle
 * in the same spirit as `/notify`:
 *
 *   /codemode           toggle on/off
 *   /codemode on        enable
 *   /codemode off       disable
 *
 * Starts OFF in every session, and resets to OFF on `/new` or restart, even if
 * `defaultTools` includes `codemode`. Turn it on with `/codemode on` when you
 * want it. The switch only manages the active-tool set (`pi.getActiveTools()` /
 * `pi.setActiveTools()`), so it does not touch settings on disk.
 *
 * Note: while OFF this also removes `codemode` if another extension (e.g. the
 * built-in MCP support) activates it, so it acts as a true master switch.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const CODEMODE_TOOL = "codemode";

export default function codemodeToggle(pi: ExtensionAPI): void {
	// Desired state for this session. Forced to `false` on session_start, so
	// codemode always begins OFF regardless of `defaultTools` / `--tools`.
	let wantOn = false;

	function isRegistered(): boolean {
		return pi.getAllTools().some((tool) => tool.name === CODEMODE_TOOL);
	}

	function isActive(): boolean {
		return pi.getActiveTools().includes(CODEMODE_TOOL);
	}

	/** Reconcile the active-tool set with `wantOn`. Returns the resulting state. */
	function setState(next: boolean): boolean {
		wantOn = next;
		const active = pi.getActiveTools();
		const has = active.includes(CODEMODE_TOOL);
		if (next && !has) {
			pi.setActiveTools([...active, CODEMODE_TOOL]);
		} else if (!next && has) {
			pi.setActiveTools(active.filter((name) => name !== CODEMODE_TOOL));
		}
		return next;
	}

	/** Re-apply the chosen state (after tree navigation or before each run). */
	function apply(): void {
		setState(wantOn);
	}

	pi.on("session_start", () => {
		// Always start OFF; enable with `/codemode on` when wanted.
		setState(false);
	});
	pi.on("session_tree", () => apply());
	pi.on("before_agent_start", () => apply());

	pi.registerCommand("codemode", {
		description: "Enable/disable the codemode tool (on|off)",
		handler: (args: string, ctx: ExtensionCommandContext) => {
			if (!isRegistered()) {
				ctx.ui.notify(
					"codemode is not registered — is the built-in codemode extension disabled?",
					"error",
				);
				return;
			}

			const a = args.trim().toLowerCase();
			let next: boolean;
			if (a === "on") {
				next = true;
			} else if (a === "off") {
				next = false;
			} else if (a === "" || a === "toggle") {
				next = !isActive();
			} else {
				ctx.ui.notify("usage: /codemode [on|off]", "warning");
				return;
			}

			setState(next);
			ctx.ui.notify(`codemode ${next ? "on" : "off"}`, "info");
		},
	});
}
