#!/usr/bin/env bash
# Turns the takes under dist/demo/<version>/scenes/ into the two deliverables, with ffmpeg
# only (no browser): taboom-<version>.mp4 — the panel beside the story pane and the Settings
# page, every scene in registry order — and taboom-<version>.gif — the panel alone, the GIF
# clips of the scenes that have one. Reads scenes.json (written by record.ts). Re-runnable on its own:
# `just demo-encode` after a `--scene` retake. `--stills` publishes the stills only (no ffmpeg).
set -euo pipefail

STILLS_ONLY=""
if [[ "${1:-}" == "--stills" ]]; then STILLS_ONLY=1; shift; fi
VERSION="${1:-$(node -p "require('./package.json').version")}"
DIR="${DEMO_DIR:-dist/demo/$VERSION}"   # DEMO_DIR: another take folder (record.ts --out)
MANIFEST="$DIR/scenes.json"

# the copies the docs link to: one name per kind, no version, overwritten by every encode of
# the real take folder (a DEMO_DIR scratch take never lands in the docs unless DEMO_PUBLISH says so)
PUBLISH="${DEMO_PUBLISH:-}"
if [[ -z "$PUBLISH" && -z "${DEMO_DIR:-}" ]]; then PUBLISH="docs/assets/demo"; fi

