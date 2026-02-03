from PIL import Image
import os
import sys

FILES = [
    "toad_idle_right_v1.png",
    "toad_jump_right_v1.png",
    "toad_land_right_v1.png",
    "toad_cashout_right_v1.png",
    "toad_jackpot_right_v1.png",
    "toad_dead_right_v1.png",
]

# Root-independent repo path resolution
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ROOT = os.path.join(REPO_ROOT, "public", "lilypad-leap", "sprites", "toad", "sheets", "v1")

# Hard-locked spec
SHEET_W, SHEET_H = 1024, 256
FRAMES = 4
FRAME_W, FRAME_H = SHEET_W // FRAMES, SHEET_H

def check(path: str) -> str:
    img = Image.open(path).convert("RGBA")
    w, h = img.size

    if (w, h) != (SHEET_W, SHEET_H):
        return f"FAIL wrong size {w}x{h} (expected {SHEET_W}x{SHEET_H})"

    if w % FRAMES != 0:
        return f"FAIL width not divisible by {FRAMES}: {w}x{h}"

    # Transparency check: require at least 1% fully transparent pixels
    a = img.getchannel("A")
    alpha0 = sum(1 for px in a.get_flattened_data() if px == 0)
    total = w * h
    pct = alpha0 / total

    if pct < 0.01:
        return f"FAIL no real transparency (alpha0={pct:.4%})"

    return f"OK size={w}x{h} alpha0={pct:.2%} frame={FRAME_W}x{FRAME_H}"

def main() -> None:
    ok = True
    print(f"Repo root: {REPO_ROOT}")
    print(f"Sprite root: {ROOT}")
    print("-" * 70)

    for f in FILES:
        p = os.path.join(ROOT, f)
        if not os.path.exists(p):
            print("MISSING", f)
            ok = False
            continue

        res = check(p)
        print(f"{f}: {res}")
        if res.startswith("FAIL"):
            ok = False

    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
