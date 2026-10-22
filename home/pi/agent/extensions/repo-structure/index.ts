/**
 * repo-structure — 可开关的"仓库结构"工具。
 *
 * 提供一个工具 `repo_structure`：扫描任意仓库（新建或已有），返回
 *   - format=digest : 结构摘要（目录树/体量/语言/构建标记/文档）
 *   - format=agents : 依据分层最佳实践生成 AGENTS.md 脚手架（根 + 候选作用域 + 检查清单）
 * 可选 write=true 把脚手架落盘（不覆盖已存在的 AGENTS.md）。
 *
 * 默认 **关闭**（工具处于 inactive，模型看不到），与 browser-zen / web-access-toggle 同一模式：
 *
 *   /repo-structure on      启用
 *   /repo-structure off     关闭
 *   /repo-structure         切换
 *
 * 每个 session 开始都重置为 OFF，只在本次会话手动开。
 *
 * 详细的最佳实践与用法见同目录：
 *   reference/agent-docs-best-practices.md
 *   README.md
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import { renderAgentsPlan, renderDigest, scanRepo, writeScaffold } from "./scan.ts";

const TOOL = "repo_structure";

const Params = Type.Object({
  path: Type.Optional(
    Type.String({ description: "仓库根目录；默认当前工作目录" }),
  ),
  format: Type.Optional(
    Type.Union([Type.Literal("digest"), Type.Literal("agents")], {
      description: "digest=结构摘要（默认）；agents=AGENTS.md 分层脚手架",
    }),
  ),
  maxDepth: Type.Optional(
    Type.Number({ description: "扫描深度，默认 4，上限 8" }),
  ),
  write: Type.Optional(
    Type.Boolean({
      description:
        "format=agents 时是否把脚手架写入文件（默认 false）。不会覆盖已存在的 AGENTS.md。",
    }),
  ),
});
type ParamsType = Static<typeof Params>;

export default function repoStructure(pi: ExtensionAPI): void {
  // 期望状态；session_start 强制为 false。
  let wantOn = false;

  const isRegistered = (): boolean => pi.getAllTools().some((t) => t.name === TOOL);
  const isActive = (): boolean => pi.getActiveTools().includes(TOOL);

  /** 让 active-tool 集合与 wantOn 一致，返回最终状态。 */
  function setState(next: boolean): boolean {
    wantOn = next;
    const active = pi.getActiveTools();
    const has = active.includes(TOOL);
    if (next && !has) pi.setActiveTools([...active, TOOL]);
    else if (!next && has) pi.setActiveTools(active.filter((n) => n !== TOOL));
    return next;
  }
  const apply = (): void => setState(wantOn);

  pi.on("session_start", () => setState(false)); // 永远从 OFF 开始
  pi.on("session_tree", () => apply());
  pi.on("before_agent_start", () => apply());

  pi.registerTool({
    name: TOOL,
    label: "Repo structure",
    description:
      "扫描一个仓库并返回其可观察结构（目录、体量、语言、构建标记、现有文档），或据此生成 AGENTS.md 的分层脚手架。用于「给新仓库建结构」或「总结现有仓库结构」。",
    promptSnippet: "扫描仓库结构 / 生成 AGENTS.md 分层脚手架",
    promptGuidelines: [
      "要生成或总结仓库文档（AGENTS.md 等）时，先调用一次 `repo_structure` 拿到机械摘要，再据此判断；不要用一堆 ls/find 自己拼结构。",
      '用 `format="agents"` 得到分层脚手架（根 + 候选作用域 + 检查清单）。只有用户明确同意时才传 `write=true` 落盘。',
      "生成内容时遵循分层原则：能放子目录作用域的别堆在根文件；能指向已有文档的就别复述；能写成命令/工具的就别写成\"请你小心\"；只写代码告诉不了你的陷阱；引用名字/revision，别写行号。",
    ],
    parameters: Params,
    defaultActive: false,
    async execute(_toolCallId, params: ParamsType) {
      const root = resolve(params.path?.trim() || process.cwd());
      if (!existsSync(root)) {
        return {
          content: [{ type: "text" as const, text: `路径不存在: ${root}` }],
          isError: true,
          details: {},
        };
      }

      const scan = scanRepo(root, { maxDepth: params.maxDepth });
      const format = params.format ?? "digest";

      if (format === "agents") {
        let text = renderAgentsPlan(scan);
        if (params.write) {
          const results = writeScaffold(scan, "all");
          text += `\n\n## 写盘结果\n${results.map((r) => `- ${r}`).join("\n")}`;
        }
        return { content: [{ type: "text" as const, text }], details: { root, files: scan.files } };
      }

      return {
        content: [{ type: "text" as const, text: renderDigest(scan) }],
        details: { root, files: scan.files, dirs: scan.dirs },
      };
    },
  });

  pi.registerCommand("repo-structure", {
    description: "开关 repo_structure 工具（on|off|toggle）",
    handler: (args: string, ctx: ExtensionCommandContext) => {
      if (!isRegistered()) {
        ctx.ui.notify("repo_structure 未注册——扩展没加载？", "error");
        return;
      }
      const a = args.trim().toLowerCase();
      let next: boolean;
      if (a === "on") next = true;
      else if (a === "off") next = false;
      else if (a === "" || a === "toggle") next = !isActive();
      else {
        ctx.ui.notify("usage: /repo-structure [on|off]", "warning");
        return;
      }
      setState(next);
      ctx.ui.notify(`repo_structure ${next ? "on" : "off"}`, "info");
    },
  });
}
