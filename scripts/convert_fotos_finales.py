"""Convierte las fotos finales de Flor Mía (PNG pesados) a WebP optimizados.

Lee desde assets-src/fotosFinalesFlorMia/ y escribe
los archivos finales en public/images/flor-mia/products/ con nombres limpios
kebab-case. Las fotos "Secundaria" terminan en -secundaria.webp.

Uso:
    python3 scripts/convert_fotos_finales.py
"""

from pathlib import Path

from PIL import Image, ImageOps

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SOURCE_ROOT = (
    PROJECT_ROOT / "assets-src" / "fotosFinalesFlorMia"
)
OUTPUT_ROOT = PROJECT_ROOT / "public" / "images" / "flor-mia" / "products"

PRIMARY_WIDTH = 1200
SECONDARY_WIDTH = 1000
QUALITY = 84

# (origen relativo a SOURCE_ROOT, destino en OUTPUT_ROOT, ancho máximo)
CONVERSIONS = [
    # AOVE 500cc monovarietales + Blend IG
    ("AOVE/Arbequina500cc.png", "aceite-arbequina-500cc.webp", PRIMARY_WIDTH),
    ("AOVE/Arbosana500cc.png", "aceite-arbosana-500cc.webp", PRIMARY_WIDTH),
    ("AOVE/Blend500cc.png", "aceite-blend-500cc.webp", PRIMARY_WIDTH),
    ("AOVE/Coratina500cc.png", "aceite-coratina-500cc.webp", PRIMARY_WIDTH),
    ("AOVE/Picual500cc.png", "aceite-picual-500cc.webp", PRIMARY_WIDTH),
    ("AOVE/Arauco500cc.png", "aceite-arauco-500cc.webp", PRIMARY_WIDTH),
    # AOVE formatos grandes
    ("AOVE/Oliva2LBlend.png", "aceite-oliva-2l.webp", PRIMARY_WIDTH),
    ("AOVE/Oliva5LBlend.png", "aceite-oliva-5l.webp", PRIMARY_WIDTH),
    # AOVE secundarias (hover)
    (
        "AOVE/Secundaria/Arbequina500ccSecundaria.png",
        "aceite-arbequina-500cc-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    (
        "AOVE/Secundaria/Arbosana500ccSecundaria.png",
        "aceite-arbosana-500cc-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    (
        "AOVE/Secundaria/Blend500ccSecundaria.png",
        "aceite-blend-500cc-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    (
        "AOVE/Secundaria/Coratina500ccSecundaria.png",
        "aceite-coratina-500cc-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    (
        "AOVE/Secundaria/Picual500ccSecundaria.png",
        "aceite-picual-500cc-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    (
        "AOVE/Secundaria/Arauco500ccSecundaria.png",
        "aceite-arauco-500cc-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    (
        "AOVE/Secundaria/Blend2LSecundaria.png",
        "aceite-oliva-2l-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    (
        "AOVE/Secundaria/Blend5LSecundaria.png",
        "aceite-oliva-5l-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    # Productos mendocinos
    (
        "productosMendocinos/ALmendras500grPrincipal.png",
        "almendras-500g.webp",
        PRIMARY_WIDTH,
    ),
    ("productosMendocinos/Pistachos400gr.png", "pistachos-400g.webp", PRIMARY_WIDTH),
    (
        "productosMendocinos/AceitunasGriegas500gr.png",
        "aceitunas-griegas.webp",
        PRIMARY_WIDTH,
    ),
    (
        "productosMendocinos/MermeladaPeraTiaClara.png",
        "mermelada-pera.webp",
        PRIMARY_WIDTH,
    ),
    # Foto principal de la Sal de Malbec (archivo con nombre genérico)
    (
        "productosMendocinos/ChatGPT Image Oct 2, 2026, 05_19_52 PM.png",
        "sal-malbec.webp",
        PRIMARY_WIDTH,
    ),
    # Secundarias mendocinas (hover)
    (
        "productosMendocinos/Secundaria/Almendras500grSecundaria.png",
        "almendras-500g-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    (
        "productosMendocinos/Secundaria/Pistachos400grSecundaria.png",
        "pistachos-400g-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    (
        "productosMendocinos/Secundaria/OlivasGregas500grSecundaria.png",
        "aceitunas-griegas-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    (
        "productosMendocinos/Secundaria/MermeladaPeraSecundaria.png",
        "mermelada-pera-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    (
        "productosMendocinos/Secundaria/SalMalbecSecundaria.png",
        "sal-malbec-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    # Formatos adicionales sin producto cargado todavía
    ("productosMendocinos/Almendras1kgSecundario.png", "almendras-1kg.webp", PRIMARY_WIDTH),
    ("productosMendocinos/Almendras200grSecundario.png", "almendras-200g.webp", PRIMARY_WIDTH),
    ("productosMendocinos/Pistachos150gr.png", "pistachos-150g.webp", PRIMARY_WIDTH),
    ("productosMendocinos/Pistachos800gr.png", "pistachos-800g.webp", PRIMARY_WIDTH),
    (
        "productosMendocinos/Secundaria/Almendras1kgSecundaria.png",
        "almendras-1kg-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    (
        "productosMendocinos/Secundaria/Almendras200grSecundaria.png",
        "almendras-200g-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    (
        "productosMendocinos/Secundaria/Pistachos150grSecundaria.png",
        "pistachos-150g-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    (
        "productosMendocinos/Secundaria/Pistachos800grSecundaria.png",
        "pistachos-800g-secundaria.webp",
        SECONDARY_WIDTH,
    ),
    # Vino (asset editorial / futuro producto)
    ("Vino/VinoBazan750ml.png", "vino-bazan.webp", PRIMARY_WIDTH),
    (
        "Vino/Secundaria/VinoBazan500ccSecundaria.png",
        "vino-bazan-secundaria.webp",
        SECONDARY_WIDTH,
    ),
]


def convert(source: Path, destination: Path, max_width: int) -> tuple[int, int, int]:
    if not source.is_file():
        raise FileNotFoundError(f"Falta la fuente: {source}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as opened:
        image = ImageOps.exif_transpose(opened)
        has_alpha = image.mode in ("RGBA", "LA") or (
            image.mode == "P" and "transparency" in image.info
        )
        image = image.convert("RGBA" if has_alpha else "RGB")
        if image.width > max_width:
            target_height = round(image.height * max_width / image.width)
            image = image.resize((max_width, target_height), Image.Resampling.LANCZOS)
        image.save(destination, "WEBP", quality=QUALITY, method=6, optimize=True)
    return image.width, image.height, destination.stat().st_size


def main() -> None:
    for source_rel, dest_rel, max_width in CONVERSIONS:
        width, height, size = convert(
            SOURCE_ROOT / source_rel, OUTPUT_ROOT / dest_rel, max_width
        )
        print(f"{dest_rel}: {width}x{height} ({size / 1024:.0f} KiB)")


if __name__ == "__main__":
    main()
