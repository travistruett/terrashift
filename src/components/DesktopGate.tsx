"use client";

import { useState, useEffect } from "react";

function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;

  // Check viewport width
  if (window.innerWidth < 1024) return true;

  // Check for touch-only devices (no fine pointer = no mouse)
  if (window.matchMedia("(pointer: coarse)").matches &&
      !window.matchMedia("(pointer: fine)").matches) return true;

  return false;
}

function checkWebGL(): { supported: boolean; maxTexture: number } {
  if (typeof window === "undefined") return { supported: false, maxTexture: 0 };
  try {
    const canvas = document.createElement("canvas");
    const gl =
      canvas.getContext("webgl2") ||
      canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl");
    if (!gl) return { supported: false, maxTexture: 0 };
    const maxTexture = (gl as WebGLRenderingContext).getParameter(
      (gl as WebGLRenderingContext).MAX_TEXTURE_SIZE,
    );
    return { supported: true, maxTexture };
  } catch {
    return { supported: false, maxTexture: 0 };
  }
}

export default function DesktopGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "pass" | "fail">("loading");
  const [reasons, setReasons] = useState<string[]>([]);

  useEffect(() => {
    const problems: string[] = [];

    if (isMobileDevice()) {
      problems.push("Desktop browser required (screen width \u2265 1024px)");
    }

    const { supported, maxTexture } = checkWebGL();
    if (!supported) {
      problems.push("WebGL is not available");
    } else if (maxTexture < 16384) {
      problems.push(
        `GPU texture support too low (${maxTexture}px, needs 16384px)`,
      );
    }

    const nav = typeof navigator !== "undefined" ? navigator as Navigator & { deviceMemory?: number } : null;
    if (nav?.deviceMemory !== undefined && nav.deviceMemory < 4) {
      problems.push(`Insufficient memory (${nav.deviceMemory}GB, needs 4GB+)`);
    }

    setReasons(problems);
    setStatus(problems.length > 0 ? "fail" : "pass");
  }, []);

  if (status === "loading") return null;
  if (status === "pass") return <>{children}</>;

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#111",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
      }}
    >
      <div style={{ textAlign: "center", maxWidth: 460, color: "#c9cdd1" }}>
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 300,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            color: "#fff",
            margin: "0 0 0.6rem",
          }}
        >
          TerraShift
        </h1>
        <p style={{ fontSize: "0.95rem", margin: "0 0 1.8rem", lineHeight: 1.6 }}>
          TerraShift renders a high-resolution 3D globe with 16K textures and
          real-time climate shaders. It currently requires a desktop browser
          with a dedicated GPU.
        </p>

        <div
          style={{
            textAlign: "left",
            margin: "0 auto",
            width: "fit-content",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          {reasons.map((r) => (
            <div
              key={r}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.6rem",
                fontSize: "0.8rem",
              }}
            >
              <span style={{ color: "#fa5252", fontSize: "0.75rem" }}>{"\u2717"}</span>
              <span>{r}</span>
            </div>
          ))}
        </div>

        <p
          style={{
            fontSize: "0.75rem",
            color: "#5c636e",
            marginTop: "2rem",
            lineHeight: 1.5,
          }}
        >
          Mobile support is on the roadmap. For now, visit on a laptop or
          desktop for the full experience.
        </p>
      </div>
    </div>
  );
}
