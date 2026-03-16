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
| `process-ice.py` | `earth_ice.png` (~15MB) | GEBCO (~28MB) + HadISST (~16MB) | ~90s | RGBA ice texture (distance, resilience, concentration, elevation) |

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

### Data sources

| Dataset | Provider | Resolution | Format | Auth |
|---------|----------|------------|--------|------|
| Blue Marble | NASA via h-schmidt.net | 43200×21600 | JPEG | None |
| GEBCO Bathymetry | sbcode.net (GEBCO derived) | 5400×2700 | 16-bit TIFF | None |
| HadISST Sea Ice | UK Met Office | 1° lat/lon (~360×180) | NetCDF3, gzipped | None |

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
