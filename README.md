# TerraShift

Interactive 3D globe visualizing the directional impact of climate change on sea levels, ice coverage, and snowfall. Control temperature and timeframe to see what +2°C or -6°C actually looks like on Earth.

**Goal:** Make abstract climate numbers tangible. The models are heuristics, not simulations — favoring visual impact and directional accuracy over scientific precision.

## Quick Start

```bash
pnpm install
pnpm dev          # → http://localhost:3000
```

## Features

- **Sea level rise/fall** — coastal flooding and exposed seabed rendered per-pixel from GEBCO elevation data
- **Ice growth & melt** — Greenland, Antarctica, Arctic sea ice, and mountain glaciers respond to temperature with realistic geography
- **Vegetation & biome shift** — arctic greening with dynamic treeline, subtropical desertification with Hadley cell expansion, elevation-aware forest density
- **Snowfall projections** — click any point on the globe to see how snowfall changes, powered by 30 years of ERA5 reanalysis data with wet-bulb temperature partitioning
- **Location search** — search for any location and fly the camera there
- **Sea ice seasons** — toggle between September (minimum) and March (maximum) sea ice extent
- **Time-lagged response** — sea ice shifts in decades, ice sheets in millennia

## Tech Stack

Next.js 16 · React 19 · TypeScript · Three.js / React Three Fiber · Mantine v8 · Zustand · Vercel Analytics · pnpm

## How It Works

A GLSL fragment shader composites three 16K textures per pixel at 60fps:

1. **Satellite color** (NASA Blue Marble) — what Earth looks like today
2. **DEM** (GEBCO bathymetry, ±100m) — elevation for sea level flooding
3. **Ice texture** (generated RGBA) — where ice exists and how it responds to temperature

The user controls **ΔT** (temperature change, ±40°C) and **timeframe** (10–10,000 years). A Zustand store computes sea level rise and time-lagged ice temperature, which the shader uses to flood coastlines, melt ice, and grow new ice — all in real-time.

**Snowfall projections** use a separate model: 30 years of daily precipitation from ERA5 reanalysis are binned by wet-bulb temperature. A logistic snow fraction (Jennings et al. 2018) with Clausius-Clapeyron moisture scaling projects how snowfall changes at any point on Earth.

See **[docs/algorithm.md](docs/algorithm.md)** for the full algorithm specification, math, and iteration history.

## Architecture

```
src/app/page.tsx (server)
  → src/components/EarthCanvas.tsx ("use client")    — Three.js Canvas + loading screen
    → src/components/RealisticEarth.tsx               — GLSL shader + 3 textures
    → src/components/GlobeMarker.tsx                  — clickable location pin
    → src/components/AtmosphereGlow.tsx               — atmospheric edge glow
  → src/components/ClimatePanel.tsx ("use client")    — temperature/timeframe controls
  → src/components/SnowfallPanel.tsx ("use client")   — per-location snowfall projection
  → src/components/LocationSearch.tsx ("use client")  — geocoding + camera fly-to
  → src/components/GitHubLink.tsx ("use client")      — source link

  ↕ src/stores/climate.ts (Zustand)    — SLR + ice temperature models
  ↕ src/stores/snowfall.ts (Zustand)   — snowfall state + pin location

  src/actions/snowfall.ts (server)     — ERA5 data fetch + wet-bulb binning
  src/actions/geocode.ts (server)      — location search via Open-Meteo geocoding
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
| `process-ice.py` | `earth_ice.png` (~15MB) + `sea_ice_march.png` (~3MB) | GEBCO (~28MB) + IMS 4km (~8MB) + HadISST (~16MB) | ~3 min | RGBA ice texture + March sea ice |

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
- `sea_ice_march.png` — 16K grayscale March sea ice concentration. Loaded on demand when the user toggles to Winter view.

### Data sources

| Dataset | Provider | Resolution | Format | Auth | Used for |
|---------|----------|------------|--------|------|----------|
| Blue Marble | NASA via h-schmidt.net | 43200×21600 | JPEG | None | Satellite color |
| GEBCO Bathymetry | sbcode.net (GEBCO derived) | 5400×2700 | 16-bit TIFF | None | Elevation/flooding |
| IMS Snow & Ice | NOAA/NSIDC (G02156) | 6144×6144 (~4km) | gzipped ASCII | None | NH sea ice (Sep + Mar) |
| HadISST Sea Ice | UK Met Office | 1° lat/lon (~360×180) | NetCDF3, gzipped | None | SH sea ice |
| ERA5 Reanalysis | ECMWF via Open-Meteo | ~11km (best_match) | JSON API | None | Snowfall projections |

## CDN (Cloudflare R2)

The 16K textures (~35MB total) are served from Cloudflare R2 in production to avoid Vercel bandwidth costs. R2 has zero egress fees.

**Local dev:** No setup needed — textures load from `public/textures/` when `NEXT_PUBLIC_CDN_URL` is unset.

**Production:** Set `NEXT_PUBLIC_CDN_URL` in Vercel to the R2 public URL.

**Uploading textures:** After regenerating textures, upload to R2:

```bash
# Add R2 credentials to .env.local (gitignored):
#   R2_ACCESS_KEY_ID=<your key>
#   R2_SECRET_ACCESS_KEY=<your secret>

./scripts/upload-textures.sh          # upload changed textures
./scripts/upload-textures.sh --dry    # preview what would upload
```

Requires `awscli` (`brew install awscli`). The script reads credentials from `.env.local` automatically.

## Commands

```bash
pnpm dev          # Start dev server (localhost:3000)
pnpm build        # Production build (type-checked)
pnpm lint         # ESLint
```

No test framework is configured.

## Documentation

- **[docs/algorithm.md](docs/algorithm.md)** — Full algorithm spec: sea level model, ice model, snowfall projection, shader pipeline, tuning constants, iteration history, known limitations
- **[CLAUDE.md](CLAUDE.md)** — AI assistant instructions and codebase conventions
