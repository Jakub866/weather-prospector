import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import type { Analysis } from './stats';
import { histogram } from './stats';
import { CATEGORIES } from './weatherCodes';

Chart.register(
  BarController,
  BarElement,
  CategoryScale,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
  Legend,
);

const charts: Chart[] = [];

function css(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function baseOptions() {
  const muted = css('--text-secondary');
  const grid = css('--grid');
  Chart.defaults.color = muted;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index' as const, intersect: false },
    scales: {
      x: { grid: { display: false }, border: { color: grid } },
      y: { grid: { color: grid }, border: { display: false } },
    },
  };
}

export function renderCharts(a: Analysis): void {
  charts.splice(0).forEach((c) => c.destroy());
  const s1 = css('--series-1');
  const s2 = css('--series-2');
  const surface = css('--surface');
  const muted = css('--text-muted');

  // 1. Histogram temperatur max / min (wspólne koszyki 1 °C)
  const all = [...a.historical.tMax, ...a.historical.tMin];
  const bins = histogram(all, 1);
  const count = (xs: number[]) => {
    const c = bins.map(() => 0);
    for (const x of xs) c[Math.min(bins.length - 1, Math.floor(x - bins[0].from))]++;
    return c.map((n) => (n / xs.length) * 100);
  };
  const base = baseOptions();
  charts.push(
    new Chart(document.getElementById('chart-hist') as HTMLCanvasElement, {
      type: 'bar',
      data: {
        labels: bins.map((b) => `${b.from}°`),
        datasets: [
          {
            label: 'Temp. minimalna',
            data: count(a.historical.tMin),
            backgroundColor: s1,
            borderColor: surface,
            borderWidth: 1,
            borderRadius: 3,
            grouped: false,
          },
          {
            label: 'Temp. maksymalna',
            data: count(a.historical.tMax),
            backgroundColor: s2,
            borderColor: surface,
            borderWidth: 1,
            borderRadius: 3,
            grouped: false,
          },
        ],
      },
      options: {
        ...base,
        datasets: { bar: { categoryPercentage: 1, barPercentage: 0.92 } },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10 } },
          tooltip: {
            callbacks: {
              title: (items) => {
                const b = bins[items[0].dataIndex];
                return `${b.from} … ${b.to} °C`;
              },
              label: (it) => `${it.dataset.label}: ${(it.raw as number).toFixed(1)}% dni`,
            },
          },
        },
        scales: {
          ...base.scales,
          y: { ...base.scales.y, ticks: { callback: (v) => `${v}%` } },
        },
      },
    }),
  );

  // 2. Średnia temperatura okna w kolejnych latach + trend
  const years = a.yearly.map((p) => p.year);
  const lastYear = Math.max(years[years.length - 1], a.target.getUTCFullYear());
  const labels: number[] = [];
  for (let y = years[0]; y <= lastYear; y++) labels.push(y);
  const yearlyMap = new Map(a.yearly.map((p) => [p.year, p.mean]));
  const datasets: any[] = [
    {
      label: 'Średnia temperatura w oknie',
      data: labels.map((y) => yearlyMap.get(y) ?? null),
      borderColor: s1,
      backgroundColor: s1,
      borderWidth: 2,
      pointRadius: 3,
      pointHoverRadius: 6,
      pointBorderColor: surface,
      pointBorderWidth: 1,
      spanGaps: false,
    },
  ];
  if (a.trendLine.length === 2) {
    const [p0, p1] = a.trendLine;
    const slope = (p1.mean - p0.mean) / (p1.year - p0.year || 1);
    datasets.push({
      label: 'Trend liniowy',
      data: labels.map((y) => p0.mean + slope * (y - p0.year)),
      borderColor: muted,
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 0,
    });
  }
  charts.push(
    new Chart(document.getElementById('chart-trend') as HTMLCanvasElement, {
      type: 'line',
      data: { labels, datasets },
      options: {
        ...base,
        plugins: {
          legend: { position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10 } },
          tooltip: {
            callbacks: {
              label: (it) => (it.raw == null ? '' : `${it.dataset.label}: ${(it.raw as number).toFixed(1)} °C`),
            },
          },
        },
        scales: {
          ...base.scales,
          x: { ...base.scales.x, ticks: { maxTicksLimit: 10 } },
          y: { ...base.scales.y, ticks: { callback: (v) => `${v}°` } },
        },
      },
    }),
  );

  // 3. Rozkład typów pogody (prognoza ważona)
  const cats = a.forecast.categories.filter((c) => c.count > 0);
  charts.push(
    new Chart(document.getElementById('chart-cats') as HTMLCanvasElement, {
      type: 'bar',
      data: {
        labels: cats.map((c) => `${CATEGORIES[c.category].icon} ${CATEGORIES[c.category].label}`),
        datasets: [
          {
            label: 'Prawdopodobieństwo',
            data: cats.map((c) => c.share * 100),
            backgroundColor: s1,
            borderRadius: 4,
            barPercentage: 0.7,
          },
        ],
      },
      options: {
        ...base,
        indexAxis: 'y',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (it) => `${(it.raw as number).toFixed(1)}% (${cats[it.dataIndex].count} dni w historii)`,
            },
          },
        },
        scales: {
          x: { grid: { color: css('--grid') }, border: { display: false }, ticks: { callback: (v) => `${v}%` } },
          y: { grid: { display: false }, border: { color: css('--grid') } },
        },
      },
    }),
  );
}
