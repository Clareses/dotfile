#!/bin/fish

echo 'REDACTED' | sudo -S howdy auth

if test $status -eq 0
    echo "SUCCESS"
    pkill -USR1 hyprlock
else
    echo "FAILED"
end

