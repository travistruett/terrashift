# Snowfall Projection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add click-to-inspect snowfall projections to the globe — users click any point to see baseline annual snowfall and a climate-adjusted projection.

**Architecture:** A Next.js server action fetches 30-year baseline snowfall from Open-Meteo. A Zustand store holds the selected point and baseline data. A Mantine card computes the projection client-side (snow-fraction + Clausius-Clapeyron) reactively from `tempDiff`. A Three.js marker pin shows the selected point on the globe.

**Tech Stack:** Next.js 16 server actions, Zustand, Mantine v8, React Three Fiber v9, Open-Meteo Historical API

**Spec:** `docs/superpowers/specs/2026-03-16-snowfall-projection-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/stores/snowfall.ts` | Create | Zustand store: selected point, baseline data, loading/error state, fetchBaseline action |
| `src/actions/snowfall.ts` | Create | Server action: fetch 30yr daily snowfall + temp from Open-Meteo, aggregate to annual avg + winter temp |
| `src/components/SnowfallPanel.tsx` | Create | Mantine Card: displays baseline, projected snowfall, change %, formula inputs, methodology |
| `src/components/GlobeMarker.tsx` | Create | Three.js mesh: small sphere positioned at lat/lng from snowfall store |
| `src/components/EarthCanvas.tsx` | Modify | Add click handling (pointer down/up distance gate), render GlobeMarker |
| `src/components/RealisticEarth.tsx` | Modify | Accept + forward pointer events from mesh to parent |
| `src/components/Interface.tsx` | Modify | Add clear-pin ActionIcon (second dismiss control per spec) |
| `src/app/page.tsx` | Modify | Add SnowfallPanel to layout |
| `docs/algorithm.md` | Modify | New "Snowfall Projection Model" section with formula, sources, limitations |

---

## Chunk 1: Data Layer

### Task 1: Snowfall Zustand Store

**Files:**
- Create: `src/stores/snowfall.ts`

**Context:** Follow the pattern in `src/stores/climate.ts` — a `create<State>()` call with interface + actions. The projection formula is NOT in the store; it's computed inline in the panel component.

- [ ] **Step 1: Create the snowfall store**

```typescript
// src/stores/snowfall.ts
import { create } from "zustand";
import { fetchSnowfallBaseline } from "@/actions/snowfall";

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

export const useSnowfallStore = create<SnowfallState>((set, get) => ({
  lat: null,
  lng: null,
  baselineSnowfallCm: 0,
  meanWinterTempC: 0,
  loading: false,
  error: null,
  requestId: 0,

  fetchBaseline: async (lat: number, lng: number) => {
    const id = get().requestId + 1;
    set({ lat, lng, loading: true, error: null, requestId: id });

    try {
      const result = await fetchSnowfallBaseline(lat, lng);
      // Only write if this is still the latest request
      if (get().requestId === id) {
        set({
          baselineSnowfallCm: result.baselineSnowfallCm,
          meanWinterTempC: result.meanWinterTempC,
          loading: false,
        });
      }
    } catch {
      if (get().requestId === id) {
        set({ loading: false, error: "Could not fetch data. Try again." });
      }
    }
  },

  clear: () =>
    set((state) => ({
      lat: null,
      lng: null,
      baselineSnowfallCm: 0,
      meanWinterTempC: 0,
      loading: false,
      error: null,
      requestId: state.requestId + 1,
    })),
}));
```

- [ ] **Step 2: Verify build**

This won't build yet because `@/actions/snowfall` doesn't exist. That's expected — it's created in Task 2. Skip build verification until Task 2.

---

### Task 2: Server Action

**Files:**
- Create: `src/actions/snowfall.ts`

**Context:** Next.js 16 server actions live in files with `'use server'` at the top. The Open-Meteo Historical API is free, no key needed. We fetch 30 years (1991-2020) of daily `snowfall_sum` and `temperature_2m_mean`, then aggregate server-side.

- [ ] **Step 1: Create the server action**

