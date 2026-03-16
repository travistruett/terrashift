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
 *   │  3. decode RGBA → compute threshold per-pixel │
 *   │     (float precision — no 8-bit banding)      │
 *   │  4. if iceTemp < threshold → ice overlay      │
 *   │  5. apply lighting                            │
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
  uniform float u_slr;
  uniform float u_iceTemp;
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

    // ── Ice overlay (RGBA per-pixel threshold — no 8-bit banding) ──
    // Texture channels: R=distance, G=land resilience, B=sea ice conc, A=elevation
    vec4 iceTex = texture2D(u_ice, vUv);
    float distNorm = iceTex.r;     // sqrt-encoded distance from ice edge
    float landRes  = iceTex.g;     // land ice resilience (0–1 → 0–${LAND_RES_SCALE}°C)
    float seaConc  = iceTex.b;     // sea ice concentration (0–1)
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
      // Non-ice pixel: threshold from distance + terrain + latitude
      float dist_km = distNorm * distNorm * ${MAX_DIST_KM.toFixed(1)};  // undo sqrt encoding
      float lat = abs(0.5 - vUv.y) * 180.0;
      float elev_m = iceElev * ${MAX_ELEV_M.toFixed(1)};
      float growthRate = ${GROWTH_BASE.toFixed(1)} + ${GROWTH_LAT.toFixed(1)} * pow(lat / 90.0, 1.2) + ${GROWTH_ELEV.toFixed(1)} * elev_m;
      iceThreshold = -(dist_km / growthRate);
    }

    float iceDelta = iceThreshold - u_iceTemp;

    // Ice melt: reveal terrain under melting ice using bedrock elevation
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

    // Ice growth: white overlay with strength-based opacity
    float iceAmount = smoothstep(-1.0, 2.0, iceDelta);
    if (iceAmount > 0.0) {
      vec3 iceColor = vec3(0.92, 0.95, 0.98);
      float iceStrength = smoothstep(0.0, 2.0, max(iceThreshold, iceDelta));
      float opacity = iceAmount * mix(0.55, 0.95, iceStrength);
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

  const [colorMap, dem, ice] = useTexture([
    "/textures/earth_color.jpg",
    "/textures/earth_dem.png",
    "/textures/earth_ice.png",
  ]);

  // Stable reference needed — Three.js caches shaders by uniform object identity.
  // This is an intentional useMemo (React Compiler exception for Three.js stability).
  const uniforms = useMemo(
    () => ({
      u_colorMap: { value: colorMap },
      u_dem: { value: dem },
      u_ice: { value: ice },
      u_slr: { value: 0 },
      u_iceTemp: { value: 0 },
      u_lightDir: { value: new THREE.Vector3(5, 3, 5).normalize() },
    }),
    [colorMap, dem, ice],
  );

  // Update shader uniforms every frame from Zustand store (bypasses React renders)
  useFrame(() => {
    if (materialRef.current) {
      const state = useClimateStore.getState();
      materialRef.current.uniforms.u_slr.value = state.slr;
      materialRef.current.uniforms.u_iceTemp.value = state.iceTemp;
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
