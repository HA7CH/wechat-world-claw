export interface QuakeData {
  events: Array<{ place: string; magnitude: number }>;
}

interface UsgsFeature {
  properties?: { place?: string; mag?: number };
}

interface UsgsResp {
  features?: UsgsFeature[];
}

export async function fetchLatestQuake(): Promise<QuakeData | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);

  try {
    const url =
      "https://earthquake.usgs.gov/fdsnws/event/1/query" +
      "?format=geojson&minmagnitude=5.5&limit=3&orderby=time";
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;
    const data = (await resp.json()) as UsgsResp;
    const events = (data.features ?? [])
      .map((f) => ({ place: f.properties?.place ?? "", magnitude: f.properties?.mag ?? 0 }))
      .filter((e) => e.place && e.magnitude);
    if (events.length === 0) return null;
    return { events };
  } catch (err) {
    console.error("[usgs] fetch failed:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
