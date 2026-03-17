import { create } from "zustand";
import { fetchWeatherBaseline } from "@/actions/weather";

interface WeatherState {
  lat: number | null;
  lng: number | null;
  precipDist: number[];
  baselineSnowfallCm: number;
  avgHighC: number;
  avgLowC: number;
  totalPrecipMm: number;
  avgRH: number;
  loading: boolean;
  error: string | null;
  requestId: number;
  flyTo: { lat: number; lng: number } | null;
  setPin: (lat: number, lng: number) => void;
  setFlyTo: (lat: number, lng: number) => void;
  clearFlyTo: () => void;
  fetchBaseline: (lat: number, lng: number) => Promise<void>;
  clear: () => void;
}

export const useWeatherStore = create<WeatherState>((set, get) => ({
  lat: null,
  lng: null,
  precipDist: [],
  baselineSnowfallCm: 0,
  avgHighC: 0,
  avgLowC: 0,
  totalPrecipMm: 0,
  avgRH: 0,
  loading: false,
  error: null,
  requestId: 0,
  flyTo: null,

  setFlyTo: (lat: number, lng: number) => set({ flyTo: { lat, lng } }),
  clearFlyTo: () => set({ flyTo: null }),

  setPin: (lat: number, lng: number) => {
    set((state) => ({
      lat,
      lng,
      precipDist: [],
      baselineSnowfallCm: 0,
      avgHighC: 0,
      avgLowC: 0,
      totalPrecipMm: 0,
      avgRH: 0,
      loading: false,
      error: null,
      requestId: state.requestId + 1,
    }));
  },

  fetchBaseline: async (lat: number, lng: number) => {
    const id = get().requestId + 1;
    set({ lat, lng, loading: true, error: null, requestId: id });

    try {
      const result = await fetchWeatherBaseline(lat, lng);
      if (get().requestId === id) {
        set({
          precipDist: result.precipDist,
          baselineSnowfallCm: result.baselineSnowfallCm,
          avgHighC: result.avgHighC,
          avgLowC: result.avgLowC,
          totalPrecipMm: result.totalPrecipMm,
          avgRH: result.avgRH,
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
      precipDist: [],
      baselineSnowfallCm: 0,
      avgHighC: 0,
      avgLowC: 0,
      totalPrecipMm: 0,
      avgRH: 0,
      loading: false,
      error: null,
      requestId: state.requestId + 1,
    })),
}));
