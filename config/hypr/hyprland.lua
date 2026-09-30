require("./uitls.lua")

----------------------- Cursor --------------------------

hl.env("XCURSOR_THEME", "breeze_cursors")
hl.env("XCURSOR_SIZE", "28")
-- hl.env("HYPRCURSOR_THEME", "breeze_cursors")
-- hl.env("HYPRCURSOR_SIZE", "30")

----------------------- Auto Start --------------------------

hl.on("hyprland.start", function()
    hl.exec_cmd("fcitx5")
    hl.exec_cmd("hyprsunset -t 8000")
    hl.exec_cmd("awww-daemon")
    -- quickshell is a Qt6 app: force the fcitx5 Qt (DBus) plugin for it.
    -- Without QT_IM_MODULE, Qt6's built-in Wayland input context registers NO
    -- input context with fcitx5 for the sidebar's layer surface, so the IME
    -- cannot work there at all. The DBus plugin registers focus correctly.
    hl.exec_cmd("~/.config/hypr/changebg & QT_IM_MODULE=fcitx XMODIFIERS=@im=fcitx qs -d -n & swaync")
    hl.exec_cmd("hyprctl setcursor breeze_cursors 28")
    hl.exec_cmd("pulseaudio -k && pulseaudio --start")
    hl.exec_cmd("clash-verge")
    hl.exec_cmd("xrdb -merge ~/.Xresources")
    hl.exec_cmd("/usr/lib/polkit-gnome/polkit-gnome-authentication-agent-1")
    hl.exec_cmd("dbus-update-activation-environment --systemd WAYLAND_DISPLAY XDG_CURRENT_DESKTOP")
end)

----------------------- Configs --------------------------


local misc = {
    key_press_enables_dpms = false,
    mouse_move_enables_dpms = true,
}

local input = {
    kb_layout = "us",
    -- kb_file = "$HOME/.config/hypr/xkb/us-custom.xkb",
    touchpad = {
        natural_scroll = true,
        disable_while_typing = true,
        scroll_factor = 1,
    },
    sensitivity = 0,
}

local general = {
    gaps_in = 3,
    gaps_out = 6,
    border_size = 5,
    col = {
        active_border = {
            colors = { "rgba(33ccffee)", "rgba(00ff99ee)" },
            angle = 45
        },
        inactive_border = "rgba(595959aa)"
    },
    layout = "dwindle"
}

local decoration = {
    rounding = 10,
    shadow = {
        enabled = true,
        range = 4,
        render_power = 3,
        color = "rgba(1a1a1aee)"
    },
    blur = {
        enabled = true,
        size = 6,
        passes = 4,
        new_optimizations = true,
        ignore_opacity = true,
    },
    -- inactive_opacity = 0.85
}

local xwayland = { force_zero_scaling = true }
local dwindle = { preserve_split = true }
local animations = { enabled = true }

hl.curve("myBezier", { type = "bezier", points = { { 0.05, 0.9 }, { 0.1, 1.05 } } })
hl.animation({ leaf = "windows", enabled = true, speed = 7, bezier = "myBezier" })
hl.animation({ leaf = "windowsOut", enabled = true, speed = 7, bezier = "default", style = "popin 80%" })
hl.animation({ leaf = "border", enabled = true, speed = 10, bezier = "default" })
hl.animation({ leaf = "borderangle", enabled = true, speed = 8, bezier = "default" })
hl.animation({ leaf = "fade", enabled = true, speed = 7, bezier = "default" })
hl.animation({ leaf = "workspaces", enabled = true, speed = 6, bezier = "default" })

-- per-layer animation: only the swaync control center slides in from the left;
-- every other layer keeps the global (fade) animation.
hl.layer_rule({ match = { namespace = "swaync-control-center" }, animation = "slide left" })


hl.config({
    general = general,
    xwayland = xwayland,
    animations = animations,
    dwindle = dwindle,
    misc = misc,
    input = input,
    decoration = decoration
})


