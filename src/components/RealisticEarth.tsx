"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useTexture } from "@react-three/drei";
import * as THREE from "three";
import { useClimateStore } from "@/stores/climate";

/*
 * Shader architecture
 * ───────────────────
 *
 *  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
 *  │ color map   │  │  DEM map    │  │  ice map    │
 *  │ (satellite) │  │ (±100m 8-bit)│  │ (threshold) │
 *  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
 *         │                │                 │
 *         ▼                ▼                 ▼
 *   ┌───────────────────────────────────────────┐
 *   │           Fragment Shader                 │
 *   │                                           │
 *   │  1. elevation = dem × 200 - 100           │
 *   │  2. if elev < SLR → water color           │
 *   │     if elev < 0 & > SLR → exposed seabed  │
 *   │     else → satellite color                │
 *   │  3. if iceTemp < iceThreshold → ice        │
 *   │  4. apply lighting                        │
 *   └───────────────────────────────────────────┘
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

    // ── Ice overlay ──
    // Ice texture encodes threshold: pixel 0 = -40°C, pixel 255 = +40°C
    float iceThreshold = texture2D(u_ice, vUv).r * 80.0 - 40.0;
    float iceDelta = iceThreshold - u_iceTemp;
    // Soft edge: blend over ~2°C range
    float iceAmount = smoothstep(-0.5, 1.5, iceDelta);

    if (iceAmount > 0.0) {
      // Ice color: white with slight blue tint
      vec3 iceColor = vec3(0.92, 0.95, 0.98);
      float opacity = iceAmount * 0.9;
      // Sea ice (over water) is slightly more translucent
      if (depth > 0.0) {
        opacity *= 0.75;
      }
      color = mix(color, iceColor, opacity);
    }

    // Simple diffuse + ambient lighting
    float diffuse = max(dot(vNormal, normalize(u_lightDir)), 0.0);
    float light = 0.25 + diffuse * 0.75;

    gl_FragColor = vec4(color * light, 1.0);
  }
`;

export default function RealisticEarth() {
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
    <mesh>
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
