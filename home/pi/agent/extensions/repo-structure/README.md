# repo-structure（pi 扩展）

给'任意仓库（新建或已有）生成或总结结构'提供一个**可开关**的工具。

- 工具 `repo_structure`：扫描仓库 → 结构摘要，或按分层最佳实践生成 `AGENTS.md` 脚手架。
- 默认 **关闭**；每个 session 开始都重置为 OFF。用命令手动开：

```vim
/repo-structure on       " 启用
/repo-structure off      " 关闭
/repo-structure          " 切换
```

（模仿 `web-access-toggle` / `browser-zen` 的"工具默认 inactive、手动 enable"模式：关闭时模型看不到这个工具，也不会有它的 prompt 指引。）

## 工具用法

```
repo_structure(format="digest")                       # 结构摘要（默认）
repo_structure(format="digest", maxDepth=5)           # 扫深一点
repo_structure(path="/some/repo", format="agents")    # 生成 AGENTS.md 分层脚手架（不写盘）
repo_structure(format="agents", write=true)           # 落盘（不覆盖已存在的 AGENTS.md）
```

- `format="digest"`：目录树、体量、文件类型、构建/技术标记、现有文档、候选作用域目录。**纯机械、稳定、便宜**。
- `format="agents"`：根 `AGENTS.md` 骨架 + 候选子目录 `AGENTS.md` 骨架 + 检查清单。
- 不用 shell 出去跑 `ls`/`find`——扫描在进程内完成，输出格式固定。

## 文件

| 文件 | 作用 |
|---|---|
| `index.ts` | 扩展入口：注册工具 + `/repo-structure` 开关 |
| `scan.ts` | 纯函数：扫描 + 渲染摘要/脚手架 + 落盘 |
| `reference/agent-docs-best-practices.md` | 分层最佳实践（放置决策 + 六条原则） |

## 安装 / 部署

本目录通过 `links.manifest` 软链到 `~/.pi/agent/extensions/repo-structure`（`pi` target）。
`pi` 会从 `package.json` 的 `pi.extensions` 发现 `index.ts`。
