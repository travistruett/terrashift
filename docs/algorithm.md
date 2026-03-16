# TerraShift Algorithm Documentation

## Overview

TerraShift renders a 3D globe showing the directional impact of climate change on sea levels and ice coverage. The user controls two inputs — **temperature change** (ΔT, ±40°C) and **timeframe** (10–10,000 years) — and the globe updates in real-time to show flooding, ice growth, and ice melt.

All models are **heuristic approximations**, not physical simulations. The goal is to make abstract climate numbers tangible: "what does +2°C actually look like?"

---

## High-Level Summary

### How It Works (Plain English)

1. **Three textures** are loaded onto a 3D sphere: a satellite photo (what Earth looks like), a height map (elevation above/below sea level), and an ice map (where ice exists and how easily it melts/grows).

2. When you raise the temperature, three things happen:
   - **Sea level rises** — low-lying coastal areas flood with water (blue overlay)
   - **Ice melts** — existing ice (Greenland, Antarctica, Arctic sea ice) gradually disappears, revealing the terrain underneath
   - **Ice coverage shrinks** — the white ice overlay becomes thinner and retreats toward the poles

3. When you lower the temperature, ice **grows outward** from its current real-world boundaries. The growth follows real geography — it spreads along coastlines, over high ground, and across polar oceans — not in artificial circles.

4. Everything responds to time: sea ice shifts in decades, ice sheets take millennia. A +2°C world in 100 years looks very different from +2°C in 10,000 years.

### The Rendering Pipeline

```
User Input (ΔT, timeframe)
    ↓
Zustand Store (calculates SLR + iceTemp)
    ↓
GLSL Fragment Shader (runs per-pixel, 60fps):
    ↓
┌─────────────────────────────────────────┐
│ 1. Read elevation from DEM texture      │
│ 2. Sea level: flood or expose seabed    │
│ 3. Ice melt: reveal terrain under ice   │
│ 4. Ice growth: white overlay with       │
│    concentration-based opacity          │
│ 5. Apply lighting                       │
└─────────────────────────────────────────┘
    ↓
Rendered Globe
```

---

## Technical Specification

### 1. Texture Encoding

All textures are 16384×8192 (16K) equirectangular projection.

| Texture | Format | Encoding | Source |
|---------|--------|----------|--------|
| `earth_color.jpg` | RGB JPEG | Direct satellite color | NASA Blue Marble via h-schmidt.net |
| `earth_dem.png` | 8-bit grayscale | `elevation = pixel × 200/255 - 100` meters | GEBCO bathymetry |
| `earth_ice.png` | RGBA PNG | 4-channel raw ingredients (see below) | Generated (see §4) |

**DEM encoding detail:**
- Pixel 0 = -100m, pixel 128 ≈ 0m (sea level), pixel 255 = +100m
- Resolution: 0.78m per pixel step
- Range chosen to capture coastal flooding (±100m covers all plausible SLR scenarios)

**Ice RGBA encoding detail:**
Instead of pre-computing a threshold (which creates 8-bit banding at 0.31°C/step), the texture stores **raw ingredients** and the shader computes thresholds per-pixel at float precision.

| Channel | Contents | Encoding | Range |
|---------|----------|----------|-------|
| R | Distance from ice edge | `sqrt(dist_km / 8000)` | 0–8000 km, ~3km/step near edges |
| G | Land ice resilience | `resilience / 10.0` | 0–10°C (satellite-detected ice only) |
| B | Sea ice concentration | Direct from HadISST | 0–1 (ocean pixels only) |
| A | Terrain elevation | `elevation / 9000` | 0–9000m (full range, not ±100m DEM) |

- `G > 0` → land ice pixel (Greenland, Antarctica, mountain glaciers)
- `B > 0` → sea ice pixel (HadISST observational data)
- `R > 0, G = 0, B = 0` → non-ice pixel (distance to nearest ice edge)
- The shader uses these channels to compute a unique float threshold per pixel, eliminating quantization bands entirely

### 2. Sea Level Rise Model

**Location:** `src/stores/climate.ts` → `calculateSLR()`

Four physical components, each with exponential time response:

```
SLR = sign(ΔT) × Σᵢ [ sensitivityᵢ(|ΔT|) × (1 - e^(-t/τᵢ)) ]
```

| Component | Equilibrium Sensitivity | τ (years) | Activation | Notes |
|-----------|------------------------|-----------|------------|-------|
| Thermal expansion + mountain glaciers | 0.5 m/°C (linear) | 200 | None | Fast, modest |
| Greenland Ice Sheet | 7.4 m (total) | 3,000 | Sigmoid at 1.5°C | Tipping point behavior |
| West Antarctic Ice Sheet (WAIS) | 5.0 m (total) | 800 | Sigmoid at 3.0°C | Fastest major ice sheet |
| East Antarctic Ice Sheet (EAIS) | 53.0 m (total) | 10,000 | Sigmoid at 8.0°C | Slow, enormous |

