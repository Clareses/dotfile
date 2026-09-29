#!/bin/fish

while true
    set content (socat TCP-LISTEN:35210,reuseaddr -)
    printf "%s" $content | base64 -d | wl-copy
    echo "loop"
end
