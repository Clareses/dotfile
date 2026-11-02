# Local patch: `tidy.thinkingOpen`

Vendored copy of `pi-tidy@0.7.0` (upstream: https://github.com/Andy8647/pi-tidy) with the
unmerged PR #23 ported in, because there is no released setting for "thinking starts expanded".

Changes vs upstream 0.7.0:

- `config.ts` — new `thinkingOpen` option; **default `true` here** (upstream PR had `false`)
- `index.ts` — pass it to `patchToolBoxFrames`
- `tool-frame.ts` — thread it through `ToolFrameOptions` → `setThinkingOpen`
- `tool-group-view.ts` — **local rewrite of the thinking feature**: one source of truth.
  A run's visibility is `pi`'s per-run `thinkingVisibilityOverrides` when it holds an entry,
  otherwise the message's own `hideThinkingBlock` (`runShown()`). Hidden → one row
  `󰧑 thinking  <head of the run>`; shown → pi's own markdown and nothing else, no frame, no
  label above it. Clicks go through pi's own `MouseRegion`.
  The PR's `thinkingOpen` seeding, the `THOUGHT_OPEN` carrier marker, the Ctrl+T wrapper and
  the `openGroup` side effect are all gone: they were a second source of state, which produced
  runs that stayed folded after a toggle, runs that re-opened on their own next turn, and a
  sliding preview window under `Ctrl+T`.
- `tool-lines.ts` — unchanged upstream, but the live sliding window is no longer used: a folded
  row is a still head preview, so nothing scrolls while the model is thinking.
- Tests: `test/thinking-open.test.ts` and `test/toggle-thinking.test.ts` were replaced by
  `test/thinking-visibility.test.ts` (label ↔ pi's text, Ctrl+T both ways, group rows).

## Local patch: group open by default + `/cot`

- `config.ts` — `groupOpen` option; **default `true` here** (upstream default is `false`)
- `tool-groups.ts` — `groupsOpen` live slot + an `openGeneration` counter. A group
  draws with its own level only if that level was set since the last `/cot`;
  otherwise it follows the slot. So `/cot` re-levels groups already on screen
  without walking the (non-iterable) `WeakMap`s. `openGroup` really opens a
  folded group; `closeGroup` stays inert so a `▾` header click cannot fold.
- `tool-frame.ts` — thread `groupOpen`, `setGroupsOpen()`, and `refreshToolBoxes()`
  (the repaint hook `/cot` uses)
- `index.ts` — `pi.registerCommand("cot")`: toggles the slot, repaints every live
  tool box, notifies. Commands are session-only; `tidy.groupOpen` seeds the
  next load.
- Tests: local fixtures default to `groupOpen: true`, and `openGroups()` in
  `test/turn-groups.test.ts` clicks any folded group header.
- `gutterColor` (default `muted`) replaces the hard-coded `borderMuted` for the
  group rail, `├─` tick, chevron, in-body continuation rail and codemode rail.
  One setting for all the group's chrome; `mdLink` restores the blue rail.
## Re-syncing with a new upstream release

```sh
git clone https://github.com/Andy8647/pi-tidy /tmp/pt && cd /tmp/pt
git checkout vX.Y.Z
git apply --include='*.ts' --3way UPSTREAM-PR-23.patch   # resolve tool-frame.ts import conflict
# then set DEFAULTS.thinkingOpen = true in config.ts
# copy *.ts, package.json, README.md, LICENSE back here
```

Do not `pi install npm:pi-tidy` alongside this: same extension, two owners.
