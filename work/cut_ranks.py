import sys
from collections import deque
from PIL import Image, ImageDraw

WORK = r"C:\Users\lee\Documents\Default Project\ai-debate-arena\work"

def is_light_neutral(r, g, b):
    # bronze/silver: baked checkerboard ~ gray(236-240) / white(252-255), near-neutral & light
    mn, mx = min(r, g, b), max(r, g, b)
    return mn > 214 and (mx - mn) < 24

def is_dark_navy(r, g, b):
    # gold: dark navy background
    mx = max(r, g, b)
    return mx < 78 and b >= r - 6

def remove_bg(src, dst, predicate, edge_clean_iters=3):
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    px = im.load()
    bg = bytearray(w * h)          # 1 = background to remove
    visited = bytearray(w * h)
    dq = deque()

    def seed(x, y):
        i = y * w + x
        r, g, b, a = px[x, y]
        if predicate(r, g, b):
            bg[i] = 1
            dq.append(i)
            visited[i] = 1

    for x in range(w):
        seed(x, 0); seed(x, h - 1)
    for y in range(h):
        seed(0, y); seed(w - 1, y)

    # 8-connected flood
    while dq:
        i = dq.popleft()
        x, y = i % w, i // w
        for dy in (-1, 0, 1):
            ny = y + dy
            if ny < 0 or ny >= h:
                continue
            row = ny * w
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                nx = x + dx
                if nx < 0 or nx >= w:
                    continue
                ni = row + nx
                if visited[ni]:
                    continue
                visited[ni] = 1
                r, g, b, a = px[nx, ny]
                if predicate(r, g, b):
                    bg[ni] = 1
                    dq.append(ni)

    # extra passes: remove predicate-matching pixels adjacent to already-removed bg
    # (cleans checker white squares that only touch the gray lattice at corners)
    for _ in range(edge_clean_iters):
        added = 0
        for y in range(h):
            for x in range(w):
                i = y * w + x
                if bg[i]:
                    continue
                r, g, b, a = px[x, y]
                if not predicate(r, g, b):
                    continue
                touch = False
                for dy in (-1, 0, 1):
                    ny = y + dy
                    if 0 <= ny < h:
                        for dx in (-1, 0, 1):
                            nx = x + dx
                            if 0 <= nx < w and bg[ny * w + nx]:
                                touch = True
                if touch:
                    bg[i] = 1
                    added += 1
        if added == 0:
            break

    out = im.copy()
    op = out.load()
    removed = 0
    for y in range(h):
        for x in range(w):
            i = y * w + x
            if bg[i]:
                op[x, y] = (0, 0, 0, 0)
                removed += 1
    out.save(dst)

    # dark preview composite
    prev = Image.new("RGBA", (w, h), (20, 16, 42, 255))
    prev.alpha_composite(out)
    prev.convert("RGB").save(dst.replace(".png", "-preview.png"))
    print(f"{dst.split(chr(92))[-1]}: {w}x{h}, removed {removed} ({removed/(w*h):.1%})")

jobs = [
    (r"C:\Users\lee\CrossDevice\荣耀Magic8 Pro\storage\Pictures\WeiXin\mmexport1788281027654.jpg",
     WORK + r"\bronze-flood.png", is_light_neutral),
    (r"C:\Users\lee\CrossDevice\荣耀Magic8 Pro\storage\Pictures\WeiXin\mmexport1788281026481.jpg",
     WORK + r"\silver-flood.png", is_light_neutral),
    (r"C:\Users\lee\CrossDevice\荣耀Magic8 Pro\storage\Pictures\WeiXin\mmexport1788281029840.jpg",
     WORK + r"\gold-flood.png", is_dark_navy),
]
for s, d, p in jobs:
    remove_bg(s, d, p)
