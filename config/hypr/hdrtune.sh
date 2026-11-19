#!/usr/bin/env bash
# 实时调 DP-1 的 HDR SDR 白点
# 用法: ./hdrtune.sh <sdrbrightness> [sdr_min_luminance]
set -e
B=${1:-2.0}
M=${2:-0.2}

SIG=$(hyprctl instances -j | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["instance"])')

HYPRLAND_INSTANCE_SIGNATURE=$SIG hyprctl eval \
  "hl.monitor({output=\"DP-1\", mode=\"3840x2160@144\", position=\"1600x0\", scale=\"1.33\", cm=\"hdr\", bitdepth=10, sdrbrightness=$B, sdr_min_luminance=$M})" >/dev/null

sleep 0.3
HYPRLAND_INSTANCE_SIGNATURE=$SIG hyprctl -j monitors | python3 -c "
import json,sys
for m in json.load(sys.stdin):
    if m['name']=='DP-1':
        print(f\"DP-1  sdrbrightness={m['sdrBrightness']}  sdr_min_luminance={m['sdrMinLuminance']}\")
"
