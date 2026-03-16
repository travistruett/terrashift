"use client";

import { useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Loader } from "@react-three/drei";
import { Suspense } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import RealisticEarth from "./RealisticEarth";
import GlobeMarker from "./GlobeMarker";
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

    // Convert intersection point on sphere to lat/lng (normalize for safety).
    // Three.js SphereGeometry vertex mapping: x = -cos(phi)*sin(theta), z = sin(phi)*sin(theta)
    // so longitude = atan2(-z, x) to undo the texture orientation.
    const p = e.point.clone().normalize();
    const rawLat = Math.asin(p.y) * (180 / Math.PI);
    const rawLng = Math.atan2(-p.z, p.x) * (180 / Math.PI);

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
          <GlobeMarker />
        </Suspense>
        <OrbitControls
          enableZoom
          enablePan={false}
          minDistance={1.15}
          maxDistance={6}
          rotateSpeed={0.3}
          zoomSpeed={0.2}
          enableDamping
          dampingFactor={0.05}
        />
      </Canvas>
      <Loader />
    </>
  );
}
