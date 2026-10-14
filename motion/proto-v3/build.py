#!/usr/bin/env python3
"""Assemble le son d'un reel et cale les scènes sur la voix off.

Usage : python3 build.py <voix>      (ex. anatole, anna)

- vo/<voix>-<i>.mp3 : une phrase de voix off par scène (silences retirés)
- les scènes durent le temps de leur phrase (avec un minimum pour laisser les animations finir)
- timing.js : les instants de début de scène, lus par index.html
- audio.wav : voix + bruitages ElevenLabs (sfx/el) + musique de fond baissée sous la voix
"""
import json, subprocess, sys

voice = sys.argv[1] if len(sys.argv) > 1 else "anatole"
N = 6
MIN = [2.0, 2.6, 2.7, 2.5, 2.1, 2.2]   # durée minimale de chaque scène (animations)
LEAD, TAIL = 0.12, 0.18                # la voix démarre 0,12 s après le début de scène

def run(args):
    subprocess.run(args, check=True)

def dur(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path],
                         capture_output=True, text=True, check=True).stdout
    return float(out.strip())

# 1. Voix : silences du début et de la fin retirés
d = []
for i in range(N):
    src, out = f"vo/{voice}-{i}.mp3", f"vo/.{voice}-{i}.wav"
    run(["ffmpeg", "-v", "error", "-y", "-i", src, "-af",
         "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse",
         "-ar", "44100", "-ac", "2", out])
    d.append(dur(out))

# 2. Scènes calées sur la voix
T = [0.0]
for i in range(N - 1):
    T.append(round(T[i] + max(MIN[i], LEAD + d[i] + TAIL), 2))
END = round(T[-1] + max(MIN[-1], LEAD + d[-1] + 0.6), 2)
open("timing.js", "w").write(
    "// Généré par build.py : début de chaque scène, calé sur la voix off\n"
    f"window.__PF_T = {json.dumps({'T': T, 'END': END})};\n")

# 3. Bruitages (relatifs au début des scènes), volontairement espacés
cues = [("impact", T[0] + 0.55, 0.55)]
for i in range(1, N):
    cues.append(("whoosh", T[i] - 0.08, 0.45))
cues += [("pop", T[1] + 0.3, 0.35), ("click", T[1] + 0.96, 0.6),
         ("pop", T[2] + 0.3, 0.3), ("pop", T[2] + 1.05, 0.3), ("notif", T[2] + 1.9, 0.6),
         ("pop", T[3] + 0.6, 0.3), ("riser", T[3] + 0.9, 0.35), ("impact", T[3] + 1.45, 0.5),
         ("pop", T[4] + 0.3, 0.3), ("typing", T[4] + 0.6, 0.45), ("typing", T[4] + 1.05, 0.45), ("pop", T[4] + 1.6, 0.35),
         ("impact", T[5] + 0.2, 0.5), ("pop", T[5] + 0.95, 0.4)]

inputs, parts, voice_labels, fx_labels = [], [], [], []
for i in range(N):
    inputs += ["-i", f"vo/.{voice}-{i}.wav"]
    ms = int((T[i] + LEAD) * 1000)
    parts.append(f"[{i}]adelay={ms}|{ms}[v{i}]")
    voice_labels.append(f"[v{i}]")
for j, (name, t, vol) in enumerate(cues):
    k = N + j
    inputs += ["-i", f"sfx/el/{name}.mp3"]
    ms = int(max(0, t) * 1000)
    parts.append(f"[{k}]volume={vol},adelay={ms}|{ms}[f{j}]")
    fx_labels.append(f"[f{j}]")
m = N + len(cues)
inputs += ["-stream_loop", "-1", "-i", "sfx/el/music.mp3"]
parts += [
    f"{''.join(voice_labels)}amix=inputs={N}:normalize=0,apad=whole_dur={END}[vo]",
    "[vo]asplit=2[vomix][key]",
    # Musique : fond discret, encore baissée quand la voix parle, fondu de fin
    f"[{m}]atrim=0:{END},volume=0.22,afade=t=out:st={END - 1.2}:d=1.2[mus]",
    "[mus][key]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350[musd]",
    f"{''.join(fx_labels)}amix=inputs={len(cues)}:normalize=0[fx]",
    # Volume des Reels : environ -14 LUFS (sinon la vidéo paraît plus basse que les autres)
    f"[vomix][musd][fx]amix=inputs=3:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=9,atrim=0:{END}[out]",
]
run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", ";".join(parts), "-map", "[out]", "-ar", "44100", "-ac", "2", "audio.wav"])

# 4. Durée de la composition
html = open("index.html").read()
import re
html = re.sub(r'(id="root"[^>]*data-duration=")[0-9.]+(")', rf"\g<1>{END}\2", html)
html = re.sub(r'(id="audio"[^>]*data-duration=")[0-9.]+(")', rf"\g<1>{END}\2", html)
open("index.html", "w").write(html)
print(f"{voice} : scènes {T}, fin {END} s")
