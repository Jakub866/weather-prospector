import { describe, expect, it } from 'vitest';
import type { DailyRecord } from '../src/api';
import {
  analyze,
  anchorInYear,
  histogram,
  linearRegression,
  modeBin,
  quantile,
  seasonalWindow,
  weightedQuantile,
} from '../src/stats';
import { categorize } from '../src/weatherCodes';

function day(date: string, over: Partial<DailyRecord> = {}): DailyRecord {
  return { date, tMax: 10, tMin: 0, tMean: 5, precip: 0, code: 0, wind: 10, ...over };
}

/** Generuje dzienne rekordy między dwiema datami (UTC). */
function series(from: string, to: string, f: (d: Date) => Partial<DailyRecord>): DailyRecord[] {
  const out: DailyRecord[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(day(d.toISOString().slice(0, 10), f(new Date(d))));
  }
  return out;
}

describe('podstawowe statystyki', () => {
  it('quantile interpoluje liniowo', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([5], 0.9)).toBe(5);
  });

  it('weightedQuantile respektuje wagi', () => {
    expect(weightedQuantile([0, 10], [1, 1], 0.5)).toBe(0);
    expect(weightedQuantile([0, 10], [1, 9], 0.5)).toBe(10);
  });

  it('histogram i moda', () => {
    const xs = [1.2, 1.7, 2.1, 2.2, 2.9, -0.5];
    const h = histogram(xs, 1);
    expect(h[0].from).toBe(-1);
    expect(h.reduce((a, b) => a + b.count, 0)).toBe(xs.length);
    expect(modeBin(xs, 1)).toMatchObject({ from: 2, to: 3, count: 3 });
  });

  it('regresja liniowa', () => {
    const r = linearRegression([2000, 2001, 2002], [1, 3, 5]);
    expect(r.slope).toBeCloseTo(2);
    expect(r.predict(2003)).toBeCloseTo(7);
    expect(r.r2).toBeCloseTo(1);
  });
});

describe('okno sezonowe', () => {
  it('29 lutego w roku nieprzestępnym → 28 lutego', () => {
    const t = new Date('2024-02-29T00:00:00Z');
    expect(anchorInYear(t, 2023).toISOString().slice(0, 10)).toBe('2023-02-28');
    expect(anchorInYear(t, 2020).toISOString().slice(0, 10)).toBe('2020-02-29');
  });

  it('okno przez koniec roku przypisuje dni do roku kotwicy', () => {
    const recs = series('2020-12-20', '2021-01-20', () => ({}));
    const w = seasonalWindow(recs, new Date('2030-01-02T00:00:00Z'), 7);
    expect(w.length).toBe(15);
    expect(new Set(w.map((s) => s.seasonYear))).toEqual(new Set([2021]));
    expect(w.some((s) => s.date === '2020-12-26')).toBe(true);
    expect(w.some((s) => s.date === '2021-01-09')).toBe(true);
  });

  it('odrzuca lata z niepełnym oknem', () => {
    const recs = series('2021-01-01', '2021-01-03', () => ({}));
    expect(seasonalWindow(recs, new Date('2030-01-05T00:00:00Z'), 7)).toHaveLength(0);
  });
});

describe('analyze', () => {
  // 30 lat, ocieplenie 0.3°C/rok, rano zawsze pogodnie, co 4. dzień deszcz
  const recs = series('1995-01-01', '2024-12-31', (d) => {
    const y = d.getUTCFullYear() - 1995;
    const base = 0.3 * y + Math.sin(d.getUTCDate()) * 2;
    const rainy = d.getUTCDate() % 4 === 0;
    return { tMean: base, tMax: base + 5, tMin: base - 5, precip: rainy ? 3 : 0, code: rainy ? 63 : 1 };
  });

  it('wykrywa trend i ekstrapoluje na rok docelowy', () => {
    const a = analyze(recs, new Date('2026-07-15T00:00:00Z'));
    expect(a.years).toHaveLength(30);
    expect(a.forecast.trendUsed).toBe(true);
    expect(a.forecast.trendPerDecade).toBeCloseTo(3, 1);
    // poziom w 2026 ≈ 0.3 * 31 = 9.3
    expect(a.forecast.tMean.expected).toBeGreaterThan(8.5);
    expect(a.forecast.tMean.expected).toBeLessThan(10);
    expect(a.forecast.tMean.p10).toBeLessThan(a.forecast.tMean.expected);
    expect(a.forecast.tMean.p90).toBeGreaterThan(a.forecast.tMean.expected);
    expect(a.forecast.tMax.expected - a.forecast.tMin.expected).toBeCloseTo(10, 1);
  });

  it('liczy najczęstszą kategorię i szansę opadu', () => {
    const a = analyze(recs, new Date('2026-07-15T00:00:00Z'));
    expect(a.historical.categories[0].category).toBe('clear');
    expect(a.forecast.categories[0].category).toBe('clear');
    expect(a.historical.rainProbability).toBeGreaterThan(0.15);
    expect(a.historical.rainProbability).toBeLessThan(0.35);
  });

  it('bez trendu przy krótkiej serii', () => {
    const short = recs.filter((r) => r.date >= '2021-01-01');
    const a = analyze(short, new Date('2026-07-15T00:00:00Z'));
    expect(a.forecast.trendUsed).toBe(false);
    expect(a.trendLine).toHaveLength(0);
  });
});

describe('kody WMO', () => {
  it('mapuje kody na kategorie', () => {
    expect(categorize(0)).toBe('clear');
    expect(categorize(3)).toBe('overcast');
    expect(categorize(45)).toBe('fog');
    expect(categorize(81)).toBe('rain');
    expect(categorize(75)).toBe('snow');
    expect(categorize(95)).toBe('storm');
  });
});

describe('daleka przyszłość', () => {
  const recs = series('1995-01-01', '2024-12-31', (d) => {
    const y = d.getUTCFullYear() - 1995;
    // trend + losowy szum międzyroczny (deterministyczny)
    const base = 0.3 * y + Math.sin(y * 12.9898) * 1.5 + Math.sin(d.getUTCDate()) * 2;
    return { tMean: base, tMax: base + 5, tMin: base - 5 };
  });

  it('analizuje datę kilka lat do przodu (30.09.2030)', () => {
    const a = analyze(recs, new Date('2030-09-30T00:00:00Z'));
    expect(a.forecast.extrapolationYears).toBe(6);
    expect(a.forecast.tMean.expected).toBeGreaterThan(9);
    expect(a.trendLine[1].year).toBe(2030);
  });

  it('przedział niepewności rośnie z odległością ekstrapolacji', () => {
    const near = analyze(recs, new Date('2025-09-30T00:00:00Z')).forecast.tMean;
    const far = analyze(recs, new Date('2060-09-30T00:00:00Z')).forecast.tMean;
    expect(far.p90 - far.p10).toBeGreaterThan(near.p90 - near.p10);
    expect(far.p10).toBeLessThan(far.expected);
    expect(far.p90).toBeGreaterThan(far.expected);
  });
});
