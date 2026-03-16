#!/usr/bin/env python3
"""
Download GEBCO heightmap and process it into a ±100m coastal-focused DEM.

Output: public/textures/earth_dem.png
  - 8-bit grayscale PNG, 16384x8192 (matches 16K color texture)
  - 0 = -100m, 128 = sea level (0m), 255 = +100m
  - Resolution: 0.78m per pixel step
  - Includes both land elevation AND ocean bathymetry

Usage:
  scripts/.venv/bin/python scripts/process-dem.py

Requires: pip install Pillow requests numpy
"""

import os
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
    import requests
    import numpy as np
except ImportError:
    print("Missing dependencies. Install with:")
    print("  scripts/.venv/bin/pip install Pillow requests numpy")
    sys.exit(1)

# GEBCO 16-bit heightmaps from sbcode.net (derived from GEBCO 2020 Grid)
# Higher resolution = better coastal detail
GEBCO_SOURCES = [
    ("10800x5400 (2 arcmin, ~3.7km/pixel)", "https://sbcode.net/topoearth/downloads/gebco_bathy.10800x5400_16bit.tif"),
    ("5400x2700 (4 arcmin, ~7.4km/pixel)", "https://sbcode.net/topoearth/downloads/gebco_bathy.5400x2700_16bit.tif"),
]

OUTPUT_DIR = Path(__file__).parent.parent / "public" / "textures"
OUTPUT_PATH = OUTPUT_DIR / "earth_dem.png"
TARGET_WIDTH = 16384
TARGET_HEIGHT = 8192

# DEM range: ±100m around sea level
RANGE_MIN = -100.0  # meters
RANGE_MAX = 100.0   # meters


def download_file(url: str, dest: Path) -> bool:
    """Download a file with progress reporting."""
    print(f"  Downloading: {url}")
    try:
        resp = requests.get(url, stream=True, timeout=120)
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
                    print(f"\r  {pct:.0f}% ({mb:.1f}MB / {total_mb:.1f}MB)", end="", flush=True)
        print()
        return True
    except Exception as e:
        print(f"  Failed: {e}")
        return False


def determine_scale(arr: np.ndarray, sea_level: int) -> float:
    """Determine the meters-per-unit scale factor empirically.

    Uses the data distribution to find the scale. The signed values
    (value - sea_level) should map to elevation in meters. We use the
    overall range and known Earth elevation bounds to estimate scale.
    """
    signed = arr.astype(np.int32) - sea_level
    min_signed = int(signed.min())
    max_signed = int(signed.max())

    # Earth's elevation extremes: ~-10935m (Mariana) to ~+8848m (Everest)
    # At this resolution, peaks/trenches are smoothed, so actual extremes
    # in the data will be less extreme. Use the ratio of positive to negative
    # range to help calibrate.
    #
    # For ocean: scale_ocean = ~10935 / |min_signed|
    # For land:  scale_land  = ~8848 / max_signed
    # Average gives a reasonable estimate.
    scale_ocean = 10935.0 / abs(min_signed) if min_signed < 0 else 0.5
    scale_land = 8848.0 / max_signed if max_signed > 0 else 0.5
    scale = (scale_ocean + scale_land) / 2

    print(f"  Signed range: {min_signed} to {max_signed}")
    print(f"  Scale estimate: {scale:.4f} m/unit")
    print(f"    Ocean scale: {scale_ocean:.4f} (from min={min_signed}, ~-10935m)")
    print(f"    Land scale:  {scale_land:.4f} (from max={max_signed}, ~+8848m)")

    return scale


