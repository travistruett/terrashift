"use server";

export interface WeatherBaseline {
  lat: number;
  lng: number;
  /** Annual total precipitation (mm) in each 1°C wet-bulb temperature bin. Index 0 = [-40,-39)°C, index 69 = [29,30)°C */
  precipDist: number[];
  /** Observed annual snowfall in cm (from ERA5 snowfall_sum, used as calibrated baseline) */
  baselineSnowfallCm: number;
  /** Average daily high temperature (°C) */
  avgHighC: number;
  /** Average daily low temperature (°C) */
  avgLowC: number;
  /** Total annual precipitation (mm) */
  totalPrecipMm: number;
  /** Average relative humidity (%) */
  avgRH: number;
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
    temperature_2m_max: (number | null)[];
    temperature_2m_min: (number | null)[];
    relative_humidity_2m_mean: (number | null)[];
  };
}

/**
 * Wet-bulb temperature approximation (Stull 2011).
 * Accurate to ±0.3°C for RH 5–99% and T −20°C to +50°C.
 *
 * Stull, R. (2011). "Wet-Bulb Temperature from Relative Humidity and Air
 * Temperature." J. Appl. Meteor. Climatol., 50(11), 2267–2269.
 */
function wetBulb(T: number, RH: number): number {
  return (
    T * Math.atan(0.151977 * Math.sqrt(RH + 8.313659)) +
    Math.atan(T + RH) -
    Math.atan(RH - 1.676331) +
    0.00391838 * Math.pow(RH, 1.5) * Math.atan(0.023101 * RH) -
    4.686035
  );
}

export async function fetchWeatherBaseline(
  lat: number,
  lng: number
): Promise<WeatherBaseline> {
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new Error("Coordinates out of range");
  }

  const url = new URL("https://archive-api.open-meteo.com/v1/archive");
  url.searchParams.set("latitude", lat.toFixed(4));
  url.searchParams.set("longitude", lng.toFixed(4));
  url.searchParams.set("start_date", "1991-01-01");
  url.searchParams.set("end_date", "2020-12-31");
  url.searchParams.set("daily", "precipitation_sum,snowfall_sum,temperature_2m_mean,temperature_2m_max,temperature_2m_min,relative_humidity_2m_mean");
  url.searchParams.set("models", "best_match");
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
): WeatherBaseline {
  const { precipitation_sum, snowfall_sum, temperature_2m_mean, temperature_2m_max, temperature_2m_min, relative_humidity_2m_mean } = data.daily;

  const bins = new Float64Array(BIN_COUNT);
  let totalSnowfall = 0;
  let sumTMax = 0, countTMax = 0;
  let sumTMin = 0, countTMin = 0;
  let sumPrecip = 0;
  let sumRH = 0, countRH = 0;

  for (let i = 0; i < precipitation_sum.length; i++) {
    const precip = precipitation_sum[i];
    const temp = temperature_2m_mean[i];
    const rh = relative_humidity_2m_mean[i];
    if (precip != null && temp != null && rh != null) {
      const tw = wetBulb(temp, rh);
      const binIndex = Math.round(tw) - BIN_MIN;
      if (binIndex >= 0 && binIndex < BIN_COUNT) {
        bins[binIndex] += precip;
      }
    }

    const snow = snowfall_sum[i];
    if (snow != null) { totalSnowfall += snow; }

    const tMax = temperature_2m_max[i];
    if (tMax != null) { sumTMax += tMax; countTMax++; }

    const tMin = temperature_2m_min[i];
    if (tMin != null) { sumTMin += tMin; countTMin++; }

    if (precip != null) { sumPrecip += precip; }
    if (rh != null) { sumRH += rh; countRH++; }
  }

  const years = 30;
  const precipDist = Array.from(bins, (v) => v / years);
  const baselineSnowfallCm = totalSnowfall / years;

  return {
    lat,
    lng,
    precipDist,
    baselineSnowfallCm,
    avgHighC: countTMax > 0 ? sumTMax / countTMax : 0,
    avgLowC: countTMin > 0 ? sumTMin / countTMin : 0,
    totalPrecipMm: sumPrecip / years,
    avgRH: countRH > 0 ? sumRH / countRH : 0,
  };
}
