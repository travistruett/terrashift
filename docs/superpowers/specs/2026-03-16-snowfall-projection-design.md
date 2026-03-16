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

### Data Flow

1. **Click**: User clicks the globe. `RealisticEarth` mesh `onClick` fires with Three.js intersection event.
2. **Raycast to coords**: Convert intersection point on unit sphere to `{ lat, lng }` using `atan2`/`asin` math.
3. **Store update**: Write `{ lat, lng, loading: true }` to `SnowfallStore`.
4. **Server action**: `SnowfallPanel` calls `fetchSnowfallBaseline(lat, lng)` — a Next.js 16 server action in a `'use server'` file.
5. **API call**: Server action fetches 30 years (1991-01-01 to 2020-12-31) of daily `snowfall_sum` and `temperature_2m_mean` from Open-Meteo Historical Weather API.
6. **Aggregation**: Server-side computes annual average snowfall (cm) and mean winter temperature (Dec/Jan/Feb for Northern Hemisphere, Jun/Jul/Aug for Southern).
7. **Store result**: Baseline data written to store, `loading: false`.
8. **Projection**: Client-side derived value recomputes whenever `tempDiff` changes (no re-fetch).

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
  // Aggregate server-side into annual snowfall avg + winter temp avg
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
| `baselineFraction ~ 0` (tropical, no snow) | Projected stays 0 — skip division |
| `projectedFraction = 0` (warmed past threshold) | Projected = 0 regardless of moisture |
| Negative `tempDiff` (cooling) | Works symmetrically — more snow from fraction increase |
| Ocean click (no meaningful snowfall station) | Show result anyway — Open-Meteo returns ERA5 reanalysis for ocean grid cells |

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

- Small sphere or sprite rendered on the globe surface at the selected lat/lng
- Subtle white/accent color, does not compete with climate visualization
- Position derived from snowfall store `{ lat, lng }`
- Disappears when snowfall selection is cleared

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

## Constraints & Limitations

- **Resolution**: Open-Meteo ERA5 reanalysis is ~25km grid. Snowfall in mountainous terrain varies at finer scales.
- **Elevation**: The formula does not account for local elevation effects beyond what ERA5 captures in its grid cell.
- **Seasonal simplification**: Uses DJF/JJA winter months; transitional months (Oct/Nov, Mar/Apr) contribute snowfall in some regions.
- **Linear snow fraction**: Real snow-rain transition is slightly non-linear; the linear approximation is standard and sufficient for visualization purposes.
- **No orographic effects**: The moisture scaling is global, not adjusted for rain shadow or lake effect.
- **Rate limits**: 10,000 Open-Meteo requests/day. Each click = 1 request. Unlikely to hit this in normal use.
