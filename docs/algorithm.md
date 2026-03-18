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

Five physical components (split per Levermann et al. 2013), each with exponential time response:

```
SLR = sign(ΔT) × Σᵢ [ sensitivityᵢ(|ΔT|) × (1 - e^(-t/τᵢ)) ]
```

| Component | Equilibrium Sensitivity | τ (years) | Activation | Notes |
|-----------|------------------------|-----------|------------|-------|
| Thermal expansion | 0.42 m/°C (linear) | 200 | None | Ocean heat uptake |
| Mountain glaciers | 0.34 m/°C (linear), **capped at 0.5m** | 150 | None | Finite alpine ice inventory (~0.41m SLE) |
| Greenland Ice Sheet | 7.4 m (total) | 3,000 | Sigmoid at 1.5°C | Tipping point behavior |
| West Antarctic Ice Sheet (WAIS) | 5.0 m (total) | 800 | Sigmoid at 3.0°C | Fastest major ice sheet |
| East Antarctic Ice Sheet (EAIS) | 53.0 m (total) | 10,000 | Sigmoid at 8.0°C | Slow, enormous |

**Mountain glacier cap:** The equilibrium contribution is `min(0.34 × |ΔT|, 0.5)` — at ~1.5°C all mountain glaciers are committed to melt, and further warming cannot add more (there is no more alpine ice to lose). The 0.5m cap reflects the total global alpine ice inventory.

**Sigmoid activation:** `σ(x) = 1 / (1 + e^(-(x - threshold) / steepness))`

This models tipping points — below the threshold, the ice sheet barely responds; above it, collapse accelerates. The sigmoid ensures smooth transitions.

**Example outputs:**
- +2°C, 100yr → ~0.6m (thermal + glaciers + early Greenland)
- +2°C, 3000yr → ~5.5m (thermal + glaciers + most of Greenland + some WAIS)
- +10°C, 10000yr → ~56m (everything)
- -6°C, 3000yr → ~-5.5m (sea level drop from ice growth)

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

### 3b. Vegetation Temperature Model

**Location:** `src/stores/climate.ts` → `calculateVegTemp()`

Vegetation responds faster than ice sheets but slower than weather. Tundra greening is measurable within decades; full forest migration takes centuries. Two-component exponential lag:

```
vegTemp = ΔT × (0.7 × (1 - e^(-t/30)) + 0.3 × (1 - e^(-t/500)))
```

| Component | Weight | τ (years) | Represents |
|-----------|--------|-----------|------------|
| Fast | 70% | 30 | Shrub expansion, tundra greening |
| Slow | 30% | 500 | Full forest migration |

**Response fraction at various timeframes:**
- 10 yr → 18% of ΔT
- 100 yr → 62%
- 1,000 yr → 86%
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

The shader runs per-pixel at 60fps. It reads three textures and three uniforms (`u_slr`, `u_iceTemp`, `u_vegTemp`).

#### 5.1 Sea Level Flooding

```glsl
float depth = u_slr - elevation;

if (depth > 5.0)      → deep water color
else if (depth > 0.0)  → shallow water (gradient)
else if (elevation < 0) → exposed seabed (if sea level dropped)
else                    → satellite color
```

#### 5.2 Vegetation / Biome Shift

**Location:** `src/components/RealisticEarth.tsx` (fragment shader, after sea level, before ice overlay)

Driven by `u_vegTemp` (separate, faster time constant than ice). Land pixels only (elevation ≥ 0). Three effects:

**Arctic greening** (warming, lat > 50°):
- Detects tundra via low saturation + low-medium brightness in satellite color
- Blends toward boreal green (`0.15, 0.35, 0.12`)
- Onset at +0.5°C vegTemp, full at +3°C
- Dynamic treeline: base varies by latitude (800m at 72°, 2500m at 50°), rises 150m per °C of vegTemp (Körner & Paulsen 2004, ~6.5°C/km lapse rate)
- Elevation gradient: full greening 500m+ below treeline, smooth fade to zero at treeline (not a hard cutoff)

**Subtropical drying** (warming, lat 20°–55° max):
- Detects existing green vegetation via green-dominant hue
- Drying target shifts from brown grassland (`0.55, 0.48, 0.35`) to sandy desert (`0.68, 0.58, 0.42`) at extreme temps
- Onset at +1.5°C vegTemp, full effect at +5°C, desert color at +20°C
- Upper latitude expands with warming: 38° + 0.5° per °C vegTemp (Hadley cell expansion), capped at 55°
- 75% max blend, preserving satellite luminance variation

