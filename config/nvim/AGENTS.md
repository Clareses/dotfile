# config/nvim — lazy.nvim 配置（作用域指令）

根 `../../AGENTS.md` 仍然适用。

## 结构

- `init.lua` — 入口，加载顺序：`config.lazy` → `config.options` → `config.keymaps`，再加载顶层模块。
- `lua/config/` — `lazy.lua`（lazy.nvim 引导）、`options.lua`、`keymaps.lua`。
- `lua/plugins/*.lua` — 每个文件返回一个 lazy.nvim 插件 spec。
- `lua/<module>.lua` — 顶层功能模块（如 `txtfmt`）。
- `basic.lua` — 旧的单文件基础配置（历史遗留）。
- `lazy-lock.json` — lazy.nvim 管理，锁版本用。

## 约定

- **加插件**：新建 `lua/plugins/<name>.lua` 返回 spec；不要在 `init.lua` 里堆插件配置。
- **加顶层函数/模块**：放 `lua/<module>.lua`，在 `init.lua` 里 `require("<module>").setup(...)`。
- 配置完成的状态用 `/reload` 无效——nvim 需重开，或在运行中手动
  `:lua package.loaded["<module>"] = nil; require("<module>").setup(...)`（`require` 有缓存）。
- 注释以中文为主，风格跟现有文件保持一致。

## 陷阱

- 本目录在 `links.manifest` 里是**逐项链接**（不是整目录 linkdir）：`init.lua`、`basic.lua`、
  `lua/`、`clean/`、`back-package/`、`lazy-lock.json`、`.scalafmt.conf` 各自一条。
  **新增顶层文件/目录时，记得同步加 manifest 条目**，否则不会出现在 `~/.config/nvim`。
- 运行时目录 `.metals/`、`.scala-build/`、`.bsp/`、`.vim/` 留在本地、不纳入本仓库。
- 改了 `lua/` 下的文件后，验证用 `nvim --headless -u NONE` 加载模块，或用 `luac`/`bun build --no-bundle`
  之类做语法检查，避免直接凭感觉。
