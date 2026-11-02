# pi-tidy

<p align="center">
  <img src="https://raw.githubusercontent.com/Andy8647/pi-tidy/main/assets/cover.png" alt="pi-tidy — a reply's tool calls fold into one line" width="840">
</p>

Tool folding for the [pi](https://github.com/earendil-works/pi) coding agent: a reply's tool calls
fold into one line you can click open, while edits, failures and background jobs stay in view — and
every box gets a rounded transparent frame.

**▶ [Watch the 40-second demo](https://cdn.jsdelivr.net/gh/Andy8647/pi-tidy@v0.4.3/assets/demo.mp4)**

## Features

- **Rounded borders** — ╭╮╰╯ box drawing instead of pi's default ┌┐└┘; an expanded box gets a blank row above and below its body inside the frame, and a diff body always does
- **Every tool box** — built-in tools, MCP calls (pi-mcp-adapter), subagents, and any other extension's tools all get the same frame
- **Every message box** — compaction and branch summaries, skill invocations, and extension custom messages get the same frame, each kind in its own border color
- **User messages that fit** — tidy's rounded frame, as wide as the text, with the user icon in its top border; a one-word prompt gets a small box. Or the rail (pi's dark background fill with an accent `│` in front), or pi's own look
- **Your own `!` commands, marked as yours** — a `!` / `!!` run gets the rounded frame too, with the user icon, the `!` you typed and the user message color, so it never passes for the agent's bash box
- **Nerd Font icons** — every box gets a kind icon; file tools show the target file's nvim-web-devicons glyph right in front of the path (`write /tmp/x.ts` renders `  write 󰛦 /tmp/x.ts`)
- **Side-by-side edit diffs** — an edit's diff renders as two panes (`old │ new`) with line numbers
  on both sides, a coloured bar and tinted row per changed line, and the changed word emphasised
  inside the line. Removed and added blocks pair up row by row, so a replaced block reads as
  before/after instead of two stacked runs. Below `splitDiffMinWidth` (or while the preview is still
  being computed) it falls back to pi's unified diff
- **Transparent background** — no solid background fill, works with terminal transparency
- **Grouped tool calls** — every tool call between two pieces of assistant text collapses to one line
  (`▸ 4 calls ·  bash×3  read×1 · 🧠 5 thoughts · 1.2s`). Click it and it turns into a `▾` header with one
  row per call under a `│` gutter; click a row to open that call's output underneath it — the row stays
  put and takes a `├─` tick off the rail, because inside a group the rail already frames it and a box
  there was a frame inside a frame. The `▾` header folds the whole group. The assistant's text always
  shows and is what separates groups, so you can still see a reply drifting; tool-only model steps
  don't split a group. Every call — edits included — is a row while collapsed and opens into a
  box of its own: the border carries the command/path, the body the output (a diff is clipped to
  `diffLines` until opened).
  Steps are separated by one blank rail row, so a long group reads as blocks rather than a wall.
  A folded group is one line: only a *running* call keeps a row, and a failure is reported once, as
  `3 failed` in red (`✗` per row once you open it). Every row says what the call produced
  (`12 lines`, `3 matches`, `exit 1`). `ctrl+o` expands a box to its *partial* view (the first
  `partialLines` rows plus a hint), `ctrl+shift+o` opens every box's whole output, and clicking a row
  opens that one box in full
- **Thinking, folded in** — a model step that only thinks and calls a tool used to leave a bare
  `Thinking...` behind; now it is a `thinking` row inside the group: a brain, the word, then one line of
  what the model actually thought, in order above the call it belongs to. The summary counts the runs
  and carries the same brain (`🧠 5 thoughts`), and a click opens that step's thinking full length — the
  same rounded box a tool result gets, in the new `thinkingColor` (yellow by default). While a run is
  still arriving the summary's marker spins (outside a group, the row's own glyph does, since there is
  no summary to carry it) and the preview slides over the newest words; once it stops, the row settles
  to a short head preview capped at 56 cells — a glance, not a paragraph. pi's `hideThinkingBlock`
  setting is ignored on purpose: the row is the same whether thinking is configured on or off, and the
  click is the one way to read it. A message that both thinks and writes gets the same row for its
  label (clicking it opens the same box, with `󰧑 thinking` set into its top border in place of the row),
  and its run stays out of the group's count — it renders above the text, not as a row in the list. With `groupTools: false` there is no group to fold into, but every
  step's thinking is still that row, above the box it belongs to