**Cooling reversal** (negative vegTemp):
- Tundra expands equatorward into temperate zones (lat 30°–55°)
- Desaturates existing green toward brown/grey tundra colors

All effects use `smoothstep` blending against the satellite base color at ≤55% opacity, preserving the natural look.

#### 5.3 Ice Overlay (Per-Pixel Threshold)

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

**Elevation nucleation gate:** Only pixels above 1500m can nucleate ice independently via the elevation formula. Below 1500m, ice growth comes exclusively from distance-based spread from existing ice edges. This prevents the latitude bonus from creating spurious sea-level ice at low latitudes (e.g., tropical oceans icing over at -4°C).

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

#### 5.4 Lighting

Simple Lambertian diffuse + ambient:
```glsl
float light = 0.25 + max(dot(normal, lightDir), 0.0) * 0.75;
```

### 6. Weather Projection Model

**Location:** `src/components/WeatherPanel.tsx` (client-side projection), `src/actions/weather.ts` (server-side data fetch)

Click any point on the globe to see projected weather based on the current temperature setting. The baseline comes from ERA5 reanalysis; projections are computed client-side so they update instantly when the temperature slider moves. Four metrics are displayed: temperature (avg high/low), precipitation, snowfall, and humidity.

#### 6.1 Architecture: Server Aggregation + Client Projection

The model splits computation between server and client:

**Server** (`src/actions/weather.ts`): Fetches 30 years of daily `precipitation_sum`, `snowfall_sum`, `temperature_2m_mean`, `temperature_2m_max`, `temperature_2m_min`, and `relative_humidity_2m_mean` from Open-Meteo. Computes:
- **Precipitation bins:** Wet-bulb temperature per day via Stull (2011), bins total precipitation into 1°C-wide wet-bulb temperature bins (70 bins from -40°C to +29°C). Returns annual-average precipitation per bin (`precipDist[]`).
- **Temperature baselines:** Average daily high (`avgHighC` = mean of all `temperature_2m_max`) and average daily low (`avgLowC` = mean of all `temperature_2m_min`).
- **Precipitation baseline:** Annual total precipitation (`totalPrecipMm` = sum / 30 years).
- **Humidity baseline:** Average relative humidity (`avgRH` = mean of all `relative_humidity_2m_mean`).
- **Snowfall baseline:** Observed annual snowfall (`baselineSnowfallCm` = sum of `snowfall_sum` / 30 years).

**Client** (`src/components/WeatherPanel.tsx`): Projects each metric:
- **Temperature:** baseline + ΔT (simple shift)
- **Precipitation:** baseline × e^(0.06 × ΔT) (Clausius-Clapeyron scaling)
- **Snowfall:** Iterates over wet-bulb bins with temperature shift + CC scaling + logistic snow fraction. Computes a ratio vs model baseline and applies to observed baseline.
- **Humidity:** RH displayed as-is (stays ~constant under warming); absolute moisture change noted as ±6%/°C.

All projections run in <1ms, so they update instantly on slider drag.

#### 6.2 Data Source

- **API:** Open-Meteo Historical Weather API (`best_match` model — combines ERA5-Land ~11km for temperature/humidity with ERA5 for precipitation)
- **Resolution:** ~0.1 degree (~11 km) grid for temperature/humidity, ~0.25 degree (~25 km) for precipitation
- **Baseline period:** 1991-2020 (WMO 30-year climate normal)
- **Variables:** `precipitation_sum` (mm/day), `snowfall_sum` (cm/day), `temperature_2m_mean` (°C), `temperature_2m_max` (°C), `temperature_2m_min` (°C), `relative_humidity_2m_mean` (%)
- **Wet-bulb computation:** Per-day wet-bulb temperature via Stull (2011) closed-form approximation (accurate ±0.3°C for RH 5–99%, T −20°C to +50°C)
- **Binning:** Each day's `precipitation_sum` is added to the 1°C bin matching its daily mean wet-bulb temperature. Totals are divided by 30 years to get annual averages.
- **Observed baseline:** `snowfall_sum` is summed and divided by 30 for accurate baseline display (the logistic model overestimates baseline at warm-margin locations)

#### 6.3 Snow Fraction: Logistic Function (Wet-Bulb)

Determines what fraction of precipitation falls as snow using wet-bulb temperature (Jennings et al. 2018):

```
snowFraction(Tw) = 1 / (1 + exp(1.5 × (Tw - 0.5)))
```

- T50 = 0.5°C wet-bulb — temperature where rain and snow are equally likely. Lower than the 1.0°C dry-bulb threshold because wet-bulb accounts for evaporative cooling.
- Steepness a = 1.5 — observationally validated S-curve transition
- At -2°C: ~98% snow. At +3.5°C: ~1% snow.

