# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev          # Start dev server (localhost:3000)
pnpm build        # Production build
pnpm lint         # ESLint (flat config, eslint.config.mjs)
```

No test framework is configured yet.

## Tech Stack

- **Next.js 16** with App Router (`src/app/`) and React 19
- **React Compiler** enabled via `reactCompiler: true` in next.config.ts
- **TypeScript** in strict mode; path alias `@/*` → `./src/*`
- **pnpm** as package manager (versions pinned in package.json, no `^` ranges)
- **Mantine v8** for UI components (`@mantine/core`, `@mantine/hooks`, `@mantine/charts`)
- **PostCSS** with `postcss-preset-mantine` and breakpoint variables
- **Zustand** for state management
- **Three.js 0.183** / React Three Fiber v9 / Drei v10 for 3D graphics
- **ESLint 10** flat config with `@eslint-react/eslint-plugin` and `typescript-eslint`

## Architecture

- App Router: all routes under `src/app/`, server components by default
- `"use client"` boundary: `EarthCanvas.tsx` and `Interface.tsx` are client components; `page.tsx` stays server
- Styling: Mantine components first, CSS modules (`*.module.css`) for page-specific styles
- Fonts: Geist Sans & Geist Mono via `next/font`
- Mantine package imports are optimized in next.config.ts (`optimizePackageImports`)
- Color scheme: dark mode by default (`defaultColorScheme="dark"`)

## 3D Globe Architecture

```
page.tsx (server) → EarthCanvas.tsx ("use client") → RealisticEarth.tsx
                  → Interface.tsx ("use client")
                  ↕ ClimateStore (Zustand) ↕
```

- **ClimateStore** (`src/stores/climate.ts`): Zustand store with tempDiff, timeFrame, derived SLR + iceTemp
- **SLR Model**: Multi-component with sigmoid-activated tipping points (thermal, Greenland, WAIS, EAIS)
- **Ice Model**: Time-lagged two-component response (fast τ=50yr + slow τ=2000yr)
- **RealisticEarth**: Custom GLSL ShaderMaterial reads DEM + ice textures, applies SLR flooding then ice overlay
- **Interface**: Mantine sliders write to store; logarithmic scale for timeframe slider (10–10,000yr)
- Shader uniforms updated every frame via `useFrame` + `useClimateStore.getState()` (no React re-renders)

## Textures

- `public/textures/earth_color.jpg`: 16K JPEG, NASA Blue Marble
- `public/textures/earth_dem.png`: 16K 8-bit grayscale, ±100m range (0.78m/step)
- `public/textures/earth_ice.png`: 16K RGBA PNG (R=distance, G=land resilience, B=sea ice conc, A=elevation)
- `public/textures/sea_ice_march.png`: 16K grayscale March sea ice (for future seasonal toggle)
- Ice texture stores raw ingredients; shader computes threshold per-pixel at float precision (no 8-bit banding)
- Sea ice sources: NH from NOAA IMS 4km (no auth), SH from HadISST 1° (both Sep + Mar downloaded)
- Generated from: satellite ice detection + IMS/HadISST sea ice + distance transform + GEBCO elevation
- Regenerate: `echo "y" | scripts/.venv/bin/python scripts/process-ice.py` (downloads GEBCO + IMS + HadISST, ~3min)

## Algorithm Documentation

**Full spec lives in [`docs/algorithm.md`](docs/algorithm.md)** — this is the source of truth for how all models work.

When modifying any of the following, you MUST update `docs/algorithm.md` **and** the in-app methodology panels to match:
- **SLR model** (`src/stores/climate.ts` → `calculateSLR`): update §2 "Sea Level Rise Model" + `ClimatePanel.tsx` methodology section & modal
- **Ice temperature model** (`src/stores/climate.ts` → `calculateIceTemp`): update §3 "Ice Temperature Model" + `ClimatePanel.tsx` modal
- **Ice texture generation** (`scripts/process-ice.py`): update §4 "Ice Threshold Texture Generation"
- **GLSL shader ice/flood logic** (`src/components/RealisticEarth.tsx`): update §5 "GLSL Fragment Shader"
- **Weather model** (`src/components/WeatherPanel.tsx`, `src/actions/weather.ts`): update §6 "Weather Projection Model" + `WeatherPanel.tsx` methodology section & modal
- **Tuning constants**: update the "Tuning Reference" section at the bottom
- **Any new approach or rejected approach**: add to "Iteration History" section

The iteration history in `docs/algorithm.md` tracks every approach we've tried and why it was accepted/rejected. **Always check this before proposing a new approach** to avoid re-trying something that already failed. When making changes, add a row to the relevant table (shader iterations, ice model versions, etc.) explaining what changed and why.

## Conventions

- React Compiler handles memoization; do NOT use `useMemo`/`useCallback` except for Three.js object stability
- GLSL shaders: inline template strings in component files (not separate .glsl files)
- Textures in `public/textures/`, served via Vercel CDN
- Dependency versions are pinned (no `^` ranges) — always use exact versions when adding packages (`pnpm add --save-exact` or manually remove `^`)
- Scripts use `scripts/.venv/` Python venv with Pillow, numpy, requests, scipy
