import { create } from "zustand";
import { fetchSnowfallBaseline } from "@/actions/snowfall";

interface SnowfallState {
  lat: number | null;
  lng: number | null;
  baselineSnowfallCm: number;
  meanWinterTempC: number;
  loading: boolean;
  error: string | null;
  requestId: number;
  fetchBaseline: (lat: number, lng: number) => Promise<void>;
  clear: () => void;
}

export const useSnowfallStore = create<SnowfallState>((set, get) => ({
  lat: null,
  lng: null,
  baselineSnowfallCm: 0,
  meanWinterTempC: 0,
  loading: false,
  error: null,
  requestId: 0,

  fetchBaseline: async (lat: number, lng: number) => {
    const id = get().requestId + 1;
    set({ lat, lng, loading: true, error: null, requestId: id });

    try {
      const result = await fetchSnowfallBaseline(lat, lng);
      if (get().requestId === id) {
        set({
          baselineSnowfallCm: result.baselineSnowfallCm,
          meanWinterTempC: result.meanWinterTempC,
          loading: false,
        });
      }
    } catch {
      if (get().requestId === id) {
        set({ loading: false, error: "Could not fetch data. Try again." });
      }
    }
  },

  clear: () =>
    set((state) => ({
      lat: null,
      lng: null,
      baselineSnowfallCm: 0,
      meanWinterTempC: 0,
      loading: false,
      error: null,
      requestId: state.requestId + 1,
    })),
}));