Using wet-bulb temperature improves rain/snow partitioning in dry continental climates where dry-bulb alone overestimates snowfall (cold but dry air has a wet-bulb temperature closer to its dry-bulb, while humid air near freezing has a larger dry/wet gap).

#### 6.4 Clausius-Clapeyron Moisture Scaling

Atmospheric moisture capacity scales exponentially with temperature (O'Gorman 2014):

```
ccScale = exp(0.06 × ΔT)
```

Rate b ≈ 0.06/°C (thermodynamic rate for extratropical precipitation extremes). Applied uniformly — no asymmetric warming/cooling rates needed because the bin-based approach naturally captures shoulder-month snow extension (bins that were above freezing shift below it).

#### 6.5 Combined Projection (Calibrated Ratio)

For each temperature bin i:

```
T_shifted = T_bin + ΔT
P_scaled  = P_bin × exp(0.06 × ΔT)
snow_i    = P_scaled × snowFraction(T_shifted)

modelSnow(ΔT) = Σ snow_i
```

The model uses two approaches depending on whether the location has observed baseline snowfall:

**Calibrated ratio approach** (baseline ≥ 0.1 cm/yr):

```
changeRatio    = modelSnow(ΔT) / modelSnow(0)
projectedSnow  = observedBaseline × changeRatio
```

Where `observedBaseline` is the ERA5 `snowfall_sum` annual average. The model's physics drives the direction and magnitude of change; the observed baseline anchors it to reality. This avoids the logistic function's systematic overestimation at warm-margin locations (e.g., Atlanta: model says 12cm, ERA5 observes 4cm).

**Absolute approach** (baseline < 0.1 cm/yr — e.g., tropical locations):

```
projectedSnow  = modelSnow(ΔT)
```

When there is no observed snowfall to calibrate against (e.g., Florida at −40°C), the model output is used directly. The units work out: mm of water-equivalent ≈ cm of snow at the standard 10:1 fresh snow density ratio. This allows the model to project snowfall at locations where none currently exists.

#### 6.6 Counterintuitive Result Detection

The UI displays contextual HoverCards when results would confuse a layperson:

| Condition | Explanation shown |
|-----------|-------------------|
| ΔT < -3 AND change < -10% | **Moisture starvation** — very cold air holds far less moisture; Antarctica's interior is one of the driest places on Earth despite extreme cold |
| ΔT > +0.5 AND change > +5% | **Moisture wins** — most precipitation already falls below freezing, so +7%/°C moisture increase outpaces the rain/snow shift. Reverses at higher warming. |

#### 6.7 Edge Cases

| Condition | Handling |
|-----------|----------|
| `precipDist` empty (loading) | Panel shows loading overlay |
| Baseline < 0.1 cm AND projected < 0.1 cm | Display "Trace / negligible snowfall" |
| Baseline < 0.1 cm AND projected ≥ 0.1 cm | Absolute model; shows projected only with explanatory note |
| Ocean click | Shows ERA5 reanalysis for ocean grid cell |
| Extreme cooling (e.g. -30°C) | Moisture starvation naturally reduces snowfall; HoverCard explains |

#### 6.8 Limitations

- Precipitation resolution is ~25km (ERA5); temperature/humidity are ~11km (ERA5-Land via `best_match`)
- Shifting bins by ΔT assumes climate change shifts the mean without altering variance or skewness (Arctic amplification changes both)
- Wet-bulb approximation (Stull 2011) is accurate to ±0.3°C but degrades outside RH 5–99% and T −20°C to +50°C
- CC scaling is purely thermodynamic — cannot predict dynamic synoptic shifts (storm track changes, ENSO)
- Rate limited to 10,000 Open-Meteo requests/day (each click = 1 request)

#### 6.9 Sources

- Jennings, K.S., et al. (2018). "Spatial variation of the rain-snow temperature threshold across the Northern Hemisphere." *Nature Communications*, 9, 1148.
- O'Gorman, P.A. (2014). "Contrasting responses of mean and extreme snowfall to climate change." *Nature*, 512, 416-418.
- Held, I.M. & Soden, B.J. (2006). "Robust responses of the hydrological cycle to global warming." *Journal of Climate*, 19(21), 5686-5699.
- Stull, R. (2011). "Wet-Bulb Temperature from Relative Humidity and Air Temperature." *J. Appl. Meteor. Climatol.*, 50(11), 2267-2269.
- Open-Meteo Historical Weather API — ERA5 reanalysis (ECMWF), 0.25°, global, 1940-present.

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
| Dynamic treeline + elevation gradient | Static treeline was a binary cutoff — mountains uniformly green or not. Real treeline rises ~150m/°C (lapse rate). Replaced hard gate with smoothstep gradient (full greening 500m below treeline, fading to zero at treeline). Treeline now shifts with vegTemp. | Natural valley-to-peak gradient: dense forest → sparse → bare rock |
| Gated elevNucleation behind 1500m minimum | Latitude bonus in elevNucleation gave sea-level thresholds everywhere, causing tropical oceans to ice over at -4°C. The `max(distThreshold, elevNucleation)` let elevNucleation override the correctly-negative distThreshold. | Sea-level ice only from distance-based spread; mountain glaciation preserved |

### UI Iterations

| Change | Reason |
|--------|--------|
| Custom CSS → Mantine primitives | Inconsistent styling, too much custom code |
| Added Collapse + useDisclosure | Panel took up too much space |
| Ice mass: absolute Gt → % change | "796.4K Gt" is meaningless to users |

### SLR Model Iterations

| Version | Change | Result |
|---------|--------|--------|
| v1 | Four-component (thermal+glaciers combined, Greenland, WAIS, EAIS) | Initial implementation |
| v2 | Split thermal expansion (0.42m/°C) from mountain glaciers (0.34m/°C, capped 0.5m) | Per Levermann et al. 2013. Glaciers saturate at ~1.5°C; thermal continues scaling linearly. |

### Snowfall Projection Iterations

| Version | Approach | Result |
|---------|----------|--------|
| v1 | Snow-fraction + Clausius-Clapeyron, Open-Meteo 30yr baseline | Initial implementation. Linear snow fraction, +7%/°C moisture. Edge cases handled for tropical/trace/threshold crossover. |
| v2 | **Temperature-binned precipitation distribution** | Server bins 30yr daily precipitation by temperature (70 bins, 1°C). Client iterates bins with logistic snow fraction (Jennings 2018) + symmetric CC (6%/°C). Solves warm-margin, Wisconsin paradox, and DJF-only issues. Eliminates ad-hoc asymmetric moisture rates. |
| v3 | **Wet-bulb temperature binning + best_match resolution** | Server fetches `relative_humidity_2m_mean`, computes wet-bulb via Stull (2011), bins by wet-bulb instead of dry-bulb. Snow fraction T50 lowered from 1.0°C to 0.5°C (wet-bulb threshold). Switched to `best_match` model (~11km ERA5-Land for temp/humidity, ~25km ERA5 for precip). Improves rain/snow partitioning in dry continental climates and resolution in complex terrain. |
| v4 | **Rename to WeatherPanel + expand baseline metrics** | Renamed `SnowfallPanel`/`snowfall.ts` to `WeatherPanel`/`weather.ts`. Added `temperature_2m_max` and `temperature_2m_min` to Open-Meteo call. Server now computes avgHighC, avgLowC, totalPrecipMm, avgRH from 30-year daily data. UI shows 4 metric sections (temperature, precipitation, snowfall, humidity). Snowfall projection model unchanged. |
| v5 | **Absolute fallback for zero-baseline locations** | Ratio model (`projected = baseline × ratio`) can't create snowfall where none exists (0 × anything = 0). Added absolute fallback: when baseline < 0.1 cm, use model output directly (mm water-equiv ≈ cm snow at 10:1 SWE). UI shows projected-only with note when baseline is trace but projected is significant. Fixes Florida at −40°C showing "negligible" despite −11°C avg high. |

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

Arctic greening: onset 0.5°C, full 3.0°C, max opacity 0.70, lat > 50°, treeline rises 150m/°C, 500m fade zone
Subtropical drying: onset 1.5°C, full 5.0°C, max opacity 0.75, lat 20°–(38+0.5×vegTemp)° capped 55°, desert color at 20°C+
Cooling tundra expansion: onset 1.0°C, full 5.0°C, max opacity 0.40, lat 30°–55°
```

### Vegetation Constants (`climate.ts`)
```
vegTemp fast: τ=30yr, weight=0.7 (shrub expansion)
vegTemp slow: τ=500yr, weight=0.3 (forest migration)
```

### SLR Constants (`climate.ts`)
```
Thermal expansion: 0.42 m/°C, τ=200yr
Mountain glaciers: 0.34 m/°C, τ=150yr, capped at 0.5m total
Greenland: 7.4m, τ=3000yr, sigmoid(1.5°C, steepness=1.0)
WAIS: 5.0m, τ=800yr, sigmoid(3.0°C, steepness=1.5)
EAIS: 53.0m, τ=10000yr, sigmoid(8.0°C, steepness=3.0)
```