----------------------- Key Bindings --------------------------

local mainMod = "ALT + "
local exec = hl.dsp.exec_cmd
local win = hl.dsp.window
local bind = hl.bind

-- Keybinding for window action
bind(mainMod .. "SHIFT + Q", win.close())
bind(mainMod .. "SHIFT + SPACE", win.float({ action = "toggle" }))
bind(mainMod .. "f", win.fullscreen({ action = "toggle" }))

-- bind(mainMod .. "l", function()
--     hl.dispatch(exec("touch ~/.from_window"))
--     TRY_MOVE("r", 7000, 1000)
-- end)
bind(mainMod .. "l", hl.dsp.focus({ direction = "r" }))
bind(mainMod .. "h", hl.dsp.focus({ direction = "l" }))
bind(mainMod .. "k", hl.dsp.focus({ direction = "u" }))
bind(mainMod .. "j", hl.dsp.focus({ direction = "d" }))
bind(mainMod .. "SHIFT + h", win.move({ direction = "l" }))
bind(mainMod .. "SHIFT + l", win.move({ direction = "r" }))
bind(mainMod .. "SHIFT + k", win.move({ direction = "u" }))
bind(mainMod .. "SHIFT + j", win.move({ direction = "d" }))

-- workspace bindings and settings
for i = 1, 10, 1 do
    hl.workspace_rule({ workspace = "0" .. tostring(i), monitor = "HDMI-A-1" })
    hl.workspace_rule({ workspace = "1" .. tostring(i), monitor = "DP-2" })
    local key = i
    if i == 10 then key = 0 end

    bind(mainMod .. "+ " .. key, function()
        local wstr = tostring(i)
        if hl.get_active_monitor().name == "DP-2" then
            if i == 10 then wstr = "20" else wstr = "1" .. wstr end
        else
            wstr = "0" .. wstr
        end
        hl.dispatch(hl.dsp.focus({ workspace = wstr }))
    end)

    bind(mainMod .. "+ SHIFT + " .. key, function()
        local wstr = tostring(i)
        if hl.get_active_monitor().name == "DP-2" then
            if i == 10 then wstr = "20" else wstr = "1" .. wstr end
        else
            wstr = "0" .. wstr
        end
        hl.dispatch(win.move({ workspace = wstr }))
    end)
end
hl.workspace_rule({ workspace = "20", monitor = "DP-2" })
hl.workspace_rule({ workspace = "21", monitor = "eDP-1", persistent = true })
bind(mainMod .. "+ BACKSPACE", hl.dsp.focus({ workspace = "21" }))
bind(mainMod .. "+ SHIFT + BACKSPACE", win.move({ workspace = "21" }))
bind(mainMod .. "mouse:272", win.drag())
bind(mainMod .. "mouse:273", win.resize())

-- keybinding for applications
bind(mainMod .. "return", exec("/bin/kitty fish"))
bind(mainMod .. "d", exec("env -u XMODIFIERS -u GTK_IM_MODULE -u QT_IM_MODULE rofi -show drun"))
bind(mainMod .. "w", exec("env -u XMODIFIERS -u GTK_IM_MODULE -u QT_IM_MODULE rofi -show window"))
bind(mainMod .. "e", exec("env -u XMODIFIERS -u GTK_IM_MODULE -u QT_IM_MODULE rofi -show run"))

-- Wallpaper (ML4W / quickshell + awww)
-- bind(mainMod .. "SHIFT + W", exec("~/.config/ml4w/scripts/ml4w-wallpaper-app --random"), { description = "Random wallpaper" })
bind(mainMod .. "CTRL + W", exec("~/.config/ml4w/scripts/ml4w-wallpaper-app"), { description = "Wallpaper selector" })
bind(mainMod .. "CTRL + SHIFT + W", exec("~/.config/ml4w/scripts/ml4w-wallpaper-automation"),
    { description = "Toggle wallpaper automation" })

