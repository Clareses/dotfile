set wid (hyprctl activeworkspace -j | jq '.id')
set nr_w (hyprctl clients | grep "workspace: $wid " | grep -v "Window" | grep -v "title" | wc -l)

if test $nr_w -eq 0
    hyprctl keyword general:col.active_border rgba\(595959aa\)
    hyprctl dispatch movecursor -100 1000
    return
end


if is_edge_window left
    hyprctl keyword general:col.active_border rgba\(595959aa\)
    hyprctl dispatch movecursor -100 1000
else
    hyprctl dispatch movefocus left
end
