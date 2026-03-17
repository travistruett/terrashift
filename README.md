# TerraShift

Interactive 3D globe visualizing the directional impact of climate change on sea levels and ice coverage. Control temperature and timeframe to see what +2°C or -6°C actually looks like on Earth.

**Goal:** Make abstract climate numbers tangible. The models are heuristics, not simulations — favoring visual impact and directional accuracy over scientific precision.

## Quick Start

```bash
pnpm install
pnpm dev          # → http://localhost:3000
```

## Tech Stack

Next.js 16 · React 19 · TypeScript · Three.js / React Three Fiber · Mantine v8 · Zustand · pnpm

## How It Works

A GLSL fragment shader composites three 16K textures per pixel at 60fps:

1. **Satellite color** (NASA Blue Marble) — what Earth looks like today
2. **DEM** (GEBCO bathymetry, ±100m) — elevation for sea level flooding
3. **Ice threshold** (generated) — where ice exists and how it responds to temperature

The user controls **ΔT** (temperature change, ±40°C) and **timeframe** (10–10,000 years). A Zustand store computes sea level rise and time-lagged ice temperature, which the shader uses to flood coastlines, melt ice, and grow new ice — all in real-time.

See **[docs/algorithm.md](docs/algorithm.md)** for the full algorithm specification, math, and iteration history.

## Architecture

```
src/app/page.tsx (server)
  → src/components/EarthCanvas.tsx ("use client")  — Three.js Canvas
    → src/components/RealisticEarth.tsx             — GLSL shader + 3 textures
  → src/components/Interface.tsx ("use client")     — Mantine UI panel
  ↕ src/stores/climate.ts (Zustand)                — SLR + ice models
```

## Scripts

All texture generation scripts live in `scripts/` and use a local Python venv.

### First-time setup

```bash
python3 -m venv scripts/.venv
scripts/.venv/bin/pip install Pillow numpy requests scipy
```

### Texture generation

Run these to regenerate the 16K textures in `public/textures/`. Each script downloads its source data, processes it, and writes the output. They prompt before overwriting.

| Script | Output | Downloads | Time | Description |
|--------|--------|-----------|------|-------------|
| `process-color.py` | `earth_color.jpg` (~8MB) | NASA Blue Marble 43K (~55MB) | ~2 min | Satellite imagery, downscaled to 16K |
| `process-dem.py` | `earth_dem.png` (~5MB) | GEBCO bathymetry (~28MB) | ~30s | ±100m elevation, 8-bit grayscale |
| `process-ice.py` | `earth_ice.png` (~15MB) + `sea_ice_march.png` (~3MB) | GEBCO (~28MB) + IMS 4km (~8MB) + HadISST (~16MB) | ~3 min | RGBA ice texture + March sea ice for future seasonal toggle |

**Run with:**
```bash
# Individual
scripts/.venv/bin/python scripts/process-color.py

# All (with auto-confirm overwrite)
echo "y" | scripts/.venv/bin/python scripts/process-color.py
echo "y" | scripts/.venv/bin/python scripts/process-dem.py
echo "y" | scripts/.venv/bin/python scripts/process-ice.py
```

**After regenerating textures:** hard-refresh your browser (Cmd+Shift+R) to clear the Three.js texture cache.

### `process-ice.py` details

Generates two textures from three data sources:

1. **Satellite ice detection** — finds bright white pixels at high latitude in `earth_color.jpg`
2. **Real sea ice concentration** — NH from NOAA IMS 4km (polar stereographic, reprojected to equirectangular), SH from HadISST 1°. Downloads 10 years of September (Arctic minimum) and March (Arctic maximum), averages for pseudo-concentration.
3. **GEBCO elevation** — for terrain height encoding

**Outputs:**
- `earth_ice.png` — 16K RGBA: R=distance from ice edge, G=land ice resilience, B=September sea ice concentration, A=elevation. Used by the GLSL shader for ice grow/shrink.
- `sea_ice_march.png` — 16K grayscale March sea ice concentration. Saved for a future seasonal toggle (not yet wired into the shader).

### Data sources

| Dataset | Provider | Resolution | Format | Auth | Used for |
|---------|----------|------------|--------|------|----------|
| Blue Marble | NASA via h-schmidt.net | 43200×21600 | JPEG | None | Satellite color |
| GEBCO Bathymetry | sbcode.net (GEBCO derived) | 5400×2700 | 16-bit TIFF | None | Elevation/flooding |
| IMS Snow & Ice | NOAA/NSIDC (G02156) | 6144×6144 (~4km) | gzipped ASCII | None | NH sea ice (Sep + Mar) |
| HadISST Sea Ice | UK Met Office | 1° lat/lon (~360×180) | NetCDF3, gzipped | None | SH sea ice fallback |

## Commands

```bash
pnpm dev          # Start dev server (localhost:3000)
pnpm build        # Production build (type-checked)
pnpm lint         # ESLint
```

No test framework is configured.

## Documentation

- **[docs/algorithm.md](docs/algorithm.md)** — Full algorithm spec: sea level model, ice model, shader pipeline, tuning constants, iteration history, known limitations
- **[CLAUDE.md](CLAUDE.md)** — AI assistant instructions and codebase conventions