-- Notification center (swaync)
bind(mainMod .. "c", exec("swaync-client -t -sw"), { description = "Toggle notification center" })

-- ML4W sidebar (quickshell)
bind(mainMod .. "b", exec("qs ipc call sidebar toggle"), { description = "Toggle ML4W sidebar" })

-- Todo list + sticky notes popup (quickshell)
bind(mainMod .. "t", exec("qs ipc call todo toggle"), { description = "Toggle todo & sticky notes" })
bind(mainMod .. "u", function()
    local monitors = hl.get_monitors()
    local cmd = ""
    for i, mon in pairs(monitors) do
        local locx = mon.x
        local locy = mon.y
        local mx = mon.size.width
        local my = mon.size.height
        local scale = mon.scale
        cmd = cmd .. "grim -g \"" ..
            locx ..
            "," ..
            locy ..
            " " ..
            math.floor(mx / scale) ..
            "x" .. math.floor(my / scale) .. "\" ~/pictures/screenlock" .. tostring(i) .. ".png && "
    end
    hl.dispatch(exec(cmd .. "hyprlock"))
end)
bind(mainMod .. "XF86AudioRaiseVolume", exec("pactl set-sink-volume @DEFAULT_SINK@ +0.5%"))
bind(mainMod .. "XF86AudioLowerVolume", exec("pactl set-sink-volume @DEFAULT_SINK@ -0.5%"))
bind(mainMod .. "XF86AudioMute", exec("pactl set-sink-mute @DEFAULT_SINK@ toggle"))
bind(mainMod .. "CTRL + A", function()
    local cmd = SCREEN_CAPTURE_CMD()
    hl.dispatch(exec(cmd))
end)


bind(mainMod .. "CTRL + left", exec([[echo '{ "op": "prev" }' | websocat ws://127.0.0.1:14558/ws]]))
bind(mainMod .. "CTRL + right", exec([[echo '{ "op": "next" }' | websocat ws://127.0.0.1:14558/ws]]))
bind(mainMod .. "CTRL + space", exec([[
fish -c '
if curl -s http://127.0.0.1:14558/api/status | grep -q pause
    echo "{\"op\":\"play\"}" | websocat ws://127.0.0.1:14558/ws
else
    echo "{\"op\":\"pause\"}" | websocat ws://127.0.0.1:14558/ws
end
'
]]))

----------------------- window rules --------------------------
hl.window_rule({
    name = "for-splayer",
    match = {
        title = ".*SPlayer-Next - Desktop Lyric.*"
    },
    border_size = 0,
    no_blur = true,
    no_shadow = true,
    pin = true,
    float = true,
    size = { 2560, 0 },
    move = { 0, 68 },
    no_focus = true,
})

hl.window_rule({
    name = "for-dynamic",
    match = {
        title = ".*Dynamic Island.*"
    },
    border_size = 0,
    no_blur = true,
    no_shadow = true,
    pin = true,
    float = true,
    size = { 2560, 0 },
    move = { -600, 20 },
    no_focus = true,
    max_size = { 0, 0 },
})

hl.window_rule({
    name = "for-bilibili",
    match = {
        title = ".*Picture-in-Picture.*"
    },
    border_size = 0,
    no_blur = true,
    no_shadow = true,
    pin = true,
    float = true,
    size = { 595, 350 },
    move = { 1950, 55 },
    no_focus = false
})

-- hl.window_rule({
--     name = "for-nsys",
--     match = {
--         class = ".*devtools.nvidia.com.nsys-ui.*"
--     },
-- })

---------------------- moniors ----------------------------
hl.monitor({
    output = "eDP-1",
    mode = "2560x1600@120.00",
    position = "0x0",
    scale = "1.6",
})
hl.monitor({
    output = "HDMI-A-1",
    mode = "2560x1440@144.00",
    position = "1600x0",
    scale = "1.0",
})
hl.monitor({
    output = "DP-2",
    mode = "2560x1440@75",
    scale = "1.07",
    position = "4160x0"
})
