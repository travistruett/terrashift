"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import type { ThreeEvent } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { useClimateStore } from "@/stores/climate";
import {
  MAX_DIST_KM,
  MAX_ELEV_M,
  LAND_RES_SCALE,
  SEA_ICE_RES_SCALE,
  GROWTH_BASE,
  GROWTH_LAT,
  GROWTH_ELEV,
} from "@/constants/ice";
import { TEXTURE_VERSION, CDN_URL } from "@/constants/textures";

/*
 * Shader architecture
 * ───────────────────
 *
 *  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐
 *  │ color map   │  │  DEM map    │  │  ice map (RGBA)  │
 *  │ (satellite) │  │ (±100m 8-bit)│  │ R=dist G=res     │
 *  └──────┬──────┘  └──────┬──────┘  │ B=conc A=elev    │
 *         │                │          └────────┬─────────┘
 *         ▼                ▼                   ▼
 *   ┌───────────────────────────────────────────────┐
 *   │           Fragment Shader                     │
 *   │                                               │
 *   │  1. elevation = dem × 200 - 100               │
 *   │  2. if elev < SLR → water color               │
 *   │     if elev < 0 & > SLR → exposed seabed      │
 *   │     else → satellite color                    │
 *   │  3. snow-line melt (mountain snow → rock)      │
 *   │  4. ice melt (reveal terrain under melted ice) │
 *   │  5. vegetation/biome shift (greening/drying)    │
 *   │  6. ice growth (white overlay)                 │
 *   │  7. apply lighting                            │
 *   └───────────────────────────────────────────────┘
 */

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    vUv = uv;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D u_colorMap;
  uniform sampler2D u_dem;
  uniform sampler2D u_ice;
  uniform sampler2D u_marchIce;
  uniform float u_slr;
  uniform float u_iceTemp;
  uniform float u_vegTemp;
  uniform float u_seaSeason;
  uniform vec3 u_lightDir;

  varying vec2 vUv;
  varying vec3 vNormal;

  void main() {
    float demSample = texture2D(u_dem, vUv).r;
    // DEM encoding: 0 = -100m, 0.5 = 0m (sea level), 1.0 = +100m
    float elevation = demSample * 200.0 - 100.0;

    vec3 baseColor = texture2D(u_colorMap, vUv).rgb;

    vec3 deepWater = vec3(0.01, 0.10, 0.30);
    vec3 shallowWater = vec3(0.04, 0.22, 0.42);
    vec3 exposedLand = vec3(0.55, 0.50, 0.40);

    // Positive depth = underwater, negative = above new sea level
    float depth = u_slr - elevation;

    vec3 color;
    if (depth > 5.0) {
      color = deepWater;
    } else if (depth > 0.0) {
      float t = depth / 5.0;
      color = mix(shallowWater, deepWater, t);
    } else if (elevation < 0.0) {
      // Exposed seabed: sea level dropped, revealing ocean floor
      color = mix(baseColor, exposedLand, 0.7);
    } else {
      color = baseColor;
    }

    // ── Snow-line melt: remove baked-in mountain snow when warming ──
    vec4 iceTex = texture2D(u_ice, vUv);
    float fullElev = iceTex.a * ${MAX_ELEV_M.toFixed(1)};
    float lat = abs(0.5 - vUv.y) * 180.0;

    if (u_iceTemp > 0.0 && fullElev > 500.0) {
      float brightness = dot(baseColor, vec3(0.299, 0.587, 0.114));
      float maxC = max(baseColor.r, max(baseColor.g, baseColor.b));
      float minC = min(baseColor.r, min(baseColor.g, baseColor.b));
      float sat = maxC > 0.0 ? (maxC - minC) / maxC : 0.0;
      float isSnowy = smoothstep(0.55, 0.75, brightness) * smoothstep(0.25, 0.10, sat);

      if (isSnowy > 0.01) {
        // Snowline rises ~150m per °C of warming, base varies by latitude
        float currentSnowline = max(5000.0 - 80.0 * lat, 0.0);
        float newSnowline = currentSnowline + u_iceTemp * 150.0;
        float snowMelt = smoothstep(-300.0, 300.0, newSnowline - fullElev);
        vec3 rock = vec3(0.50, 0.46, 0.38);
        color = mix(color, rock, snowMelt * isSnowy);
      }
    }

    // ── Ice overlay (RGBA per-pixel threshold — no 8-bit banding) ──
    // Texture channels: R=distance, G=land resilience, B=sea ice conc, A=elevation
    float distNorm = iceTex.r;     // sqrt-encoded distance from ice edge
    float landRes  = iceTex.g;     // land ice resilience (0–1 → 0–${LAND_RES_SCALE}°C)
    float sepConc  = iceTex.b;     // September sea ice concentration (0–1)
    float marConc  = texture2D(u_marchIce, vUv).r; // March sea ice (0 if not loaded)
    float seaConc  = mix(sepConc, marConc, u_seaSeason);
    float iceElev  = iceTex.a;     // terrain elevation (0–1 → 0–${MAX_ELEV_M}m)

    // Compute threshold per-pixel at float precision
    float iceThreshold;
    if (landRes > 0.008) {
      // Land ice (Greenland, Antarctica): resilience = how much warming to melt
      iceThreshold = landRes * ${LAND_RES_SCALE.toFixed(1)};
    } else if (seaConc > 0.06) {
      // Sea ice (HadISST): concentration-proportional resilience
      iceThreshold = seaConc * ${SEA_ICE_RES_SCALE.toFixed(1)};
    } else {
      // Non-ice pixel: threshold from distance + elevation nucleation
      float dist_km = distNorm * distNorm * ${MAX_DIST_KM.toFixed(1)};

      // Distance-based spread from existing ice
      float growthRate = ${GROWTH_BASE.toFixed(1)} + ${GROWTH_LAT.toFixed(1)} * pow(lat / 90.0, 1.2) + ${GROWTH_ELEV.toFixed(1)} * fullElev;
      float distThreshold = -(dist_km / growthRate);

      // Ocean penalty: open water resists land-ice growth
      // (sea ice is handled separately via B channel)
      if (elevation < 0.0) {
        distThreshold -= 2.0;
      }

      // Elevation nucleation: mountains glaciate independently
      // Only above 1500m — sea-level ice comes from distance spread only
      float elevNucleation = -99.0;
      if (fullElev > 1500.0) {
        float latBonus = (lat / 90.0) * 3.0;
        elevNucleation = (fullElev - 2500.0) / 2000.0 + latBonus - 3.0;
      }

      iceThreshold = max(distThreshold, elevNucleation);
    }

    float iceDelta = iceThreshold - u_iceTemp;

    // Ice melt: reveal terrain under melting ice using bedrock elevation
    // Runs BEFORE vegetation so plants can colonize revealed terrain
    if (iceThreshold > 0.3 && iceDelta < 0.0) {
      float meltAmount = smoothstep(0.0, -5.0, iceDelta);
      vec3 underIce;
      if (elevation < 0.0) {
        underIce = mix(shallowWater, deepWater, smoothstep(0.0, -30.0, elevation));
      } else {
        vec3 tundra = vec3(0.35, 0.42, 0.30);
        vec3 rock = vec3(0.50, 0.46, 0.38);
        underIce = mix(tundra, rock, smoothstep(10.0, 60.0, elevation));
      }
      color = mix(color, underIce, meltAmount);
    }

    // ── Vegetation / biome shift ──
    // Arctic greening (warming): high-latitude terrain shifts toward boreal green
    // Subtropical drying (warming): mid-latitudes desaturate toward brown
    // Both reverse when cooling
    // Runs after ice melt (plants colonize revealed terrain) but before ice growth
    if (abs(u_vegTemp) > 0.3 && elevation >= 0.0) {
      float brightness = dot(color, vec3(0.299, 0.587, 0.114));
      float maxC = max(color.r, max(color.g, color.b));
      float minC = min(color.r, min(color.g, color.b));
      float sat = maxC > 0.0 ? (maxC - minC) / maxC : 0.0;

      if (u_vegTemp > 0.0) {
        // Arctic greening: high latitude terrain → denser boreal green
        // Treeline rises ~150m per °C warming (Körner & Paulsen 2004, lapse rate ~6.5°C/km)
        float baseTreeline = mix(2500.0, 800.0, smoothstep(50.0, 72.0, lat));
        float treeline = baseTreeline + u_vegTemp * 150.0;
        // Elevation gradient: full greening well below treeline, fading to zero at treeline
        float elevFactor = smoothstep(treeline, treeline - 500.0, fullElev);
        float arcticZone = smoothstep(45.0, 55.0, lat) * elevFactor;
        // Broad detection: non-snow land (snow already converted to rock by melt section above)
        float isVegetable = smoothstep(0.90, 0.75, brightness) * smoothstep(0.05, 0.15, brightness);
        float greenAmount = arcticZone * isVegetable * smoothstep(0.5, 3.0, u_vegTemp);
        // Elevation-varied green: dark dense forest in valleys, lighter/sparser upslope
        vec3 darkForest = vec3(0.08, 0.25, 0.06);
        vec3 lightForest = vec3(0.22, 0.38, 0.18);
        float elevGrad = smoothstep(0.0, treeline * 0.7, fullElev);
        vec3 borealGreen = mix(darkForest, lightForest, elevGrad);
        // Preserve satellite luminance variation for terrain relief
        borealGreen *= (0.6 + brightness * 0.8);
        color = mix(color, borealGreen, greenAmount * 0.70);

        // Subtropical drying: Hadley cell expands ~0.5° lat per °C of warming
        float dryUpperLat = min(38.0 + u_vegTemp * 0.5, 55.0);
        float subtropZone = smoothstep(15.0, 22.0, lat) * smoothstep(dryUpperLat + 7.0, dryUpperLat, lat);
        float isGreen = step(0.01, color.g - max(color.r, color.b) * 0.85);
        float dryAmount = subtropZone * isGreen * smoothstep(1.5, 5.0, u_vegTemp);
        // Drying target shifts from brown grassland to sandy desert at extreme temps
        vec3 dryGrass = vec3(0.55, 0.48, 0.35);
        vec3 desert = vec3(0.68, 0.58, 0.42);
        vec3 dryLand = mix(dryGrass, desert, smoothstep(5.0, 20.0, u_vegTemp));
        color = mix(color, dryLand, dryAmount * 0.75);
      } else {
        // Cooling: tundra expands equatorward
        float absVeg = abs(u_vegTemp);

        // Tundra/steppe expansion at lower latitudes
        float tundraZone = smoothstep(55.0, 42.0, lat) * smoothstep(25.0, 35.0, lat);
        float isGreenish = smoothstep(0.06, 0.15, sat);
        float tundraAmount = tundraZone * isGreenish * smoothstep(0.8, 4.0, absVeg);
        vec3 tundraBrown = vec3(0.40, 0.38, 0.30);
        color = mix(color, tundraBrown, tundraAmount * 0.50);
      }
    }

    // Ice growth: white overlay with sharper edges and terrain-aware opacity
    // Runs after vegetation so glaciation covers forests (physically correct)
    float iceAmount = smoothstep(-0.3, 0.8, iceDelta);
    if (iceAmount > 0.0) {
      vec3 iceColor = vec3(0.92, 0.95, 0.98);
      float iceStrength = smoothstep(0.0, 1.5, max(iceThreshold, iceDelta));
      float opacity = iceAmount * mix(0.4, 0.95, iceStrength);
      color = mix(color, iceColor, opacity);
    }

    // Simple diffuse + ambient lighting
    float diffuse = max(dot(vNormal, normalize(u_lightDir)), 0.0);
    float light = 0.25 + diffuse * 0.75;

    gl_FragColor = vec4(color * light, 1.0);
  }
