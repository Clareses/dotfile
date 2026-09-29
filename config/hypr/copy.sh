#!/bin/fish

set cur_win (hyprctl activewindow | grep title)
set cur_cls (hyprctl activewindow | grep class)

if string match -q "*vim*" $cur_win
    set sentence (wtype "\"+y" && sleep 0.05 && wl-paste)
else if string match -q "*kitty*" $cur_cls
    set sentence (wtype -M ctrl -M shift -k c -m shift -m ctrl && sleep 0.02 && wl-paste)
else if string match -q "*okular*" $cur_cls
    set sentence (wtype -M ctrl -k insert -m ctrl && sleep 0.02 && wl-paste)
else
    set sentence (wtype -M ctrl -k c -m ctrl && sleep 0.02 && wl-paste)
end


curl "localhost:60828/input_translate"
# -d "$sentence"
