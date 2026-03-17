"use client";

import { useRef } from "react";
import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import { useSnowfallStore } from "@/stores/snowfall";

const _markerDir = new Vector3();
const _camDir = new Vector3();

export default function GlobeMarker() {
  const lat = useSnowfallStore((s) => s.lat);
  const lng = useSnowfallStore((s) => s.lng);
  const loading = useSnowfallStore((s) => s.loading);
  const hasData = useSnowfallStore((s) => s.precipDist.length > 0);
  const hasError = useSnowfallStore((s) => s.error !== null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ x: 0, y: 0, z: 0 });

  // Hide marker when on the far side of the globe (no React re-renders)
  useFrame(({ camera }) => {
    if (!wrapperRef.current) return;
    const p = posRef.current;
    _markerDir.set(p.x, p.y, p.z).normalize();
    _camDir.copy(camera.position).normalize();
    const facing = _markerDir.dot(_camDir) > 0;
    wrapperRef.current.style.opacity = facing ? "1" : "0";
    wrapperRef.current.style.pointerEvents = facing ? "" : "none";
  });

  if (lat === null || lng === null) return null;

  const showButton = !loading && !hasData && !hasError;

  const alpha = (lng + 180) * (Math.PI / 180);
  const beta = (90 - lat) * (Math.PI / 180);
  const r = 1.005;
  const x = -r * Math.cos(alpha) * Math.sin(beta);
  const y = r * Math.cos(beta);
  const z = r * Math.sin(alpha) * Math.sin(beta);
  posRef.current = { x, y, z };

  function handleFetch(e: React.MouseEvent) {
    e.stopPropagation();
    useSnowfallStore.getState().fetchBaseline(lat!, lng!);
  }

  return (
    <Html position={[x, y, z]} zIndexRange={[10, 0]} style={{ transform: "translate(-50%, -100%)" }}>
      <div ref={wrapperRef} style={{ position: "relative", pointerEvents: "none", transition: "opacity 0.15s" }}>
        {/* Continuous stem — only shown with the flag button */}
        {showButton && (
          <div style={{ width: 2, height: 48, backgroundColor: "rgba(255, 255, 255, 0.7)", boxShadow: "var(--mantine-shadow-sm)" }} />
        )}
        {/* Dot */}
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            backgroundColor: "#f76707",
            boxShadow: "var(--mantine-shadow-sm)",
            transform: "translateX(-4px)",
          }}
        />
        {/* Flag button — branches right from top of stem */}
        {showButton && (
          <button
            onClick={handleFetch}
            style={{
              pointerEvents: "auto",
              position: "absolute",
              top: 0,
              left: 2,
              background: "rgba(26, 27, 30, 0.85)",
              backdropFilter: "blur(10px)",
              color: "#fff",
              border: "1px solid rgba(255, 255, 255, 0.15)",
              boxShadow: "var(--mantine-shadow-sm)",
              borderRadius: "0 6px 6px 0",
              padding: "5px 8px 5px 10px",
              fontSize: 12,
              fontWeight: 500,
              cursor: "pointer",
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            Get Details
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 6 15 12 9 18" />
            </svg>
          </button>
        )}
      </div>
    </Html>
  );
}
