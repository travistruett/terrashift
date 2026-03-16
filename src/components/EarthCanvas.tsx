"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Loader } from "@react-three/drei";
import { Suspense } from "react";
import RealisticEarth from "./RealisticEarth";

export default function EarthCanvas() {
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
          <RealisticEarth />
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
