"""
按显示尺寸重建首页素材（控制主包体积 < 2MB）：
- header-logo.png：透明盾牌，宽 420（Hero 显示约 220rpx，@3x 足够清晰）
- rank-bronze/silver/gold.png：段位徽章，长边 240（胶囊内仅 ~36rpx）
来源为 work/ 下已去底的 flood/cutout 中间稿。
"""
import os
from PIL import Image

WORK = r"C:\Users\lee\Documents\Default Project\ai-debate-arena\work"
IMG = r"C:\Users\lee\Documents\Default Project\ai-debate-arena\miniprogram\images"


def save_resized(src, dst, long_edge, clear_box=None):
    im = Image.open(src).convert("RGBA")
    if clear_box:
        x0, y0, x1, y1 = clear_box
        for y in range(y0, y1):
            for x in range(x0, x1):
                im.putpixel((x, y), (0, 0, 0, 0))
    w, h = im.size
    scale = long_edge / max(w, h)
    nw, nh = round(w * scale), round(h * scale)
    im = im.resize((nw, nh), Image.LANCZOS)
    out = os.path.join(IMG, dst)
    im.save(out, optimize=True)
    print(f"{dst}: {nw}x{nh}, {os.path.getsize(out)/1024:.0f} KB")


# 透明 logo：宽 420
logo = Image.open(os.path.join(WORK, "header-logo-cutout.png")).convert("RGBA")
lw, lh = logo.size
logo = logo.resize((420, round(lh * 420 / lw)), Image.LANCZOS)
logo_path = os.path.join(IMG, "header-logo.png")
logo.save(logo_path, optimize=True)
print(f"header-logo.png: {logo.size[0]}x{logo.size[1]}, {os.path.getsize(logo_path)/1024:.0f} KB")

# 三枚段位徽章：长边 240；gold 右下角水印清除（坐标沿用源图像素空间）
save_resized(os.path.join(WORK, "bronze-flood.png"), "rank-bronze.png", 240)
save_resized(os.path.join(WORK, "silver-flood.png"), "rank-silver.png", 240)
save_resized(os.path.join(WORK, "gold-flood.png"), "rank-gold.png", 240, clear_box=(605, 975, 768, 1024))
