# config/quickshell — QML shell（作用域指令）

根 `../../AGENTS.md` 仍然适用。这里只写 quickshell 专属、从代码里看不出来的东西。

## 结构

- `shell.qml` — 入口（带 `//@ pragma UseQApplication`），import 各 `*App` 目录，用 `Variants` 给每个屏幕放一个面板。
- `<X>App/` — 一个功能一个目录：`StatusbarApp`、`SidebarApp`、`NotificationApp`、`CalendarApp`、`PowerApp`、`TodoApp`、`WallpaperApp`、`WelcomeApp` 等。
- `shared/` — 共享资源（含 `shared/icons/`）。
- `CustomTheme/Theme.qml` — 全局主题（颜色 / 圆角 / 字体），也读 `~/.config/ml4w/colors/colors.json`。

## 约定

- 颜色、圆角、字号一律走 `Theme.*`，**不要硬编码色值**——否则会和 shell 其它部分脱节。
- 新增顶栏模块的标准动作：写 `StatusbarApp/<X>Module.qml` → 在 `StatusbarApp/StatusbarWindow.qml` 注册 → 处理配置文件。
- 图标放 `shared/icons/`。

## 陷阱（都是实际踩过的）

- `shell.qml` 的 `UseQApplication` 让 quickshell 变成 QApplication：`QsMenuAnchor` 会渲染成
  **Qt Widgets 的 `QMenu`**（浅色 Fusion 调色板 + 方角），与 shell 不统一。
  系统托盘的右键菜单因此是**自绘**的：`StatusbarApp/TrayMenu.qml` + `QsMenuOpener` + `TrayMenuItem.qml`。
  **改托盘菜单不要再退回 `QsMenuAnchor`。**
- QML **禁止**组件直接递归实例化自身（会报 "instantiated recursively"）。子菜单靠共享行组件
  （`TrayMenuItem`）+ 一层内联子菜单实现。
- 顶栏配置文件有两级（见 `StatusbarWindow.qml` 顶部注释）：
  1. `~/.config/ml4w-statusbar/statusbar.json` — 用户覆盖；
  2. `~/.config/ml4w/settings/statusbar.json` — 随附的 fallback。
  **实际生效的是这两份**，repo 里的 `StatusbarApp/statusbar.json` 只是源/模板。
  改模块显隐、顺序，要改 `~/.config/ml4w*` 那两份。
- 改完 quickshell 会热重载；务必看日志确认没有 QML 报错（`qs log` 或启动时的 stderr）。

## 可移植性

- 路径用 `Quickshell.env("HOME")` / `~`，不要写死用户名或显示器名。
