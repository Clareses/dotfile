#!/bin/fish

hyprctl eval 'hl.monitor({ output = "HDMI-A-1", disabled = true})'
hyprctl eval 'hl.monitor({ output = "DP-1", disabled = true})'
hyprctl eval 'hl.dispatch(hl.dsp.dpms({action = off, monitor = "eDP-1"}))'

