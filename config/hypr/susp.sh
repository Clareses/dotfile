#!/bin/fish

hyprctl eval 'hl.monitor({ output = "HDMI-A-1", disabled = true})'
hyprctl eval 'hl.dispatch(hl.dsp.dpms({action = off, monitor = "eDP-1"}))'
hyprctl eval 'hl.dispatch(hl.dsp.dpms({action = off, monitor = "DP-1"}))'

