# dotfile

个人 dotfiles：把以下软件的配置集中到这里，用软链接部署回原位。

- WM/桌面：hyprland、waybar、i3、quickshell
- 终端：tmux、fish
- 编辑器：neovim
- AI：pi（`~/.pi/agent` 的配置部分）

## 结构

```
dotfile/
├── install.sh         部署脚本（幂等、带备份、可 dry-run/卸载，按 target 选择性安装）
├── links.manifest     声明式映射表：mode 源 目标 target
├── config/<app>/      映射到 ~/.config/<app>
└── home/pi/agent/     映射到 ~/.pi/agent（仅配置，不含 auth/sessions/cache）
```

## 用法

安装时必须指定 target（安装哪些程序/功能的配置），可一次写多个，或写 `all`：

```sh
./install.sh --list          # 列出所有可用 target
./install.sh all --dry-run   # 先看全量会做什么，不动任何东西
./install.sh tmux fish       # 只部署 tmux 和 fish
./install.sh all             # 部署全部（已存在的真实文件先备份）
./install.sh tmux --status   # 查看 tmux 相关链接状态
./install.sh all --uninstall # 移除本仓库建立的链接
```

可用 target 由 `links.manifest` 第 4 列声明，例如：
`hypr`、`waybar`、`i3`、`quickshell`、`fcitx5`、`mako`、`swaync`、
`tmux`、`fish`、`nvim`、`pi`，外加 `all`。

备份目录：`~/.local/state/dotfile/backups/<时间戳>/`（可用 `DOTFILE_BACKUP_ROOT` 覆盖）。

## manifest 三种模式

| mode | 行为 |
|---|---|
| `linkdir` | 整目录软链接（`~/.config/<app>` → `repo/config/<app>`） |
| `linkfile` | 单文件软链接 |
| `mirror` | 目标目录保持真实，只把 repo 下每个子项软链接进去；repo 没有的（如 `node_modules`、`.zen-ai-profile`、`.git`）原样保留 |

## 设计约定 / 注意

- **不纳入**：密钥（`~/.pi/agent/auth.json`）、会话（`sessions/`）、缓存、`node_modules`、浏览器 profile、fish 的 `fish_variables`。见 `.gitignore`。
- **nvim / fish** 用逐项链接，运行时目录（`.metals`、`.scala-build`、`.bsp`）和 `fish_variables` 留在本地。
- **ML4W**：hypr/waybar/quickshell 已从 ML4W 接管；`~/.config/ml4w*` 仍归 ML4W，不在本仓库。
- **可移植**：用户相关路径统一用 `$HOME`/`~/`（fish/hypr/shell/lua 内嵌命令均已适配），任意用户 clone 到自己的 `~/.config/dotfile` 后 `./install.sh` 即可部署；显示器名、壁纸/截图目录等仍需按本机调整。
- **密钥**：API key 等放 `config/fish/conf.d/secrets.fish`（已 gitignore），不要写进受版本控制的文件。
- matugen 生成的 `colors.*` / `waybar/colors.css` 被 `.gitignore` 忽略（要版本化就删掉对应行）。
- 想新增一个 app：把内容放进 `config/<app>/`（或 `home/...`），在 `links.manifest` 加一行（含 target 名）即可。
