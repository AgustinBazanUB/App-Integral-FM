"""Genera los WebP descriptivos definidos por la especificación de Flor Mía.

Estos archivos no pretenden reemplazar fotografías reales. Mantienen la
proporción final, evitan saltos de layout y explican qué imagen debe cargarse.
"""

from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "public" / "images" / "placeholders"
GENERATED_SOCIAL = Path(
    r"C:\Users\agsba\.codex\generated_images"
    r"\019fac74-668e-73f1-bcd8-97658ba7468e"
    r"\call_gXsRj0M87MnIsr34enI45XbR.png"
)

BACKGROUND_START = (27, 31, 23)
BACKGROUND_END = (38, 49, 31)
GOLD = (217, 194, 140)
GOLD_DIM = (199, 163, 90, 110)
IVORY_DIM = (244, 240, 230, 70)


def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        Path(r"C:\Windows\Fonts\seguisb.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf"),
        Path(r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def gradient(width: int, height: int) -> Image.Image:
    image = Image.new("RGB", (width, height), BACKGROUND_START)
    pixels = image.load()
    diagonal = max(1, width + height)
    for y in range(height):
        for x in range(width):
            ratio = (x + y) / diagonal
            pixels[x, y] = tuple(
                int(start + (end - start) * ratio)
                for start, end in zip(BACKGROUND_START, BACKGROUND_END)
            )
    return image


def wrap_label(text: str, max_chars: int) -> str:
    words = text.upper().split()
    lines: list[str] = []
    current: list[str] = []
    for word in words:
        proposed = " ".join([*current, word])
        if current and len(proposed) > max_chars:
            lines.append(" ".join(current))
            current = [word]
        else:
            current.append(word)
    if current:
        lines.append(" ".join(current))
    return "\n".join(lines)


def draw_placeholder(path: str, size: tuple[int, int], label: str) -> None:
    width, height = size
    image = gradient(width, height).convert("RGBA")
    draw = ImageDraw.Draw(image, "RGBA")

    inset = max(18, int(min(width, height) * 0.045))
    radius = max(22, int(min(width, height) * 0.035))
    draw.rounded_rectangle(
        (inset, inset, width - inset, height - inset),
        radius=radius,
        outline=GOLD_DIM,
        width=max(2, width // 600),
    )

    # Formas abstractas: botella, cuenco y horizonte; son guías visuales, no productos.
    center_x = width * 0.5
    center_y = height * 0.42
    bottle_width = width * 0.09
    bottle_height = height * 0.24
    draw.rounded_rectangle(
        (
            center_x - bottle_width / 2,
            center_y - bottle_height / 2,
            center_x + bottle_width / 2,
            center_y + bottle_height / 2,
        ),
        radius=max(8, int(bottle_width * 0.18)),
        outline=(217, 194, 140, 90),
        width=max(2, width // 500),
    )
    neck_width = bottle_width * 0.42
    draw.rounded_rectangle(
        (
            center_x - neck_width / 2,
            center_y - bottle_height * 0.72,
            center_x + neck_width / 2,
            center_y - bottle_height * 0.42,
        ),
        radius=max(4, int(neck_width * 0.18)),
        outline=(217, 194, 140, 90),
        width=max(2, width // 500),
    )

    bowl_y = center_y + bottle_height * 0.55
    draw.ellipse(
        (
            center_x - bottle_width * 1.7,
            bowl_y,
            center_x - bottle_width * 0.25,
            bowl_y + bottle_height * 0.34,
        ),
        outline=(244, 240, 230, 60),
        width=max(2, width // 600),
    )
    draw.ellipse(
        (
            center_x + bottle_width * 0.25,
            bowl_y,
            center_x + bottle_width * 1.7,
            bowl_y + bottle_height * 0.34,
        ),
        outline=(244, 240, 230, 60),
        width=max(2, width // 600),
    )

    for index in range(3):
        y = height * (0.18 + index * 0.035)
        amplitude = height * 0.015
        points = []
        for x in range(0, width + 1, max(8, width // 120)):
            wave = math.sin((x / width) * math.pi * 2 + index) * amplitude
            points.append((x, y + wave))
        draw.line(points, fill=IVORY_DIM, width=max(1, width // 1000))

    filename = Path(path).name
    uses_html_caption = filename in {
        "hero-flor-mia-productos-mendoza.webp",
        "cta-mesa-productos-mendoza.webp",
    }
    if not uses_html_caption:
        label_font = load_font(max(16, int(min(width, height) * 0.027)), bold=True)
        helper_font = load_font(max(12, int(min(width, height) * 0.017)))
        wrapped = wrap_label(label, max(24, int(width / (label_font.size * 0.58))))
        bbox = draw.multiline_textbbox(
            (0, 0), wrapped, font=label_font, spacing=8, align="center"
        )
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        text_x = (width - text_width) / 2
        text_y = height * 0.20 - text_height / 2
        draw.multiline_text(
            (text_x, text_y),
            wrapped,
            font=label_font,
            fill=GOLD,
            spacing=8,
            align="center",
        )

        helper = "REEMPLAZAR POR FOTOGRAFÍA REAL"
        helper_bbox = draw.textbbox((0, 0), helper, font=helper_font)
        helper_width = helper_bbox[2] - helper_bbox[0]
        draw.text(
            ((width - helper_width) / 2, text_y + text_height + 24),
            helper,
            font=helper_font,
            fill=(244, 240, 230, 145),
        )

    destination = OUTPUT / path
    destination.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(destination, "WEBP", quality=82, method=6)


PLACEHOLDERS: list[tuple[str, tuple[int, int], str]] = [
    ("hero-flor-mia-productos-mendoza.webp", (1600, 900), "HERO: aceite protagonista + selección regional mendocina"),
    ("categoria-aceites-de-oliva.webp", (800, 1000), "CATEGORÍA: botellas reales de aceite Flor Mía"),
    ("categoria-frutos-secos.webp", (800, 1000), "CATEGORÍA: almendras, pistachos y pasas reales"),
    ("categoria-aceitunas.webp", (800, 1000), "CATEGORÍA: aceitunas verdes, negras y griegas"),
    ("categoria-mermeladas.webp", (800, 1000), "CATEGORÍA: frascos reales de mermeladas"),
    ("categoria-sales-condimentadas.webp", (800, 1000), "CATEGORÍA: sales con Malbec, ajo y variedades reales"),
    ("categoria-regalos-mendocinos.webp", (800, 1000), "CATEGORÍA: regalo o combinación real Flor Mía"),
    ("destacado-aceites-flor-mia.webp", (1600, 1000), "DESTACADO: colección de aceites Flor Mía"),
    ("editorial-frutos-secos-mendoza.webp", (800, 1000), "EDITORIAL: frutos secos reales"),
    ("editorial-aceitunas-mendoza.webp", (800, 1000), "EDITORIAL: selección real de aceitunas"),
    ("editorial-mermeladas-mendoza.webp", (800, 1000), "EDITORIAL: sabores reales de mermelada"),
    ("editorial-sales-mendoza.webp", (800, 1000), "EDITORIAL: sales condimentadas reales"),
    ("mesa-mendocina-flor-mia.webp", (1600, 1000), "OCASIÓN: mesa con combinación de productos Flor Mía"),
    ("local-flor-mia-productos-mendocinos.webp", (800, 1000), "LOCAL REAL: estanterías y productos Flor Mía"),
    ("cliente-resena-1.webp", (800, 800), "RESEÑA REAL: cliente o producto autorizado"),
    ("pack-flor-mia-regionales.webp", (1600, 1000), "PACK REAL: combinación disponible de productos"),
    ("cta-mesa-productos-mendoza.webp", (1680, 720), "CTA: mesa regional mendocina con aceite protagonista"),
]

PRODUCTS = [
    ("aceites", "aceite-blend", "Aceites · Aceite Blend"),
    ("aceites", "aceite-arbequina", "Aceites · Aceite Arbequina"),
    ("aceites", "aceite-coratina", "Aceites · Aceite Coratina"),
    ("frutos-secos", "pistachos", "Frutos secos · Pistachos"),
    ("frutos-secos", "almendras", "Frutos secos · Almendras"),
    ("frutos-secos", "pasas-de-uva", "Frutos secos · Pasas de uva"),
    ("aceitunas", "seleccion", "Aceitunas · Selección real"),
    ("mermeladas", "sabor-pendiente", "Mermelada · Sabor real pendiente"),
    ("sales", "sal-con-malbec", "Sales · Sal con Malbec"),
    ("sales", "sal-con-ajo", "Sales · Sal con ajo"),
]

VARIETIES = ["arbequina", "arbosana", "blend", "coratina", "picual", "arauco"]

GALLERY = [
    ("Interior y frente del local", (800, 1000)),
    ("Degustación de aceite", (800, 800)),
    ("Botellas de aceite", (900, 1200)),
    ("Almendras y pistachos", (800, 1000)),
    ("Aceitunas", (800, 800)),
    ("Mermeladas", (900, 1200)),
    ("Sales condimentadas", (800, 1000)),
    ("Regalos o mesas armadas", (800, 800)),
]


def create_social_assets() -> None:
    if not GENERATED_SOCIAL.exists():
        raise FileNotFoundError(f"No se encontró la tarjeta social: {GENERATED_SOCIAL}")

    OUTPUT.mkdir(parents=True, exist_ok=True)
    image = Image.open(GENERATED_SOCIAL).convert("RGB")
    webp = ImageOps.fit(image, (1200, 630), method=Image.Resampling.LANCZOS)
    webp.save(
        OUTPUT / "og-flor-mia-productos-mendoza.webp",
        "WEBP",
        quality=88,
        method=6,
    )

    png = ImageOps.fit(image, (1200, 630), method=Image.Resampling.LANCZOS)
    png.save(ROOT / "public" / "og.png", "PNG", optimize=True)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)

    for filename, size, label in PLACEHOLDERS:
        draw_placeholder(filename, size, label)

    for category, slug, label in PRODUCTS:
        draw_placeholder(
            f"producto-{category}-{slug}.webp",
            (800, 1000),
            f"PRODUCTO REAL: {label}",
        )

    for variety in VARIETIES:
        draw_placeholder(
            f"variedad-{variety}-contexto.webp",
            (800, 1000),
            f"ACEITE: {variety} + uso gastronómico",
        )

    for index, (label, size) in enumerate(GALLERY, start=1):
        draw_placeholder(
            f"galeria-flor-mia-{index}.webp",
            size,
            f"GALERÍA REAL: {label}",
        )

    create_social_assets()
    print(f"Placeholders generados en {OUTPUT}")


if __name__ == "__main__":
    main()
