#!/usr/bin/env python3
"""يرسم كروت المجموعات (تحذير أصفر/أحمر، انضمام، مغادرة) بدقة 1200x600."""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "public", "cards")
FONT_BLACK = os.path.join(ROOT, "assets", "fonts", "Tajawal-Black.ttf")
FONT_BOLD = os.path.join(ROOT, "assets", "fonts", "Tajawal-Bold.ttf")
W, H = 1200, 600


def font(path, size):
    return ImageFont.truetype(path, size)


def vertical_gradient(size, top, bottom):
    w, h = size
    base = Image.new("RGB", (1, h))
    d = ImageDraw.Draw(base)
    for y in range(h):
        t = y / max(1, h - 1)
        d.point((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return base.resize((w, h), Image.BICUBIC)


def glow(size, color, center, radius):
    layer = Image.new("RGB", size, (0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx, cy = center
    d.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=color)
    return layer.filter(ImageFilter.GaussianBlur(radius // 2))


def stripes(size, color, step=46, width=3):
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    w, h = size
    for x in range(-h, w + h, step):
        d.line([(x, 0), (x + h, h)], fill=color, width=width)
    return layer


def rtl_text(draw, xy, text, fnt, fill, anchor="ra"):
    draw.text(xy, text, font=fnt, fill=fill, anchor=anchor, direction="rtl", language="ar")


def warning_triangle(draw, cx, cy, r, fill, mark_fill):
    pts = [(cx, cy - r), (cx + r * 1.12, cy + r * 0.86), (cx - r * 1.12, cy + r * 0.86)]
    draw.polygon(pts, fill=fill)
    draw.rounded_rectangle([cx - r * 0.085, cy - r * 0.42, cx + r * 0.085, cy + r * 0.3], radius=r * 0.08, fill=mark_fill)
    draw.ellipse([cx - r * 0.11, cy + r * 0.46, cx + r * 0.11, cy + r * 0.68], fill=mark_fill)


def base_card(accent, accent2):
    img = vertical_gradient((W, H), (10, 12, 16), (24, 28, 36)).convert("RGB")
    img = Image.blend(img, glow((W, H), accent2, (250, 300), 520), 0.55)
    img = Image.blend(img, glow((W, H), (0, 0, 0), (W - 120, 60), 380), 0.35)
    img = img.convert("RGBA")
    img.alpha_composite(stripes((W, H), accent + (9,)))
    top = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(top).rounded_rectangle([18, 18, W - 18, 112], radius=34, fill=(255, 255, 255, 14))
    img.alpha_composite(top)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([18, 18, W - 18, H - 18], radius=34, outline=accent + (170,), width=3)
    d.line([(18, 112), (W - 18, 112)], fill=accent + (110,), width=2)
    return img, d


def fit_font(path, text, max_w, start, lo=20):
    size = start
    while size > lo:
        f = font(path, size)
        if ImageDraw.Draw(Image.new("RGB", (10, 10))).textlength(text, font=f, direction="rtl", language="ar") <= max_w:
            return f
        size -= 2
    return font(path, lo)


def make_warning(number, accent, accent2, title, subtitle, badge_text, out_name):
    img, d = base_card(accent, accent2)
    # شريط علوي
    d.rounded_rectangle([W - 470, 40, W - 52, 104], radius=32, fill=accent + (255,))
    rtl_text(d, (W - 82, 72), "نظام حماية المجموعة", font(FONT_BOLD, 34), (18, 18, 18), "rm")
    d.ellipse([44, 30, 158, 144], outline=accent + (230,), width=5)
    rtl_text(d, (101, 88), badge_text, font(FONT_BLACK, 62), accent, "mm")
    # العنوان
    rtl_text(d, (W - 70, 200), title, font(FONT_BLACK, 150), (255, 255, 255), "ra")
    # خط فاصل
    d.rounded_rectangle([W - 640, 372, W - 70, 380], radius=4, fill=accent + (255,))
    rtl_text(d, (W - 70, 412), subtitle, fit_font(FONT_BOLD, subtitle, 620, 46), (222, 228, 236), "ra")
    # أيقونة
    warning_triangle(d, 250, 300, 132, accent + (255,), (20, 22, 28))
    os.makedirs(OUT, exist_ok=True)
    img.convert("RGB").save(os.path.join(OUT, out_name), quality=95)
    print("saved", out_name)


def make_event(accent, accent2, title, subtitle, out_name, icon):
    img, d = base_card(accent, accent2)
    rtl_text(d, (W - 80, 210), title, font(FONT_BLACK, 132), (255, 255, 255), "ra")
    d.rounded_rectangle([W - 700, 372, W - 80, 380], radius=4, fill=accent + (255,))
    rtl_text(d, (W - 80, 410), subtitle, fit_font(FONT_BOLD, subtitle, 660, 44), (224, 230, 238), "ra")
    if icon == "join":
        d.ellipse([150, 190, 390, 430], outline=accent + (255,), width=8)
        d.line([(270, 240), (270, 380)], fill=accent + (255,), width=16)
        d.line([(200, 310), (340, 310)], fill=accent + (255,), width=16)
    else:
        d.ellipse([150, 190, 390, 430], outline=accent + (255,), width=8)
        d.rounded_rectangle([232, 258, 308, 342], radius=8, fill=accent + (255,))
        d.polygon([(216, 250), (300, 300), (216, 350)], fill=(20, 22, 28))
    os.makedirs(OUT, exist_ok=True)
    img.convert("RGB").save(os.path.join(OUT, out_name), quality=95)
    print("saved", out_name)


YELLOW = (255, 193, 7)
AMBER = (255, 140, 0)
RED = (229, 57, 53)
CRIMSON = (183, 28, 28)
GREEN = (16, 185, 129)
TEAL = (6, 148, 162)
SLATE = (96, 125, 139)
BLUE = (30, 90, 160)

make_warning(1, YELLOW, AMBER, "تحذير", "هذا تحذير رقم ١ — تكرار المخالفة يعرّضك للطرد", "١", "warn-1.png")
make_warning(2, YELLOW, AMBER, "تحذير", "هذا تحذير رقم ٢ — التحذير القادم يعني الطرد فوراً", "٢", "warn-2.png")
make_warning(3, RED, CRIMSON, "إنذار أخير", "المخالفة الثالثة — سيتم طردك من المجموعة", "٣", "warn-3.png")
make_event(GREEN, TEAL, "أهلاً وسهلاً", "نوّرت المجموعة — اقرأ القوانين وشارك باحترام", "join.png", "join")
make_event(SLATE, BLUE, "إلى اللقاء", "غادرتَ المجموعة — نتمنى لك التوفيق", "leave.png", "leave")
