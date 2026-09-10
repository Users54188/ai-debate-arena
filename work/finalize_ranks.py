from PIL import Image

WORK = r"C:\Users\lee\Documents\Default Project\ai-debate-arena\work"
IMG = r"C:\Users\lee\Documents\Default Project\ai-debate-arena\miniprogram\images"
LONG_EDGE = 360

def finalize(src_cut, dst_name, clear_box=None):
    im = Image.open(src_cut).convert("RGBA")
    if clear_box:
        x0, y0, x1, y1 = clear_box
        for y in range(y0, y1):
            for x in range(x0, x1):
                im.putpixel((x, y), (0, 0, 0, 0))
    w, h = im.size
    scale = LONG_EDGE / max(w, h)
    nw, nh = round(w * scale), round(h * scale)
    im = im.resize((nw, nh), Image.LANCZOS)
    out = f"{IMG}\\{dst_name}"
    im.save(out, optimize=True)
    import os
    print(f"{dst_name}: {nw}x{nh}, {os.path.getsize(out)/1024:.0f} KB")

# gold watermark at x[630..760] y[988..1016]; clear with margin, only far bottom-right
finalize(WORK + r"\bronze-flood.png", "rank-bronze.png")
finalize(WORK + r"\silver-flood.png", "rank-silver.png")
finalize(WORK + r"\gold-flood.png",   "rank-gold.png", clear_box=(605, 975, 768, 1024))
