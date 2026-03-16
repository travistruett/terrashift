#!/usr/bin/env python3
"""
Download high-resolution Earth imagery and produce a 16K color texture.

Output: public/textures/earth_color.jpg
  - 16384x8192 JPEG (equirectangular projection)
  - Source: NASA Blue Marble via h-schmidt.net (43200x21600 original)

Usage:
  scripts/.venv/bin/python scripts/process-color.py

Requires: pip install Pillow requests
"""

import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
    import requests
except ImportError:
    print("Missing dependencies. Install with:")
    print("  scripts/.venv/bin/pip install Pillow requests")
    sys.exit(1)

# Allow very large images (43200x21600 = ~933M pixels, needs ~2.8GB RAM)
Image.MAX_IMAGE_PIXELS = 1_000_000_000

OUTPUT_DIR = Path(__file__).parent.parent / "public" / "textures"
OUTPUT_PATH = OUTPUT_DIR / "earth_color.jpg"
TARGET_WIDTH = 16384
TARGET_HEIGHT = 8192
JPEG_QUALITY = 85

# NASA Blue Marble repackaged as a single 43200x21600 JPEG (~55MB)
# Original source: NASA Visible Earth / Blue Marble Next Generation
PRIMARY_URL = "https://www.h-schmidt.net/map/download/world_shaded_43k.jpg"

# Fallback: NASA direct at 5400x2700 (lower res but official)
FALLBACK_URL = (
    "https://assets.science.nasa.gov/content/dam/science/esd/eo/images"
    "/bmng/bmng-topography/june/world.topo.200406.3x5400x2700.jpg"
)


def download_file(url: str, dest: Path, timeout: int = 300) -> bool:
    """Download a file with progress reporting."""
    print(f"  URL: {url}")
    try:
        resp = requests.get(url, stream=True, timeout=timeout)
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        downloaded = 0
        with open(dest, "wb") as f:
            for chunk in resp.iter_content(chunk_size=65536):
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded / total * 100
                    mb = downloaded / 1024 / 1024
                    total_mb = total / 1024 / 1024
                    print(
                        f"\r  {pct:.0f}% ({mb:.1f}MB / {total_mb:.1f}MB)",
                        end="",
                        flush=True,
                    )
        print()
        return True
    except Exception as e:
        print(f"  Failed: {e}")
        return False


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if OUTPUT_PATH.exists():
        size_mb = OUTPUT_PATH.stat().st_size / 1024 / 1024
        print(f"Color texture already exists at {OUTPUT_PATH} ({size_mb:.1f}MB)")
        resp = input("Overwrite? [y/N] ").strip().lower()
        if resp != "y":
            print("Skipping.")
            return

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)
        raw_path = tmp_path / "raw.jpg"

        # Try primary source (43K)
        print("\nDownloading 43200x21600 Earth imagery (~55MB)...")
        if not download_file(PRIMARY_URL, raw_path):
            print("\nPrimary source failed. Trying NASA fallback (5400x2700)...")
            if not download_file(FALLBACK_URL, raw_path):
                print("\nERROR: Could not download color texture from any source.")
                sys.exit(1)

        print("Opening image (this may use ~3GB RAM for 43K source)...")
        img = Image.open(raw_path)
        print(f"  Source: {img.size[0]}x{img.size[1]}, mode={img.mode}")

        if img.mode != "RGB":
            img = img.convert("RGB")

        print(f"Resizing to {TARGET_WIDTH}x{TARGET_HEIGHT}...")
        img = img.resize((TARGET_WIDTH, TARGET_HEIGHT), Image.Resampling.LANCZOS)

        print(f"Saving JPEG (quality={JPEG_QUALITY})...")
        img.save(OUTPUT_PATH, "JPEG", quality=JPEG_QUALITY, optimize=True)

        size_mb = OUTPUT_PATH.stat().st_size / 1024 / 1024
        print(f"\nColor texture saved to: {OUTPUT_PATH}")
        print(f"  Size: {size_mb:.1f}MB")
        print(f"  Resolution: {TARGET_WIDTH}x{TARGET_HEIGHT}")
        print(f"  Source: NASA Blue Marble Next Generation (public domain)")


if __name__ == "__main__":
    main()
