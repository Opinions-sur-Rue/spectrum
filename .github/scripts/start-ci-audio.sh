#!/usr/bin/env bash
set -euo pipefail

# Isolated per-job server: never changes the host desktop's audio defaults and
# loads no physical capture devices. Firefox Web Audio needs a working output
# even when getUserMedia is replaced by our oscillator-based test fixture.
runtime=${1:?Usage: start-ci-audio.sh PRIVATE_RUNTIME_DIRECTORY}
mkdir -p "$runtime"
chmod 700 "$runtime"
export PULSE_RUNTIME_PATH="$runtime"
export PULSE_SERVER="unix:$runtime/native"

pulseaudio --daemonize=yes --exit-idle-time=-1 --use-pid-file=yes \
  --log-target="file:$runtime/pulse.log" -n \
  --load="module-native-protocol-unix socket=$runtime/native" \
  --load="module-null-sink sink_name=spectrum_ci rate=48000 channels=2"
pactl set-default-sink spectrum_ci
pactl set-default-source spectrum_ci.monitor
pactl list short sinks

if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'PULSE_RUNTIME_PATH=%s\nPULSE_SERVER=%s\n' "$PULSE_RUNTIME_PATH" "$PULSE_SERVER" >> "$GITHUB_ENV"
fi
