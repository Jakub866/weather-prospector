export interface DailyRecord {
  date: string; // YYYY-MM-DD
  tMax: number;
  tMin: number;
  tMean: number;
  precip: number;
  code: number;
  wind: number;
}

const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive';
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pobiera dzienne dane historyczne z ostatnich `years` lat (archiwum ERA5 ma ok. 2–5 dni opóźnienia,
 * więc koniec zakresu to dziś − 5 dni).
 */
export async function fetchHistory(lat: number, lon: number, years: number): Promise<DailyRecord[]> {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 5);
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - years);
  start.setUTCDate(start.getUTCDate() - 10); // zapas na okno ±7 dni na początku zakresu

  const key = `wp:${lat.toFixed(2)}:${lon.toFixed(2)}:${isoDate(start)}:${isoDate(end)}`;
  try {
    const cached = sessionStorage.getItem(key);
    if (cached) return JSON.parse(cached) as DailyRecord[];
  } catch {
    /* brak dostępu do storage – pomijamy cache */
  }

  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    start_date: isoDate(start),
    end_date: isoDate(end),
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'temperature_2m_mean',
      'precipitation_sum',
      'weather_code',
      'wind_speed_10m_max',
    ].join(','),
    timezone: 'auto',
  });

  const res = await fetch(`${ARCHIVE_URL}?${params}`);
  if (!res.ok) {
    let reason = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.reason) reason = body.reason;
    } catch {
      /* ignore */
    }
    throw new Error(`Błąd pobierania danych: ${reason}`);
  }
  const json = await res.json();
  const d = json.daily;
  const out: DailyRecord[] = [];
  for (let i = 0; i < d.time.length; i++) {
    const tMax = d.temperature_2m_max[i];
    const tMin = d.temperature_2m_min[i];
    if (tMax == null || tMin == null) continue;
    out.push({
      date: d.time[i],
      tMax,
      tMin,
      tMean: d.temperature_2m_mean[i] ?? (tMax + tMin) / 2,
      precip: d.precipitation_sum[i] ?? 0,
      code: d.weather_code[i] ?? 3,
      wind: d.wind_speed_10m_max[i] ?? 0,
    });
  }

  try {
    sessionStorage.setItem(key, JSON.stringify(out));
  } catch {
    /* np. przekroczony limit – trudno */
  }
  return out;
}

export interface Place {
  name: string;
  lat: number;
  lon: number;
  country?: string;
  admin1?: string;
}

export async function searchPlaces(query: string): Promise<Place[]> {
  const params = new URLSearchParams({ name: query, count: '6', language: 'pl', format: 'json' });
  const res = await fetch(`${GEOCODE_URL}?${params}`);
  if (!res.ok) return [];
  const json = await res.json();
  return (json.results ?? []).map((r: any) => ({
    name: r.name,
    lat: r.latitude,
    lon: r.longitude,
    country: r.country,
    admin1: r.admin1,
  }));
}
