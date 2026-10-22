# config/hypr — 合成器配置 / 锁屏脚本（作用域指令）

根 `../../AGENTS.md` 仍然适用。**这个目录安全敏感**：里面有锁屏和人脸识别的脚本。

## 配置形式（别改错文件）

- Hyprland 0.56 支持 **Lua 配置**（`hl.*` API、`hyprctl eval` / `hyprctl repl`）。
  当前主配置是 `hyprland.lua`——`hypridle.conf` 的 `on-resume` 通过 `touch hyprland.lua` 触发重载，
  说明它被监听、在生效。
- `hyprland.conf` / `hyprland.conf.ini` / `hyprland.laptop.conf` 是更早的 conf 形式，**改之前先确认哪套生效**。
- `colors.conf` / `colors.lua` 由 matugen 生成、被 gitignore；**不要手改**（要版本化才删 `.gitignore` 对应行）。
- 注意文件名：存在 `uitls.lua`（拼写如此）和 `utils.lua` 两个；`hyprland.lua` 里 `require("./uitls.lua")`。
  **不要顺手"修正"这个拼写**，除非同时改掉引用。

## 锁屏 / 人脸（安全红线）

- 流程：`hypridle.conf` 空闲超时 → `on-timeout = sh "$HOME/.config/hypr/face-lock.sh"`。
- `face-lock.sh`：`sudo -n /usr/bin/howdy auth` 成功 → 认为人在，**重置 idle、不上锁**；
  失败 → 跑 `susp.sh` + `grim` 截屏 + `hyprlock`。
- `howdy-facial.sh`：`hyprlock` 上锁后等人脸，成功后通知 `hyprlock` 解锁。
- **绝不硬编码密码**。依赖免密 sudoers：`clares ALL=(root) NOPASSWD: /usr/bin/howdy`
  （本仓库历史上曾把密码写进 `howdy-facial.sh` 并进了 git 历史，后来重写历史。务必避免重演。）
- 改动这些脚本后必须做**语法检查**并确认失败时能安全回退到"上锁"（fail-safe）：
  `sh -n face-lock.sh`、`fish -n howdy-facial.sh`。

## 其它

- 脚本（`changebg`、`copy.sh`、`clipc.sh`、`clipd.sh`、`fresh.sh`、`susp.sh` 等）里的路径一律用 `$HOME`。
- 显示器名、`xkb` 布局等按本机调整。