```typescript
// src/actions/snowfall.ts
"use server";

interface SnowfallBaseline {
  lat: number;
  lng: number;
  baselineSnowfallCm: number;
  meanWinterTempC: number;
}

interface OpenMeteoResponse {
  daily: {
    time: string[];
    snowfall_sum: (number | null)[];
    temperature_2m_mean: (number | null)[];
  };
}

/**
 * Fetch 30-year climate normal (1991-2020) snowfall and winter temperature
 * from Open-Meteo Historical Weather API (ERA5 reanalysis, 0.25 degree grid).
 */
export async function fetchSnowfallBaseline(
  lat: number,
  lng: number
): Promise<SnowfallBaseline> {
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error("Coordinates out of range");
  }

  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lng.toFixed(4));
  url.searchParams.set("start_date", "1991-01-01");
  url.searchParams.set("end_date", "2020-12-31");
  url.searchParams.set("daily", "snowfall_sum,temperature_2m_mean");
  url.searchParams.set("timezone", "auto");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Open-Meteo returned ${res.status}`);
    }
    const data: OpenMeteoResponse = await res.json();
    return aggregate(lat, lng, data);
  } finally {
    clearTimeout(timeout);
  }
}

function aggregate(
  lat: number,
  lng: number,
  data: OpenMeteoResponse
): SnowfallBaseline {
  const { time, snowfall_sum, temperature_2m_mean } = data.daily;

  // Winter months: DJF for Northern Hemisphere, JJA for Southern
  const winterMonths = lat >= 0 ? [12, 1, 2] : [6, 7, 8];

  let totalSnowfall = 0;
  let snowDays = 0;
  let totalWinterTemp = 0;
  let winterDays = 0;

  for (let i = 0; i < time.length; i++) {
    const snow = snowfall_sum[i];
    if (snow != null) {
      totalSnowfall += snow;
      snowDays++;
    }

    const temp = temperature_2m_mean[i];
    const month = parseInt(time[i].substring(5, 7), 10);
    if (temp != null && winterMonths.includes(month)) {
      totalWinterTemp += temp;
      winterDays++;
    }
  }

  const years = 30;
  const baselineSnowfallCm = snowDays > 0 ? (totalSnowfall / years) : 0;
  const meanWinterTempC = winterDays > 0 ? (totalWinterTemp / winterDays) : 0;

  return { lat, lng, baselineSnowfallCm, meanWinterTempC };
}
```

- [ ] **Step 2: Verify lint + build pass**

Run: `pnpm lint && pnpm build`
Expected: Clean build. Both new files should compile without errors.

- [ ] **Step 3: Commit**

```bash
git add src/stores/snowfall.ts src/actions/snowfall.ts
git commit -m "feat: add snowfall store and Open-Meteo server action"
```

---

## Chunk 2: Globe Interaction

### Task 3: Click Handling on Globe

**Files:**
- Modify: `src/components/RealisticEarth.tsx` (add onPointerDown/onPointerUp props to mesh)
- Modify: `src/components/EarthCanvas.tsx` (add click handler logic, distance gate, lat/lng conversion)

**Context:** R3F pointer events on meshes automatically provide raycast intersection data. The `event.point` gives the 3D intersection point on the sphere. We need a pointer-down/pointer-up distance gate to distinguish clicks from orbit drags. Grid-cell dedup at 0.25 degrees prevents redundant fetches.

- [ ] **Step 1: Add pointer event forwarding to RealisticEarth**

In `src/components/RealisticEarth.tsx`, modify the component to accept and forward pointer event handlers:

Change the function signature and mesh element:

```typescript
// Add to imports
import type { ThreeEvent } from "@react-three/fiber";

// Change signature
interface RealisticEarthProps {
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
}

