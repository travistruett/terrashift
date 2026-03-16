#!/usr/bin/env python3
"""
Generate ice coverage threshold texture for TerraShift.

Uses satellite imagery to detect present-day ice, then computes a distance
field from the ice edges. Ice grows/shrinks from its real boundaries — no
circles, no rectangles.

Output: public/textures/earth_ice.png
  - 16384x8192 8-bit grayscale PNG
  - Encoding: pixel 0 = -40°C, pixel 128 ≈ 0°C, pixel 255 = +40°C
  - Shader: if iceTemp < iceThreshold → render as ice

Model:
  1. Detect present-day ice from satellite color (bright white at high latitude)
  2. Compute distance transform from ice edges (pixels → km)
  3. Detected ice: threshold from latitude resilience (+0.5 to +8°C)
  4. Non-ice: threshold = -distance_from_ice / growth_rate
     Growth rate varies by latitude (faster at high latitudes) and elevation
     (higher = faster). This means ice expands outward from existing edges,
     following real coastlines, mountain ranges, and terrain.

Calibration:
  - Present (ΔT=0): Only satellite-detected ice shows
  - LGM (ΔT≈-6): Ice expanded ~2000-3000km south from Arctic edges
  - PETM (ΔT=+8): Nearly all ice gone

Usage:
  scripts/.venv/bin/python scripts/process-ice.py

Requires: pip install Pillow numpy requests scipy
"""

import sys
import gzip
import tempfile
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
    from scipy.ndimage import distance_transform_edt
    import requests
except ImportError:
    print("Missing dependencies. Install with:")
    print("  scripts/.venv/bin/pip install Pillow numpy requests scipy")
    sys.exit(1)

Image.MAX_IMAGE_PIXELS = 300_000_000

WIDTH = 16384
HEIGHT = 8192

OUTPUT_DIR = Path(__file__).parent.parent / "public" / "textures"
OUTPUT_PATH = OUTPUT_DIR / "earth_ice.png"
COLOR_PATH = OUTPUT_DIR / "earth_color.jpg"

TEMP_MIN = -40.0
TEMP_MAX = 40.0

GEBCO_URL = "https://sbcode.net/topoearth/downloads/gebco_bathy.5400x2700_16bit.tif"
SEA_LEVEL_OFFSET = 32768

# ── Tuning constants ──────────────────────────────────────────────────

# Ice detection from satellite
ICE_BRIGHT_MIN = 185        # min average RGB brightness
ICE_SAT_MAX = 0.20          # max HSV saturation (white, not tan)
ICE_LAT_MIN = 55            # min |latitude| for general detection
ICE_MOUNTAIN_BRIGHT = 210   # stricter brightness for mountain ice
ICE_MOUNTAIN_ELEV = 3000    # min elevation (m) for mountain ice detection

# Distance transform pixel scale
# At 16K resolution: 360°/16384 ≈ 0.022° per pixel
# At equator: 1° ≈ 111km, so 1 pixel ≈ 2.4km
# At 60°: 1° lon ≈ 55km, so 1 pixel ≈ 1.2km
# We use a single scale factor (equatorial) and adjust via growth rate
PIXEL_KM = 111.0 * 360.0 / WIDTH  # ~2.44 km/pixel at equator

# Real sea ice data (HadISST from UK Met Office)
HADISST_URL = "https://www.metoffice.gov.uk/hadobs/hadisst/data/HadISST_ice.nc.gz"
SEA_ICE_CONC_MIN = 0.15       # 15% minimum concentration (IPCC standard)

# RGBA texture encoding ranges — must match src/constants/ice.ts
MAX_DIST_KM = 8000.0          # R channel: sqrt(dist_km / MAX_DIST_KM)
MAX_ELEV_M = 9000.0           # A channel: elevation / MAX_ELEV_M
LAND_RES_SCALE = 10.0         # G channel: resilience / LAND_RES_SCALE


def download_file(url: str, dest: Path, timeout: int = 120) -> bool:
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
                    print(f"\r  {pct:.0f}% ({mb:.1f}MB / {total_mb:.1f}MB)", end="", flush=True)
        print()
        return True
    except Exception as e:
        print(f"  Failed: {e}")
        return False


def temp_to_pixel(t):
    """Map temperature (-40 to +40°C) → pixel (0 to 255)."""
    return np.clip((t - TEMP_MIN) / (TEMP_MAX - TEMP_MIN) * 255, 0, 255).astype(np.uint8)


