/**
 * tree-delete extension (conversation view)
 *
 * Shows ONLY the conversation: user messages and assistant messages that
 * contain text. Tool results, tool-call-only assistant turns, labels,
 * model/thinking changes, compactions and other bookkeeping entries are hidden.
 *
 * Keys:
 *   space     — toggle selection of the highlighted entry (multi-select)
 *   ctrl+a    — select all / clear all
 *   d         — delete every selected entry in one batch (if none selected,
 *               delete just the highlighted entry); children are reparented
 *   r         — undo the last deletion (file-snapshot stack)
 *   Enter     — navigate to highlighted entry (same as built-in /tree)
 *   Esc       — clear the selection if any; otherwise exit
 *
 * Deletion is batched: mark every entry you want gone, then press d once.
 * The tree refreshes a single time, and the cursor is kept near where you were.
 *
 * The tree is read directly from the JSONL file, so changes are visible
 * immediately — no /resume needed.
 *
 * Install: copy to ~/.pi/agent/extensions/ or .pi/extensions/
 */

import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { TreeSelectorComponent } from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { readFileSync, writeFileSync } from "node:fs";

// Types present in session-manager but not re-exported from the top-level index.
type SessionTreeNode = { entry: SessionEntry; children: SessionTreeNode[]; label?: string };
type LabelEntry = SessionEntry & { type: "label"; targetId: string; label: string | undefined };

// ---------------------------------------------------------------------------
// JSONL / tree helpers
// ---------------------------------------------------------------------------

function parseSessionEntries(filePath: string): SessionEntry[] {
  const entries: SessionEntry[] = [];
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const p = JSON.parse(t) as { type: string };
      if (p.type !== "session") entries.push(p as SessionEntry);
    } catch { /* skip malformed lines */ }
  }
  return entries;
}

