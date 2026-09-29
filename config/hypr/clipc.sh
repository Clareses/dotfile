#!/usr/bin/fish

set old ""

while true
    set new (wl-paste)

    if test "$new" != "$old"
        set old "$new"
        printf "%s" "$new"
        # printf "%s" "$new" | base64 | socat - TCP:200.200.200.2:35210
    end

    sleep 1

end