def process_tiff(src_path: Path) -> Image.Image:
    """Process a 16-bit TIFF into our ±100m focused DEM.

    The sbcode.net GEBCO TIFFs use unsigned 16-bit with sea level at 32768
    (standard signed-to-unsigned offset). Scale factor is determined
    empirically from the data range.
    """
    print("Processing 16-bit TIFF...")
    img = Image.open(src_path)
    width, height = img.size
    print(f"  Source: {width}x{height}, mode={img.mode}")

    arr = np.array(img)
    print(f"  dtype: {arr.dtype}, range: {arr.min()} to {arr.max()}")

    # GEBCO encoding: unsigned value = signed elevation units + 32768
    SEA_LEVEL_OFFSET = 32768

    # Verify: the 71st percentile should be near sea level (Earth is 71% ocean)
    p71 = int(np.percentile(arr, 71))
    print(f"  71st percentile: {p71} (expected ~{SEA_LEVEL_OFFSET})")
    if abs(p71 - SEA_LEVEL_OFFSET) > 2000:
        print(f"  WARNING: 71st percentile far from 32768, encoding may differ")

    # Determine scale factor (meters per TIFF unit)
    scale = determine_scale(arr, SEA_LEVEL_OFFSET)

    # Convert to elevation in meters
    elevation = (arr.astype(np.float32) - SEA_LEVEL_OFFSET) * scale

    # Verify with known locations
    locations = {
        "Pacific": (1350, 300, -5000),   # lat=0, lon=-160
        "Florida": (945, 1470, 2),       # lat=26, lon=-80
        "Denver":  (750, 1125, 1600),    # lat=40, lon=-105
    }
    src_w, src_h = width, height
    print(f"\n  Verification (at source resolution {width}x{height}):")
    for name, (row_frac_num, col_frac_num, expected) in locations.items():
        # Scale sample coords to actual image size
        r = int(row_frac_num * height / 2700)
        c = int(col_frac_num * width / 5400)
        r = min(r, height - 1)
        c = min(c, width - 1)
        actual = float(elevation[r, c])
        print(f"    {name}: {actual:.0f}m (expected ~{expected}m)")

    # Clamp to ±100m range and map to 0-255
    clamped = np.clip(elevation, RANGE_MIN, RANGE_MAX)
    normalized = (clamped - RANGE_MIN) / (RANGE_MAX - RANGE_MIN)
    output = (normalized * 255).astype(np.uint8)

    # Distribution check
    below = np.sum(output < 128)
    above = np.sum(output >= 128)
    total = output.size
    print(f"\n  Output distribution:")
    print(f"    Below sea level: {below/total*100:.1f}%")
    print(f"    Above sea level: {above/total*100:.1f}%")
    print(f"    At pixel 0 (deep ocean): {np.sum(output == 0)/total*100:.1f}%")
    print(f"    At pixel 255 (high land): {np.sum(output == 255)/total*100:.1f}%")
    print(f"    Coastal band (1-254): {np.sum((output > 0) & (output < 255))/total*100:.1f}%")

    return Image.fromarray(output)


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if OUTPUT_PATH.exists():
        print(f"DEM already exists at {OUTPUT_PATH}")
        resp = input("Overwrite? [y/N] ").strip().lower()
        if resp != "y":
            print("Skipping.")
            return

    with tempfile.TemporaryDirectory() as tmp:
        tmp_path = Path(tmp)

        for desc, url in GEBCO_SOURCES:
            print(f"\nTrying {desc}...")
            tiff_path = tmp_path / "gebco.tif"
            if not download_file(url, tiff_path):
                continue

            try:
                result = process_tiff(tiff_path)
            except Exception as e:
                print(f"  Processing failed: {e}")
                import traceback
                traceback.print_exc()
                continue

            # Resize to target resolution
            if result.size != (TARGET_WIDTH, TARGET_HEIGHT):
                print(f"\n  Resizing to {TARGET_WIDTH}x{TARGET_HEIGHT}...")
                result = result.resize(
                    (TARGET_WIDTH, TARGET_HEIGHT), Image.Resampling.LANCZOS
                )

            result.save(OUTPUT_PATH, "PNG", optimize=True)
            size_kb = OUTPUT_PATH.stat().st_size // 1024
            print(f"\nDEM saved to: {OUTPUT_PATH}")
            print(f"  Size: {size_kb}KB")
            print(f"  Resolution: {TARGET_WIDTH}x{TARGET_HEIGHT}")
            print(f"  Range: ±{int(RANGE_MAX)}m, precision: ~{(RANGE_MAX-RANGE_MIN)/255:.2f}m/step")
            return

        print("\nERROR: Could not download DEM data from any source.")
        print("Try downloading manually from: https://sbcode.net/topoearth/")
        sys.exit(1)


if __name__ == "__main__":
    main()
