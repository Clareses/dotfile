/**
 * web-access-toggle — manual on/off switch for pi-web-access tools.
 *
 * pi-web-access normally registers its tools but leaves them inactive until its
 * own `web_enable` loader tool is called by the model. This extension hides
 * that automatic path and gives you a single explicit toggle instead:
 *
 *   /pi-web-access on|off     (no argument toggles)
 *
 * Default is OFF, and it resets to OFF at the start of every session — same
 * spirit as `/notify on|off`.
 *
 * It only manages the active-tool set; the tools themselves still come from
 * pi-web-access (`~/.pi/agent/git/github.com/nicobailon/pi-web-access`).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const HOME = os.homedir();
const LEGACY_CONFIG = path.join(HOME, ".pi", "web-search.json");
const AGENT_CONFIG = path.join(HOME, ".pi", "agent", "web-search.json");
const CONFIG_PATH = fs.existsSync(LEGACY_CONFIG) ? LEGACY_CONFIG : AGENT_CONFIG;

type ToolKey = "webSearch" | "sourceCheck" | "fetchContent" | "getSearchContent";
const TOOL_KEYS: ToolKey[] = ["webSearch", "sourceCheck", "fetchContent", "getSearchContent"];
const DEFAULT_TOOL_NAMES: Record<ToolKey, string> = {
	webSearch: "web_search",
	sourceCheck: "source_check",
	fetchContent: "fetch_content",
	getSearchContent: "get_search_content",
};
const LOADER_TOOL = "web_enable";

function readConfig(): Record<string, unknown> {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

function isToolEnabled(config: Record<string, unknown>, key: ToolKey): boolean {
	const tools = config.tools as Record<string, { enabled?: unknown }> | undefined;
	const override = tools?.[key]?.enabled;
	if (typeof override === "boolean") return override;
	// Legacy shorthand only affects the search tools.
	const webSearch = config.webSearch as { enabled?: unknown } | undefined;
	if ((key === "webSearch" || key === "sourceCheck") && webSearch?.enabled === false) return false;
	return true;
}

/** Registered-and-enabled pi-web-access tool names, honoring custom toolNames. */
function configuredToolNames(): string[] {
	const config = readConfig();
	const custom = (config.toolNames ?? {}) as Record<string, unknown>;
	return TOOL_KEYS.filter((key) => isToolEnabled(config, key)).map((key) => {
		const value = custom[key];
		return typeof value === "string" && value.trim() ? value.trim() : DEFAULT_TOOL_NAMES[key];
	});
}

export default function webAccessToggle(pi: ExtensionAPI): void {
	let enabled = false;

	/** Reconcile the active-tool set with the current toggle state. */
	function apply(): string[] {
		const managed = new Set(configuredToolNames());
		const registered = new Set(pi.getAllTools().map((tool) => tool.name));
		const keep = pi.getActiveTools().filter((name) => name !== LOADER_TOOL && !managed.has(name));
		const wanted = enabled ? [...managed].filter((name) => registered.has(name)) : [];
		pi.setActiveTools([...new Set([...keep, ...wanted])]);
		return wanted;
	}

	function setState(next: boolean): string[] {
		enabled = next;
		return apply();
	}

	// Always start OFF, and keep the loader's auto-activation suppressed.
	pi.on("session_start", () => {
		setState(false);
	});
	pi.on("session_tree", () => {
		apply();
	});
	pi.on("before_agent_start", () => {
		apply();
	});

	// pi-web-access re-registers its `web_enable` loader after this extension's
	// handlers run, so keep the model from using the loader while OFF.
	pi.on("tool_call", async (event) => {
		if (!enabled && event.toolName === LOADER_TOOL) {
			return { block: true, reason: "Web access is off. Ask the user to run /pi-web-access on." };
		}
	});

	pi.registerCommand("pi-web-access", {
		description: "Enable/disable pi-web-access web tools (on|off)",
		handler: (args: string, ctx: ExtensionContext) => {
			const a = args.trim().toLowerCase();
			if (a === "" || a === "toggle") {
				// fall through to toggle
			} else if (a === "on") {
				enabled = true;
			} else if (a === "off") {
				enabled = false;
			} else {
				ctx.ui.notify("usage: /pi-web-access on|off", "warning");
				return;
			}
			if (a === "" || a === "toggle") enabled = !enabled;

			const applied = setState(enabled);
			if (enabled && applied.length === 0) {
				ctx.ui.notify(
					`pi-web-access tools are not registered; check ${CONFIG_PATH}`,
					"error",
				);
				return;
			}
			ctx.ui.notify(
				enabled ? `pi-web-access on (${applied.join(", ")})` : "pi-web-access off",
				"info",
			);
		},
	});
}
