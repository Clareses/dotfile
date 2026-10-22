# home/pi/agent — pi 配置 / 扩展 / skills（作用域指令）

根 `../../AGENTS.md` 仍然适用。这里是 `~/.pi/agent` 的**配置子集**。

> **⚠️ 不要把本文件加入 `links.manifest`。** pi 会把 `<agent-dir>/AGENTS.md`（即
> `~/.pi/agent/AGENTS.md`）当作**跨所有工作目录的全局用户指令**加载；本文件只是本仓库的
> 范围说明，一旦部署就会污染你每一个 pi 会话。

## 关键约束：改动必须与 links.manifest 同步

仓库**不会自动部署**这里的任何东西——只有出现在 `links.manifest` 里的条目才会被软链到 `~/.pi/agent`。
所以：

- 新增一个**单文件**（扩展 / json）→ 加 `linkfile home/pi/agent/extensions/<x>.ts ~/.pi/agent/extensions/<x>.ts pi`。
- 新增一个**带源码的扩展目录**（含 `node_modules` 等）→ 用 `mirror`（保留目标目录里 repo 没有的东西）。
- 新增一个 **package**（扩展 + skills 打包）→ 用 `linkdir`。

漏加 manifest 的后果：文件在本仓库里，但**运行时根本不加载**。

## 不允许提交的东西

`auth.json`、`models-store.json`、`sessions/`、`web-search-cache/`、`npm/`、`git/`、`monitor/`
都已在 `.gitignore`。**密钥绝不进受控文件**（见根 AGENTS.md 的安全红线）。

## 结构与文件

- `settings.json` — 主配置：默认 provider/model、`packages`、`extensions` 数组、主题等。
- `models.json` — 自定义 provider（当前是 `yun`）。
- `keybindings.json` — 快捷键。
- `prompts/` — 提示词模板（如 `zotero.md`）。
- `skills/<name>/SKILL.md` — pi skill，YAML frontmatter 至少含 `name`、`description`（description 里写清
  **何时用 / 何时别用**，它常驻上下文、是"接口"）。
- `extensions/*.ts` — pi 扩展（单文件）；`extensions/<pkg>/`、`packages/<pkg>/` — 带源码的包。
- `pi-input-history.json` — 输入历史（由 pi 写）。

## 写 pi 扩展的约定

- 默认导出 `export default function (pi) { … }`，用 `pi.registerCommand` / `pi.registerTool` /
  `pi.on` / `pi.registerShortcut` 注册能力。
- 类型从 `@earendil-works/pi-coding-agent`（`@mariozechner/*` 也做了别名）；TUI 组件从
  `@earendil-works/pi-tui`。扩展由 jiti 加载，**不需要编译**。
- 命令/工具注册进 `pi` 后即可热重载；session 相关状态要用 session 维度键控，别用全局变量。
- 与内置命令**同名会被过滤**（扩展无法覆盖内置斜杠命令，如 `/tree`）。

## 陷阱

- 扩展文件改了但"没生效"——先检查 `links.manifest` 有没有对应条目、以及 `settings.json` 里的
  `extensions` / `packages` 是否包含它。
- 同时装多个做同一件事的扩展会抢同名工具（例如多个 subagent 插件、多个 `find`/`grep` 实现）；
  引入前先确认没有重叠。