**Sigmoid activation:** `σ(x) = 1 / (1 + e^(-(x - threshold) / steepness))`

This models tipping points — below the threshold, the ice sheet barely responds; above it, collapse accelerates. The sigmoid ensures smooth transitions.

**Example outputs:**
- +2°C, 100yr → ~0.3m (thermal + early Greenland)
- +2°C, 3000yr → ~5.4m (thermal + most of Greenland + some WAIS)
- +10°C, 10000yr → ~56m (everything)
- -6°C, 3000yr → ~-5.4m (sea level drop from ice growth)

### 3. Ice Temperature Model

**Location:** `src/stores/climate.ts` → `calculateIceTemp()`

Ice doesn't respond instantly to temperature. Two-component exponential lag:

```
iceTemp = ΔT × (0.3 × (1 - e^(-t/50)) + 0.7 × (1 - e^(-t/2000)))
```

| Component | Weight | τ (years) | Represents |
|-----------|--------|-----------|------------|
| Fast | 30% | 50 | Sea ice, mountain glaciers |
| Slow | 70% | 2,000 | Continental ice sheets |

**Response fraction at various timeframes:**
- 10 yr → 6% of ΔT
- 100 yr → 29%
- 1,000 yr → 57%
- 10,000 yr → 99%

### 4. Ice Texture Generation (RGBA)

**Location:** `scripts/process-ice.py`

This is the most complex part. The script generates an RGBA texture storing raw ingredients for per-pixel threshold computation in the shader.

#### 4.1 Present-Day Ice Detection

Two sources combined:

**A. Satellite detection** from NASA Blue Marble:
```
is_ice = (brightness > 185) AND (saturation < 0.20) AND (|latitude| > 55°)
```
- Catches: Greenland, Antarctic ice sheet, glaciers
- Also detects mountain ice: brightness > 210 AND saturation < 0.12 AND elevation > 3000m AND |lat| > 25°
- Guaranteed: all Antarctic land below -65° latitude

**B. HadISST sea ice concentration** (UK Met Office):
- Downloads `HadISST_ice.nc.gz` — monthly sea ice from passive microwave satellites
- Averages last 10 Septembers (Arctic minimum extent)
- Where concentration > 15% AND pixel is ocean → mark as sea ice
- Data is on 1° lat/lon grid, bilinear upscaled to 16K

#### 4.2 Distance Transform

After detecting all present-day ice, compute the **Euclidean distance transform** (`scipy.ndimage.distance_transform_edt`) from every non-ice pixel to the nearest ice edge. Convert to kilometers:

```
dist_km = dist_pixels × 111.0 × 360.0 / 16384
```

(Uses equatorial pixel scale ~2.44 km/pixel.)

#### 4.3 RGBA Channel Encoding

Instead of computing a threshold and encoding it in 8 bits (which creates visible banding), each channel stores a raw ingredient:

**R channel — Distance from ice edge** (non-ice pixels only):
```
R = sqrt(clamp(dist_km / 8000, 0, 1)) × 255
```
Square root encoding gives ~3 km/step near ice edges (where precision matters most) vs ~35 km/step far away.

**G channel — Land ice resilience** (satellite-detected ice only):
```
resilience = clamp(0.5 + 7.5 × max((|lat| - 25) / 65, 0)^1.5, 0.5, 8.0)
G = (resilience / 10.0) × 255
```
Polar ice (90°) → ~8°C (very resilient). Temperate ice (55°) → ~2°C.

**B channel — Sea ice concentration** (HadISST data, non-satellite sea ice only):
```
B = concentration × 255
```
Direct from HadISST observations. 15% → barely frozen. 100% → solid pack ice.

**A channel — Terrain elevation** (all pixels):
```
A = clamp(elevation, 0, 9000) / 9000 × 255
```
Full elevation range (0–9000m), not the ±100m DEM. Mountains at 5000m+ now affect ice growth in the shader. This elevation data comes from the same GEBCO source before the ±100m clamp.

### 5. GLSL Fragment Shader

**Location:** `src/components/RealisticEarth.tsx`

The shader runs per-pixel at 60fps. It reads three textures and two uniforms (`u_slr`, `u_iceTemp`).

#### 5.1 Sea Level Flooding

```glsl
float depth = u_slr - elevation;

if (depth > 5.0)      → deep water color
else if (depth > 0.0)  → shallow water (gradient)
else if (elevation < 0) → exposed seabed (if sea level dropped)
else                    → satellite color
```

#### 5.2 Ice Overlay (Per-Pixel Threshold)

The shader reads the RGBA ice texture and computes a threshold at full float precision per pixel:

