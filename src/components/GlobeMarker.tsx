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