- **Background jobs** — a call that starts a long-running process (pi-processes' `process start`) shows
  the *process's* state on its row: `◐ process ticker  running 12s · READY matched`, then
  `✓ … exited 0 · 20s` / `✗ … exit 1` / `⊘ … killed SIGTERM`. The summary spins while one runs
  (`◐ 1 running`), and the `[process] …` notification messages are folded into the row — pi-processes
  still delivers them to the model, pi-tidy just doesn't draw them twice. Starts inside codemode get
  independent process rows under the script, even when it starts several jobs or fails afterward.
  Each nested process has its own hover and expand target: click to see its command, working directory
  and the last 20 output lines without expanding the script. Open logs update as output arrives;
  processes whose logs are no longer retained still show their saved status
- **codemode reads as a call list** — the folded row counts what the script ran (`codemode bash×3 read×1`, MCP
  tools by server, plus a red `1 failed` when a call inside it failed while the script caught it and
  succeeded), and the opened box shows those calls as tidy rows: kind icon, the same one-line argument summary,
  one per line, in a name column and a duration column, under a rail of their own. The script and the output
  each fold to one row (`▸ script · 13 lines`, `▸ output · 4 items`) that opens on click, separated by a dim
  rule; a script that called nothing folds the same way, using the output's first marker as its boundary. A
  nested `process start` hangs inside the body with those rows, since it is one of the things the script
  produced. Arguments are clipped to the row (the duration always survives) instead of wrapping onto a second
  line. The output stays one block: a script builds its `text()` items from whatever it computed, so an item
  can be a filtered, merged summary of several calls and nothing ties it back to the call that fed it.
  With `groupTools: false` (or `codemode` passed as pinned) the box is the same list in a frame of its
  own, with the row a group would show for it in the top border; all of the calls are listed, not just pi's
  last eight. `ctrl+o`, or a click anywhere else in the box, opens the script and the output together
- **One-line boxes** — collapsed boxes keep a single row of output (`bashResultLines`), and a multi-line command
  plus `(+N more lines, ctrl+o to expand)`, so a long tool call no longer owns the screen; `ctrl+o`
  restores the whole command
- **Bash syntax highlighting** — commands get token-level coloring (commands, flags, strings, variables, operators, etc.)
- **Click a box to fold it** — clicks land on pi's own expand toggle at the right row, for every tool
  including `renderShell: "self"` ones (edit, MCP)
- **Scroll-safe caching** — an unchanged box costs one line comparison per frame, nothing is re-framed

## What it looks like

A reply's tool calls, folded:

<img src="https://raw.githubusercontent.com/Andy8647/pi-tidy/main/assets/folded.png" alt="Five tool calls folded into one summary line" width="840">

A background process (pi-processes), tracked on the row that started it:

<img src="https://raw.githubusercontent.com/Andy8647/pi-tidy/main/assets/process.png" alt="A background process row with its live state" width="560">

Click `▸ 5 calls` and it becomes a `▾` header with one row per call, each step's thinking above it:

```
 ▾ 5 calls ·  bash×3  read×2 · 4 thoughts · 1 failed · 2.4s
 │ 🧠 thinking  测试挂了，先确认是哪一个断言炸的，再看是不是我们这边的问题
 │ ✓  bash git status --short  4 lines · 0.1s
 │ 🧠 thinking  看一眼改了什么
 │ ✓  read src/app.ts  120 lines · 0.0s
 │ ✗  bash pnpm test  exit 1 · 1.8s
 │ 🧠 thinking  …
```

## Installation

```bash
pi install npm:pi-tidy
```

Requires pi ≥ 1.1.0 (component mouse events, tool durations); on an older pi it
says so at session start. Bash highlighting and the custom write preview also need
`pi.registerToolRenderer()` (pi 1.3.0). Without that API they are skipped and Tidy
says so once, rather than falling back to a tool override that would stop another
extension from loading.

Or straight from the repo:

```bash
pi install git:github.com/Andy8647/pi-tidy
```

Restart pi to activate.

### Coming from pi-toolbox

pi-tidy is `@andy8647/pi-toolbox` renamed (from 0.4.2). Swap the package, and
remove the old one first so the two aren't loaded side by side:

```bash
pi remove npm:@andy8647/pi-toolbox
pi install npm:pi-tidy
```

Your `"toolbox"` settings keep working; rename the key to `"tidy"` when convenient.

The old package re-registered `bash` and `write` as its own tools so it could draw
the highlighted command row and the write preview. pi treats a second registration
under a built-in name as a hard failure, so Tidy could not be loaded alongside an
extension that sandboxes or gates those tools, in either load order. Since 0.4.5
both previews travel as `pi.registerToolRenderer()` resolvers instead, which is why
there is nothing left to conflict with (see [How it works](#how-it-works)).

## Releasing

`.github/workflows/publish.yml` publishes to npm on a published GitHub Release,
using npm's Trusted Publisher (OIDC) — no `NPM_TOKEN` secret. Bump `version` in
`package.json`, tag `vX.Y.Z`, and publish the release; the workflow fails fast
if the tag and the manifest version disagree.

## Configuration

Add a `tidy` key to your `~/.pi/agent/settings.json`; changes apply on `/reload`:

```json
{
  "tidy": {
    "enabled": true,
    "highlightBash": true,
    "frameMessages": true,
    "userMessageStyle": "frame",
    "userMessageAlign": "left",
    "collapseTurns": "off",
    "frameFinalReply": false,
    "userMessagePaddingY": 1,
    "userMessageColors": { "rail": "accent", "rule": "borderMuted" },
    "icons": true,
    "bashResultLines": 1,
    "writeLines": 10,
    "diffLines": 20,
    "thinkingColor": "warning",
    "gutterColor": "muted",
    "groupTools": true,
    "groupOpen": true,
    "alwaysShowTools": ["edit", "write"],
    "backgroundJobs": true,
    "hideJobNotifications": true,
    "toolColors": {
      "bash": "bashMode",
      "read": "toolTitle",
      "edit": "syntaxVariable",
      "write": "syntaxVariable",
      "grep": "syntaxOperator",
      "find": "syntaxOperator",
      "ls": "syntaxOperator",
      "mcp": "customMessageLabel"
    },
    "messageBorderColors": {
      "user": "toolTitle",
      "compaction": "customMessageLabel",
      "branch": "mdCode",
      "skill": "accent",
      "custom": "warning"
    }
  }
}
```

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the extension |
| `highlightBash` | boolean | `true` | Syntax-highlight bash commands |
| `frameMessages` | boolean | `true` | Frame compaction/branch/skill/custom-message boxes like tool boxes, and your own `!` / `!!` bash runs (in the user message color, with the user icon and the `!` you typed) |
| `userMessageStyle` | `"frame"` \| `"rail"` \| `"off"` | `"frame"` | How user messages look. `frame`: the rounded message frame, as wide as the text (never wider than the screen), with the user icon set into its top border, in `messageBorderColors.user` (needs `frameMessages`). `rail`: pi's dark `userMessageBg` fill with an accent `│` in front of every row — no rule rows, no icon. `off`: pi's own. `frameUserMessages` from before 0.5 is no longer read |
| `userMessageAlign` | `"left"` \| `"right"` | `"left"` | Align a `frame` user message and its border icon together. `rail` and `off` are unchanged. Long messages still use the available width |
| `collapseTurns` | `"off"` \| `"afterRun"` \| `"live"` | `"off"` | **Experimental, opt-in.** Fold a whole run's process. `afterRun` waits for final settlement; `live` folds while running and keeps the latest assistant text visible. Works with grouping on or off |
| `frameFinalReply` | boolean | `false` | **Experimental, opt-in.** Put only the settled final assistant reply in a full-width transparent frame, with that message's provider glyph and model name in the top-left border. Independent of turn folding and `frameMessages` |
| `userMessagePaddingY` | number | `1` | Background-filled rows above and below the text of a `rail` message, `0`–`3` |
| `userMessageColors` | object | `{ "rail": "accent", "rule": "borderMuted" }` | Colours for the `rail` style. Only `rail` is painted (the `│`); `rule` is kept for compatibility. Each is a theme color name or `#rrggbb` |
| `icons` | boolean | `true` | Nerd Font icons on every box. Requires a Nerd Font; set `false` otherwise |
| `groupTools` | boolean | `true` | Fold the tool calls between two assistant text blocks (or a user message) into one summary line; click it for one row per call, click a row to open its output beneath it (no box inside the group). `false` renders every call as its own box (a `codemode` box still reads as its call list) |
| `groupOpen` | boolean | `true` | A new tool group starts open: `▾` header plus one row per call. `false` starts it folded (`▸ N calls`); click that header to open it. `/cot` toggles the whole session at runtime — it re-levels groups already on screen, and a later `/cot` wins over a group you opened by hand |
| `backgroundJobs` | boolean | `true` | A call that started a background job (pi-processes) shows the job's live state on its row and in the summary. A *running* job keeps its row while folded; a finished one folds away (the summary counts it). The spinner turns once a second for a job's first 5 minutes, then stands still (a dev server can run for hours) |
| `hideJobNotifications` | boolean | `true` | Don't draw a job's notification messages (`[process] "ticker" matched stdout: READY`) once its row shows them. Only drawing — the model still receives them. Jobs without a row keep their messages |
| `alwaysShowTools` | string[] | `["edit", "write"]` | **Deprecated.** Folding is uniform now: every call is a row, opened into a box. The list still suppresses background-job tracking on those tools |
| `splitDiff` | boolean | `true` | Render an edit's diff as two panes (`old │ new`) with line numbers, a bar and a tinted row per changed line. `false` keeps pi's unified diff |
| `splitDiffMinWidth` | number | `72` | Box width below which the split is dropped for pi's unified diff — two panes need room to stay readable |
| `thinkingColor` | theme color | `warning` | Colour of the brain, the `N thoughts` count and an expanded thinking box. Any theme color name or `#rrggbb` |
| `gutterColor` | theme color | `muted` | Colour of a group's left rail (`│`), its `├─` tick and its `▾`/`▸` chevron — one colour for all the group's chrome. `muted` stays readable on a dark terminal where pi's `borderMuted` border grey does not; `mdLink` gives the blue rail, `accent` ties it to the theme's highlight |
| `partialLines` | number | `12` | Rows an expanded box shows at `ctrl+o` before `ctrl+shift+o` draws the rest (with `… (+N lines, ctrl+shift+o to expand)` under them). `0` makes `ctrl+o` show the whole output already |
| `diffLines` | number | `20` | Diff rows drawn while an edit box is collapsed. The window is anchored at the first changed line (a third of the budget of context above it), with `… (N more lines, M total, ctrl+o to expand)` under it — pi's own edit renderer has no budget at all, so this is the only thing keeping a long diff from owning the screen. `ctrl+o` draws all of it, `0` keeps just the summary row |
| `bashResultLines` | number | `1` | Visual lines of bash *output* shown while collapsed. pi's renderer hard-codes 5 with no setting; raise this for more context, `0` to hide output until you expand |
| `writeLines` | number | `10` | Visual lines of a written file shown while the box is collapsed (pi's own number, now adjustable). `0` keeps just the header until you expand. Requires Pi's `registerToolRenderer` API |
| `toolColors` | object | see above | Border color per tool name for successful executions (pending stays grey, errors stay red, unlisted tools take `accent`). When set, the map **replaces** the defaults — `{}` disables per-tool colors |
| `messageBorderColors` | object | see above | Per-kind message-box border colors; merged over the defaults |

All color values are theme fg color names (`ThemeColor`), so they follow the
active theme. Default palette rationale: tool boxes reserve green/red/grey for
execution status, so message kinds get hues that don't collide —
`customMessageLabel` (mauve, matching the `[compaction]` label) for
compactions, `mdCode` (peach) for branch summaries, `accent` (sky) for skill
invocations, `warning` (yellow) for extension notices.

## How it works

pi builds one `ToolExecutionComponent` per tool call, no matter which extension
registered the tool. pi-tidy patches that component's `render` to frame the whole
box — which is why MCP and subagent boxes are framed too. Message boxes (compaction, branch
summary, skill invocation, extension custom message) never go through that
component; their own prototypes get the same treatment, with one exception
that keeps its native styling: custom messages rendered by an
extension-provided renderer. `!` bash-mode runs are framed as the user's
rather than as a tool's: the agent's bash box changes color with its state,
while the user's keeps the user messages' color (`messageBorderColors.user`, or
`userMessageColors.rail` under the rail) and lets pi's own rows (`Running...`,
`(exit 1)`) say how it went. Both user message styles render pi's own Markdown
child narrower and swap only its chrome, so markdown
transformers registered by other extensions (pi-ide-context's selection
references, for one) keep working. With pi-starline 0.9 and later, tidy is the
only extension that styles user messages; earlier pi-starline versions draw
their own over it.

Tidy registers **no tools at all**. Everything it changes about `bash` and `write`
(the highlighted command row, the collapsed output budgets, the write preview)
travels as a `pi.registerToolRenderer()` resolver, so the tool that is actually
installed keeps its execution, schema, shell and result renderer, and `next()`
hands Tidy whatever is downstream — pi's built-in renderers when an extension
defines none. Registering a tool under a built-in name is a hard failure in pi
(`Tool "write" conflicts with …`), which is why an extension that sandboxes
`bash`/`write` used to be mutually exclusive with Tidy no matter which loaded
first. It no longer is (issue #7, PR #8 and the bash follow-up).

An unchanged box returns its cached line array outright: pi re-renders the
whole transcript on every frame, including every mouse packet while scrolling.
Measured against unpatched pi at 300 boxes / 2400 lines: +0.03 ms per full
render.

### Grouping

Groups are derived at render time from transcript order — nothing is
persisted, so a reloaded session folds the same way. A boundary is a user
message or an assistant message with visible text; pi gives every model step its
own assistant message, and steps that only call a tool don't split a group.
`ctrl+o` and pi's own box clicks both arrive through `setExpanded`, which is how
the group levels stay in step with pi's per-box expand flag. Groups start open
here (`groupOpen: true`); `/cot` flips them all open/folded at runtime, and a
folded group's `▸` header opens just that group. The `▾` header of an already
open group is inert — folding it back is `/cot`'s job. The rail, tick and
chevron all take `gutterColor` (default `muted`), so the group reads as one
piece instead of mixing pi's near-invisible border grey with the row colours.

### Turn summaries and final replies (experimental)

Turn folding and final-reply framing are experimental and disabled by default. Updating does not enable
either feature. To try both, merge these keys into the `tidy` object in `~/.pi/agent/settings.json`:

```json
{
  "tidy": {
    "collapseTurns": "afterRun",
    "frameFinalReply": true
  }
}
```

The keys work independently: `collapseTurns: "live"` folds while the run is still active;
`frameFinalReply: true` can be used without turn folding. To disable them, set `collapseTurns` to
`"off"` and `frameFinalReply` to `false`. Restart Pi after upgrading to load the new rendering patches.
For right-aligned user frames, set `tidy.userMessageAlign: "right"` with `tidy.userMessageStyle: "frame"`
and `tidy.frameMessages: true`; this is separate from the experimental features.

`collapseTurns` adds an outer fold around one complete run. Steering messages, retries and
automatic continuations stay in that run until pi fully settles. An interrupted, failed or
truncated run is marked as such. `afterRun` shows the process while it is running and folds
it on completion; `live` folds immediately, keeping the newest assistant text visible.

The summary sits at the top of the turn: directly above the final reply while folded, and
above the process once opened. It stays in place across both states:

```text
 ▸ took 1m20s · LLM 58s · tools 20s · 12 calls · read×6 · bash×4 · codemode×2
```

Click it to restore the process, and click the same row again to hide it. The outer fold
also hides thinking and the tool rows, but never user inputs. Opening it preserves the inner groups,
manual expansion and output budgets rather than resetting them. A pure chat
reply with no hidden process gets no extra summary. `/tidy turn` toggles the latest run;
`/tidy turn N` toggles a run by its one-based position on the active branch. `ctrl+o` still
expands/collapses tool outputs and their containing turns. Background-job notifications
remain visible when turn folding is enabled, since their owning rows may be hidden.

`took` is run wall time. `LLM` covers the main agent's model requests, including response
wait and generation. `tools` is the union of top-level tool execution intervals, including
codemode and MCP waits, not CPU time: parallel tools and nested calls are not added twice.
Nested model calls belong to their calling tool. Detached background jobs are not timed
past the launching tool's return. Retries, framework overhead and overlap mean the two
parts need not sum to the total. Timing metadata is saved outside model context and follows
the active session branch. Missing historical timings show `—`, not an estimate.

`frameFinalReply` frames only a settled final text reply, keeping pi's Markdown rendering
and mouse targets. It never promotes an intermediate tool-calling message into a final
answer. The border label names the model that answered the reply — the id recorded on
the message, not the currently selected one — and the glyph in front of it is its
provider's: recent Nerd Fonts have OpenAI/Claude/Google glyphs, other providers get a
generic robot. A model id too long for the border is clipped to `…` rather than dropping
the label, and `icons: false` drops the glyph and keeps the model name.

### Background jobs

pi has no notion of a job that outlives its tool call, so `background-jobs.ts`
has a small provider interface. pi-processes is the one provider: its
`processes:*` events on pi's shared extension bus keep a row live, its persisted
`ad-process:notification` messages rebuild a reloaded session, and a process it
no longer knows reads `not running`. If that protocol changes, rows fall back to
plain tool rows.

### Mouse

Clicks come from pi's own fullscreen mode (`tuiMode: "fullscreen"`, pi ≥ 0.86
component mouse events); pi-tidy never turns on mouse reporting itself. Only left
clicks on its own rows are taken — presses and drags pass through, so text
selection works as usual. Without fullscreen there are no clicks: `ctrl+o` still
toggles every box.

A row you can click lights up under the pointer, and the pointer turns into a hand
while it is on one (OSC 22: Ghostty, kitty, foot and WezTerm draw it; other
terminals ignore it). Under tmux, zellij or screen pi only reports motion with a button
held, so there is no hover there.

The transcript's scrollbar is pi's, and with `fullscreenScrollbar: "auto"` (the
default) pi paints it over the rightmost column — the one these frames put their
border in, so it covers the border while it is on screen. Set `"always"` and pi
reserves that column instead, drawing the frames one cell narrower; `"hidden"`
works too if you never want it. Nothing to configure on this side either way.

## Render benchmark

PRs include a **Render benchmark** check. Its Job Summary compares the PR's base and head
commits on the same runner using the same fixture and installed dependencies. It reports
median and P95 milliseconds per frame at 100, 500 and 1,500 components, folded and with all
tool outputs expanded. Raw samples are attached as an artifact. Timing changes do not fail CI.

The fixture uses real pi components with synthetic user messages, thinking, tool groups,
failures, edit diffs and codemode calls. It never executes tools or contacts a model.
Measurements cover warm transcript rendering, not terminal drawing or end-to-end scroll latency;
small differences can be runner noise. For a local comparison, run `pnpm bench /path/to/base-checkout`
from the PR checkout. Both checkouts must resolve the PR checkout's installed dependencies.

## Compatible themes

For the best transparent experience, set tool background colors to `""` in your theme:

```json
{
  "toolPendingBg": "",
  "toolSuccessBg": "",
  "toolErrorBg": ""
}
```

## License

MIT
