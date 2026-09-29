/**
 * Browser extension (Zen / Firefox) — drive your OWN running browser over
 * WebDriver BiDi via puppeteer-core.
 *
 * Why not Playwright: Playwright's Firefox support uses its own patched
 * "Juggler" protocol and can only drive `npx playwright install firefox`.
 * It cannot attach to a stock Firefox or Zen. Zen/Firefox expose WebDriver
 * BiDi on `--remote-debugging-port`, which Puppeteer speaks.
 *
 * Difference from the Chromium/Playwright extension: this one CONNECTS to a
 * browser the user already started; it never launches and never closes it.
 * `browser_close` / `/browser off` only disconnect, leaving your Zen (and
 * all its tabs / logins) untouched.
 *
 * Modes:
 *   - Managed (default): the extension launches its OWN Zen with a dedicated
 *     AI profile, separate from your personal browsing, drives it, and closes
 *     it on teardown. Nothing to pre-start, and your main Zen is never touched.
 *     A window is shown by default so you can watch/drive it yourself too.
 *   - Attach (opt-in): set PI_BROWSER_BIDI to attach to a browser you started
 *     yourself (same profile you are using), e.g.
 *       PI_BROWSER_BIDI=ws://127.0.0.1:9222/session pi
 *
 * Usage: /browser on, then call browser_* tools.
 *
 * Env:
 *   PI_BROWSER_BIDI        attach to an existing browser at this BiDi endpoint
 *                          (disables managed mode)
 *   PI_ZEN_BIN             path to the Zen/Firefox binary (auto-detected)
 *   PI_ZEN_PROFILE         user-data dir for the AI profile; default
 *                          ~/.pi/agent/extensions/browser-zen/.zen-ai-profile
 *   PI_BROWSER_HEADLESS=1  run the managed browser without a window
 *   PI_ZEN_KEEP_ALIVE=1    on teardown disconnect instead of close, leaving
 *                          the managed window open
 *
 * Tools: browser_goto, browser_eval, browser_console, browser_network,
 *        browser_fill, browser_click, browser_screenshot, browser_tabs,
 *        browser_use_tab, browser_close.
 */

import { existsSync, mkdtempSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import puppeteer, {
  type Browser,
  type Page,
  type ConsoleMessage,
  type HTTPRequest,
  type HTTPResponse,
} from "puppeteer-core";

type ConsoleEntry = {
  ts: number;
  type: string;
  text: string;
  location?: string;
};

type NetEntry = {
  ts: number;
  method: string;
  url: string;
  status?: number;
  statusText?: string;
  resourceType: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  failure?: string;
};

const MAX_BUF = 1000;
const BROWSER_TOOL_NAMES = [
  "browser_goto",
  "browser_eval",
  "browser_console",
  "browser_network",
  "browser_fill",
  "browser_click",
  "browser_screenshot",
  "browser_tabs",
  "browser_use_tab",
  "browser_close",
];
const ENABLED_ENTRY_TYPE = "browser-zen-enabled";
const KEEP_HEADERS = new Set([
  "authorization",
  "apikey",
  "content-type",
  "x-client-info",
  "accept-profile",
  "content-profile",
  "prefer",
  "location",
  "www-authenticate",
  "retry-after",
]);

// BiDi waitUntil names differ from Playwright's ("networkidle" isn't a thing).
const WAIT_MAP = {
  load: "load",
  domcontentloaded: "domcontentloaded",
  networkidle: "networkidle0",
  commit: "domcontentloaded",
} as const;
type WaitUntil = keyof typeof WAIT_MAP;

function pushBounded<T>(buf: T[], entry: T): void {
  buf.push(entry);
  if (buf.length > MAX_BUF) buf.splice(0, buf.length - MAX_BUF);
}

function which(cmd: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir) continue;
    const full = join(dir, cmd);
    if (existsSync(full)) return full;
  }
  return undefined;
}