function buildTree(entries: SessionEntry[]): SessionTreeNode[] {
  // Latest LabelEntry for a targetId wins.
  const labels = new Map<string, string | undefined>();
  for (const e of entries)
    if (e.type === "label") labels.set((e as LabelEntry).targetId, (e as LabelEntry).label);

  const nodeMap = new Map<string, SessionTreeNode>();
  for (const e of entries)
    if (e.type !== "label")
      nodeMap.set(e.id, { entry: e, children: [], label: labels.get(e.id) });

  const roots: SessionTreeNode[] = [];
  for (const node of nodeMap.values()) {
    const parent = node.entry.parentId ? nodeMap.get(node.entry.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  for (const node of nodeMap.values())
    node.children.sort((a, b) => a.entry.timestamp.localeCompare(b.entry.timestamp));

  return roots;
}

/** Depth-first list of entry ids in the same order TreeSelectorComponent traverses. */
function flatDFS(nodes: SessionTreeNode[]): string[] {
  const result: string[] = [];
  const stack = [...nodes].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    result.push(node.entry.id);
    for (let i = node.children.length - 1; i >= 0; i--) stack.push(node.children[i]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Conversation-only view
// ---------------------------------------------------------------------------

/** Does a message content payload contain real text (not just tool calls)? */
function hasTextContent(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return false;
  return content.some(
    (b) =>
      typeof b === "object" &&
      b !== null &&
      (b as { type?: unknown }).type === "text" &&
      typeof (b as { text?: unknown }).text === "string" &&
      (b as { text: string }).text.trim().length > 0,
  );
}

/** True when an entry is part of the visible conversation. */
function isConversationEntry(entry: SessionEntry): boolean {
  if (entry.type !== "message") return false;
  const role = entry.message.role;
  if (role === "user") return true;
  if (role === "assistant") return hasTextContent(entry.message.content);
  return false;
}

/**
 * Keep only conversation entries, reparenting so that descendants attach to the
 * nearest surviving ancestor (mirrors how a filtered tree is displayed).
 */
function conversationTree(entries: SessionEntry[]): { tree: SessionTreeNode[]; keepIds: Set<string> } {
  const keepIds = new Set<string>();
  for (const e of entries) if (isConversationEntry(e)) keepIds.add(e.id);

  const byId = new Map(entries.map((e) => [e.id, e]));
  const nearest = (startId: string | null): string | null => {
    let cur = startId;
    while (cur) {
      if (keepIds.has(cur)) return cur;
      cur = byId.get(cur)?.parentId ?? null;
    }
    return null;
  };

  const remapped = entries
    .filter((e) => e.type === "label" || keepIds.has(e.id))
    .map((e) =>
      e.type === "label" ? e : ({ ...e, parentId: nearest(e.parentId) } as SessionEntry),
    );

  return { tree: buildTree(remapped), keepIds };
}

/** Prefix selected nodes with a checkbox in their label. */
function decorateTree(nodes: SessionTreeNode[], selected: Set<string>): SessionTreeNode[] {
  return nodes.map((n) => ({
    entry: n.entry,
    label: selected.has(n.entry.id)
      ? n.label
        ? `✓ ${n.label}`
        : "✓"
      : n.label,
    children: decorateTree(n.children, selected),
  }));
}

// ---------------------------------------------------------------------------
// Splice helpers
// ---------------------------------------------------------------------------

/**
 * For each deleted entry, walk up past other deleted entries to find the
 * nearest surviving ancestor. Children of deleted entries are reparented there.
 */
function computeParentRemap(
  entries: SessionEntry[],
  idsToDelete: Set<string>,
): Map<string, string | null> {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const remap = new Map<string, string | null>();
  for (const id of idsToDelete) {
    let pid = byId.get(id)?.parentId ?? null;
    while (pid !== null && idsToDelete.has(pid)) pid = byId.get(pid)?.parentId ?? null;
    remap.set(id, pid);
  }
  return remap;
}

/**
 * Rewrite the JSONL file:
 *  - drop entries in idsToDelete
 *  - reparent their children via parentRemap
 *  - drop LabelEntries whose targetId was deleted
 */
function rewriteFile(
  filePath: string,
  idsToDelete: Set<string>,
  parentRemap: Map<string, string | null>,
): void {
  const kept: string[] = [];
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const p = JSON.parse(t) as Record<string, unknown>;
      if (p.type === "session") { kept.push(t); continue; }
      if (typeof p.id === "string" && idsToDelete.has(p.id)) continue;
      if (p.type === "label" && typeof p.targetId === "string" && idsToDelete.has(p.targetId)) continue;
      if (typeof p.parentId === "string" && parentRemap.has(p.parentId)) {
        kept.push(JSON.stringify({ ...p, parentId: parentRemap.get(p.parentId) ?? null }));
      } else {
        kept.push(t);
      }
    } catch { kept.push(t); }
  }
  writeFileSync(filePath, kept.join("\n") + "\n", "utf8");
}

/** Walk up from startId, returning the first id NOT in deleteIds, or null. */
function survivingAncestor(
  entries: SessionEntry[],
  startId: string | null,
  deleteIds: Set<string>,
): string | null {
  const byId = new Map(entries.map((e) => [e.id, e]));
  let cur = startId;
  while (cur) {
    if (!deleteIds.has(cur)) return cur;
    cur = byId.get(cur)?.parentId ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// UI result
// ---------------------------------------------------------------------------

type UIResult =
  | { action: "navigate"; entryId: string }
  | { action: "delete"; idsToDelete: string[]; nextCursorId: string | null }
  | { action: "undo" }
  | null;

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.registerCommand("treed", {
    description:
      "Navigate conversation tree — space:select  ctrl+a:select all  d:delete selected  r:undo  Enter:navigate  Esc:exit",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("This command requires interactive mode", "warning");
        return;
      }

      await ctx.waitForIdle();

      const sessionFile = ctx.sessionManager.getSessionFile();
      if (!sessionFile) {
        ctx.ui.notify("Cannot delete from an ephemeral (non-persisted) session", "warning");
        return;
      }

      // `ctx.sessionManager` is the same live SessionManager the agent uses, but it is
      // typed as a read-only pick. Rewriting the JSONL alone leaves pi's in-memory tree
      // untouched, so deleted entries survive in /tree and in the next request.
      // setSessionFile() re-reads the file and rebuilds the tree/index/leaf, which is
      // what makes the deletion apply to the *real* session tree.
      const liveManager = ctx.sessionManager as unknown as {
        setSessionFile(path: string): void;
        branch(id: string): void;
        resetLeaf(): void;
      };
      const syncManager = (leafId: string | null) => {
        liveManager.setSessionFile(sessionFile);
        if (leafId) liveManager.branch(leafId);
        else liveManager.resetLeaf();
      };

      let displayLeafId = ctx.sessionManager.getLeafId();
      let initialCursorId: string | null = null;
      let changed = false;
      const undoStack: Array<{ content: string; displayLeafId: string | null }> = [];

      while (true) {
        const fileEntries = parseSessionEntries(sessionFile);
        const { tree, keepIds } = conversationTree(fileEntries);
        const flatIds = flatDFS(tree);

        // Map the real leaf onto the nearest visible conversation entry so the
        // active-path marker lands somewhere sensible.
        let cursorLeafId = displayLeafId;
        {
          const byId = new Map(fileEntries.map((e) => [e.id, e]));
          while (cursorLeafId && !keepIds.has(cursorLeafId)) {
            cursorLeafId = byId.get(cursorLeafId)?.parentId ?? null;
          }
        }

        const result = await ctx.ui.custom<UIResult>((tui, theme, _kb, done) => {
          const termH = tui.terminal.rows;
          let highlightedId: string | null = initialCursorId;
          const selected = new Set<string>();

          const makeSelector = (onlyId?: string | null) =>
            new TreeSelectorComponent(
              decorateTree(tree, selected),
              cursorLeafId ?? null,
              termH,
              (id) => done({ action: "navigate", entryId: id }),
              () => {
                if (selected.size > 0) {
                  selected.clear();
                  highlightedId = onlyId ?? selector.getTreeList().getSelectedNode()?.entry.id ?? null;
                  rebuildSelector();
                } else {
                  done(null);
                }
              },
              undefined,
              onlyId ?? undefined,
            );

          let selector = makeSelector(initialCursorId);

          function rebuildSelector() {
            selector = makeSelector(highlightedId);
          }

          return {
            render(width: number) {
              const lines = selector.render(width);
              const u = undoStack.length;
              const n = selected.size;
              const plain = n > 0
                ? `  ${n} selected — space:toggle  ctrl+a:all  d:delete  Esc:clear`
                : `  space:select  ctrl+a:select all  d:delete${u ? `  r:undo(${u})` : ""}  Esc:exit`;
              lines.push(theme.fg("dim", plain.slice(0, width)));
              return lines;
            },
            invalidate() { selector.invalidate(); },
            handleInput(data: string) {
              // Toggle selection.
              if (matchesKey(data, "space")) {
                const node = selector.getTreeList().getSelectedNode();
                if (!node) return;
                if (selected.has(node.entry.id)) selected.delete(node.entry.id);
                else selected.add(node.entry.id);
                highlightedId = node.entry.id;
                rebuildSelector();
                return;
              }

              // Select all / clear all.
              if (matchesKey(data, "ctrl+a")) {
                if (selected.size === flatIds.length) selected.clear();
                else for (const id of flatIds) selected.add(id);
                highlightedId = selector.getTreeList().getSelectedNode()?.entry.id ?? highlightedId;
                rebuildSelector();
                return;
              }

              // Delete: the whole selection in one batch, or just the highlighted entry.
              if (matchesKey(data, "d") || matchesKey(data, "ctrl+d")) {
                const node = selector.getTreeList().getSelectedNode();
                const ids = selected.size > 0
                  ? [...selected]
                  : node
                    ? [node.entry.id]
                    : [];
                if (ids.length === 0) return;

                const deleteSet = new Set(ids);
                const indices = ids.map((id) => flatIds.indexOf(id)).filter((i) => i >= 0);
                let nextCursorId: string | null = null;
                if (indices.length > 0) {
                  const hi = Math.max(...indices);
                  const lo = Math.min(...indices);
                  for (let i = hi + 1; i < flatIds.length; i++) {
                    if (!deleteSet.has(flatIds[i])) { nextCursorId = flatIds[i]; break; }
                  }
                  if (!nextCursorId) {
                    for (let i = lo - 1; i >= 0; i--) {
                      if (!deleteSet.has(flatIds[i])) { nextCursorId = flatIds[i]; break; }
                    }
                  }
                }
                selected.clear();
                done({ action: "delete", idsToDelete: ids, nextCursorId });
                return;
              }

              if (matchesKey(data, "r")) {
                if (undoStack.length > 0) done({ action: "undo" });
                return;
              }

              selector.handleInput(data);
            },
            get focused() { return selector.focused; },
            set focused(v: boolean) { selector.focused = v; },
          };
        });

        // ── Esc / cancel ──────────────────────────────────────────────────
        if (result === null) break;

        // ── Navigate ──────────────────────────────────────────────────────
        if (result.action === "navigate") {
          const nav = await ctx.navigateTree(result.entryId);
          if (!nav.cancelled && nav.editorText) ctx.ui.setEditorText(nav.editorText);
          break;
        }

        // ── Undo ──────────────────────────────────────────────────────────
        if (result.action === "undo") {
          const snap = undoStack.pop()!;
          writeFileSync(sessionFile, snap.content, "utf8");
          syncManager(snap.displayLeafId); // reload in-memory tree after restore
          displayLeafId = snap.displayLeafId;
          initialCursorId = null;
          continue;
        }

        // ── Delete (splice — children reparented, not deleted) ────────────
        if (result.action === "delete") {
          const { idsToDelete } = result;
          if (idsToDelete.length === 0) continue;

          const deleteSet = new Set<string>(idsToDelete);
          const parentRemap = computeParentRemap(fileEntries, deleteSet);

          undoStack.push({ content: readFileSync(sessionFile, "utf8"), displayLeafId });
          rewriteFile(sessionFile, deleteSet, parentRemap);

          const newLeaf = survivingAncestor(fileEntries, displayLeafId, deleteSet);
          syncManager(newLeaf); // reload in-memory tree so the deletion is real
          displayLeafId = newLeaf;
          changed = true;
          initialCursorId = result.nextCursorId;
          continue;
        }
      }

      // The file is already correct, but the rendered transcript still shows the old
      // messages. Navigating to the current leaf makes the interactive UI rebuild the
      // chat from the reloaded session; even a no-op navigation re-renders.
      if (changed && displayLeafId) {
        try {
          await ctx.navigateTree(displayLeafId);
        } catch {
          /* best effort */
        }
      }
    },
  });
}
