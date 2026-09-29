# pi browser extension (Zen / Firefox, WebDriver BiDi)

Drives Zen/Firefox with puppeteer-core over **WebDriver BiDi** so pi can debug
a live SPA the way a human would in devtools: navigate, run JS, inspect
localStorage, watch the console and network, fill forms, click.

Playwright is not used because Playwright's Firefox support relies on its own
patched "Juggler" protocol and cannot attach to a stock Firefox/Zen. Firefox
and Zen expose WebDriver BiDi on `--remote-debugging-port`, which Puppeteer
speaks.

## Install

```bash
cd ~/.pi/agent/extensions/browser-zen
npm install
```

Then `/reload` in pi (or restart).

## Managed mode (default): a dedicated AI browser

By default the extension launches its **own** Zen instance with a dedicated
profile (`~/.pi/agent/extensions/browser-zen/.zen-ai-profile`), drives it, and
closes it when the session ends. It never touches your personal Zen.

- A **window is shown** so you can watch and drive it yourself too.
- The profile is persistent, so logins/cookies survive across pi sessions.
- Required prefs (disabling the remote-debugging confirmation prompt, welcome
  screens, default-browser check) are injected via `extraPrefsFirefox`.

```
/browser on     # enable the tools
/browser        # status
/browser off    # disable + close the managed browser
```

## Attach mode (opt-in)

Attach to a browser you started yourself, with your own profile:

```bash
# fully quit Zen, then:
zen-browser --remote-debugging-port 9222
PI_BROWSER_BIDI=ws://127.0.0.1:9222/session pi
```

In attach mode `/browser off` only **disconnects**; it never closes your
browser.

## Tools

| Tool | Purpose |
|---|---|
| `browser_goto`       | Navigate to a URL. Returns `{ status, finalUrl }`. |
| `browser_eval`       | Run JS in the page. Expression, function source, or already-called IIFE — all three work. Return value must be JSON-serializable. |
| `browser_console`    | Drain buffered console + pageerror entries (filterable, bounded to 1000). |
| `browser_network`    | Drain buffered network requests. Terse by default (`status method url`); `verbose: true` and/or `includeHeaders: [...]` inline curated headers (authorization, apikey, content-type, …). |
| `browser_fill`       | Type a value into an input matched by selector, replacing the old value. |
| `browser_click`      | Click an element (CSS, `text/...`, `aria/...`). |
| `browser_screenshot` | Save a PNG to a tempdir and return its path; pi can `read` it. |
| `browser_tabs`       | List open tabs (index, URL, title, visibility). |
| `browser_use_tab`    | Select the target tab by index or URL substring. |
| `browser_close`      | Close the managed browser / disconnect in attach mode. |

All page-touching tools serialize through a single internal queue, so firing
several `browser_*` calls in one batch runs them in submission order.

## Env knobs

| Env var | Default | Effect |
|---|---|---|
| `PI_ZEN_BIN` | auto-detected | Path to the Zen/Firefox binary. |
| `PI_ZEN_PROFILE` | `~/.pi/agent/extensions/browser-zen/.zen-ai-profile` | User-data dir for the managed profile. |
| `PI_BROWSER_HEADLESS` | unset (window shown) | Set to `1` to run without a window. |
| `PI_ZEN_KEEP_ALIVE` | unset | On teardown, disconnect instead of close, leaving the managed window open. |
| `PI_BROWSER_BIDI` | unset | Attach mode: BiDi endpoint of a browser you started. |

## Caveats

- Firefox allows only **one active BiDi session**. A stale client can block
  reconnection; in managed mode this is a non-issue because we own the process.
- `browser_eval` returns DOM nodes as an opaque value; return primitive
  properties (`.outerHTML`, `.textContent`, `.value`) instead.
- `browser_click` CSS attribute selectors match HTML attributes, not DOM
  properties. Prefer `text/Submit` or `aria/Submit`.
- `browser_network` is clear-on-read (the whole buffer is wiped). Pass
  `clear: false` to peek without draining.
- Network capture stores headers but not bodies.
