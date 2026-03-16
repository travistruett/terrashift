import { create } from "zustand";

interface ClimateState {
  /** Temperature differential in °C (-40 to +40) */
  tempDiff: number;
  /** Timeframe in years (10 to 10,000) */
  timeFrame: number;
  /** Derived sea level rise in meters */
  slr: number;
  /** Time-lagged effective temperature for ice response */
  iceTemp: number;
  setTempDiff: (temp: number) => void;
  setTimeFrame: (time: number) => void;
}

/** Smooth activation: 0 → 1 centered at threshold */
function sigmoid(x: number, threshold: number, steepness: number): number {
  return 1 / (1 + Math.exp(-(x - threshold) / steepness));
}

/**
 * Multi-component sea level rise model.
 *
 * Four physical processes, each with its own equilibrium sensitivity,
 * tipping-point threshold, and response timescale:
 *
 *   SLR = Σ [ sensitivity_i(|ΔT|) × (1 - e^(-t / τ_i)) ]
 *
 * ┌───────────────────┬───────────┬──────────┬───────────┐
 * │ Component         │ Max (m)   │ τ (yr)   │ Threshold │
 * ├───────────────────┼───────────┼──────────┼───────────┤
 * │ Thermal + glaciers│ 0.5m/°C   │    200   │ none      │
 * │ Greenland         │ 7.4m      │  3,000   │ ~1.5°C    │
 * │ West Antarctic    │ 5.0m      │    800   │ ~3.0°C    │
 * │ East Antarctic    │ 53.0m     │ 10,000   │ ~8.0°C    │
 * └───────────────────┴───────────┴──────────┴───────────┘
 *
 * Range at ±40°C × 10,000yr ≈ ±66m (fits within ±100m DEM encoding).
 */
function calculateSLR(tempDiff: number, timeFrame: number): number {
  const sign = Math.sign(tempDiff);
  const absT = Math.abs(tempDiff);

  // Thermal expansion + mountain glaciers: linear, fast, modest
  const fast = 0.5 * absT * (1 - Math.exp(-timeFrame / 200));

  // Greenland ice sheet: 7.4m total, sigmoid activation ~1.5°C, τ=3000yr
  const greenlandCommitted = 7.4 * sigmoid(absT, 1.5, 1.0);
  const greenland = greenlandCommitted * (1 - Math.exp(-timeFrame / 3000));

  // West Antarctic Ice Sheet: 5m total, sigmoid ~3°C, τ=800yr
  const waisCommitted = 5.0 * sigmoid(absT, 3.0, 1.5);
  const wais = waisCommitted * (1 - Math.exp(-timeFrame / 800));

  // East Antarctic Ice Sheet: 53m total, sigmoid ~8°C, τ=10000yr
  const eaisCommitted = 53.0 * sigmoid(absT, 8.0, 3.0);
  const eais = eaisCommitted * (1 - Math.exp(-timeFrame / 10000));

  return sign * (fast + greenland + wais + eais);
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
  iceTemp: 0,
  setTempDiff: (tempDiff) =>
    set((state) => ({
      tempDiff,
      slr: calculateSLR(tempDiff, state.timeFrame),
      iceTemp: calculateIceTemp(tempDiff, state.timeFrame),
    })),
  setTimeFrame: (timeFrame) =>
    set((state) => ({
      timeFrame,
      slr: calculateSLR(state.tempDiff, timeFrame),
      iceTemp: calculateIceTemp(state.tempDiff, timeFrame),
    })),
}));