function resolveBrowserBin(): string {
  if (process.env.PI_ZEN_BIN) return process.env.PI_ZEN_BIN;
  for (const c of [
    "/opt/zen-browser-bin/zen-bin",
    "/usr/lib/zen/zen-bin",
    "/opt/zen/zen-bin",
  ]) {
    if (existsSync(c)) return c;
  }
  for (const name of ["zen-browser", "zen-bin", "zen", "firefox", "firefox-esr"]) {
    const p = which(name);
    if (p) return p;
  }
  throw new Error(
    "could not find a Zen/Firefox binary. Set PI_ZEN_BIN to its path, e.g.\n" +
      "  PI_ZEN_BIN=/opt/zen-browser-bin/zen-bin pi",
  );
}

// Injected through puppeteer's extraPrefsFirefox (puppeteer overwrites the
// profile's user.js, so editing it ourselves would be clobbered).
const EXTRA_PREFS: Record<string, unknown> = {
  // No "Incoming Connection / Allow connection?" dialog for the remote agent.
  "devtools.debugger.prompt-connection": false,
  "browser.shell.checkDefaultBrowser": false,
  "browser.startup.page": 0,
  "browser.startup.homepage": "about:blank",
  "browser.aboutwelcome.enabled": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "toolkit.telemetry.enabled": false,
  // Zen first-run / welcome screens.
  "zen.welcome-screen.seen": true,
  "zen.view.welcome-screen.seen": true,
};

