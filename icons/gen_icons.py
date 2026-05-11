#!/usr/bin/env python3
"""
临时占位图标生成脚本。
无需第三方依赖，直接用 stdlib 输出 PNG。
图标设计：圆角方形 #1a1532 背景 + 居中白色"弓"字 + 一抹琥珀色高光弧。

后续替换为正式美术素材后，本脚本可以删除。
用法：python3 icons/gen_icons.py
输出：icons/icon-180.png, icons/icon-192.png, icons/icon-512.png, icons/icon-1024.png, icons/icon-maskable-512.png
"""
import os
import struct
import zlib
import math

OUT_DIR = os.path.dirname(os.path.abspath(__file__))

# 主题色（与 #game-wrapper 背景一致）
BG = (0x1a, 0x15, 0x32)      # 深紫
ACCENT = (0xff, 0xb8, 0x6b)  # 琥珀色高光
FG = (0xff, 0xff, 0xff)      # 白色


def lerp(a, b, t):
    return a + (b - a) * t


def lerp_color(c1, c2, t):
    return tuple(int(round(lerp(c1[i], c2[i], t))) for i in range(3))


def draw_icon(size, rounded=True, safe_zone_padding=0):
    """返回 size×size 像素的 RGBA bytearray。"""
    # 创建透明背景
    px = bytearray(size * size * 4)

    # 圆角半径（占图标 22%，maskable 时取整）
    if rounded:
        radius = int(size * 0.22)
    else:
        radius = 0

    # 渐变背景：从顶部稍亮过渡到底部 BG
    BG_TOP = (0x2a, 0x20, 0x4a)
    BG_BOT = BG

    cx, cy = size / 2.0, size / 2.0

    # 弓的几何参数（以图标中心为原点）
    bow_radius = size * 0.32          # 弓身半径
    bow_thickness = max(2, size * 0.06)  # 弓身线宽
    bow_inner = bow_radius - bow_thickness
    # 弓只画左侧约 220° 弧（视觉上类似 ")"，但稍微夸张以便辨识）
    bow_start_deg = 215  # 起始角度（屏幕坐标系，0° 向右，正向顺时针）
    bow_end_deg = 145    # 结束角度（注意需要跨越 0/360）

    # 弓弦：从弓两端连一条直线
    bs_rad = math.radians(bow_start_deg)
    be_rad = math.radians(bow_end_deg)
    string_x1 = cx + bow_radius * math.cos(bs_rad)
    string_y1 = cy + bow_radius * math.sin(bs_rad)
    string_x2 = cx + bow_radius * math.cos(be_rad)
    string_y2 = cy + bow_radius * math.sin(be_rad)
    string_thickness = max(1, size * 0.012)

    # 箭：从弓中心向右上方射出
    arrow_angle = math.radians(-25)   # 略向上倾
    arrow_length = size * 0.46
    arrow_thickness = max(2, size * 0.045)
    arrow_start_offset = size * 0.04  # 起点在中心稍后
    arrow_x0 = cx - math.cos(arrow_angle) * arrow_start_offset
    arrow_y0 = cy - math.sin(arrow_angle) * arrow_start_offset
    arrow_x1 = cx + math.cos(arrow_angle) * arrow_length
    arrow_y1 = cy + math.sin(arrow_angle) * arrow_length

    # 箭头三角
    arrowhead_len = size * 0.08
    arrowhead_wid = size * 0.06

    def in_rounded_rect(x, y):
        """是否在圆角矩形内（应用 safe-zone padding 之后）"""
        pad = safe_zone_padding
        if x < pad or y < pad or x >= size - pad or y >= size - pad:
            return False
        # 距离四个角
        local_r = max(0, radius - pad)
        if local_r <= 0:
            return True
        # 检测在哪个角象限
        dx, dy = 0, 0
        if x < pad + local_r:
            dx = pad + local_r - x
        elif x > size - pad - local_r:
            dx = x - (size - pad - local_r)
        if y < pad + local_r:
            dy = pad + local_r - y
        elif y > size - pad - local_r:
            dy = y - (size - pad - local_r)
        return dx * dx + dy * dy <= local_r * local_r

    def dist_point_segment(px_, py_, x1, y1, x2, y2):
        dx = x2 - x1
        dy = y2 - y1
        if dx == 0 and dy == 0:
            return math.hypot(px_ - x1, py_ - y1)
        t = ((px_ - x1) * dx + (py_ - y1) * dy) / (dx * dx + dy * dy)
        t = max(0, min(1, t))
        nx = x1 + t * dx
        ny = y1 + t * dy
        return math.hypot(px_ - nx, py_ - ny)

    def point_in_triangle(px_, py_, ax, ay, bx, by, cxx, cyy):
        d1 = (px_ - bx) * (ay - by) - (ax - bx) * (py_ - by)
        d2 = (px_ - cxx) * (by - cyy) - (bx - cxx) * (py_ - cyy)
        d3 = (px_ - ax) * (cyy - ay) - (cxx - ax) * (py_ - ay)
        has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
        has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
        return not (has_neg and has_pos)

    # 箭头三个顶点
    head_tip_x = arrow_x1 + math.cos(arrow_angle) * arrowhead_len
    head_tip_y = arrow_y1 + math.sin(arrow_angle) * arrowhead_len
    perp_x = -math.sin(arrow_angle)
    perp_y = math.cos(arrow_angle)
    head_b_x = arrow_x1 + perp_x * arrowhead_wid
    head_b_y = arrow_y1 + perp_y * arrowhead_wid
    head_c_x = arrow_x1 - perp_x * arrowhead_wid
    head_c_y = arrow_y1 - perp_y * arrowhead_wid

    # 箭尾羽毛（两片三角形）
    fletch_x = arrow_x0 - math.cos(arrow_angle) * (size * 0.03)
    fletch_y = arrow_y0 - math.sin(arrow_angle) * (size * 0.03)
    fletch_len = size * 0.07
    fletch_wid = size * 0.05
    f_tail_x = fletch_x - math.cos(arrow_angle) * fletch_len
    f_tail_y = fletch_y - math.sin(arrow_angle) * fletch_len
    f_a_x = fletch_x + perp_x * fletch_wid * 0.4
    f_a_y = fletch_y + perp_y * fletch_wid * 0.4
    f_b_x = fletch_x - perp_x * fletch_wid * 0.4
    f_b_y = fletch_y - perp_y * fletch_wid * 0.4

    for y in range(size):
        for x in range(size):
            idx = (y * size + x) * 4
            if not in_rounded_rect(x + 0.5, y + 0.5):
                # 透明外部
                continue

            # 1) 渐变背景
            t = y / (size - 1) if size > 1 else 0
            bg = lerp_color(BG_TOP, BG_BOT, t)
            r, g, b = bg

            # 2) 弓身（圆环，仅在指定角度区间内）
            dx = (x + 0.5) - cx
            dy = (y + 0.5) - cy
            d = math.hypot(dx, dy)
            if bow_inner - 0.5 <= d <= bow_radius + 0.5:
                ang = math.degrees(math.atan2(dy, dx)) % 360
                # 区间：215° → (穿过 360 / 0) → 145°
                in_arc = (ang >= bow_start_deg) or (ang <= bow_end_deg)
                if in_arc:
                    # 软边缘
                    edge = min(d - bow_inner, bow_radius - d)
                    alpha = max(0, min(1, edge + 0.5))
                    r = int(lerp(r, ACCENT[0], alpha))
                    g = int(lerp(g, ACCENT[1], alpha))
                    b = int(lerp(b, ACCENT[2], alpha))

            # 3) 弓弦（白色细线）
            ds = dist_point_segment(x + 0.5, y + 0.5, string_x1, string_y1, string_x2, string_y2)
            if ds <= string_thickness:
                alpha = max(0, min(1, string_thickness - ds + 0.5))
                r = int(lerp(r, 255, alpha * 0.85))
                g = int(lerp(g, 255, alpha * 0.85))
                b = int(lerp(b, 255, alpha * 0.85))

            # 4) 箭杆（白色粗线）
            da = dist_point_segment(x + 0.5, y + 0.5, arrow_x0, arrow_y0, arrow_x1, arrow_y1)
            if da <= arrow_thickness * 0.5:
                alpha = max(0, min(1, arrow_thickness * 0.5 - da + 0.5))
                r = int(lerp(r, FG[0], alpha))
                g = int(lerp(g, FG[1], alpha))
                b = int(lerp(b, FG[2], alpha))

            # 5) 箭头三角
            if point_in_triangle(x + 0.5, y + 0.5, head_tip_x, head_tip_y, head_b_x, head_b_y, head_c_x, head_c_y):
                r, g, b = ACCENT

            # 6) 箭尾羽毛
            if point_in_triangle(x + 0.5, y + 0.5, f_a_x, f_a_y, f_b_x, f_b_y, f_tail_x, f_tail_y):
                r, g, b = ACCENT

            px[idx] = r
            px[idx + 1] = g
            px[idx + 2] = b
            px[idx + 3] = 255

    return bytes(px)


def save_png(path, width, height, rgba):
    """写一个最小可用的 PNG（RGBA, 8-bit, 无 interlace）。"""
    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)

    # 加每行的 filter byte (0 = None)
    stride = width * 4
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(rgba[y * stride:(y + 1) * stride])
    compressed = zlib.compress(bytes(raw), 9)

    with open(path, "wb") as f:
        f.write(sig)
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", compressed))
        f.write(chunk(b"IEND", b""))


def main():
    sizes = [
        ("icon-180.png", 180, True, 0),
        ("icon-192.png", 192, True, 0),
        ("icon-512.png", 512, True, 0),
        # maskable: 内容必须在中心 80% 区域内，外圈作为安全缓冲。
        # 这里用同样的圆角设计，但额外缩小绘制范围。
        ("icon-maskable-512.png", 512, False, int(512 * 0.1)),
    ]

    for name, size, rounded, pad in sizes:
        print(f"Generating {name} ({size}x{size}, rounded={rounded}, pad={pad})...")
        rgba = draw_icon(size, rounded=rounded, safe_zone_padding=pad)
        save_png(os.path.join(OUT_DIR, name), size, size, rgba)

    print("Done.")


if __name__ == "__main__":
    main()
