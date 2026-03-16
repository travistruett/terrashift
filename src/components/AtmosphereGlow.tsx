"use client";

import { useMemo } from "react";
import * as THREE from "three";

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vec3 viewDir = normalize(-vPosition);
    float fresnel = 1.0 - dot(viewDir, vNormal);
    float glow = pow(fresnel, 12.0) * 0.25;
    vec3 color = vec3(0.3, 0.55, 1.0);
    gl_FragColor = vec4(color * glow, glow);
  }
`;

export default function AtmosphereGlow() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    []
  );

  return (
    <mesh>
      <sphereGeometry args={[1.015, 64, 64]} />
      <primitive object={material} attach="material" />
    </mesh>
  );
}
