#!/usr/bin/env python3
"""Generate the HomeTube app icon (1024x1024 PNG) with no dependencies.

Draws a rounded dark square with a play triangle, supersampled 4x for smooth
edges, and writes a PNG using only zlib/struct. Feed the output to
`npx tauri icon app-icon.png` to regenerate the src-tauri icon set.
"""
import struct
import zlib

SIZE = 1024
SUPERSAMPLE = 2  # per axis -> 2048x2048 samples

# Colors (RGBA)
BG = (23, 26, 33, 255)        # shell dark
BG_EDGE = (38, 43, 54, 255)   # subtle border tone
ACCENT = (239, 68, 68, 255)   # hometube red
WHITE = (245, 245, 247, 255)

# Geometry (in final-pixel units)
MARGIN = 96                    # rounded square inset
RADIUS = 200                   # corner radius
# Play triangle (pointing right), slightly optically centered
TRI_LEFT, TRI_RIGHT = 402, 668
TRI_TOP, TRI_BOTTOM = 352, 672


def inside_rounded_rect(x, y):
    x0, y0, x1, y1 = MARGIN, MARGIN, SIZE - MARGIN, SIZE - MARGIN
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + RADIUS), x1 - RADIUS)
    cy = min(max(y, y0 + RADIUS), y1 - RADIUS)
    return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS * RADIUS


def inside_edge_ring(x, y, width=4):
    """Border band just inside the rounded rect edge."""
    if not inside_rounded_rect(x, y):
        return False
    x0, y0, x1, y1 = MARGIN + width, MARGIN + width, SIZE - MARGIN - width, SIZE - MARGIN - width
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + RADIUS), x1 - RADIUS)
    cy = min(max(y, y0 + RADIUS), y1 - RADIUS)
    return (x - cx) ** 2 + (y - cy) ** 2 <= RADIUS * RADIUS


def inside_triangle(x, y):
    """Right-pointing play triangle with vertices (L,T), (L,B), (R,C)."""
    cx = (TRI_TOP + TRI_BOTTOM) / 2
    if not (TRI_LEFT <= x <= TRI_RIGHT):
        return False
    # half-height of the triangle at this x (linear taper to the tip)
    t = (x - TRI_LEFT) / (TRI_RIGHT - TRI_LEFT)
    half = (1 - t) * (TRI_BOTTOM - TRI_TOP) / 2
    return abs(y - cx) <= half


def color_at(x, y):
    if inside_triangle(x, y):
        return WHITE
    if inside_edge_ring(x, y):
        return BG_EDGE
    if inside_rounded_rect(x, y):
        return BG
    return (0, 0, 0, 0)


def render():
    rows = []
    for py in range(SIZE):
        row = bytearray()
        for px in range(SIZE):
            acc = [0, 0, 0, 0]
            for sy in range(SUPERSAMPLE):
                for sx in range(SUPERSAMPLE):
                    x = px + (sx + 0.5) / SUPERSAMPLE
                    y = py + (sy + 0.5) / SUPERSAMPLE
                    c = color_at(x, y)
                    for i in range(4):
                        acc[i] += c[i]
            n = SUPERSAMPLE * SUPERSAMPLE
            row += bytes(v // n for v in acc)
        rows.append(bytes(row))
    return rows


def write_png(path, rows):
    raw = b"".join(b"\x00" + r for r in rows)  # filter byte 0 per scanline

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", SIZE, SIZE, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


if __name__ == "__main__":
    import os
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app-icon.png")
    write_png(out, render())
    print(f"wrote {out} ({SIZE}x{SIZE})")
