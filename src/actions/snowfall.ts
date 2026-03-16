"use server";

interface SnowfallBaseline {
  lat: number;
  lng: number;
  baselineSnowfallCm: number;
  meanWinterTempC: number;
}

interface OpenMeteoResponse {
  daily: {
    time: string[];
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
  url.searchParams.set("daily", "snowfall_sum,temperature_2m_mean");
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
  const { time, snowfall_sum, temperature_2m_mean } = data.daily;

  const winterMonths = lat >= 0 ? [12, 1, 2] : [6, 7, 8];

  let totalSnowfall = 0;
  let snowDays = 0;
  let totalWinterTemp = 0;
  let winterDays = 0;

  for (let i = 0; i < time.length; i++) {
    const snow = snowfall_sum[i];
    if (snow != null) {
      totalSnowfall += snow;
      snowDays++;
    }

    const temp = temperature_2m_mean[i];
    const month = parseInt(time[i].substring(5, 7), 10);
    if (temp != null && winterMonths.includes(month)) {
      totalWinterTemp += temp;
      winterDays++;
    }
  }

  const years = 30;
  const baselineSnowfallCm = snowDays > 0 ? totalSnowfall / years : 0;
  const meanWinterTempC = winterDays > 0 ? totalWinterTemp / winterDays : 0;

  return { lat, lng, baselineSnowfallCm, meanWinterTempC };
}