```glsl
vec4 iceTex = texture2D(u_ice, vUv);
float distNorm = iceTex.r;   // sqrt-encoded distance
float landRes  = iceTex.g;   // land ice resilience
float seaConc  = iceTex.b;   // sea ice concentration
float iceElev  = iceTex.a;   // terrain elevation

float iceThreshold;
if (landRes > 0.008)         // Land ice: resilience-based
    iceThreshold = landRes * 10.0;
else if (seaConc > 0.06)     // Sea ice: concentration-based
    iceThreshold = seaConc * 2.0;
else {                        // Non-ice: distance + terrain + latitude
    float dist_km = distNorm * distNorm * 8000.0;   // undo sqrt
    float lat = abs(0.5 - vUv.y) * 180.0;
    float elev_m = iceElev * 9000.0;
    float growthRate = 100.0 + 500.0 * pow(lat / 90.0, 1.2) + 0.25 * elev_m;
    iceThreshold = -(dist_km / growthRate);
}
```

Key difference from previous approach: threshold is computed per-pixel using continuous float values instead of read from a quantized 8-bit texture. Each pixel gets a unique threshold from the combination of distance, latitude, and elevation — no contour bands.

**Growth rate formula:** `100 + 500 × (|lat|/90)^1.2 + 0.25 × elevation_m`
- At equator: ~100 km/°C (very slow growth)
- At 60°N: ~380 km/°C (moderate)
- At pole: ~600 km/°C (fast)
- At 5000m elevation: adds 1250 km/°C (mountains freeze much faster)

**Ice delta:** `iceDelta = iceThreshold - u_iceTemp`
- Positive → ice is present
- Negative → ice has melted

**Ice melt** (revealing terrain under melting ice):
```glsl
if (iceThreshold > 0.3 && iceDelta < 0.0) {
    meltAmount = smoothstep(0.0, -5.0, iceDelta);
    // Water below sea level, tundra→rock gradient above
    color = mix(color, underIce, meltAmount);
}
```

The DEM contains **bedrock elevation** under ice sheets (from radar sounding data), so Greenland's interior correctly shows as below sea level (would become ocean if fully deglaciated).

**Ice growth** (white overlay with concentration-based opacity):
```glsl
float iceAmount = smoothstep(-1.0, 2.0, iceDelta);
float iceStrength = smoothstep(0.0, 2.0, max(iceThreshold, iceDelta));
float opacity = iceAmount * mix(0.55, 0.95, iceStrength);
```

`max(iceThreshold, iceDelta)` handles both present-day ice (strong threshold → opaque) and growing ice (strong delta → gets more opaque as it establishes).

#### 5.3 Lighting

Simple Lambertian diffuse + ambient:
```glsl
float light = 0.25 + max(dot(normal, lightDir), 0.0) * 0.75;
```

---

## Iteration History

A running log of approaches tried, what worked, and what didn't.

### Ice Model Versions

#### v1: Circular Zones (REJECTED)
- **Approach:** 9 circular zones (Antarctic, Greenland, Arctic, Laurentide, etc.) with center/edge temperature gradients using haversine distance.
- **Problem:** Obvious perfect circles visible on the globe. Looked very artificial.

#### v2: Circular Zones + Elevation (REJECTED)
- **Approach:** Added GEBCO elevation with lapse rate (6°C/km) to modulate zone thresholds.
- **Problem:** Circles still dominated. Lapse rate too aggressive — put false ice on Rockies and Alps at ΔT=0. Reduced to 2°C/km but circles remained visible.

#### v3: Satellite Detection + Rectangular Regions (REJECTED)
- **Approach:** Detected ice from satellite color. Used rectangular lat/lon regions for glacial spreading, capped at -0.5°C to prevent ΔT=0 artifacts.
- **Problem:** Arctic Ocean showed translucent blob from base latitude formula giving positive thresholds at high latitudes. Rectangles were better than circles but still somewhat artificial.

#### v4: Distance Transform + Formula Sea Ice (REPLACED)
- **Approach:** Detect ice from satellite → distance transform → growth rate varies by lat+elevation → latitude-based sea ice bonus for polar ocean.
- **Problem:** Sea ice bonus was purely latitude-based, creating visible spoke/ray artifacts radiating from the pole. Shape didn't match real Arctic ice.

#### v5: Distance Transform + HadISST Real Sea Ice (REPLACED)
- **Approach:** Same as v4 but replaced formula-based sea ice with real observational data from UK Met Office HadISST dataset (September mean of last 10 years, passive microwave satellite observations).
- **Result:** Arctic sea ice boundary follows real geography. But still encoded threshold in 8 bits → visible contour bands despite dithering and blur attempts.

