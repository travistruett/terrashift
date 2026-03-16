# Snowfall Projection Feature — Design Spec

## Overview

Add click-to-inspect snowfall projections to TerraShift. Users click any point on the globe to see baseline annual snowfall (30-year climate normal) and projected snowfall based on the current temperature/timeframe settings. A Mantine card displays the results with formula inputs visible, and a marker pin indicates the selected point on the globe.

## Architecture

```
User clicks globe
       |
       v
EarthCanvas (raycast -> lat/lng)
       |
       v
SnowfallStore.fetch(lat, lng)  <- triggers loading state
       |
       v
Server Action: fetchSnowfallBaseline(lat, lng)
  +-- Open-Meteo Historical API (1991-2020 daily snowfall_sum + temperature)
  +-- Computes: annualSnowfallCm, meanWinterTempC
  +-- Returns: { lat, lng, baselineSnowfallCm, meanWinterTempC }
       |
       v
SnowfallStore stores baseline data, clears loading
       |
       v
SnowfallPanel (Mantine Card) reads:
  - baseline from snowfall store
  - tempDiff from ClimateStore
  - derives projectedSnowfall via snow-fraction formula (client-side, reactive)
```

### Key Files

| File | Type | Purpose |
|------|------|---------|
| `src/actions/snowfall.ts` | `'use server'` | Fetches + aggregates Open-Meteo 30yr data |
| `src/stores/snowfall.ts` | Zustand store | Baseline data, loading state, selected point |
| `src/components/SnowfallPanel.tsx` | `'use client'` | Mantine Card with LoadingOverlay, projection display |
| `src/components/EarthCanvas.tsx` | Modified | Adds raycasting click handler |
| `src/components/RealisticEarth.tsx` | Modified | Renders marker pin at selected point, exposes onClick |
| `src/app/page.tsx` | Modified | Adds `<SnowfallPanel />` to the page layout |

### Data Flow

1. **Click vs. drag**: Record pointer position on `onPointerDown`. On `onPointerUp`, if the pointer moved less than 5px, treat it as a click. Otherwise, ignore (it was an orbit drag). This prevents every orbit rotation from triggering a snowfall lookup.
2. **Raycast to coords**: Convert Three.js intersection point on the unit sphere to geographic coordinates:
   ```ts
   const { x, y, z } = intersection.point;
   const lat = Math.asin(y) * (180 / Math.PI);
   const lng = Math.atan2(x, z) * (180 / Math.PI);
   ```
   (Assumes default Three.js `SphereGeometry` orientation: Y-up, equator at y=0.)
3. **Grid-cell dedup**: Round lat/lng to nearest 0.25 degrees (one ERA5 grid cell). If the rounded coords match the current selection, skip the fetch — reuse cached baseline.
4. **Store update + fetch**: The click handler calls `snowfallStore.fetchBaseline(lat, lng)`, which sets `{ lat, lng, loading: true }` and calls the server action. The store action increments a `requestId` counter; when the response arrives, it checks that the `requestId` still matches before writing results. This prevents race conditions from rapid clicks.
5. **Server action**: `fetchSnowfallBaseline(lat, lng)` — a Next.js 16 server action in a `'use server'` file — fetches 30 years (1991-01-01 to 2020-12-31) of daily `snowfall_sum` and `temperature_2m_mean` from Open-Meteo Historical Weather API.
6. **Aggregation**: Server-side computes annual average snowfall (cm) and mean winter temperature (Dec/Jan/Feb for Northern Hemisphere, Jun/Jul/Aug for Southern).
7. **Store result**: Baseline data written to store, `loading: false`. On API error or timeout (10s), sets `error` message instead.
8. **Projection**: Client-side derived value recomputes whenever `tempDiff` changes (no re-fetch).

## Zustand Store: `SnowfallStore`

```typescript
// src/stores/snowfall.ts
interface SnowfallState {
  /** Selected point (null = no selection) */
  lat: number | null;
  lng: number | null;
  /** Baseline data from server action */
  baselineSnowfallCm: number;
  meanWinterTempC: number;
  /** UI state */
  loading: boolean;
  error: string | null;
  /** Race condition guard — incremented on each fetch */
  requestId: number;
  /** Actions */
  fetchBaseline: (lat: number, lng: number) => Promise<void>;
  clear: () => void;
}
```

