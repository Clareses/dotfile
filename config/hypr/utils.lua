local function map(tbl, fn)
    local result = {}
    for i, v in ipairs(tbl) do
        result[i] = fn(v, i)
    end
    return result
end

local function is_edge(direction)
    local active_win = hl.get_active_window()
    if active_win == nil then
        return
    end

    local monitor = active_win.monitor
    if monitor == nil then
        return
    end

    local x = active_win.at.x
    local w = active_win.size.x
    local mx = monitor.x
    local mw = monitor.size.width
    if direction == "l" then
        return x <= 100
    else
        return x + w >= mx + mw - 100
    end
end

function TRY_MOVE(direction, x, y)
    local workspace = hl.get_active_workspace()
    if workspace == nil then
        return
    end
    local all_windows = hl.get_windows()
    local function weq(window)
        return window.workspace == workspace and 1 or 0
    end
    local nr_window = #map(all_windows, weq)
    local function action()
        hl.config({
            general = { col = { active_border = "rgba(595959aa)" } }
        })
        hl.dispatch(hl.dsp.cursor.move({ x = x, y = y }))
    end

    if nr_window == 0 then
        if workspace.id ~= 11 then
            action()
        end
    end

    if is_edge(direction) then
        action()
    else
        hl.dispatch(hl.dsp.focus({ direction = direction }))
    end
end

function SCREEN_CAPTURE_CMD()
    local mon = hl.get_active_workspace().monitor
    if mon == nil then
        return
    end
    local locx = mon.x
    local locy = mon.y
    local mx = mon.size.width
    local my = mon.size.height
    local scale = mon.scale

    local cmd =
        "echo " .. locx .. "," .. locy ..
        " " .. math.floor(mx / scale) .. "x" .. math.floor(my / scale) ..
        " | grim -g - - | " ..
        "satty --filename - " ..
        "--init-tool crop " ..
        "--fullscreen " ..
        "--copy-command wl-copy " ..
        "--output-filename " ..
        "$HOME/Pictures/Screenshots/$(date +%Y-%m-%d-%H-%M-%S).png " ..
        "--early-exit"

    return cmd
end