export default function RealisticEarth({ onPointerDown, onPointerUp }: RealisticEarthProps) {
```

And on the `<mesh>`:
```tsx
<mesh onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
```

- [ ] **Step 2: Add click handling in EarthCanvas**

In `src/components/EarthCanvas.tsx`, add the click handling logic:

```typescript
"use client";

import { useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Loader } from "@react-three/drei";
import { Suspense } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import RealisticEarth from "./RealisticEarth";
import { useSnowfallStore } from "@/stores/snowfall";

/** Round to nearest 0.25 degrees (one ERA5 grid cell) */
function snapToGrid(value: number): number {
  return Math.round(value * 4) / 4;
}

export default function EarthCanvas() {
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

  function handlePointerDown(e: ThreeEvent<PointerEvent>) {
    pointerDownPos.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
  }

  function handlePointerUp(e: ThreeEvent<PointerEvent>) {
    if (!pointerDownPos.current) return;

    const dx = e.nativeEvent.clientX - pointerDownPos.current.x;
    const dy = e.nativeEvent.clientY - pointerDownPos.current.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    pointerDownPos.current = null;

    // Touch is less precise — use 10px threshold vs 5px for mouse
    const threshold = e.nativeEvent.pointerType === "touch" ? 10 : 5;
    if (dist > threshold) return; // Was a drag, not a click

    // Convert intersection point on sphere to lat/lng (normalize for safety)
    const p = e.point.clone().normalize();
    const rawLat = Math.asin(p.y) * (180 / Math.PI);
    const rawLng = Math.atan2(p.x, p.z) * (180 / Math.PI);

    const lat = snapToGrid(rawLat);
    const lng = snapToGrid(rawLng);

    // Dedup: skip if same grid cell is already selected
    const store = useSnowfallStore.getState();
    if (store.lat === lat && store.lng === lng) return;

    store.fetchBaseline(lat, lng);
  }

  return (
    <>
      <Canvas
        camera={{ position: [0, 0, 3], fov: 45 }}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
        }}
        gl={{ antialias: true }}
      >
        <ambientLight intensity={0.3} />
        <directionalLight position={[5, 3, 5]} intensity={1.5} />
        <Suspense fallback={null}>
          <RealisticEarth
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
          />
          {/* GlobeMarker added in Task 4 */}
        </Suspense>
        <OrbitControls
          enableZoom
          enablePan={false}
          minDistance={1.15}
          maxDistance={6}
          rotateSpeed={0.5}
          zoomSpeed={0.3}
          enableDamping
          dampingFactor={0.08}
        />
      </Canvas>
      <Loader />
    </>
  );
}
```

- [ ] **Step 3: Verify lint passes**

Run: `pnpm lint`
Expected: Clean (GlobeMarker doesn't exist yet, so build will fail — that's Task 4)

---

### Task 4: Globe Marker

**Files:**
- Create: `src/components/GlobeMarker.tsx`

**Context:** A small emissive sphere positioned at lat/lng from the snowfall store, at radius 1.005 (slightly above the globe surface to avoid z-fighting). Converts lat/lng to 3D cartesian coordinates using standard spherical→cartesian math.

- [ ] **Step 1: Create GlobeMarker component**

```typescript
// src/components/GlobeMarker.tsx
"use client";

import { useSnowfallStore } from "@/stores/snowfall";

export default function GlobeMarker() {
  const lat = useSnowfallStore((s) => s.lat);
  const lng = useSnowfallStore((s) => s.lng);

  if (lat === null || lng === null) return null;

  const phi = lat * (Math.PI / 180);
  const theta = lng * (Math.PI / 180);
  const r = 1.005;
  const x = r * Math.cos(phi) * Math.sin(theta);
  const y = r * Math.sin(phi);
  const z = r * Math.cos(phi) * Math.cos(theta);

  return (
    <mesh position={[x, y, z]}>
      <sphereGeometry args={[0.008, 16, 16]} />
      <meshStandardMaterial
        color="#ffffff"
        emissive="#ffffff"
        emissiveIntensity={0.6}
      />
    </mesh>
  );
}
```

- [ ] **Step 2: Add GlobeMarker import + render to EarthCanvas**

In `src/components/EarthCanvas.tsx`, add the import and replace the placeholder comment:

```typescript
// Add to imports
import GlobeMarker from "./GlobeMarker";
```

Replace `{/* GlobeMarker added in Task 4 */}` with `<GlobeMarker />` inside the Suspense block.

- [ ] **Step 3: Verify lint + build pass**

Run: `pnpm lint && pnpm build`
Expected: Clean build. The globe should now be clickable (though no panel is visible yet).

- [ ] **Step 4: Commit**

```bash
git add src/components/GlobeMarker.tsx src/components/EarthCanvas.tsx src/components/RealisticEarth.tsx
git commit -m "feat: add globe click handling with lat/lng raycasting and marker pin"
```

---

## Chunk 3: Snowfall Panel UI

### Task 5: SnowfallPanel Component

**Files:**
- Create: `src/components/SnowfallPanel.tsx`

**Context:** Mantine Card matching the Interface panel's glass styling (`rgba(26, 27, 30, 0.85)`, backdrop blur). Reads baseline from snowfall store, `tempDiff` from climate store, and computes the projection client-side. Position: bottom-right corner, 340px wide.

The projection formula (from spec):
- `snowFraction(T) = clamp((1.5 - T) / 3.0, 0, 1)`
- `moistureFactor(dT) = 1 + 0.07 * dT`
- `projectedSnowfall = baseline * (projectedFraction / baselineFraction) * moistureFactor`

Edge cases: baselineFraction < 0.01 → projected = 0, baselineSnowfallCm < 0.1 → "Trace / negligible".

- [ ] **Step 1: Create the SnowfallPanel component**

```typescript
// src/components/SnowfallPanel.tsx
"use client";