The `fetchBaseline` action: sets loading state, increments `requestId`, calls the server action, then checks `requestId` matches before writing results. `clear` resets everything to initial state (removes pin + panel).

Projection is NOT stored — it is computed inline in `SnowfallPanel` from `baselineSnowfallCm`, `meanWinterTempC`, and `tempDiff` (read from `ClimateStore`). This keeps the store minimal and avoids cross-store subscriptions in setters.

## Server Action: `fetchSnowfallBaseline`

```typescript
// src/actions/snowfall.ts
'use server'

interface SnowfallBaseline {
  lat: number;
  lng: number;
  baselineSnowfallCm: number;
  meanWinterTempC: number;
}

export async function fetchSnowfallBaseline(
  lat: number,
  lng: number
): Promise<SnowfallBaseline> {
  // Fetch from Open-Meteo Historical Weather API
  // Endpoint: https://archive-api.open-meteo.com/v1/archive
  // Params: latitude, longitude, start_date=1991-01-01, end_date=2020-12-31
  // Daily variables: snowfall_sum, temperature_2m_mean
  // Timeout: 10 seconds (AbortController)
  // Aggregate server-side into annual snowfall avg + winter temp avg
  // Throws on network error or non-200 response
}
```

**Open-Meteo specifics:**
- No API key required
- Rate limit: 10,000 requests/day (free tier)
- Returns daily data as JSON arrays
- `snowfall_sum` is in cm, `temperature_2m_mean` is in Celsius
- ~10,950 daily records per request (30 years)

**Winter month selection:**
- Northern Hemisphere (lat >= 0): December, January, February
- Southern Hemisphere (lat < 0): June, July, August

## Projection Formula

### Snow Fraction Model

Determines what fraction of precipitation falls as snow based on temperature:

```
snowFraction(T) = clamp((1.5 - T) / 3.0, 0, 1)
```

- `T < -1.5 C`: 100% of precipitation falls as snow
- `T > +1.5 C`: 0% falls as snow (all rain)
- Linear transition between -1.5 C and +1.5 C

### Clausius-Clapeyron Moisture Scaling

Warmer air holds more water vapor, increasing total precipitation:

```
moistureFactor(dT) = 1 + 0.07 * dT
```

+7% moisture capacity per degree Celsius of warming.

### Combined Projection

```
baselineFraction  = snowFraction(meanWinterTempC)
projectedFraction = snowFraction(meanWinterTempC + tempDiff)
projectedSnowfall = baselineSnowfallCm * (projectedFraction / baselineFraction) * moistureFactor(tempDiff)
```

### Edge Cases

| Condition | Handling |
|-----------|----------|
| `baselineFraction < 0.01` (tropical, no snow) | Projected = 0 — skip division entirely to avoid float blowup |
| `projectedFraction = 0` (warmed past threshold) | Projected = 0 regardless of moisture |
| `baselineSnowfallCm < 0.1` (negligible snow) | Show "Trace / negligible snowfall" instead of numbers |
| Negative `tempDiff` (cooling) | Works symmetrically — more snow from fraction increase |
| Ocean click (no meaningful snowfall station) | Show result anyway — Open-Meteo returns ERA5 reanalysis for ocean grid cells |
| API error or timeout | Show error message in panel: "Could not fetch data. Try again." with retry button |

### Sources

- **O'Gorman, P.A. (2014)** — "Contrasting responses of mean and extreme snowfall to climate change." *Nature*, 512, 416-418. Establishes the non-linear temperature-snowfall relationship: warming increases snowfall in cold regions but decreases it in marginal regions.
- **Krasting, J.P., et al. (2013)** — "Future Changes in Northern Hemisphere Snowfall." *Journal of Climate*, 26(20), 7813-7828. Documents the snow-fraction temperature dependence and crossover behavior.
- **Clausius-Clapeyron relation** — Standard atmospheric physics: ~7% increase in saturation vapor pressure per degree Celsius. Widely used in climate projections (e.g., Held & Soden 2006).
- **Open-Meteo Historical Weather API** — ERA5 reanalysis data (ECMWF), 0.25 degree resolution, global coverage, 1940-present.
- **WMO 30-year Climate Normal** — 1991-2020 reference period, standard baseline for climatological comparisons.

