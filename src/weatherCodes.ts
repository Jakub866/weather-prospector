/** Kategorie pogody zbudowane z kodów WMO (pole `weather_code` w Open-Meteo). */
export type WeatherCategory =
  | 'clear'
  | 'partly'
  | 'overcast'
  | 'fog'
  | 'drizzle'
  | 'rain'
  | 'snow'
  | 'storm';

export interface CategoryInfo {
  label: string;
  icon: string;
}

export const CATEGORIES: Record<WeatherCategory, CategoryInfo> = {
  clear: { label: 'Słonecznie', icon: '☀️' },
  partly: { label: 'Częściowe zachmurzenie', icon: '⛅' },
  overcast: { label: 'Pochmurno', icon: '☁️' },
  fog: { label: 'Mgła', icon: '🌫️' },
  drizzle: { label: 'Słaby deszcz / mżawka', icon: '🌦️' },
  rain: { label: 'Deszcz', icon: '🌧️' },
  snow: { label: 'Śnieg', icon: '🌨️' },
  storm: { label: 'Burza', icon: '⛈️' },
};

export const CATEGORY_ORDER = Object.keys(CATEGORIES) as WeatherCategory[];

export function categorize(code: number): WeatherCategory {
  if (code <= 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'overcast';
}
