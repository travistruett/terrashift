// Shared constants between ice texture generation (process-ice.py) and
// GLSL shader (RealisticEarth.tsx). If you change a value here, regenerate
// the ice texture: echo "y" | scripts/.venv/bin/python scripts/process-ice.py

// ── Texture encoding ranges ──
// These MUST match the encoding in process-ice.py
export const MAX_DIST_KM = 8000.0; // R channel: sqrt(dist_km / MAX_DIST_KM)
export const MAX_ELEV_M = 9000.0; // A channel: elevation / MAX_ELEV_M
export const LAND_RES_SCALE = 10.0; // G channel: resilience / LAND_RES_SCALE
export const SEA_ICE_RES_SCALE = 2.0; // Shader: seaConc * SEA_ICE_RES_SCALE

// ── Shader-only: ice growth rate ──
// growthRate = GROWTH_BASE + GROWTH_LAT * (lat/90)^1.2 + GROWTH_ELEV * elev_m
export const GROWTH_BASE = 100.0; // km/°C at equator (very slow)
export const GROWTH_LAT = 500.0; // additional km/°C at pole
export const GROWTH_ELEV = 0.25; // km/°C per meter elevation
