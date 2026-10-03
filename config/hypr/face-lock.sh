#!/bin/sh
# hypridle on-timeout handler: lock only when you are actually away.
#
# `howdy auth` checks the camera for a known face. Exit 0 means you are at the
# machine: instead of locking, we nudge the pointer with ydotool so Hyprland
# sees input activity and hypridle restarts its idle timer (it will re-check in
# another `timeout` seconds). Otherwise we take the lock screenshot, start
# hyprlock, and run susp.sh (turn the external monitors and DPMS off).
#
# Requires a passwordless sudo rule for howdy, e.g. /etc/sudoers.d/howdy:
#   clares ALL=(root) NOPASSWD: /usr/bin/howdy
# so this script never has to store a password.
#
# Called from hypridle.conf as:
#   on-timeout = sh "$HOME/.config/hypr/face-lock.sh"

# Camera check. -n: never prompt for a password; if the sudo rule is missing
# this fails and we fall through to locking (the safe default).
if sudo -n /usr/bin/howdy auth >/dev/null 2>&1; then
    # Present: emit a tiny real input event (1px out and back) to reset the
    # idle timer without visibly disturbing the cursor.
    ydotool mousemove -- 1 1
    sleep 0.05
    ydotool mousemove -- -1 -1
else
    # Away: same routine as before.
    fish "$HOME/.config/hypr/susp.sh" &
    grim -g "1600,0 2560x1440" "$HOME/pictures/screenlock.png" && sleep 3 && hyprlock &
fi