## UI Design

### SnowfallPanel (Mantine Card)

Position: bottom-right corner (opposite existing Interface panel at bottom-left).

```
+-----------------------------------+
| Snowfall Projection            X  |
| 42.4 N, 71.1 W                   |
+-----------------------------------+
| Baseline    |  128.5 cm/yr        |
| Projected   |   94.2 cm/yr        |
| Change      |  -26.7%             |
+-----------------------------------+
| Inputs                            |
| Winter Temp |  -2.3 C -> +0.7 C   |
| Snow Frac   |  100% -> 27%        |
| Moisture    |  +21%               |
+-----------------------------------+
| i Methodology                     |
+-----------------------------------+
```

- `LoadingOverlay` (Mantine) shown while server action is in flight
- Close via `X` button in card header (ActionIcon)
- "Methodology" section: collapsible, placeholder text linking to `docs/algorithm.md` (future: rendered inline)
- Styling: matches existing Interface card (dark glass, backdrop blur, `rgba(26, 27, 30, 0.85)`)

### Globe Marker

- `<mesh>` with `<sphereGeometry args={[0.008, 16, 16]} />` as a sibling to `RealisticEarth` inside `EarthCanvas`
- Positioned at radius 1.005 (slightly above globe surface to avoid z-fighting):
  ```ts
  const phi = lat * (Math.PI / 180);
  const theta = lng * (Math.PI / 180);
  const r = 1.005;
  const x = r * Math.cos(phi) * Math.sin(theta);
  const y = r * Math.sin(phi);
  const z = r * Math.cos(phi) * Math.cos(theta);
  ```
- Subtle white/accent emissive material so it's visible regardless of lighting
- Position reads from snowfall store `{ lat, lng }`
- Disappears when snowfall selection is cleared (store `lat` is null)

### Dismiss Controls

1. **Card X button**: ActionIcon in the SnowfallPanel header — clears snowfall store
2. **Clear button near Interface panel**: Small ActionIcon adjacent to existing bottom-left card, only visible when a point is selected — clears snowfall store

Both dismiss paths clear the same store state, removing the panel and the marker simultaneously.

## Methodology Documentation

The projection methodology and sources will be documented in `docs/algorithm.md` (new section) following the existing convention. This documentation is structured so it can eventually be rendered in-app as a methodology explainer panel.

Content to add to `docs/algorithm.md`:
- New section: "Snowfall Projection Model"
- Sub-sections: Snow Fraction Formula, Moisture Scaling, Data Source (Open-Meteo), Baseline Period, Limitations
- Sources with full citations
- Iteration history table (following existing pattern)

## Responsive / Mobile

- **Touch**: Same pointer-down/pointer-up distance gate works for touch. Use a 10px threshold instead of 5px (touch is less precise).
- **Narrow viewports** (< 768px): `SnowfallPanel` stacks above `Interface` panel (both bottom-left) rather than side-by-side. Use Mantine `useMediaQuery` or CSS `@media` to switch positioning.
- **Panel width**: 340px (slightly narrower than Interface's 360px to fit comfortably).

## Coordinate Display Format

Convert signed decimal degrees to human-readable N/S/E/W:
```ts
const latStr = `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? 'N' : 'S'}`;
const lngStr = `${Math.abs(lng).toFixed(1)}°${lng >= 0 ? 'E' : 'W'}`;
```

## Constraints & Limitations

- **Resolution**: Open-Meteo ERA5 reanalysis is ~25km grid. Snowfall in mountainous terrain varies at finer scales.
- **Elevation**: The formula does not account for local elevation effects beyond what ERA5 captures in its grid cell.
- **Seasonal simplification**: Uses DJF/JJA winter months; transitional months (Oct/Nov, Mar/Apr) contribute snowfall in some regions.
- **Linear snow fraction**: Real snow-rain transition is slightly non-linear; the linear approximation is standard and sufficient for visualization purposes.
- **No orographic effects**: The moisture scaling is global, not adjusted for rain shadow or lake effect.
- **Rate limits**: 10,000 Open-Meteo requests/day. Each click = 1 request. Unlikely to hit this in normal use.
