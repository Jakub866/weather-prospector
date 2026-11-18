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
  const cached = readCache(key);
  if (cached) return cached;

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
  if (res.status === 429) {
    throw new Error('Przekroczono limit zapytań darmowego API Open-Meteo. Odczekaj minutę i spróbuj ponownie.');
  }
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

  writeCache(key, out);
  return out;
}

// ---------- cache w localStorage (format kolumnowy, by zmieścić się w limicie) ----------
const FIELDS = ['tMax', 'tMin', 'tMean', 'precip', 'code', 'wind'] as const;
const CACHE_PREFIX = 'wp1:';

function readCache(key: string): DailyRecord[] | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const c = JSON.parse(raw) as { start: string; dates: number[]; cols: number[][] };
    const t0 = new Date(`${c.start}T00:00:00Z`).getTime();
    return c.dates.map((dd, i) => {
      const r: any = { date: isoDate(new Date(t0 + dd * 86_400_000)) };
      FIELDS.forEach((f, j) => (r[f] = c.cols[j][i]));
      return r as DailyRecord;
    });
  } catch {
    return null;
  }
}

function writeCache(key: string, rows: DailyRecord[]): void {
  if (rows.length === 0) return;
  const start = rows[0].date;
  const t0 = new Date(`${start}T00:00:00Z`).getTime();
  const payload = JSON.stringify({
    start,
    dates: rows.map((r) => Math.round((new Date(`${r.date}T00:00:00Z`).getTime() - t0) / 86_400_000)),
    cols: FIELDS.map((f) => rows.map((r) => r[f])),
  });
  try {
    localStorage.setItem(CACHE_PREFIX + key, payload);
  } catch {
    // brak miejsca – usuń stare wpisy i spróbuj raz jeszcze
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith(CACHE_PREFIX))
        .forEach((k) => localStorage.removeItem(k));
      localStorage.setItem(CACHE_PREFIX + key, payload);
    } catch {
      /* cache niedostępny – trudno */
    }
  }
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
