from PIL import Image
import os

work = r"C:\Users\lee\Documents\Default Project\ai-debate-arena\work"
im = Image.open(os.path.join(work, "tab-sprite.png")).convert("RGB")
W, H = im.size
print("sprite size", W, H)

cols, rows = 6, 5
cw, ch = W // cols, H // rows
idx = 0
for r in range(rows):
    for c in range(cols):
        box = (c * cw, r * ch, (c + 1) * cw, (r + 1) * ch)
        cell = im.crop(box)
        # 跳过纯黑/纯色空帧
        small = cell.resize((360, int(360 * ch / cw)))
        extrema = small.convert("L").getextrema()
        if extrema[0] == extrema[1]:
            continue
        idx += 1
        out = os.path.join(work, f"tab-f{idx:02d}.png")
        small.save(out)
        print("saved", out, small.size)
