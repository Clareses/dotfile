#!/bin/fish
# Face-unlock helper, run from hypridle's on-resume. Waits briefly for hyprlock
# to come up (the lock branch of face-lock.sh starts it after a 3s screenshot
# delay), then runs `howdy auth`; on success it signals hyprlock to unlock.
#
# No password is stored here: passwordless sudo for howdy is expected, e.g.
# /etc/sudoers.d/howdy -> clares ALL=(root) NOPASSWD: /usr/bin/howdy
#
# If hyprlock never appears (e.g. the user was present and face-lock.sh only
# reset the idle timer), this exits without doing anything.

for i in (seq 10)
    if pidof hyprlock >/dev/null
        break
    end
    sleep 0.5
end

if not pidof hyprlock >/dev/null
    exit 0
end

if sudo -n /usr/bin/howdy auth
    echo "SUCCESS"
    pkill -USR1 hyprlock
else
    echo "FAILED"
end
