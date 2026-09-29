hyprctl dispatch workspace special:magic;
hyprctl dispatch killactive;
sleep 0.1;
hyprctl dispatch workspace special:magic;
hyprctl dispatch exec kitty;
sleep 0.3;
hyprctl dispatch togglespecialworkspace magic;
