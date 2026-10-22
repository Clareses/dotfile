# dotfile — 全局 agent 指令

个人 dotfiles 仓库：把 hyprland / waybar / i3 / quickshell / tmux / fish / nvim / pi
的配置集中在这里，再用软链接部署回原位。

下面是**处处皆真**的内容。各子系统的细节在各自目录的 `AGENTS.md`，**进入该目录工作前先打开它**
（用 `Read` 工具读，而不是 `cat`/`sed`）。

## 部署模型（先懂这个，否则会改错文件）

- `links.manifest` 是声明式映射，每行：`<mode> <repo 相对路径> <目标绝对路径> <target>`。
  - `linkdir`：整目录软链；`linkfile`：单文件软链；
    `mirror`：目标目录保持真实，只把 repo 下每个子项软链进去，repo 没有的（`node_modules`、`.git` 等）原样保留。
- `install.sh` 按 manifest 建立软链。**必须指定 target**：`./install.sh tmux fish` 或 `./install.sh all`；
  另有 `--list` / `--dry-run` / `--status` / `--uninstall`。
- 因此 `~/.config/<app>`、`~/.pi/...` 往往**本身就是指向本仓库的软链接**：
  改 `~/.config/...` 等于改仓库内文件。改配置请直接改仓库内文件，**不要**新建真实文件去覆盖软链。
- 备份在 `~/.local/state/dotfile/backups/<时间戳>/`。

## 安全红线（务必遵守）

- **绝不**把密钥 / 密码 / token 写进受版本控制的文件。API key 放 `config/fish/conf.d/secrets.fish`（已 gitignore）。
- 已 gitignore、**不要**取消忽略：`home/pi/agent/auth.json`、`models-store.json`、`sessions/`、
  `web-search-cache/`、`npm/`、`git/`、`config/fish/fish_variables`、`**/node_modules/`、`__pycache__`。
- 本仓库**历史上曾把密码写进 `config/hypr/howdy-facial.sh` 并进入了 git 历史**（后来重写过历史）。
  引以为戒：脚本里用 `sudo -n` + 免密 sudoers / 环境变量，绝不硬编码口令。
- matugen/脚本生成的 `config/hypr/colors.conf`、`config/hypr/colors.lua`、`config/waybar/colors.css`
  被忽略；想版本化就删掉 `.gitignore` 里对应行。

## 作用域（子目录的 AGENTS.md）

| 目录 | 内容 |
|---|---|
| `config/quickshell/` | QML shell：主题、顶栏/侧栏模块、自绘托盘菜单 |
| `config/hypr/` | 合成器配置、锁屏 / 人脸（howdy）脚本——**安全敏感** |
| `config/nvim/` | lazy.nvim 配置（`lua/config`、`lua/plugins`） |
| `home/pi/agent/` | pi 的配置 / 扩展 / skills——改动需与 `links.manifest` 同步 |

## 可移植性

- 用户相关路径一律用 `$HOME` / `~/`，**不要写死用户名**。
- 显示器名、壁纸 / 截图目录等本机专属项按机器调整，不保证跨机通用。

## 新增一个 app（标准流程）

1. 内容放进 `config/<app>/`（或 `home/...`）。
2. 在 `links.manifest` 加一行（含新的 target 名）。
3. 更新 `README.md` 的 target 列表 / 结构说明。

## 工具

- 部署 / 查看：`./install.sh <target> [--dry-run|--status]`、`./install.sh --list`。
- 本仓库是 shell / fish / lua / QML 混排；改完用对应语法检查：`bash -n`、`fish -n`、`sh -n`；
  QML 看 quickshell 日志。

## 约定

- 提交信息用中文，前缀 `feat(...)` / `fix(...)` / `chore(...)` / `style(...)`；**相关改动尽量分主题提交**。
- 注释与文档以中文为主。
- 引用配置时**用键名 / 文件路径 / 函数名**，少用行号——行号会腐烂。
