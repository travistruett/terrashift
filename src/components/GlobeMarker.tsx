"use client";

import { Html } from "@react-three/drei";
import { useSnowfallStore } from "@/stores/snowfall";

export default function GlobeMarker() {
  const lat = useSnowfallStore((s) => s.lat);
  const lng = useSnowfallStore((s) => s.lng);

  if (lat === null || lng === null) return null;

  // Inverse of the EarthCanvas raycast conversion.
  // SphereGeometry: x = -cos(alpha)*sin(beta), y = cos(beta), z = sin(alpha)*sin(beta)
  // where alpha = (lng_deg + 180) * PI/180, beta = (90 - lat_deg) * PI/180
  const alpha = (lng + 180) * (Math.PI / 180);
  const beta = (90 - lat) * (Math.PI / 180);
  const r = 1.005;
  const x = -r * Math.cos(alpha) * Math.sin(beta);
  const y = r * Math.cos(beta);
  const z = r * Math.sin(alpha) * Math.sin(beta);

  return (
    <Html position={[x, y, z]} center>
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: "50%",
          backgroundColor: "#f76707",
          boxShadow: "0 0 0 0 rgba(247, 103, 7, 0.7)",
          animation: "pulse-marker 1.5s ease-out infinite",
          pointerEvents: "none",
        }}
      />
      <style>{`
        @keyframes pulse-marker {
          0% { box-shadow: 0 0 0 0 rgba(247, 103, 7, 0.7); }
          70% { box-shadow: 0 0 0 10px rgba(247, 103, 7, 0); }
          100% { box-shadow: 0 0 0 0 rgba(247, 103, 7, 0); }
        }
      `}</style>
    </Html>
  );
}
