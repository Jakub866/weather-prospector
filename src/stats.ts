import type { DailyRecord } from './api';
import { categorize, CATEGORY_ORDER, type WeatherCategory } from './weatherCodes';

const DAY_MS = 86_400_000;

// ---------- podstawowe narzędzia statystyczne ----------

export function mean(xs: number[]): number {
  if (xs.length === 0) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

export function stdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Kwantyl z interpolacją liniową (typ 7, jak w R / numpy). */
export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function weightedMean(xs: number[], ws: number[]): number {
  let sw = 0;
  let sv = 0;
  for (let i = 0; i < xs.length; i++) {
    sw += ws[i];
    sv += ws[i] * xs[i];
  }
  return sw ? sv / sw : NaN;
}

/** Kwantyl ważony (wagi nieujemne). */
export function weightedQuantile(xs: number[], ws: number[], q: number): number {
  if (xs.length === 0) return NaN;
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const total = ws.reduce((a, b) => a + b, 0);
  const target = q * total;
  let acc = 0;
  for (const i of idx) {
    acc += ws[i];
    if (acc >= target) return xs[i];
  }
  return xs[idx[idx.length - 1]];
}

export interface Bin {
  from: number; // włącznie
  to: number; // wyłącznie
  count: number;
}

/** Histogram w koszykach o szerokości `size`, wyrównanych do wielokrotności `size`. */
export function histogram(xs: number[], size = 1): Bin[] {
  if (xs.length === 0) return [];
  const lo = Math.floor(Math.min(...xs) / size) * size;
  const hi = Math.floor(Math.max(...xs) / size) * size;
  const bins: Bin[] = [];
  for (let b = lo; b <= hi + 1e-9; b += size) bins.push({ from: b, to: b + size, count: 0 });
  for (const x of xs) {
    const i = Math.min(bins.length - 1, Math.floor((x - lo) / size));
    bins[i].count++;
  }
  return bins;
}

/** Koszyk z największą liczbą obserwacji (przy remisie – bliższy medianie). */
export function modeBin(xs: number[], size = 1): Bin | null {
  const bins = histogram(xs, size);
  if (bins.length === 0) return null;
  const med = quantile(xs, 0.5);
  let best = bins[0];
  for (const b of bins) {
    const center = (b.from + b.to) / 2;
    const bestCenter = (best.from + best.to) / 2;
    if (b.count > best.count || (b.count === best.count && Math.abs(center - med) < Math.abs(bestCenter - med))) {
      best = b;
    }
  }
  return best;
}

export interface Regression {
  slope: number;
  intercept: number;
  r2: number;
  predict(x: number): number;
  /** Błąd standardowy linii trendu w punkcie x – rośnie z odległością od środka danych. */
  standardError(x: number): number;
}

/** Regresja liniowa metodą najmniejszych kwadratów. */
export function linearRegression(xs: number[], ys: number[]): Regression {
  const n = xs.length;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = sxx === 0 || syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  let ssr = 0;
  for (let i = 0; i < n; i++) ssr += (ys[i] - (intercept + slope * xs[i])) ** 2;
  const sigma = n > 2 ? Math.sqrt(ssr / (n - 2)) : 0;
  return {
    slope,
    intercept,
    r2,
    predict: (x) => intercept + slope * x,
    standardError: (x) => (sxx === 0 ? 0 : sigma * Math.sqrt(1 / n + (x - mx) ** 2 / sxx)),
  };
}

// ---------- okno sezonowe ----------

function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Ten sam dzień/miesiąc co `target`, ale w roku `year` (29.02 → 28.02 w latach nieprzestępnych). */
export function anchorInYear(target: Date, year: number): Date {
  const m = target.getUTCMonth();
  let d = target.getUTCDate();
  if (m === 1 && d === 29 && !isLeap(year)) d = 28;
  return new Date(Date.UTC(year, m, d));
}

export interface WindowSample extends DailyRecord {
  /** Rok „sezonu”, do którego należy próbka (rok kotwicy, nie rok kalendarzowy rekordu). */
  seasonYear: number;
  offset: number; // dni od kotwicy
}

/**
 * Zbiera dni leżące w oknie ±halfWidth dni od tej samej daty (dzień/miesiąc) co `target` w każdym roku.
 * Okno może przechodzić przez koniec roku – próbka jest wtedy przypisana do roku kotwicy.
 * Lata z niepełnym oknem (< połowy dni) są odrzucane, a lata >= roku docelowego pomijane,
 * gdy kotwica wypada po ostatnim dniu danych.
 */
export function seasonalWindow(records: DailyRecord[], target: Date, halfWidth = 7): WindowSample[] {
  const out: WindowSample[] = [];
  for (const r of records) {
    const rd = parseDate(r.date);
    const ry = rd.getUTCFullYear();
    for (const y of [ry - 1, ry, ry + 1]) {
      const anchor = anchorInYear(target, y);
      const offset = Math.round((rd.getTime() - anchor.getTime()) / DAY_MS);
      if (Math.abs(offset) <= halfWidth) {
        out.push({ ...r, seasonYear: y, offset });
        break;
      }
    }
  }
  const counts = new Map<number, number>();
  for (const s of out) counts.set(s.seasonYear, (counts.get(s.seasonYear) ?? 0) + 1);
  const minDays = Math.ceil((2 * halfWidth + 1) / 2);
  return out.filter((s) => (counts.get(s.seasonYear) ?? 0) >= minDays);
}

// ---------- analiza ----------

export interface CategoryShare {
  category: WeatherCategory;
  share: number; // 0..1
  count: number;
}

export interface TempForecast {
  expected: number;
  p10: number;
  p90: number;
}

export interface YearPoint {
  year: number;
  mean: number;
}

export interface Analysis {
  target: Date;
  years: number[];
  sampleSize: number;
  historical: {
    tMean: { mean: number; median: number; std: number; min: number; max: number };
    tMaxMode: Bin | null;
    tMinMode: Bin | null;
    tMax: number[];
    tMin: number[];
    categories: CategoryShare[];
    rainProbability: number;
    medianWetPrecip: number;
    meanWind: number;
  };
  forecast: {
    tMean: TempForecast;
    tMax: TempForecast;
    tMin: TempForecast;
    categories: CategoryShare[];
    rainProbability: number;
    trendPerDecade: number;
    trendR2: number;
    trendUsed: boolean;
    /** O ile lat rok docelowy wykracza poza ostatni rok danych. */
    extrapolationYears: number;
  };
  yearly: YearPoint[];
  trendLine: YearPoint[];
}

export interface AnalyzeOptions {
  halfWidth?: number;
  /** Okres połowicznego zaniku wag (lata) – nowsze lata liczą się mocniej. */
  halfLifeYears?: number;
  /** Minimalna liczba lat, od której uwzględniamy trend liniowy. */
  minYearsForTrend?: number;
  /** Próg opadu (mm) uznawany za „dzień z opadem”. */
  wetThreshold?: number;
}

function categoryShares(samples: WindowSample[], weights: number[]): CategoryShare[] {
  const acc = new Map<WeatherCategory, { w: number; n: number }>();
  for (const c of CATEGORY_ORDER) acc.set(c, { w: 0, n: 0 });
  let total = 0;
  samples.forEach((s, i) => {
    const e = acc.get(categorize(s.code))!;
    e.w += weights[i];
    e.n += 1;
    total += weights[i];
  });
  return CATEGORY_ORDER.map((category) => ({
    category,
    share: total ? acc.get(category)!.w / total : 0,
    count: acc.get(category)!.n,
  })).sort((a, b) => b.share - a.share);
}

function trendForecast(
  samples: WindowSample[],
  weights: number[],
  pick: (s: WindowSample) => number,
  targetYear: number,
  useTrend: boolean,
): { forecast: TempForecast; reg: Regression; yearly: YearPoint[] } {
  const byYear = new Map<number, number[]>();
  for (const s of samples) {
    if (!byYear.has(s.seasonYear)) byYear.set(s.seasonYear, []);
    byYear.get(s.seasonYear)!.push(pick(s));
  }
  const yearly = [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, vs]) => ({ year, mean: mean(vs) }));

  const reg = useTrend
    ? linearRegression(
        yearly.map((p) => p.year),
        yearly.map((p) => p.mean),
      )
    : { slope: 0, intercept: 0, r2: 0, predict: () => 0, standardError: () => 0 };

  // poziom bazowy: trend liniowy albo (przy zbyt krótkiej serii) średnia ważona
  let level: (year: number) => number = reg.predict;
  if (!useTrend) {
    const wm = weightedMean(samples.map(pick), weights);
    level = () => wm;
  }
  // reszty = wartość dzienna minus poziom dla jej roku → rozrzut dzienny + międzyroczny
  const residuals = samples.map((s) => pick(s) - level(s.seasonYear));
  const expected = level(targetYear) + weightedMean(residuals, weights);
  // niepewność położenia trendu (rośnie przy dalekiej ekstrapolacji) dodana w kwadraturze
  // do rozrzutu dziennego: P10/P90 rozkładu normalnego to ±1.2816σ
  const trendSpread = 1.2816 * reg.standardError(targetYear);
  const widen = (d: number) => Math.sign(d) * Math.sqrt(d * d + trendSpread * trendSpread);
  const base = level(targetYear);
  return {
    forecast: {
      expected,
      p10: expected + widen(base + weightedQuantile(residuals, weights, 0.1) - expected),
      p90: expected + widen(base + weightedQuantile(residuals, weights, 0.9) - expected),
    },
    reg,
    yearly,
  };
}

