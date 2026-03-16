"use server";

export interface SnowfallBaseline {
  lat: number;
  lng: number;
  /** Annual total precipitation (mm) in each 1°C temperature bin. Index 0 = [-40,-39)°C, index 69 = [29,30)°C */
  precipDist: number[];
  /** Observed annual snowfall in cm (from ERA5 snowfall_sum, used as calibrated baseline) */
  baselineSnowfallCm: number;
}

const BIN_MIN = -40;
const BIN_MAX = 30;
const BIN_COUNT = BIN_MAX - BIN_MIN; // 70

interface OpenMeteoResponse {
  daily: {
    time: string[];
    precipitation_sum: (number | null)[];
    snowfall_sum: (number | null)[];
    temperature_2m_mean: (number | null)[];
  };
}

export async function fetchSnowfallBaseline(
  lat: number,
  lng: number
): Promise<SnowfallBaseline> {
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error("Coordinates out of range");
  }

  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lng.toFixed(4));
  url.searchParams.set("start_date", "1991-01-01");
  url.searchParams.set("end_date", "2020-12-31");
  url.searchParams.set("daily", "precipitation_sum,snowfall_sum,temperature_2m_mean");
  url.searchParams.set("timezone", "auto");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(url.toString(), { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Open-Meteo returned ${res.status}`);
    }
    const data: OpenMeteoResponse = await res.json();
    return aggregate(lat, lng, data);
  } finally {
    clearTimeout(timeout);
  }
}

function aggregate(
  lat: number,
  lng: number,
  data: OpenMeteoResponse
): SnowfallBaseline {
  const { precipitation_sum, snowfall_sum, temperature_2m_mean } = data.daily;

  // Accumulate total precipitation into 1°C-wide temperature bins
  const bins = new Float64Array(BIN_COUNT);

  // Also sum observed snowfall for calibrated baseline display
  let totalSnowfall = 0;

  for (let i = 0; i < precipitation_sum.length; i++) {
    const precip = precipitation_sum[i];
    const temp = temperature_2m_mean[i];
    if (precip != null && temp != null) {
      const binIndex = Math.round(temp) - BIN_MIN;
      if (binIndex >= 0 && binIndex < BIN_COUNT) {
        bins[binIndex] += precip;
      }
    }

    const snow = snowfall_sum[i];
    if (snow != null) {
      totalSnowfall += snow;
    }
  }

  // Convert totals to annual averages (30-year baseline)
  const years = 30;
  const precipDist = Array.from(bins, (v) => v / years);
  const baselineSnowfallCm = totalSnowfall / years;

  return { lat, lng, precipDist, baselineSnowfallCm };
}
