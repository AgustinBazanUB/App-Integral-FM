"""Build the curated Flor Mia web image set from the supplied product folder.

Usage:
    py -3 scripts/optimize_flor_mia_assets.py --source "C:\\path\\to\\Productos"

The script applies EXIF orientation, strips metadata from generated WebP files,
and never modifies the source photographs.
"""

from __future__ import annotations

import argparse
import shutil
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageOps


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_ROOT = PROJECT_ROOT / "public" / "images" / "flor-mia"


@dataclass(frozen=True)
class WebpAsset:
    source: str
    destination: str
    width: int
    height: int | None = None
    quality: int = 84


WEBP_ASSETS = (
    WebpAsset("Flor-mia-local.jpeg", "og-flor-mia.webp", 1200, 630, 84),
    WebpAsset("Flor-mia-local.jpeg", "local/flor-mia-local-768.webp", 768, 576, 82),
    WebpAsset("Flor-mia-local.jpeg", "local/flor-mia-local-1200.webp", 1200, 900, 82),
    WebpAsset("Flor-mia-local.jpeg", "local/flor-mia-local-1600.webp", 1600, 1200, 82),
    WebpAsset("Aceite de Oliva Bidon 5L/producto-img-7395.jpg", "products/aceite-oliva-5l.webp", 900, 900),
    WebpAsset("Aceite de Oliva Botellon 2L/producto-img-7394.jpg", "products/aceite-oliva-2l.webp", 900, 900),
    WebpAsset("Almendras naturales 500g/producto-img-7390.jpg", "products/almendras-500g.webp", 900, 900),
    WebpAsset("Pistachos con cascara 400g/producto-img-7384-thumb.jpg", "products/pistachos-400g.webp", 480, 480),
    WebpAsset(
        "Aceituna Griega 500g/WhatsApp Image 2026-07-28 at 9.17.45 PM.jpeg",
        "products/aceitunas-griegas.webp",
        720,
        960,
    ),
    WebpAsset(
        "Mermelada de Pera/WhatsApp Image 2026-07-29 at 12.20.14 PM (2).jpeg",
        "products/mermelada-pera.webp",
        720,
        960,
    ),
    WebpAsset(
        "Sal de Malbec/WhatsApp Image 2026-07-29 at 12.20.14 PM.jpeg",
        "products/sal-malbec.webp",
        720,
        960,
    ),
    WebpAsset(
        "Vino BAZAN/WhatsApp Image 2026-07-29 at 12.20.13 PM (2).jpeg",
        "products/vino-bazan.webp",
        720,
        960,
    ),
    WebpAsset(
        "Aceite de Oliva 500cc/PHOTO-2025-03-11-22-28-14(1).jpg",
        "products/aceite-trio-500cc.webp",
        900,
        1350,
    ),
    WebpAsset(
        "Aceite de Oliva 500cc/PHOTO-2025-03-11-22-28-13.jpg",
        "products/aceite-arbequina-500cc.webp",
        900,
        1350,
    ),
    WebpAsset(
        "Aceite de Oliva 500cc/PHOTO-2025-03-11-22-28-13(1).jpg",
        "products/aceite-coratina-500cc.webp",
        900,
        1350,
    ),
    WebpAsset(
        "Aceite de Oliva 500cc/DSC_0084.JPG",
        "products/aceite-blend-500cc.webp",
        900,
        1350,
    ),
)


def render_webp(source_root: Path, asset: WebpAsset) -> tuple[int, int, int]:
    source_path = source_root / Path(asset.source)
    destination_path = OUTPUT_ROOT / Path(asset.destination)
    if not source_path.is_file():
        raise FileNotFoundError(f"Missing source asset: {source_path}")

    destination_path.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source_path) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
        if asset.height is None:
            target_height = round(image.height * asset.width / image.width)
            resized = image.resize((asset.width, target_height), Image.Resampling.LANCZOS)
        else:
            resized = ImageOps.fit(
                image,
                (asset.width, asset.height),
                method=Image.Resampling.LANCZOS,
                centering=(0.5, 0.5),
            )

        resized.save(
            destination_path,
            "WEBP",
            quality=asset.quality,
            method=6,
            optimize=True,
        )

    return asset.width, resized.height, destination_path.stat().st_size


def copy_original(source_root: Path, source: str, destination: str) -> int:
    source_path = source_root / Path(source)
    destination_path = OUTPUT_ROOT / Path(destination)
    if not source_path.is_file():
        raise FileNotFoundError(f"Missing source asset: {source_path}")
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source_path, destination_path)
    return destination_path.stat().st_size


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        required=True,
        help="Path to the supplied Productos directory",
    )
    args = parser.parse_args()
    source_root = args.source.resolve()
    if not source_root.is_dir():
        parser.error(f"Source directory does not exist: {source_root}")

    logo_size = copy_original(source_root, "logo-flor-mia.svg", "logo-flor-mia.svg")
    fallback_size = copy_original(
        source_root,
        "Flor-mia-local.jpeg",
        "local/flor-mia-local.jpeg",
    )
    print(f"logo-flor-mia.svg ({logo_size / 1024:.1f} KiB)")
    print(f"local/flor-mia-local.jpeg ({fallback_size / 1024:.1f} KiB)")

    for asset in WEBP_ASSETS:
        width, height, byte_size = render_webp(source_root, asset)
        print(f"{asset.destination} ({width}x{height}, {byte_size / 1024:.1f} KiB)")


if __name__ == "__main__":
    main()