def load_sea_ice(tmp_dir: str):
    """Download HadISST and return September-mean sea ice concentration at 16K.

    Returns numpy array (HEIGHT, WIDTH) with values 0-1, or None on failure.
    HadISST: 1° lat/lon grid, NetCDF3 format (readable by scipy, no extra deps).
    """
    from scipy.io import netcdf_file

    gz_path = Path(tmp_dir) / "hadisst_ice.nc.gz"
    nc_path = Path(tmp_dir) / "hadisst_ice.nc"

    print("\nDownloading HadISST sea ice concentration data...")
    if not download_file(HADISST_URL, gz_path, timeout=180):
        print("  WARNING: Failed to download. Will use formula-based sea ice.")
        return None

    print("Decompressing...")
    with gzip.open(str(gz_path), "rb") as f_in:
        with open(nc_path, "wb") as f_out:
            f_out.write(f_in.read())

    print("Parsing NetCDF...")
    try:
        with netcdf_file(str(nc_path), "r", mmap=False) as nc:
            sic_var = nc.variables["sic"]  # (time, lat, lon)
            n_times = sic_var.shape[0]
            n_years = n_times // 12

            # Average last 10 Septembers (month index 8, 0-indexed from Jan)
            start_year = max(0, n_years - 10)
            sept_idx = [y * 12 + 8 for y in range(start_year, n_years)]
            print(f"  Averaging {len(sept_idx)} recent Septembers...")

            sept = np.zeros((sic_var.shape[1], sic_var.shape[2]), dtype=np.float64)
            for i in sept_idx:
                sept += sic_var[i, :, :]
            sept /= len(sept_idx)

            # HadISST fill value is -1.0e+30; replace negatives with 0
            sept = np.where(sept < 0, 0, sept).astype(np.float32)
            sept = np.clip(sept, 0, 1.0)

    except Exception as e:
        print(f"  WARNING: Failed to parse NetCDF: {e}")
        return None

    # HadISST lons: 0.5..359.5 → shift to match our -180..180 grid
    half = sept.shape[1] // 2
    sept = np.roll(sept, half, axis=1)

    # Resize to 16K using PIL (same approach as elevation)
    src_h, src_w = sept.shape
    print(f"  Resizing {src_w}x{src_h} → {WIDTH}x{HEIGHT}...")
    ice_img = Image.fromarray(sept, mode="F")
    ice_img = ice_img.resize((WIDTH, HEIGHT), Image.Resampling.BILINEAR)
    result = np.clip(np.array(ice_img, dtype=np.float32), 0, 1.0)

    conc_pct = np.sum(result > SEA_ICE_CONC_MIN) / result.size * 100
    print(f"  Sea ice coverage (>15%): {conc_pct:.1f}% of globe")

    return result


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    if OUTPUT_PATH.exists():
        print(f"Ice texture already exists at {OUTPUT_PATH}")
        resp = input("Overwrite? [y/N] ").strip().lower()
        if resp != "y":
            print("Skipping.")
            return

    # ── 1. Load satellite color for ice detection ──
    if not COLOR_PATH.exists():
        print(f"ERROR: Satellite image not found: {COLOR_PATH}")
        print("Run process-color.py first.")
        sys.exit(1)

    print("Loading satellite color image...")
    color_img = Image.open(COLOR_PATH)
    if color_img.size != (WIDTH, HEIGHT):
        print(f"  Resizing {color_img.size[0]}x{color_img.size[1]} → {WIDTH}x{HEIGHT}...")
        color_img = color_img.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    color = np.array(color_img, dtype=np.float32)
    r, g, b = color[:, :, 0], color[:, :, 1], color[:, :, 2]
    brightness = (r + g + b) / 3.0
    max_ch = np.maximum(np.maximum(r, g), b)
    min_ch = np.minimum(np.minimum(r, g), b)
    with np.errstate(invalid="ignore"):
        saturation = np.where(max_ch > 0, (max_ch - min_ch) / max_ch, 0)
    del color, max_ch, min_ch

    # ── 2. Load GEBCO elevation ──
    with tempfile.TemporaryDirectory() as tmp:
        tiff_path = Path(tmp) / "gebco.tif"
        print("\nDownloading GEBCO elevation data (~28MB)...")
        if not download_file(GEBCO_URL, tiff_path):
            print("ERROR: Could not download GEBCO data.")
            sys.exit(1)

        print("\nProcessing elevation...")
        img = Image.open(tiff_path)
        arr = np.array(img, dtype=np.float32)
        signed = arr - SEA_LEVEL_OFFSET
        min_s, max_s = float(signed.min()), float(signed.max())
        scale_o = 10935.0 / abs(min_s) if min_s < 0 else 0.5
        scale_l = 8848.0 / max_s if max_s > 0 else 0.5
        scale = (scale_o + scale_l) / 2
        elevation_raw = signed * scale
        print(f"  Elevation: {elevation_raw.min():.0f}m to {elevation_raw.max():.0f}m")

    src_h, src_w = elevation_raw.shape
    print(f"  Resizing {src_w}x{src_h} → {WIDTH}x{HEIGHT}...")
    elev_img = Image.fromarray(elevation_raw, mode="F")
    elev_img = elev_img.resize((WIDTH, HEIGHT), Image.Resampling.BILINEAR)
    elevation = np.array(elev_img, dtype=np.float32)
    is_ocean = elevation < 0
    del elevation_raw, elev_img

    # ── 3. Coordinate grids ──
    print(f"\nBuilding {WIDTH}x{HEIGHT} coordinate grids...")
    lat_deg = np.linspace(90, -90, HEIGHT, dtype=np.float32)
    lon_deg = np.linspace(-180, 180, WIDTH, endpoint=False, dtype=np.float32)
    lat_grid, _ = np.meshgrid(lat_deg, lon_deg, indexing="ij")
    abs_lat = np.abs(lat_grid)

    # ── 4. Detect present-day ice from satellite ──
    print("\nDetecting present-day ice from satellite imagery...")

    # Primary: bright + white + high latitude
    is_ice = (
        (brightness > ICE_BRIGHT_MIN)
        & (saturation < ICE_SAT_MAX)
        & (abs_lat > ICE_LAT_MIN)
    )

    # Mountain ice: very bright + high elevation (allows lower latitude)
    is_ice |= (
        (brightness > ICE_MOUNTAIN_BRIGHT)
        & (saturation < 0.12)
        & (abs_lat > 25)
        & (elevation > ICE_MOUNTAIN_ELEV)
    )

    # Guaranteed Antarctic land (satellite might miss shadowed areas)
    is_ice |= (lat_grid < -65) & ~is_ocean

    ice_pct = np.sum(is_ice) / is_ice.size * 100
    print(f"  Detected: {ice_pct:.1f}% of globe")
    for lat_lo, lat_hi, label in [
        (60, 91, "60-90°N"), (45, 60, "45-60°N"),
        (-60, -44, "45-60°S"), (-91, -60, "60-90°S"),
    ]:
        band = (lat_grid >= lat_lo) & (lat_grid < lat_hi)
        n = np.sum(band)
        if n > 0:
            print(f"    {label}: {np.sum(is_ice & band) / n * 100:.1f}% ice")

    del brightness, saturation, r, g, b
    satellite_ice = is_ice.copy()

    # ── 4b. Load real sea ice concentration data ──
    sea_ice_conc = None
    with tempfile.TemporaryDirectory() as tmp_ice:
        sea_ice_conc = load_sea_ice(tmp_ice)

    if sea_ice_conc is not None:
        has_sea_ice = (sea_ice_conc > SEA_ICE_CONC_MIN) & is_ocean
        new_sea_ice = has_sea_ice & ~is_ice
        print(f"  New sea ice pixels from HadISST: {np.sum(new_sea_ice) / is_ice.size * 100:.2f}%")
        is_ice |= has_sea_ice
        ice_pct = np.sum(is_ice) / is_ice.size * 100
        print(f"  Total ice (satellite + HadISST): {ice_pct:.1f}%")
    else:
        print("  Using formula-based sea ice fallback.")

    # ── 5. Distance transform from ice edges ──
    print("\nComputing distance from ice edges...")
    # distance_transform_edt gives distance in pixels from nearest True→False boundary
    # We want distance from ice edge for non-ice pixels
    dist_from_ice = distance_transform_edt(~is_ice).astype(np.float32)
    # Convert to approximate km (using equatorial pixel size)
    dist_km = dist_from_ice * PIXEL_KM

    print(f"  Max distance from ice: {dist_km.max():.0f} km")
    print(f"  Median non-ice distance: {np.median(dist_km[~is_ice]):.0f} km")

    # ── 6. Encode RGBA channels ──
    # Instead of pre-computing a threshold (which creates 8-bit banding),
    # store raw ingredients and let the shader compute threshold at float precision.
    #   R = sqrt-encoded distance from ice edge (more precision near edges)
    #   G = land ice resilience (satellite-detected ice)
    #   B = sea ice concentration (HadISST data)
    #   A = terrain elevation above sea level (full range, not ±100m DEM)
    print("\nEncoding RGBA ice texture...")

    # R: distance from ice edge, sqrt-encoded for precision near edges
    # sqrt gives ~3km/step near edge vs ~35km/step far away
    r_float = np.sqrt(np.clip(dist_km / MAX_DIST_KM, 0, 1))
    r_channel = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    r_channel[~is_ice] = np.clip(r_float[~is_ice] * 255, 0, 255).astype(np.uint8)

    # G: land ice resilience (satellite-detected ice only)
    ice_resilience = np.clip(
        0.5 + 7.5 * np.maximum((abs_lat - 25) / 65, 0) ** 1.5,
        0.5, 8.0,
    )
    g_channel = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    g_channel[satellite_ice] = np.clip(
        ice_resilience[satellite_ice] / LAND_RES_SCALE * 255, 1, 255
    ).astype(np.uint8)

    # B: sea ice concentration (HadISST, only for sea ice not already in satellite)
    b_channel = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    if sea_ice_conc is not None:
        sea_ice_only = has_sea_ice & ~satellite_ice
        b_channel[sea_ice_only] = np.clip(
            sea_ice_conc[sea_ice_only] * 255, 1, 255
        ).astype(np.uint8)

    # A: terrain elevation above sea level (full range, for growth rate in shader)
    elev_above = np.clip(elevation, 0, MAX_ELEV_M)
    a_channel = (elev_above / MAX_ELEV_M * 255).astype(np.uint8)

    # ── 7. Verification ──
    print("\nVerification:")

    def sample(lat, lon):
        row = int((90 - lat) / 180 * HEIGHT)
        col = int((lon + 180) / 360 * WIDTH) % WIDTH
        row = max(0, min(row, HEIGHT - 1))
        col = max(0, min(col, WIDTH - 1))
        d = float(dist_km[row, col])
        g = float(g_channel[row, col]) / 255 * 10.0
        b = float(b_channel[row, col]) / 255
        a = float(a_channel[row, col]) / 255 * MAX_ELEV_M
        return d, g, b, a, bool(is_ice[row, col])

    checks = [
        ("Greenland center (72°N, -40°W)", 72, -40, True),
        ("Antarctica center (-85°S, 0°E)", -85, 0, True),
        ("Arctic Ocean (85°N, 0°E)",       85, 0, True),
        ("Barents Sea (75°N, 40°E)",       75, 40, False),
        ("Rockies (40°N, -106°W)",         40, -106, False),
        ("Andes (33°S, -70°W)",           -33, -70, False),
        ("Florida (27°N, -82°W)",          27, -82, False),
        ("Hudson Bay (60°N, -85°W)",       60, -85, False),
    ]
    for label, lat, lon, expect_ice in checks:
        d, g, b, a, detected = sample(lat, lon)
        ice_type = "land" if g > 0 else "sea" if b > 0 else "none"
        status = "✓" if detected == expect_ice else "✗"
        print(f"  {status} {label}: dist={d:.0f}km, type={ice_type}, "
              f"res={g:.1f}°C, conc={b:.0%}, elev={a:.0f}m")

    # ── 8. Save RGBA PNG ──
    print("\nSaving RGBA texture...")
    output = np.stack([r_channel, g_channel, b_channel, a_channel], axis=2)
    Image.fromarray(output, mode="RGBA").save(OUTPUT_PATH, "PNG", optimize=True)
    size_kb = OUTPUT_PATH.stat().st_size // 1024
    print(f"\nIce texture saved to: {OUTPUT_PATH}")
    print(f"  Size: {size_kb}KB")
    print(f"  Resolution: {WIDTH}x{HEIGHT}")
    print(f"  Channels: R=distance, G=land_resilience, B=sea_ice, A=elevation")
    print(f"  MAX_DIST_KM={MAX_DIST_KM}, MAX_ELEV_M={MAX_ELEV_M}")
    print(f"  (Shader computes threshold per-pixel from these — no banding)")


if __name__ == "__main__":
    main()
