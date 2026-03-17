"use server";

export interface GeoResult {
  displayName: string;
  lat: number;
  lng: number;
}

export async function searchLocation(query: string): Promise<GeoResult[]> {
  if (!query || query.length < 2) return [];

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");

  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "TerraShift/1.0",
    },
  });

  if (!res.ok) return [];

  const data: Array<{ display_name: string; lat: string; lon: string }> =
    await res.json();

  return data.map((item) => ({
    displayName: item.display_name,
    lat: parseFloat(item.lat),
    lng: parseFloat(item.lon),
  }));
}
