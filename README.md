# dotfile

个人 dotfiles：把以下软件的配置集中到这里，用软链接部署回原位。

- WM/桌面：hyprland、waybar、i3、quickshell
- 终端：tmux、fish
- 编辑器：neovim
- AI：pi（`~/.pi/agent` 的配置部分）

## 结构

```
dotfile/
├── install.sh         部署脚本（幂等、带备份、可 dry-run/卸载）
├── links.manifest     声明式映射表：mode 源 目标
├── config/<app>/      映射到 ~/.config/<app>
└── home/pi/agent/     映射到 ~/.pi/agent（仅配置，不含 auth/sessions/cache）
```

## 用法

```sh
./install.sh --dry-run    # 先看会做什么，不动任何东西
./install.sh              # 部署（已存在的真实文件先备份）
./install.sh --status     # 查看当前链接状态
./install.sh --uninstall  # 移除本仓库建立的链接
```

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
- 想新增一个 app：把内容放进 `config/<app>/`（或 `home/...`），在 `links.manifest` 加一行即可。