export function analyze(records: DailyRecord[], target: Date, opts: AnalyzeOptions = {}): Analysis {
  const halfWidth = opts.halfWidth ?? 7;
  const halfLife = opts.halfLifeYears ?? 10;
  const minYearsForTrend = opts.minYearsForTrend ?? 8;
  const wet = opts.wetThreshold ?? 1;

  const samples = seasonalWindow(records, target, halfWidth);
  if (samples.length === 0) throw new Error('Brak danych historycznych dla wybranego okresu.');

  const years = [...new Set(samples.map((s) => s.seasonYear))].sort((a, b) => a - b);
  const latest = years[years.length - 1];
  const weights = samples.map((s) => Math.pow(0.5, (latest - s.seasonYear) / halfLife));
  const ones = samples.map(() => 1);
  const targetYear = target.getUTCFullYear();
  const useTrend = years.length >= minYearsForTrend;

  const tMeans = samples.map((s) => s.tMean);
  const tMax = samples.map((s) => s.tMax);
  const tMin = samples.map((s) => s.tMin);
  const wetSamples = samples.filter((s) => s.precip >= wet);

  const fMean = trendForecast(samples, weights, (s) => s.tMean, targetYear, useTrend);
  const fMax = trendForecast(samples, weights, (s) => s.tMax, targetYear, useTrend);
  const fMin = trendForecast(samples, weights, (s) => s.tMin, targetYear, useTrend);

  const wSum = weights.reduce((a, b) => a + b, 0);
  const wWet = samples.reduce((a, s, i) => a + (s.precip >= wet ? weights[i] : 0), 0);

  const trendLine = useTrend
    ? [
        { year: years[0], mean: fMean.reg.predict(years[0]) },
        { year: Math.max(targetYear, latest), mean: fMean.reg.predict(Math.max(targetYear, latest)) },
      ]
    : [];

  return {
    target,
    years,
    sampleSize: samples.length,
    historical: {
      tMean: {
        mean: mean(tMeans),
        median: quantile(tMeans, 0.5),
        std: stdDev(tMeans),
        min: Math.min(...tMin),
        max: Math.max(...tMax),
      },
      tMaxMode: modeBin(tMax, 1),
      tMinMode: modeBin(tMin, 1),
      tMax,
      tMin,
      categories: categoryShares(samples, ones),
      rainProbability: wetSamples.length / samples.length,
      medianWetPrecip: quantile(
        wetSamples.map((s) => s.precip),
        0.5,
      ),
      meanWind: mean(samples.map((s) => s.wind)),
    },
    forecast: {
      tMean: fMean.forecast,
      tMax: fMax.forecast,
      tMin: fMin.forecast,
      categories: categoryShares(samples, weights),
      rainProbability: wWet / wSum,
      trendPerDecade: fMean.reg.slope * 10,
      trendR2: fMean.reg.r2,
      trendUsed: useTrend,
      extrapolationYears: Math.max(0, targetYear - latest),
    },
    yearly: fMean.yearly,
    trendLine,
  };
}
