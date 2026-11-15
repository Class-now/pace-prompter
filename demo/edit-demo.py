"""Ma デモの編集: 無音化・待ちを早回し・下帯に字幕・冒頭タイトル。"""
import subprocess, sys
SRC = "C:/For Claude/pace-prompter/out/demo-raw.mkv"
OUT = sys.argv[1]
FONT = "C\\:/Windows/Fonts/arial.ttf"
FONTB = "C\\:/Windows/Fonts/arialbd.ttf"
W, H, BAR = 1264, 760, 84

def esc(t):
    return t.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\u2019").replace(",", "\\,").replace("%", "\\%")

def dt(text, start=None, end=None, y=None, size=26, font=FONT, color="white"):
    y = y if y is not None else f"{H}+({BAR}-text_h)/2"
    en = f":enable='between(t,{start},{end})'" if start is not None else ""
    return f"drawtext=fontfile='{font}':text='{esc(text)}':fontcolor={color}:fontsize={size}:x=(w-text_w)/2:y={y}{en}"

# (src_start, src_end, speed, [(caption, t0, t1) in segment-output time])
SEGS = [
    (15, 21, 1, [("1. Paste your talk and opt in. Camera only; Ma stores and uploads no video.", 0, 99)]),
    (21, 52, 5, [("2. Sit still for 30 s while Ma learns your calm pulse and breathing (5x speed).", 0, 99)]),
    (52, 78, 1, [("3. Read one line at a time, Space for the next. Live pulse and breathing: top right.", 0, 99)]),
    (78, 87, 1, [("Breathing ran 5+ breaths/min above your own reference: Ma holds the next line.", 0, 99)]),
    (87, 95, 1, [("One slow breath seen in the chest trace (left), so the next line comes back.", 0, 99)]),
    (95, 101, 1, [("Again the body ran ahead of the words, so Ma waits for one breath.", 0, 99)]),
    (101, 111, 1, [("3. Read one line at a time, Space for the next. Live pulse and breathing: top right.", 0, 99)]),
    (111, 114, 1, [("A third breath pause.", 0, 99)]),
    (114, 128, 1, [("Last lines, then Esc ends the run.", 0, 99)]),
    (128, 144.5, 1, [("4. Review: pulse vs your reference, talking, blinks and breath pauses per line.", 0, 99)]),
]

parts, labels = [], []
# タイトル（4 秒）
title = ",".join([
    f"color=c=0xF2EEE6:s={W}x{H+BAR}:r=30:d=4",
    dt("Ma", y="h/2-150", size=96, font=FONTB, color="0x2B2620"),
    dt("a rehearsal prompter that waits for you to breathe", y="h/2-30", size=40, color="0x2B2620"),
    dt("Built on the Presage SmartSpectra SDK", y="h/2+40", size=30, color="0x6B6358"),
    dt("Real run with a live webcam. Face blurred by Ma's preview option. No sound.", y="h/2+100", size=24, color="0x6B6358"),
    "format=yuv420p,setsar=1",
])
parts.append(title + "[v0]"); labels.append("[v0]")
for i, (a, b, sp, caps) in enumerate(SEGS, 1):
    f = [f"[0:v]trim={a}:{b}", f"setpts=(PTS-STARTPTS)/{sp}", "fps=30", f"pad={W}:{H+BAR}:0:0:color=0x1E1B17"]
    for c, t0, t1 in caps:
        f.append(dt(c, t0, t1, size=24))
    f += ["format=yuv420p", "setsar=1"]
    parts.append(",".join(f) + f"[v{i}]"); labels.append(f"[v{i}]")
n = len(labels)
parts.append("".join(labels) + f"concat=n={n}:v=1:a=0,fade=t=out:st=0:d=0[vc]")
fc = ";\n".join(parts)
cmd = ["ffmpeg", "-v", "error", "-y", "-i", SRC, "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
       "-filter_complex", fc.replace(",fade=t=out:st=0:d=0", ""), "-map", "[vc]", "-map", "1:a", "-shortest",
       "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", OUT]
r = subprocess.run(cmd)
sys.exit(r.returncode)