# the feature stills (stage.still in the scenes) next to the demo, for FEATURES.md and the README
publish_stills() {
  [[ -n "$PUBLISH" ]] || return 0
  if compgen -G "$DIR/features/*.png" > /dev/null; then
    local features
    features="$(dirname "$PUBLISH")/features"
    mkdir -p "$features"
    cp "$DIR"/features/*.png "$features/"
    echo "copied $(ls "$DIR"/features/*.png | wc -l) stills to $features/"
  fi
}

if [[ -n "$STILLS_ONLY" ]]; then publish_stills; exit 0; fi
[[ -f "$MANIFEST" ]] || { echo "no $MANIFEST — run \`just demo\` first" >&2; exit 1; }

# every pane is composed 1:1 at its viewport (demo/browser.ts *_VIEWPORT), PAD around and between
PAD=24
PANEL_W=600; PANEL_H=892   # the 820 px app plus the 72 px caption band (demo/browser.ts CAPTION_BAND)
STORY_W=768; STORY_H=300
SETTINGS_W=768; SETTINGS_H=496
CANVAS_W=$((PAD + PANEL_W + PAD + STORY_W + PAD)); CANVAS_H=$((PAD + PANEL_H + PAD))
FPS=30
GIF_W=480; GIF_FPS=12
BG="0x202124"
declare -A TITLE=([settings]=Settings)
FF=(ffmpeg -hide_banner -loglevel error -y)
DRAWTEXT=$(ffmpeg -hide_banner -filters 2>/dev/null | grep -c " drawtext " || true)

# one stream of one scene → a constant-frame-rate clip; a missing stream becomes a dark tile
encode_stream() { # scene stream width height seconds
  local scene="$1" stream="$2" w="$3" h="$4" secs="$5"
  local list="$DIR/scenes/$scene/$stream.txt" out="$DIR/scenes/$scene/$stream.mp4"
  local label=""
  if [[ -n "${TITLE[$stream]:-}" && "$DRAWTEXT" != "0" ]]; then
    label=",drawtext=text='${TITLE[$stream]}':fontcolor=white:fontsize=16:box=1:boxcolor=black@0.55:boxborderw=6:x=w-tw-14:y=10"
  fi
  if [[ -f "$list" ]]; then
    "${FF[@]}" -f concat -safe 0 -i "$list" \
      -vf "fps=$FPS,scale=$w:$h$label,format=yuv420p" \
      -t "$secs" -c:v libx264 -preset veryfast -crf 20 "$out"
  else
    "${FF[@]}" -f lavfi -i "color=c=$BG:s=${w}x${h}:r=$FPS:d=$secs" -vf "format=yuv420p$label" -c:v libx264 -preset veryfast -crf 20 "$out"
  fi
}

# panel left, the story pane over the Settings page right, padding all round
compose_scene() { # scene seconds
  local scene="$1" secs="$2" dir="$DIR/scenes/$1"
  local rx=$((PAD + PANEL_W + PAD))
  "${FF[@]}" -i "$dir/panel.mp4" -i "$dir/story.mp4" -i "$dir/settings.mp4" \
    -filter_complex "[0][1][2]xstack=inputs=3:layout=${PAD}_${PAD}|${rx}_${PAD}|${rx}_$((PAD + STORY_H + PAD)):fill=$BG:shortest=1,pad=$CANVAS_W:$CANVAS_H:0:0:color=$BG,format=yuv420p" \
    -t "$secs" -r "$FPS" -c:v libx264 -preset veryfast -crf 20 "$dir/scene.mp4"
}

mapfile -t ROWS < <(node -e '
  const m = require(process.argv[1]);
  for (const s of m.scenes) console.log([s.id, (s.durationMs / 1000).toFixed(2), s.gif ? s.gif.join(":") : "-"].join(" "));
' "$(realpath "$MANIFEST")")

CONCAT="$DIR/scenes.txt"; : > "$CONCAT"
GIF_PARTS=()
for row in "${ROWS[@]}"; do
  read -r id secs gif <<< "$row"
  if [[ ! -d "$DIR/scenes/$id" ]]; then echo "skip $id: no take" >&2; continue; fi
  echo "scene $id (${secs}s)"
  encode_stream "$id" panel "$PANEL_W" "$PANEL_H" "$secs"
  encode_stream "$id" story "$STORY_W" "$STORY_H" "$secs"
  encode_stream "$id" settings "$SETTINGS_W" "$SETTINGS_H" "$secs"
  compose_scene "$id" "$secs"
  echo "file 'scenes/$id/scene.mp4'" >> "$CONCAT"
  if [[ "$gif" != "-" ]]; then
    from="${gif%%:*}"; to="${gif##*:}"
    "${FF[@]}" -ss "$from" -to "$to" -i "$DIR/scenes/$id/panel.mp4" -vf "fps=$GIF_FPS,scale=$GIF_W:-2" -c:v libx264 -preset veryfast -crf 18 "$DIR/scenes/$id/gif-part.mp4"
    GIF_PARTS+=("$DIR/scenes/$id/gif-part.mp4")
  fi
done

MP4="$DIR/taboom-$VERSION.mp4"
"${FF[@]}" -f concat -safe 0 -i "$CONCAT" -c copy "$MP4"
echo "wrote $MP4 ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$MP4" | cut -d. -f1) s)"

if (( ${#GIF_PARTS[@]} > 0 )); then
  GIF_LIST="$DIR/gif.txt"; : > "$GIF_LIST"
  for part in "${GIF_PARTS[@]}"; do echo "file '${part#"$DIR/"}'" >> "$GIF_LIST"; done
  GIF="$DIR/taboom-$VERSION.gif"
  "${FF[@]}" -f concat -safe 0 -i "$GIF_LIST" -c copy "$DIR/gif-source.mp4"
  "${FF[@]}" -i "$DIR/gif-source.mp4" -vf "fps=$GIF_FPS,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle" -loop 0 "$GIF"
  echo "wrote $GIF ($(du -h "$GIF" | cut -f1), $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$DIR/gif-source.mp4" | cut -d. -f1) s)"
fi

[[ -n "$PUBLISH" ]] || exit 0
mkdir -p "$PUBLISH"
cp "$MP4" "$PUBLISH/taboom-demo.mp4"
[[ -f "${GIF:-}" ]] && cp "$GIF" "$PUBLISH/taboom-demo.gif"
echo "copied to $PUBLISH/taboom-demo.{mp4,gif}"
publish_stills
