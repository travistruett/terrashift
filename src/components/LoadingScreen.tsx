"use client";

import { useProgress } from "@react-three/drei";
import { useState, useEffect, useRef } from "react";
import styles from "./LoadingScreen.module.css";

const TEXTURE_LABELS: Record<string, string> = {
  "earth_color.jpg": "Earth imagery",
  "earth_dem.png": "Elevation data",
  "earth_ice.png": "Ice coverage",
};

const TEXTURE_KEYS = Object.keys(TEXTURE_LABELS);

export default function LoadingScreen() {
  const { progress, item } = useProgress();
  const loadedRef = useRef(new Set<string>());
  const prevItemRef = useRef("");
  const [visible, setVisible] = useState(true);
  const [fadeOut, setFadeOut] = useState(false);

  // Track which textures finished — driven by useProgress re-renders, no setState needed
  if (prevItemRef.current && prevItemRef.current !== item) {
    const finishedKey = TEXTURE_KEYS.find((k) =>
      prevItemRef.current.includes(k),
    );
    if (finishedKey) {
      loadedRef.current = new Set(loadedRef.current).add(finishedKey);
    }
  }
  prevItemRef.current = item;

  if (progress >= 100) {
    for (const key of TEXTURE_KEYS) {
      loadedRef.current.add(key);
    }
  }

  const loadedItems = loadedRef.current;

  // Fade out when done
  useEffect(() => {
    if (progress >= 100) {
      const fadeTimer = setTimeout(() => setFadeOut(true), 400);
      const hideTimer = setTimeout(() => setVisible(false), 1000);
      return () => {
        clearTimeout(fadeTimer);
        clearTimeout(hideTimer);
      };
    }
  }, [progress]);

  if (!visible) return null;

  const currentKey = TEXTURE_KEYS.find((k) => item.includes(k));

  return (
    <div className={`${styles.overlay} ${fadeOut ? styles.fadeOut : ""}`}>
      <div className={styles.content}>
        <h1 className={styles.title}>TerraShift</h1>
        <p className={styles.subtitle}>Loading climate data&hellip;</p>
        <div className={styles.items}>
          {TEXTURE_KEYS.map((key) => {
            const done = loadedItems.has(key);
            const active = currentKey === key && !done;
            return (
              <div key={key} className={styles.item}>
                <span
                  className={
                    done
                      ? styles.indicatorDone
                      : active
                        ? styles.indicatorActive
                        : styles.indicator
                  }
                >
                  {done ? "\u2713" : "\u25CF"}
                </span>
                <span
                  className={
                    done
                      ? styles.labelDone
                      : active
                        ? styles.labelActive
                        : styles.label
                  }
                >
                  {TEXTURE_LABELS[key]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
