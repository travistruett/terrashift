import { create } from "zustand";

interface ClimateState {
  /** Temperature differential in °C (-40 to +40) */
  tempDiff: number;
  /** Timeframe in years (10 to 10,000) */
  timeFrame: number;
  /** Derived sea level rise in meters (total: thermal + ice) */
  slr: number;
  /** SLR from ice loss only (excludes thermal expansion) */
  iceSLR: number;
  /** Time-lagged effective temperature for ice response */
  iceTemp: number;
  /** Sea ice season: 0 = September (minimum), 1 = March (maximum) */
  seaSeason: number;
  setTempDiff: (temp: number) => void;
  setTimeFrame: (time: number) => void;
  setSeaSeason: (season: number) => void;
}

/** Smooth activation: 0 → 1 centered at threshold */
function sigmoid(x: number, threshold: number, steepness: number): number {
  return 1 / (1 + Math.exp(-(x - threshold) / steepness));
}

/**
 * Multi-component sea level rise model (Levermann et al. 2013).
 *
 * Five physical processes, each with its own equilibrium sensitivity,
 * tipping-point threshold, and response timescale:
 *
 *   SLR = sign(ΔT) × Σ [ sensitivityᵢ(|ΔT|) × (1 - e^(-t / τᵢ)) ]
 *
 * ┌───────────────────┬────────────────┬──────────┬───────────┐
 * │ Component         │ Sensitivity    │ τ (yr)   │ Threshold │
 * ├───────────────────┼────────────────┼──────────┼───────────┤
 * │ Thermal expansion │ 0.42 m/°C      │    200   │ none      │
 * │ Mountain glaciers │ 0.34 m/°C      │    150   │ none      │
 * │                   │ (capped 0.5m)  │          │           │
 * │ Greenland         │ 7.4m total     │  3,000   │ ~1.5°C    │
 * │ West Antarctic    │ 5.0m total     │    800   │ ~3.0°C    │
 * │ East Antarctic    │ 53.0m total    │ 10,000   │ ~8.0°C    │
 * └───────────────────┴────────────────┴──────────┴───────────┘
 *
 * Mountain glaciers are capped at 0.5m total — the finite global alpine
 * ice inventory (~0.41m SLE, rounded up for peripheral glaciers).
 *
 * Range at ±40°C × 10,000yr ≈ ±66m (fits within ±100m DEM encoding).
 */
interface SLRResult {
  total: number;
  ice: number;
}

function calculateSLR(tempDiff: number, timeFrame: number): SLRResult {
  const sign = Math.sign(tempDiff);
  const absT = Math.abs(tempDiff);

  // Thermal expansion: linear, τ=200yr
  const thermal = 0.42 * absT * (1 - Math.exp(-timeFrame / 200));

  // Mountain glaciers: linear, τ=150yr, capped at 0.5m total inventory
  const glacierEquil = Math.min(0.34 * absT, 0.5);
  const glaciers = glacierEquil * (1 - Math.exp(-timeFrame / 150));

  // Greenland ice sheet: 7.4m total, sigmoid activation ~1.5°C, τ=3000yr
  const greenlandCommitted = 7.4 * sigmoid(absT, 1.5, 1.0);
  const greenland = greenlandCommitted * (1 - Math.exp(-timeFrame / 3000));

  // West Antarctic Ice Sheet: 5m total, sigmoid ~3°C, τ=800yr
  const waisCommitted = 5.0 * sigmoid(absT, 3.0, 1.5);
  const wais = waisCommitted * (1 - Math.exp(-timeFrame / 800));

  // East Antarctic Ice Sheet: 53m total, sigmoid ~8°C, τ=10000yr
  const eaisCommitted = 53.0 * sigmoid(absT, 8.0, 3.0);
  const eais = eaisCommitted * (1 - Math.exp(-timeFrame / 10000));

  const ice = sign * (glaciers + greenland + wais + eais);
  return { total: sign * (thermal + glaciers + greenland + wais + eais), ice };
}

/**
 * Time-lagged effective temperature for ice response.
 *
 * Ice doesn't respond instantly to temperature — sea ice adjusts in decades,
 * ice sheets in millennia. Two-component model:
 *   iceTemp = ΔT × (0.3 × (1 - e^(-t/50)) + 0.7 × (1 - e^(-t/2000)))
 *
 *   10yr  → 6%   (sea ice starting to shift)
 *   100yr → 29%  (sea ice responded, sheets barely started)
 *   1kyr  → 57%  (sheets responding)
 *   10kyr → 99%  (near equilibrium)
 */
function calculateIceTemp(tempDiff: number, timeFrame: number): number {
  const fast = 0.3 * (1 - Math.exp(-timeFrame / 50));
  const slow = 0.7 * (1 - Math.exp(-timeFrame / 2000));
  return tempDiff * (fast + slow);
}

export const useClimateStore = create<ClimateState>((set) => ({
  tempDiff: 0,
  timeFrame: 100,
  slr: 0,
  iceSLR: 0,
  iceTemp: 0,
  seaSeason: 0,
  setTempDiff: (tempDiff) =>
    set((state) => {
      const { total, ice } = calculateSLR(tempDiff, state.timeFrame);
      return { tempDiff, slr: total, iceSLR: ice, iceTemp: calculateIceTemp(tempDiff, state.timeFrame) };
    }),
  setTimeFrame: (timeFrame) =>
    set((state) => {
      const { total, ice } = calculateSLR(state.tempDiff, timeFrame);
      return { timeFrame, slr: total, iceSLR: ice, iceTemp: calculateIceTemp(state.tempDiff, timeFrame) };
    }),
  setSeaSeason: (seaSeason) => set({ seaSeason }),
}));