#### v6: RGBA Texture + Per-Pixel Shader Threshold (CURRENT)
- **Approach:** Store raw ingredients (distance, resilience, concentration, elevation) in RGBA channels instead of pre-computed threshold. Shader computes threshold per-pixel at float precision.
- **Key insight:** 80°C in 256 levels = 0.31°C steps → visible contour bands. No amount of dithering/blur fixes this. Moving the computation to the shader eliminates the quantization entirely.
- **Bonus:** A channel stores full 0–9000m elevation (the DEM texture caps at ±100m), so mountains now strongly influence ice growth. Andes, Rockies, Himalayas freeze at higher temperatures.
- **Result:** Smooth, band-free ice transitions. Ice follows terrain naturally.

### Shader Iterations

| Change | Reason | Result |
|--------|--------|--------|
| Added ice melt phase | Greenland stayed white at +38°C | Greenland now reveals terrain when warming |
| Widened smoothstep from 2°C to 5°C | Visible contour bands | Smoother transitions |
| Increased Gaussian blur σ=5 → σ=8 | Still some banding | Reduced but not eliminated |
| Added dithering (±0.3°C noise) | 8-bit quantization still visible | Bands effectively eliminated |
| Flat tundra → elevation-based terrain | Melted ice showed unrealistic flat brown | Below-sea-level areas show ocean, low areas show tundra |
| Flat 0.9 opacity → concentration-based | All ice same opacity, unrealistic | Translucent edges, opaque centers |
| Removed ocean opacity penalty | Dense pack ice was too translucent | Pack ice now solid white |
| Replaced fract(sin()) dither with IGN | Visible moiré patterns when zoomed | Screen-space noise, no patterns |
| Replaced 8-bit threshold read with RGBA per-pixel | 20+ iterations couldn't fix banding | Band-free transitions at float precision |

### UI Iterations

| Change | Reason |
|--------|--------|
| Custom CSS → Mantine primitives | Inconsistent styling, too much custom code |
| Added Collapse + useDisclosure | Panel took up too much space |
| Ice mass: absolute Gt → % change | "796.4K Gt" is meaningless to users |

---

## Known Limitations

1. **1° sea ice resolution** — HadISST is 360×180, upscaled to 16K. Boundary is smooth but not pixel-sharp. Could improve by using higher-resolution NSIDC 25km data (requires polar stereographic reprojection).

2. **September-only sea ice** — We use September (Arctic minimum). A seasonal toggle could show March maximum. Currently the same month is used globally (September = Arctic minimum, Antarctic near-maximum).

3. **No ice-free base texture** — When ice melts, terrain color is procedural (elevation-based) rather than from actual ice-free imagery. No standard "ice-free Earth" satellite image exists. Could generate one from elevation + latitude coloring.

4. **SLR model is symmetric** — Cooling produces negative SLR (sea level drop) using the same formula reversed. Real ice growth is slower than ice loss.

5. **8-bit distance quantization** — Distance channel has ~3km resolution near ice edges (sqrt encoding helps). Not visible as banding since the shader combines it with continuous latitude and elevation values.

6. **Small island ring artifacts** — Distance transform radiates concentrically from small ice patches (Svalbard, Iceland), creating subtle ring patterns.

---

## Tuning Reference

### Shared Constants (`src/constants/ice.ts`)

Source of truth for values shared between texture generation and shader. Both `process-ice.py` and `RealisticEarth.tsx` reference this file.

```
MAX_DIST_KM = 8000           # R channel encoding range
MAX_ELEV_M = 9000            # A channel encoding range
LAND_RES_SCALE = 10.0        # G channel: resilience / scale
SEA_ICE_RES_SCALE = 2.0      # Shader: seaConc × scale
GROWTH_BASE = 100             # km/°C at equator
GROWTH_LAT = 500              # additional km/°C at pole
GROWTH_ELEV = 0.25            # km/°C per meter elevation
```

### Ice Detection Constants (`process-ice.py` only)
```
ICE_BRIGHT_MIN = 185        # satellite detection brightness
ICE_SAT_MAX = 0.20          # satellite detection max saturation
ICE_LAT_MIN = 55            # min |latitude| for general detection
SEA_ICE_CONC_MIN = 0.15     # 15% IPCC standard
```

### Shader Visual Constants (`RealisticEarth.tsx` only)
```
Ice growth smoothstep = (-1.0, 2.0) — 3°C blend zone
Ice melt smoothstep = (0.0, -5.0) — 5°C melt zone
Opacity range = 0.55 (thin edge) to 0.95 (dense/land)
Opacity ramp = smoothstep(0.0, 2.0, max(threshold, delta))
```

### SLR Constants (`climate.ts`)
```
Thermal: 0.5 m/°C, τ=200yr
Greenland: 7.4m, τ=3000yr, sigmoid(1.5°C, steepness=1.0)
WAIS: 5.0m, τ=800yr, sigmoid(3.0°C, steepness=1.5)
EAIS: 53.0m, τ=10000yr, sigmoid(8.0°C, steepness=3.0)
```