function filterHeaders(
  h: Record<string, string>,
  allow: Set<string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    if (allow.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

async function headersOf(
  obj: HTTPRequest | HTTPResponse,
): Promise<Record<string, string>> {
  try {
    // allHeaders() includes e.g. Cookie; headers() is the cheap fallback.
    const anyObj = obj as unknown as { allHeaders?: () => Promise<Record<string, string>> };
    if (typeof anyObj.allHeaders === "function") return await anyObj.allHeaders();
  } catch {
    // fall through
  }
  try {
    return (obj as unknown as { headers: () => Record<string, string> }).headers() ?? {};
  } catch {
    return {};
  }
}

/**
 * Serialize all tool executions against the single shared Page. Page is not
 * concurrency-safe (a fill racing a goto, or an eval landing mid-navigation,
 * blow up), and pi fires independent tool calls in one batch by default.
 */
let opQueue: Promise<unknown> = Promise.resolve();
function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const next = opQueue.then(fn, fn);
  opQueue = next.catch(() => {});
  return next;
}

export default function browserZenExtension(pi: ExtensionAPI) {
  let browser: Browser | null = null;
  let currentPage: Page | null = null;
  const consoleBuf: ConsoleEntry[] = [];
  const netBuf: NetEntry[] = [];
  const attached = new WeakSet<Page>();

  // Attach mode when PI_BROWSER_BIDI is set; otherwise managed launch mode.
  const attachUrl = process.env.PI_BROWSER_BIDI;
  const managed = !attachUrl;
  const headless = process.env.PI_BROWSER_HEADLESS === "1";
  const keepAlive = process.env.PI_ZEN_KEEP_ALIVE === "1";
  const profileDir =
    process.env.PI_ZEN_PROFILE ??
    join(homedir(), ".pi", "agent", "extensions", "browser-zen", ".zen-ai-profile");
  let owned = false; // true when we launched the browser ourselves

  function attach(p: Page): void {
    if (attached.has(p)) return;
    attached.add(p);

    p.on("console", (msg: ConsoleMessage) => {
      let location: string | undefined;
      try {
        const loc = msg.location();
        if (loc?.url) location = `${loc.url}:${loc.lineNumber}`;
      } catch {
        // location is not always available over BiDi
      }
      pushBounded(consoleBuf, {
        ts: Date.now(),
        type: msg.type(),
        text: msg.text(),
        location,
      });
    });

    p.on("pageerror", (err: Error) => {
      pushBounded(consoleBuf, {
        ts: Date.now(),
        type: "pageerror",
        text: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
    });

    p.on("response", (res: HTTPResponse) => {
      void (async () => {
        try {
          const req = res.request();
          pushBounded(netBuf, {
            ts: Date.now(),
            method: req.method(),
            url: req.url(),
            status: res.status(),
            statusText: safeCall(() => res.statusText()),
            resourceType: safeCall(() => req.resourceType()) ?? "other",
            requestHeaders: await headersOf(req),
            responseHeaders: await headersOf(res),
          });
        } catch {
          // response/request torn down; ignore
        }
      })();
    });

    p.on("requestfailed", (req: HTTPRequest) => {
      pushBounded(netBuf, {
        ts: Date.now(),
        method: req.method(),
        url: req.url(),
        resourceType: safeCall(() => req.resourceType()) ?? "other",
        failure: safeCall(() => req.failure()?.errorText),
      });
    });
  }

  async function getBrowser(): Promise<Browser> {
    if (browser && browser.connected) return browser;
    browser = null;
    currentPage = null;

    if (managed) {
      const bin = resolveBrowserBin();
      try {
        browser = await puppeteer.launch({
          browser: "firefox",
          executablePath: bin,
          protocol: "webDriverBiDi",
          headless,
          userDataDir: profileDir,
          args: ["--new-instance", "--no-remote"],
          extraPrefsFirefox: EXTRA_PREFS,
        });
        owned = true;
      } catch (e) {
        browser = null;
        currentPage = null;
        throw new Error(
          `failed to launch Zen (${bin}) with profile ${profileDir}\n` +
            `(${e instanceof Error ? e.message : String(e)})`,
        );
      }
    } else {
      try {
        browser = await puppeteer.connect({
          browserWSEndpoint: attachUrl,
          protocol: "webDriverBiDi",
        });
        owned = false;
      } catch (e) {
        browser = null;
        currentPage = null;
        throw new Error(
          `cannot attach to the browser at ${attachUrl}\n` +
            `Start it with e.g.  zen-browser --remote-debugging-port 9222\n` +
            `(Firefox allows only one BiDi session; make sure no stale client is attached.)\n` +
            `(${e instanceof Error ? e.message : String(e)})`,
        );
      }
    }

    browser.on("disconnected", () => {
      browser = null;
      currentPage = null;
      owned = false;
    });
    return browser;
  }

  /** Prefer the tab the user is actually looking at (foreground = visible). */
  async function pickActivePage(b: Browser): Promise<Page> {
    const pages = await b.pages();
    if (pages.length === 0) return await b.newPage();
    for (const p of pages) {
      try {
        if ((await p.evaluate(() => document.visibilityState)) === "visible") {
          return p;
        }
      } catch {
        // about:blank or still loading; skip
      }
    }
    return pages[0];
  }

  async function ensurePage(): Promise<Page> {
    if (currentPage && !currentPage.isClosed()) return currentPage;
    const b = await getBrowser();
    currentPage = await pickActivePage(b);
    attach(currentPage);
    return currentPage;
  }

  /** Managed mode: close our own browser. Attach mode: only disconnect. */
  async function teardown(): Promise<void> {
    try {
      if (owned && !keepAlive) {
        await browser?.close();
      } else {
        await browser?.disconnect();
      }
    } catch {
      // best-effort
    }
    browser = null;
    currentPage = null;
    owned = false;
  }

  // Default-off gate: tools stay registered (visible in pi.getAllTools(),
  // command discovery normal) but their promptSnippet / promptGuidelines drop
  // out of the system prompt and they are not callable until /browser on.
  let enabled = false;

  function setEnabled(on: boolean): void {
    const active = new Set(pi.getActiveTools());
    if (on) {
      for (const name of BROWSER_TOOL_NAMES) active.add(name);
    } else {
      for (const name of BROWSER_TOOL_NAMES) active.delete(name);
    }
    pi.setActiveTools(Array.from(active));
    enabled = on;
  }

  async function enable(): Promise<void> {
    setEnabled(true);
    pi.appendEntry(ENABLED_ENTRY_TYPE, { on: true });
  }

  async function disable(): Promise<void> {
    setEnabled(false);
    await teardown();
    pi.appendEntry(ENABLED_ENTRY_TYPE, { on: false });
  }

  pi.on("session_start", async (_event, ctx) => {
    let want = false;
    for (const entry of ctx.sessionManager.getEntries()) {
      if (entry.type === "custom" && entry.customType === ENABLED_ENTRY_TYPE) {
        const data = entry.data as { on?: boolean } | undefined;
        if (data && typeof data.on === "boolean") want = data.on;
      }
    }
    setEnabled(want);
  });

  pi.on("session_shutdown", async () => {
    await teardown();
  });

  pi.registerTool({
    name: "browser_goto",
    label: "Browser Goto",
    description:
      "Navigate the shared Zen tab to a URL. Returns final URL and HTTP status. Uses the user's real browser/profile, so logins and localStorage are whatever the user has.",
    promptSnippet:
      "Open a URL in the user's live Zen browser to inspect DOM, storage, network, and console — instead of asking the user to copy from devtools",
    promptGuidelines: [
      "When debugging a frontend issue (broken auth, failed requests, missing tokens, JS errors, form not working, blank screen), prefer driving the live app with browser_goto + browser_eval + browser_console + browser_network instead of asking the user to copy-paste from devtools.",
      "The browser_* tools connect to the user's own Zen browser; call browser_tabs first when the target tab is unclear, and browser_use_tab to select it.",
      "After making a frontend change, use browser_goto plus browser_click / browser_fill to exercise the fix end-to-end before declaring it done.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to navigate to" }),
      waitUntil: Type.Optional(
        Type.Union([
          Type.Literal("load"),
          Type.Literal("domcontentloaded"),
          Type.Literal("networkidle"),
          Type.Literal("commit"),
        ]),
      ),
      timeoutMs: Type.Optional(Type.Number()),
    }),
    async execute(_id, params) {
      return serialize(async () => {
        const p = await ensurePage();
        const resp = await p.goto(params.url, {
          waitUntil: WAIT_MAP[(params.waitUntil ?? "domcontentloaded") as WaitUntil],
          timeout: params.timeoutMs ?? 30_000,
        });
        const status = resp?.status();
        return {
          content: [{ type: "text", text: `${status ?? "?"} ${p.url()}` }],
          details: { status, finalUrl: p.url() },
        };
      });
    },
  });

  pi.registerTool({
    name: "browser_eval",
    label: "Browser Eval",
    description:
      "Evaluate JS in the current tab. Pass an expression ('localStorage.length'), a function ('() => Object.keys(localStorage)'), or an already-called IIFE — all three work. Return value must be JSON-serializable; for DOM nodes return primitive properties (.outerHTML, .textContent, .value) rather than the node itself.",
    promptSnippet:
      "Run JS in the live page to read localStorage / cookies, decode a JWT, inspect form state, or fire a fetch with custom headers",
    promptGuidelines: [
      "Use browser_eval to inspect runtime state (localStorage, cookies, in-page variables, JWT contents, computed styles) instead of guessing from source.",
    ],
    parameters: Type.Object({
      expression: Type.String({ description: "Expression or function source" }),
    }),
    async execute(_id, params) {
      return serialize(async () => {
        const p = await ensurePage();
        // Evaluate the source once; if the result is a function, call it. This
        // handles plain expressions, function values, and already-called IIFEs
        // without the double-wrap bug.
        const src = params.expression;
        const wrapped = `(() => { const __v = (${src}); return typeof __v === 'function' ? __v() : __v; })()`;
        try {
          const result = await p.evaluate(wrapped);
          const text =
            typeof result === "string"
              ? result
              : (JSON.stringify(result, null, 2) ?? String(result));
          return { content: [{ type: "text", text }], details: { result } };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return {
            content: [{ type: "text", text: `eval error: ${msg}` }],
            details: { result: undefined },
          };
        }
      });
    },
  });

  pi.registerTool({
    name: "browser_console",
    label: "Browser Console",
    description:
      "Drain buffered console + pageerror entries (oldest first). With clear=true (default) the ENTIRE buffer is wiped after read, so subsequent calls see a fresh activity window. Pass clear=false to peek without draining.",
    promptSnippet:
      "Read JS errors and console output captured since last drain — reach for this whenever a page seems broken without an obvious network cause",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({ description: "Max entries (default 100)" })),
      filter: Type.Optional(
        Type.String({ description: "Only entries whose text/location contains this substring" }),
      ),
      clear: Type.Optional(
        Type.Boolean({
          description: "Clear the entire buffer after read. Default true.",
        }),
      ),
    }),
    async execute(_id, params) {
      return serialize(async () => {
        const limit = params.limit ?? 100;
        const filter = params.filter;
        const filtered = filter
          ? consoleBuf.filter(
              (e) => e.text.includes(filter) || (e.location ?? "").includes(filter),
            )
          : consoleBuf.slice();
        const out = filtered.slice(-limit);
        if (params.clear ?? true) consoleBuf.length = 0;
        const text =
          out
            .map(
              (e) =>
                `[${new Date(e.ts).toISOString()}] ${e.type}: ${e.text}${e.location ? `  @ ${e.location}` : ""}`,
            )
            .join("\n") || "(empty)";
        return { content: [{ type: "text", text }], details: { entries: out } };
      });
    },
  });

  pi.registerTool({
    name: "browser_network",
    label: "Browser Network",
    promptSnippet:
      "Inspect the actual HTTP requests the page made — status, method, URL, and (with verbose=true) Authorization / apikey / content-type headers. Use for 401 / 403 / CORS debugging",
    promptGuidelines: [
      "Use browser_network with verbose=true (and urlFilter to narrow scope) for any auth or CORS issue — it reveals the exact Authorization / apikey / Origin / content-type headers the browser actually sent, which is otherwise invisible from source.",
    ],
    description:
      "Drain buffered network requests. Default text output is one terse line per request. Set verbose=true to inline a curated set of request/response headers (authorization, apikey, content-type, x-client-info, accept-profile, content-profile, prefer, location, www-authenticate, retry-after). Pass includeHeaders=['cookie',...] to add more for this call only (case-insensitive). Best paired with urlFilter / status. With clear=true (default) the ENTIRE buffer is wiped after read; pass clear=false to peek without draining.",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number()),
      urlFilter: Type.Optional(Type.String({ description: "Substring filter on URL" })),
      status: Type.Optional(Type.Number({ description: "Exact HTTP status to match" })),
      verbose: Type.Optional(
        Type.Boolean({
          description: "Inline a curated set of request/response headers on each row.",
        }),
      ),
      includeHeaders: Type.Optional(
        Type.Array(Type.String(), {
          description: "Extra header names (case-insensitive) to surface. Implies verbose=true.",
        }),
      ),
      clear: Type.Optional(
        Type.Boolean({
          description: "Clear the entire buffer after read. Default true.",
        }),
      ),
    }),
    async execute(_id, params) {
      return serialize(async () => {
        let entries = netBuf.slice();
        if (params.urlFilter) {
          const needle = params.urlFilter;
          entries = entries.filter((e) => e.url.includes(needle));
        }
        if (params.status != null) {
          const wanted = params.status;
          entries = entries.filter((e) => e.status === wanted);
        }
        const out = entries.slice(-(params.limit ?? 100));
        if (params.clear ?? true) netBuf.length = 0;

        const extra = (params.includeHeaders ?? []).map((h: string) => h.toLowerCase());
        const showHeaders = params.verbose === true || extra.length > 0;
        const allow = new Set([...KEEP_HEADERS, ...extra]);

        const lines: string[] = [];
        for (const e of out) {
          lines.push(
            `${e.status ?? "ERR"} ${e.method} ${e.url}${e.failure ? `  (${e.failure})` : ""}`,
          );
          if (showHeaders) {
            const reqH = e.requestHeaders ? filterHeaders(e.requestHeaders, allow) : {};
            for (const [k, v] of Object.entries(reqH)) lines.push(`  → ${k}: ${v}`);
            const resH = e.responseHeaders ? filterHeaders(e.responseHeaders, allow) : {};
            for (const [k, v] of Object.entries(resH)) lines.push(`  ← ${k}: ${v}`);
          }
        }
        const text = lines.join("\n") || "(empty)";
        return { content: [{ type: "text", text }], details: { entries: out } };
      });
    },
  });

  pi.registerTool({
    name: "browser_fill",
    label: "Browser Fill",
    description:
      "Type a value into the input matching the selector, replacing any existing value (dispatches input/change events properly).",
    promptSnippet:
      "Type into an input on the live page (dispatches input / change events properly, unlike a raw .value= assignment)",
    parameters: Type.Object({
      selector: Type.String(),
      value: Type.String(),
    }),
    async execute(_id, params) {
      return serialize(async () => {
        const p = await ensurePage();
        const handle = await p.$(params.selector);
        if (!handle) throw new Error(`selector not found: ${params.selector}`);
        await handle.click({ clickCount: 3 });
        await handle.type(params.value);
        try {
          await handle.evaluate((el) => (el as HTMLElement).blur?.());
        } catch {
          // element may have detached; not fatal
        }
        return {
          content: [{ type: "text", text: `filled ${params.selector}` }],
          details: {},
        };
      });
    },
  });

  pi.registerTool({
    name: "browser_click",
    label: "Browser Click",
    description:
      "Click the element matching the selector. Supports CSS plus Puppeteer pseudo-selectors 'text/...' and 'aria/...' (e.g. `text/Submit`, `aria/Submit`). CSS attribute selectors match HTML attributes, not DOM properties.",
    promptSnippet:
      "Click an element on the live page — drives the app the way a user would, including form submits and SPA navigations",
    parameters: Type.Object({
      selector: Type.String(),
    }),
    async execute(_id, params) {
      return serialize(async () => {
        const p = await ensurePage();
        await p.click(params.selector);
        return {
          content: [{ type: "text", text: `clicked ${params.selector}` }],
          details: {},
        };
      });
    },
  });

  pi.registerTool({
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description:
      "Save a PNG screenshot of the current tab to a temp file and return its path. Use the read tool on that path to view it.",
    promptSnippet:
      "Capture a PNG of the current page when DOM / state inspection isn't enough and you need to see the visual",
    parameters: Type.Object({
      fullPage: Type.Optional(Type.Boolean()),
    }),
    async execute(_id, params) {
      return serialize(async () => {
        const p = await ensurePage();
        const dir = mkdtempSync(join(tmpdir(), "pi-zen-"));
        const file = join(dir, "screenshot.png");
        await p.screenshot({ path: file, fullPage: params.fullPage ?? false, type: "png" });
        return { content: [{ type: "text", text: file }], details: { path: file } };
      });
    },
  });

  pi.registerTool({
    name: "browser_tabs",
    label: "Browser Tabs",
    description:
      "List the open tabs in the user's browser with index, URL, title, and which tab browser_* tools currently target. Use browser_use_tab to switch.",
    promptSnippet:
      "List the user's open Zen tabs so you can pick the right one with browser_use_tab",
    parameters: Type.Object({}),
    async execute() {
      return serialize(async () => {
        const b = await getBrowser();
        const pages = await b.pages();
        const rows: Array<{ index: number; url: string; title: string; visible: boolean; current: boolean }> = [];
        for (let i = 0; i < pages.length; i++) {
          const p = pages[i];
          let title = "";
          let visible = false;
          try {
            title = await p.title();
          } catch {
            // ignore
          }
          try {
            visible = (await p.evaluate(() => document.visibilityState)) === "visible";
          } catch {
            // ignore
          }
          rows.push({
            index: i,
            url: p.url(),
            title,
            visible,
            current: p === currentPage,
          });
        }
        const text =
          rows
            .map(
              (r) =>
                `${r.current ? "*" : " "} [${r.index}]${r.visible ? " (visible)" : ""} ${r.title} — ${r.url}`,
            )
            .join("\n") || "(no tabs)";
        return { content: [{ type: "text", text }], details: { tabs: rows } };
      });
    },
  });

  pi.registerTool({
    name: "browser_use_tab",
    label: "Browser Use Tab",
    description:
      "Select which of the user's open tabs the browser_* tools operate on. Pass an index (from browser_tabs) or a url substring; if both are omitted, the currently visible tab is chosen.",
    promptSnippet:
      "Select the target tab (by index or URL substring) so browser_* tools act on the tab the user cares about",
    parameters: Type.Object({
      index: Type.Optional(Type.Number({ description: "Tab index from browser_tabs" })),
      url: Type.Optional(Type.String({ description: "Substring match on tab URL" })),
    }),
    async execute(_id, params) {
      return serialize(async () => {
        const b = await getBrowser();
        const pages = await b.pages();
        let chosen: Page | undefined;
        if (params.index != null) {
          chosen = pages[params.index];
          if (!chosen) {
            throw new Error(
              `no tab at index ${params.index} (found ${pages.length} tabs; run browser_tabs)`,
            );
          }
        } else if (params.url) {
          chosen = pages.find((p) => p.url().includes(params.url as string));
          if (!chosen) {
            throw new Error(`no tab whose URL contains ${JSON.stringify(params.url)}`);
          }
        } else {
          chosen = await pickActivePage(b);
        }
        currentPage = chosen;
        attach(chosen);
        return {
          content: [{ type: "text", text: `now targeting: ${chosen.url()}` }],
          details: { url: chosen.url() },
        };
      });
    },
  });

  pi.registerTool({
    name: "browser_close",
    label: "Browser Close",
    description:
      "Close the browser. In managed mode (default) this closes the AI browser instance; when attached via PI_BROWSER_BIDI it only disconnects. The next browser_* call reconnects/relaunches.",
    promptSnippet:
      "Close the managed AI browser (or disconnect when attached); auto-cleans on session end",
    parameters: Type.Object({}),
    async execute() {
      return serialize(async () => {
        await teardown();
        return { content: [{ type: "text", text: "disconnected" }], details: {} };
      });
    },
  });

  pi.registerCommand("browser", {
    description:
      "Browser tools: '/browser on' to enable, '/browser off' to disable + disconnect, bare '/browser' for status",
    handler: async (args, ctx) => {
      const cmd = (args || "").trim().toLowerCase();
      if (cmd === "on" || cmd === "enable") {
        if (enabled) {
          ctx.ui.notify("browser tools already enabled", "info");
          return;
        }
        await enable();
        ctx.ui.notify(
          managed
            ? `browser tools enabled (will launch a dedicated AI Zen profile at ${profileDir})`
            : `browser tools enabled (will attach to ${attachUrl})`,
          "info",
        );
        return;
      }
      if (cmd === "off" || cmd === "disable" || cmd === "close" || cmd === "kill") {
        const wasConnected = !!browser?.connected;
        const verb = owned && !keepAlive ? "closed" : "disconnected";
        await disable();
        ctx.ui.notify(
          wasConnected
            ? `browser tools disabled, ${verb}`
            : "browser tools disabled",
          "info",
        );
        return;
      }
      const toolState = enabled ? "enabled" : "disabled (run /browser on)";
      const modeState = managed ? `managed profile ${profileDir}` : `attach ${attachUrl}`;
      const connState = browser?.connected
        ? `, connected${currentPage && !currentPage.isClosed() ? ` at ${currentPage.url()}` : ""}`
        : ", not connected";
      ctx.ui.notify(`browser tools: ${toolState}, ${modeState}${connState}`, "info");
    },
  });
}

function safeCall<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
