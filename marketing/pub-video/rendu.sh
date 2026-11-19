#!/usr/bin/env bash
# Rend les 4 vidéos de la pub dans out/.
# Option : REMOTION_BROWSER=/chemin/vers/chrome-headless-shell pour utiliser un navigateur déjà installé.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p out
BR=()
[ -n "${REMOTION_BROWSER:-}" ] && BR=(--browser-executable="$REMOTION_BROWSER")
for c in PubV:kayely-reseaux-9x16 Pub45:kayely-reseaux-4x5 PubH:kayely-reseaux-16x9; do
  npx remotion render src/index.ts "${c%%:*}" "out/${c##*:}.mp4" --crf=18 --overwrite "${BR[@]}"
done
# Version 15 s : intro + produit + écran de fin, avec la bande-son raccourcie
ffmpeg -loglevel error -y -i out/kayely-reseaux-9x16.mp4 -i audio/mix15.m4a -filter_complex \
  "[0:v]trim=0:4.3,setpts=PTS-STARTPTS[a];[0:v]trim=9.4:15.2,setpts=PTS-STARTPTS[b];[0:v]trim=27.3:32,setpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=1:a=0[v]" \
  -map "[v]" -map 1:a -c:v libx264 -crf 18 -pix_fmt yuv420p -c:a aac -b:a 192k -movflags +faststart -shortest \
  out/kayely-reseaux-15s-9x16.mp4
ls -la out/