`;

interface RealisticEarthProps {
  onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  onPointerUp?: (e: ThreeEvent<PointerEvent>) => void;
}

export default function RealisticEarth({ onPointerDown, onPointerUp }: RealisticEarthProps) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const marchTexRef = useRef<THREE.Texture | null>(null);
  const marchLoadingRef = useRef(false);

  const v = `?v=${TEXTURE_VERSION}`;
  const base = CDN_URL;
  const [colorMap, dem, ice] = useTexture([
    `${base}/textures/earth_color.jpg${v}`,
    `${base}/textures/earth_dem.png${v}`,
    `${base}/textures/earth_ice.png${v}`,
  ]);

  // 1x1 black placeholder — zero sea ice until March texture loads
  // Intentional useMemo: Three.js needs stable texture reference
  const blackTex = useMemo(() => {
    const t = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat);
    t.needsUpdate = true;
    return t;
  }, []);

  // Stable reference needed — Three.js caches shaders by uniform object identity.
  // This is an intentional useMemo (React Compiler exception for Three.js stability).
  const uniforms = useMemo(
    () => ({
      u_colorMap: { value: colorMap },
      u_dem: { value: dem },
      u_ice: { value: ice },
      u_marchIce: { value: blackTex },
      u_slr: { value: 0 },
      u_iceTemp: { value: 0 },
      u_vegTemp: { value: 0 },
      u_seaSeason: { value: 0 },
      u_lightDir: { value: new THREE.Vector3(5, 3, 5).normalize() },
    }),
    [colorMap, dem, ice, blackTex],
  );

  // Update shader uniforms every frame from Zustand store (bypasses React renders)
  useFrame(() => {
    if (!materialRef.current) return;
    const state = useClimateStore.getState();
    materialRef.current.uniforms.u_slr.value = state.slr;
    materialRef.current.uniforms.u_iceTemp.value = state.iceTemp;
    materialRef.current.uniforms.u_vegTemp.value = state.vegTemp;
    // Only transition to March once the texture is actually loaded
    materialRef.current.uniforms.u_seaSeason.value =
      state.seaSeason > 0 && marchTexRef.current ? state.seaSeason : 0;

    // Lazy-load March texture on first toggle to Winter
    if (state.seaSeason > 0 && !marchTexRef.current && !marchLoadingRef.current) {
      marchLoadingRef.current = true;
      new THREE.TextureLoader().load(`${base}/textures/sea_ice_march.png${v}`, (tex) => {
        marchTexRef.current = tex;
        if (materialRef.current) {
          materialRef.current.uniforms.u_marchIce.value = tex;
        }
      });
    }
  });

  return (
    <mesh onPointerDown={onPointerDown} onPointerUp={onPointerUp}>
      <sphereGeometry args={[1, 128, 128]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
      />
    </mesh>
  );
}