import {
  ActionIcon,
  Card,
  Collapse,
  Group,
  LoadingOverlay,
  Stack,
  Text,
  Title,
  Button,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useSnowfallStore } from "@/stores/snowfall";
import { useClimateStore } from "@/stores/climate";

function snowFraction(t: number): number {
  return Math.max(0, Math.min(1, (1.5 - t) / 3.0));
}

function moistureFactor(dT: number): number {
  return 1 + 0.07 * dT;
}

function formatCoord(lat: number, lng: number): string {
  const latStr = `${Math.abs(lat).toFixed(1)}\u00B0${lat >= 0 ? "N" : "S"}`;
  const lngStr = `${Math.abs(lng).toFixed(1)}\u00B0${lng >= 0 ? "E" : "W"}`;
  return `${latStr}, ${lngStr}`;
}

export default function SnowfallPanel() {
  const { lat, lng, baselineSnowfallCm, meanWinterTempC, loading, error, clear, fetchBaseline } =
    useSnowfallStore();
  const tempDiff = useClimateStore((s) => s.tempDiff);
  const [methodOpen, { toggle: toggleMethod }] = useDisclosure(false);

  if (lat === null || lng === null) return null;

  // Projection calculation
  const baselineFrac = snowFraction(meanWinterTempC);
  const projectedFrac = snowFraction(meanWinterTempC + tempDiff);
  const moisture = moistureFactor(tempDiff);

  const isTrace = baselineSnowfallCm < 0.1;
  const isNonSnow = baselineFrac < 0.01;

  let projectedSnowfallCm = 0;
  if (!isNonSnow && !isTrace) {
    projectedSnowfallCm =
      projectedFrac === 0
        ? 0
        : baselineSnowfallCm * (projectedFrac / baselineFrac) * moisture;
  }

  const changePct =
    baselineSnowfallCm > 0
      ? ((projectedSnowfallCm - baselineSnowfallCm) / baselineSnowfallCm) * 100
      : 0;

  const projectedWinterTemp = meanWinterTempC + tempDiff;

  return (
    <Card
      shadow="xl"
      p="lg"
      radius="md"
      pos="absolute"
      bottom={24}
      right={24}
      w={340}
      style={{
        zIndex: 10,
        backgroundColor: "rgba(26, 27, 30, 0.85)",
        backdropFilter: "blur(10px)",
      }}
    >
      <LoadingOverlay visible={loading} zIndex={20} overlayProps={{ blur: 2 }} />

      <Group justify="space-between" align="center" mb="md">
        <div>
          <Title order={5}>Snowfall Projection</Title>
          <Text size="xs" c="dimmed">
            {formatCoord(lat, lng)}
          </Text>
        </div>
        <ActionIcon variant="subtle" color="gray" onClick={clear} aria-label="Close snowfall panel">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </ActionIcon>
      </Group>

      {error ? (
        <Stack align="center" gap="sm">
          <Text size="sm" c="red.4">
            {error}
          </Text>
          <Button
            size="xs"
            variant="light"
            onClick={() => fetchBaseline(lat, lng)}
          >
            Retry
          </Button>
        </Stack>
      ) : (
        <Stack gap="sm">
          {isTrace ? (
            <Text size="sm" c="dimmed" ta="center">
              Trace / negligible snowfall at this location
            </Text>
          ) : (
            <>
              <Stack
                gap={6}
                bg="dark.7"
                p="sm"
                style={{ borderRadius: "var(--mantine-radius-sm)" }}
              >
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Baseline</Text>
                  <Text size="sm" fw={600}>
                    {baselineSnowfallCm.toFixed(1)} cm/yr
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Projected</Text>
                  <Text size="sm" fw={600}>
                    {projectedSnowfallCm.toFixed(1)} cm/yr
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">Change</Text>
                  <Text
                    size="sm"
                    fw={600}
                    c={changePct > 0 ? "blue.4" : changePct < 0 ? "red.4" : "dimmed"}
                  >
                    {changePct >= 0 ? "+" : ""}
                    {changePct.toFixed(1)}%
                  </Text>
                </Group>
              </Stack>

              <Stack
                gap={6}
                bg="dark.7"
                p="sm"
                style={{ borderRadius: "var(--mantine-radius-sm)" }}
              >
                <Text size="xs" fw={500} c="dimmed">
                  Inputs
                </Text>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Winter Temp</Text>
                  <Text size="xs">
                    {meanWinterTempC.toFixed(1)}\u00B0C → {projectedWinterTemp.toFixed(1)}\u00B0C
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Snow Frac</Text>
                  <Text size="xs">
                    {(baselineFrac * 100).toFixed(0)}% → {(projectedFrac * 100).toFixed(0)}%
                  </Text>
                </Group>
                <Group justify="space-between">
                  <Text size="xs" c="dimmed">Moisture</Text>
                  <Text size="xs">
                    {tempDiff >= 0 ? "+" : ""}
                    {((moisture - 1) * 100).toFixed(0)}%
                  </Text>
                </Group>
              </Stack>
            </>
          )}

          <Group
            gap={4}
            style={{ cursor: "pointer" }}
            onClick={toggleMethod}
          >
            <Text size="xs" c="dimmed">
              {methodOpen ? "▾" : "▸"} Methodology
            </Text>
          </Group>
          <Collapse in={methodOpen}>
            <Text size="xs" c="dimmed" lh={1.5}>
              Snow fraction model: linear transition between -1.5°C (100% snow) and +1.5°C
              (0% snow). Moisture scales at +7%/°C (Clausius-Clapeyron). Baseline: WMO 1991-2020
              climate normal from ERA5 reanalysis. See docs/algorithm.md for full methodology.
            </Text>
          </Collapse>
        </Stack>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Verify lint passes**

Run: `pnpm lint`
Expected: Clean.

---

### Task 6: Clear Button in Interface Panel

**Files:**
- Modify: `src/components/Interface.tsx`

**Context:** The spec requires two dismiss paths: (1) the X button on the SnowfallPanel card, and (2) a small ActionIcon adjacent to the existing Interface panel at bottom-left, only visible when a point is selected. Both clear the same store state.

- [ ] **Step 1: Add clear-pin button to Interface**

In `src/components/Interface.tsx`, add the snowfall store import and a conditional clear button after the card's closing tag:

```typescript
// Add to imports
import { useSnowfallStore } from "@/stores/snowfall";

// Inside the component, before the return:
const hasSelection = useSnowfallStore((s) => s.lat !== null);
const clearSelection = useSnowfallStore((s) => s.clear);
```

Then add after the closing `</Card>`, wrap the return in a fragment:

```tsx
return (
  <>
    <Card /* ... existing card ... */ >
      {/* ... existing content ... */}
    </Card>
    {hasSelection && (
      <ActionIcon
        variant="subtle"
        color="gray"
        pos="absolute"
        bottom={24}
        left={390}
        onClick={clearSelection}
        aria-label="Clear pin"
        style={{
          zIndex: 10,
          backgroundColor: "rgba(26, 27, 30, 0.85)",
          backdropFilter: "blur(10px)",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </ActionIcon>
    )}
  </>
);
```

- [ ] **Step 2: Verify lint passes**

Run: `pnpm lint`
Expected: Clean.

---

### Task 7: Page Integration + Responsive Layout

**Files:**
- Modify: `src/app/page.tsx`

**Context:** Add `<SnowfallPanel />` to the page layout. On narrow viewports (< 768px), the SnowfallPanel should stack above the Interface panel (both bottom-left) rather than bottom-right. We handle this with a CSS media query in the component's inline styles — the panel uses `right: 24` by default and switches to `left: 24, bottom: 200px` on narrow screens.

- [ ] **Step 1: Add SnowfallPanel to page.tsx**

In `src/app/page.tsx`, add the import and render:

```typescript
import EarthCanvas from "@/components/EarthCanvas";
import Interface from "@/components/Interface";
import SnowfallPanel from "@/components/SnowfallPanel";

export default function Home() {
  return (
    <main style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <EarthCanvas />
      <Interface />
      <SnowfallPanel />
    </main>
  );
}
```

- [ ] **Step 2: Add responsive positioning to SnowfallPanel**

In `src/components/SnowfallPanel.tsx`, add the `useMediaQuery` hook for mobile positioning. Update the Card props:

```typescript
// Add to imports
import { useDisclosure, useMediaQuery } from "@mantine/hooks";

// Inside the component, before the return:
const narrow = useMediaQuery("(max-width: 768px)");
```

Then update the Card positioning props:

```tsx
<Card
  shadow="xl"
  p="lg"
  radius="md"
  pos="absolute"
  bottom={narrow ? 200 : 24}
  left={narrow ? 24 : undefined}
  right={narrow ? undefined : 24}
  w={340}
  // ... rest unchanged
>
```

- [ ] **Step 3: Verify full build**

Run: `pnpm lint && pnpm build`
Expected: Clean build. All new files compile, all existing files still compile.

- [ ] **Step 4: Manual smoke test**

Run: `pnpm dev`

Verify:
1. Globe renders as before (no regressions)
2. Click on a land area (e.g. near Boston ~42°N, 71°W) — marker pin appears, panel opens bottom-right with loading state
3. After ~2-5 seconds, baseline and projected snowfall values appear
4. Move the temperature slider — projected values update reactively (no re-fetch)
5. Click X on the panel — panel and marker disappear
6. Click a different location — new fetch triggers
7. Drag to rotate — no panel appears (distance gate works)

- [ ] **Step 5: Commit**

```bash
git add src/components/SnowfallPanel.tsx src/app/page.tsx
git commit -m "feat: add snowfall projection panel with responsive layout"
```

---

## Chunk 4: Documentation

### Task 8: Update Algorithm Documentation

**Files:**
- Modify: `docs/algorithm.md`

**Context:** Per CLAUDE.md, any new model MUST be documented in `docs/algorithm.md`. Add a new section "Snowfall Projection Model" after the existing §5 (GLSL Fragment Shader) and before the Iteration History. Follow the existing doc structure: formulas, parameters, edge cases, sources.

- [ ] **Step 1: Add Snowfall Projection Model section to docs/algorithm.md**

Insert before the `## Iteration History` heading:

```markdown
### 6. Snowfall Projection Model

**Location:** `src/components/SnowfallPanel.tsx` (client-side projection), `src/actions/snowfall.ts` (server-side data fetch)

Click any point on the globe to see projected snowfall based on the current temperature setting. The baseline comes from ERA5 reanalysis; the projection is computed client-side so it updates instantly when the temperature slider moves.

#### 6.1 Data Source

- **API:** Open-Meteo Historical Weather API (ERA5 reanalysis, ECMWF)
- **Resolution:** 0.25 degree (~25 km) grid
- **Baseline period:** 1991-2020 (WMO 30-year climate normal)
- **Variables:** `snowfall_sum` (cm/day), `temperature_2m_mean` (°C)
- **Aggregation:** Annual average snowfall = total snowfall over 30 years ÷ 30. Mean winter temperature = average of Dec/Jan/Feb (NH) or Jun/Jul/Aug (SH).

#### 6.2 Snow Fraction Formula

Determines what fraction of precipitation falls as snow based on near-surface temperature:

```
snowFraction(T) = clamp((1.5 - T) / 3.0, 0, 1)
```

- T < -1.5°C: 100% snow
- T > +1.5°C: 0% snow (all rain)
- Linear transition between -1.5°C and +1.5°C

Based on O'Gorman (2014) and Krasting et al. (2013).

#### 6.3 Clausius-Clapeyron Moisture Scaling

Warmer air holds more water vapor, increasing total precipitation:

```
moistureFactor(dT) = 1 + 0.07 × dT
```

+7% per degree Celsius, from the Clausius-Clapeyron relation (Held & Soden 2006).

#### 6.4 Combined Projection

```
baselineFrac  = snowFraction(meanWinterTempC)
projectedFrac = snowFraction(meanWinterTempC + tempDiff)
projected     = baseline × (projectedFrac / baselineFrac) × moistureFactor(tempDiff)
```

#### 6.5 Edge Cases

| Condition | Handling |
|-----------|----------|
| `baselineFrac < 0.01` | Projected = 0 (tropical, avoids float blowup) |
| `projectedFrac = 0` | Projected = 0 (warmed past snow threshold) |
| `baselineSnowfallCm < 0.1` | Display "Trace / negligible snowfall" |
| Negative tempDiff (cooling) | Works symmetrically — fraction increases |
| Ocean click | Shows ERA5 reanalysis for ocean grid cell |

#### 6.6 Limitations

- ERA5 is ~25 km — snowfall varies at finer scales in mountains
- No local elevation adjustment beyond what ERA5 captures per grid cell
- Uses DJF/JJA only — misses transitional month snowfall (Oct/Nov, Mar/Apr)
- Linear snow fraction is an approximation of a slightly non-linear real transition
- No orographic effects (rain shadow, lake effect)
- Rate limited to 10,000 Open-Meteo requests/day (each click = 1 request)

#### 6.7 Sources

- O'Gorman, P.A. (2014). "Contrasting responses of mean and extreme snowfall to climate change." *Nature*, 512, 416-418.
- Krasting, J.P., et al. (2013). "Future Changes in Northern Hemisphere Snowfall." *Journal of Climate*, 26(20), 7813-7828.
- Held, I.M. & Soden, B.J. (2006). "Robust responses of the hydrological cycle to global warming." *Journal of Climate*, 19(21), 5686-5699.
- Open-Meteo Historical Weather API — ERA5 reanalysis (ECMWF), 0.25°, global, 1940-present.
```

- [ ] **Step 2: Add iteration history entry**

In the `### Shader Iterations` table (or add a new `### Snowfall Projection Iterations` table), append:

```markdown
### Snowfall Projection Iterations

| Version | Approach | Result |
|---------|----------|--------|
| v1 | Snow-fraction + Clausius-Clapeyron, Open-Meteo 30yr baseline | Initial implementation. Linear snow fraction, +7%/°C moisture. Edge cases handled for tropical/trace/threshold crossover. |
```

- [ ] **Step 3: Verify docs render correctly**

Skim the file to make sure markdown formatting is correct and section numbering flows.

- [ ] **Step 4: Commit**

```bash
git add docs/algorithm.md
git commit -m "docs: add snowfall projection model to algorithm documentation"
```

---

## Summary

| Task | Files | What it does |
|------|-------|-------------|
| 1 | `src/stores/snowfall.ts` | Zustand store with race-condition-safe fetch |
| 2 | `src/actions/snowfall.ts` | Server action fetching 30yr Open-Meteo baseline |
| 3 | `src/components/EarthCanvas.tsx`, `src/components/RealisticEarth.tsx` | Click handling with drag disambiguation |
| 4 | `src/components/GlobeMarker.tsx`, `src/components/EarthCanvas.tsx` | Marker pin on globe + wiring into Canvas |
| 5 | `src/components/SnowfallPanel.tsx` | Projection display card with formula inputs |
| 6 | `src/components/Interface.tsx` | Clear-pin button adjacent to Interface panel |
| 7 | `src/app/page.tsx`, `src/components/SnowfallPanel.tsx` | Page wiring + responsive layout |
| 8 | `docs/algorithm.md` | Algorithm documentation for snowfall model |
