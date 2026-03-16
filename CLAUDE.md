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
- **ESLint 9** flat config with `next/core-web-vitals` and `next/typescript`

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

- **ClimateStore** (`src/stores/climate.ts`): Zustand store with tempDiff, timeFrame, derived SLR
- **SLR Model**: Multi-component with sigmoid-activated tipping points (thermal, Greenland, WAIS, EAIS)
- **RealisticEarth**: Custom GLSL ShaderMaterial reads DEM + ice textures, applies SLR flooding then ice overlay
- **Interface**: Mantine sliders write to store; logarithmic scale for timeframe slider (10–10,000yr)
- Shader uniforms updated every frame via `useFrame` + `useClimateStore.getState()` (no React re-renders)

## Textures

- `public/textures/earth_color.jpg`: 16K (16384x8192) JPEG, NASA Blue Marble
- `public/textures/earth_dem.png`: 16K (16384x8192) 8-bit grayscale, ±100m range
- `public/textures/earth_ice.png`: 16K (16384x8192) 8-bit grayscale, ice threshold map
- DEM encoding: pixel 0 = -100m, pixel 128 = sea level (0m), pixel 255 = +100m (0.78m/step)
- Ice encoding: pixel 0 = -40°C, pixel 128 ≈ 0°C, pixel 255 = +40°C (threshold ΔT for ice coverage)
- DEM source: GEBCO bathymetry data (10800x5400, upscaled to 16K)
- Color source: NASA Blue Marble via h-schmidt.net (43200x21600, downscaled to 16K)
- Ice source: generated from latitude model + paleoclimate-calibrated ice sheet zones
- Regenerate: `scripts/.venv/bin/python scripts/process-color.py` / `process-dem.py` / `process-ice.py`

## Conventions

- React Compiler handles memoization; do NOT use `useMemo`/`useCallback` except for Three.js object stability
- GLSL shaders: inline template strings in component files (not separate .glsl files)
- Textures in `public/textures/`, served via Vercel CDN
- Dependency versions are pinned (no `^` ranges) — update deliberately
