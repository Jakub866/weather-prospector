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
  type Plugin,
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

/** #rrggbb + przezroczystość 0..1 → #rrggbbaa */
function alpha(hex: string, a: number): string {
  return hex + Math.round(a * 255).toString(16).padStart(2, '0');
}

const deg = (x: number) => `${Math.round(x)}°C`;

function setCaption(id: string, text: string) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function drawLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, align: CanvasTextAlign, color: string, bold = false) {
  ctx.save();
  ctx.font = `${bold ? '600 ' : ''}12px ${getComputedStyle(document.body).fontFamily}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

const legendFilter = (item: { datasetIndex?: number }, data: { datasets: any[] }) =>
  !data.datasets[item.datasetIndex ?? 0].hideLegend;

export function renderCharts(a: Analysis): void {
  charts.splice(0).forEach((c) => c.destroy());
  Chart.defaults.color = css('--text-secondary');
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

  const day = css('--series-2'); // ciepło – temperatura w dzień
  const night = css('--series-1'); // chłód – temperatura w nocy
  const surface = css('--surface');
  const grid = css('--grid');
  const ink = css('--text-primary');
  const muted = css('--text-secondary');
  const faint = css('--text-muted');

  const targetYear = a.target.getUTCFullYear();
  const dayName = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(a.target);
  const f = a.forecast;

  // ---------------------------------------------------------------------------
  // 1. Oś czasu: było (faktyczne wartości tego dnia) → będzie (prognoza z zakresem)
  // ---------------------------------------------------------------------------
  const firstYear = a.years[0];
  const lastYear = Math.max(targetYear, a.years[a.years.length - 1]);
  const labels: number[] = [];
  for (let y = firstYear; y <= lastYear; y++) labels.push(y);
  const ti = labels.indexOf(targetYear);
  const exact = new Map(a.exactDays.map((d) => [d.year, d]));
  const latestExact = a.exactDays[a.exactDays.length - 1];

  const series = (pick: (d: (typeof a.exactDays)[number]) => number) =>
    labels.map((y) => (exact.has(y) && y !== targetYear ? pick(exact.get(y)!) : null));
  const trendData = (pts: { year: number; mean: number }[]) => {
    if (pts.length < 2) return labels.map(() => null);
    const [p0, p1] = pts;
    const k = (p1.mean - p0.mean) / (p1.year - p0.year || 1);
    return labels.map((y) => p0.mean + k * (y - p0.year));
  };
  const only = (v: number | [number, number]) => labels.map((_, i) => (i === ti ? v : null));
  const pointRadius = (data: (number | null)[]) =>
    labels.map((y, i) => (data[i] == null ? 0 : y === latestExact?.year ? 5 : 3));

  const dayData = series((d) => d.tMax);
  const nightData = series((d) => d.tMin);

  const timelineLabels: Plugin<'line'> = {
    id: 'timelineLabels',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const x = scales.x;
      const nowYear = new Date().getUTCFullYear();
      const ni = labels.indexOf(nowYear);
      // pionowa linia „dziś” + napisy BYŁO / BĘDZIE
      if (ni >= 0 && ni < labels.length - 1) {
        const px = x.getPixelForValue(ni);
        ctx.save();
        ctx.strokeStyle = faint;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(px, chartArea.top);
        ctx.lineTo(px, chartArea.bottom);
        ctx.stroke();
        ctx.restore();
        drawLabel(ctx, '◀ BYŁO', px - 8, chartArea.top + 10, 'right', muted, true);
        drawLabel(ctx, 'BĘDZIE ▶', px + 8, chartArea.top + 10, 'left', muted, true);
      }
      // etykiety przy prognozie
      if (ti >= 0) {
        const px = x.getPixelForValue(ti);
        const side = ti > labels.length * 0.75 ? 'right' : 'left';
        const dx = side === 'right' ? -12 : 12;
        drawLabel(ctx, `~${deg(f.tMax.expected)} w dzień`, px + dx, scales.y.getPixelForValue(f.tMax.expected), side, ink, true);
        drawLabel(ctx, `~${deg(f.tMin.expected)} w nocy`, px + dx, scales.y.getPixelForValue(f.tMin.expected), side, ink, true);
      }
      // etykieta ostatniego faktycznego roku
      if (latestExact && latestExact.year !== targetYear) {
        const li = labels.indexOf(latestExact.year);
        const px = x.getPixelForValue(li);
        drawLabel(ctx, `${latestExact.year}: ${deg(latestExact.tMax)}`, px, scales.y.getPixelForValue(latestExact.tMax) - 14, 'center', ink);
      }
    },
  };

  const datasets: any[] = [
    {
      type: 'line',
      label: 'W dzień (najwyżej)',
      data: dayData,
      borderColor: alpha(day, 0.55),
      backgroundColor: day,
      borderWidth: 1.5,
      pointRadius: pointRadius(dayData),
      pointHoverRadius: 6,
      pointBorderColor: surface,
      pointBorderWidth: 1,
      spanGaps: true,
      order: 2,
    },
    {
      type: 'line',
      label: 'W nocy (najniżej)',
      data: nightData,
      borderColor: alpha(night, 0.55),
      backgroundColor: night,
      borderWidth: 1.5,
      pointRadius: pointRadius(nightData),
      pointHoverRadius: 6,
      pointBorderColor: surface,
      pointBorderWidth: 1,
      spanGaps: true,
      order: 2,
    },
    {
      type: 'line',
      label: 'Kierunek zmian (w dzień)',
      hideLegend: true,
      data: trendData(a.trends.tMax),
      borderColor: alpha(day, 0.7),
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 0,
      order: 3,
    },
    {
      type: 'line',
      label: 'Kierunek zmian (w nocy)',
      hideLegend: true,
      data: trendData(a.trends.tMin),
      borderColor: alpha(night, 0.7),
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 0,
      pointHoverRadius: 0,
      order: 3,
    },
  ];
  if (ti >= 0) {
    datasets.push(
      {
        type: 'bar',
        label: 'Prawdopodobny zakres w dzień',
        hideLegend: true,
        data: only([f.tMax.p10, f.tMax.p90]),
        backgroundColor: alpha(day, 0.25),
        borderRadius: 4,
        borderSkipped: false,
        barPercentage: 1,
        categoryPercentage: 1,
        maxBarThickness: 18,
        grouped: false,
        order: 4,
      },
      {
        type: 'bar',
        label: 'Prawdopodobny zakres w nocy',
        hideLegend: true,
        data: only([f.tMin.p10, f.tMin.p90]),
        backgroundColor: alpha(night, 0.25),
        borderRadius: 4,
        borderSkipped: false,
        barPercentage: 1,
        categoryPercentage: 1,
        maxBarThickness: 18,
        grouped: false,
        order: 4,
      },
      {
        type: 'line',
        label: 'Prognoza w dzień',
        hideLegend: true,
        data: only(f.tMax.expected),
        backgroundColor: day,
        borderColor: surface,
        borderWidth: 2,
        pointRadius: 8,
        pointHoverRadius: 9,
        pointStyle: 'rectRot',
        order: 1,
      },
      {
        type: 'line',
        label: 'Prognoza w nocy',
        hideLegend: true,
        data: only(f.tMin.expected),
        backgroundColor: night,
        borderColor: surface,
        borderWidth: 2,
        pointRadius: 8,
        pointHoverRadius: 9,
        pointStyle: 'rectRot',
        order: 1,
      },
    );
  }

  charts.push(
    new Chart(document.getElementById('chart-timeline') as HTMLCanvasElement, {
      type: 'line',
      data: { labels, datasets },
      plugins: [timelineLabels],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 8, right: 8 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: {
            position: 'top',
            align: 'start',
            labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, filter: legendFilter as any },
          },
          tooltip: {
            filter: (it) => it.raw != null && !(it.dataset as any).label.startsWith('Kierunek'),
            callbacks: {
              title: (items) => `${dayName} ${items[0].label}`,
              label: (it) => {
                const r = it.raw as number | [number, number];
                return Array.isArray(r)
                  ? `${it.dataset.label}: ${deg(r[0])} … ${deg(r[1])}`
                  : `${it.dataset.label}: ${r.toFixed(1)}°C`;
              },
            },
          },
        },
        scales: {
          x: { offset: true, grid: { display: false }, border: { color: grid }, ticks: { maxTicksLimit: 12, maxRotation: 0 } },
          y: { grid: { color: grid }, border: { display: false }, ticks: { callback: (v) => `${v}°` } },
        },
      },
    }),
  );
  setCaption(
    'cap-timeline',
    `Ile stopni było ${dayName} w każdym roku – i ile będzie w ${targetYear}`,
  );

  // ---------------------------------------------------------------------------
  // 2. Jak ciepło najczęściej bywa w dzień (histogram temp. max, moda wyróżniona)
  // ---------------------------------------------------------------------------
  const tMax = a.historical.tMax;
  const bins = histogram(tMax, 1);
  const shares = bins.map((b) => (b.count / tMax.length) * 100);
  const modeIdx = shares.indexOf(Math.max(...shares));
  const forecastPos = Math.min(bins.length - 0.5, Math.max(-0.5, f.tMax.expected - bins[0].from - 0.5));

  const histLabels: Plugin<'bar'> = {
    id: 'histLabels',
    afterDatasetsDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      const x = scales.x;
      const step = bins.length > 1 ? x.getPixelForValue(1) - x.getPixelForValue(0) : 0;
      // marker prognozy
      const px = x.getPixelForValue(0) + forecastPos * step;
      ctx.save();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(px, chartArea.top + 18);
      ctx.lineTo(px, chartArea.bottom);
      ctx.stroke();
      ctx.restore();
      const align = px > chartArea.right - 90 ? 'right' : px < chartArea.left + 90 ? 'left' : 'center';
      drawLabel(ctx, `${targetYear}: ~${deg(f.tMax.expected)}`, px, chartArea.top + 8, align, ink, true);
      // etykieta najczęstszego koszyka
      const meta = chart.getDatasetMeta(0).data[modeIdx];
      if (meta && Math.abs(meta.x - px) > 40) {
        drawLabel(ctx, 'najczęściej', meta.x, meta.y - 10, 'center', muted);
      }
    },
  };

  charts.push(
    new Chart(document.getElementById('chart-hist') as HTMLCanvasElement, {
      type: 'bar',
      data: {
        labels: bins.map((b) => `${b.from}°`),
        datasets: [
          {
            label: 'Dni z taką temperaturą',
            data: shares,
            backgroundColor: bins.map((_, i) => (i === modeIdx ? day : alpha(day, 0.35))),
            borderRadius: 3,
            categoryPercentage: 1,
            barPercentage: 0.9,
          },
        ],
      },
      plugins: [histLabels],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { top: 22 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => {
                const b = bins[items[0].dataIndex];
                return `W dzień ${b.from}…${b.to}°C`;
              },
              label: (it) => `${Math.round(it.raw as number)}% dni (${bins[it.dataIndex].count} z ${tMax.length})`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { color: grid }, ticks: { maxRotation: 0, autoSkip: true } },
          y: { grid: { color: grid }, border: { display: false }, ticks: { callback: (v) => `${v}%` } },
        },
      },
    }),
  );
  const mb = bins[modeIdx];
  setCaption('cap-hist', `W dzień najczęściej było ${mb.from}…${mb.to}°C (${Math.round(shares[modeIdx])}% dni)`);

  // ---------------------------------------------------------------------------
  // 3. Jaka pogoda: było vs będzie
  // ---------------------------------------------------------------------------
  const histShare = new Map(a.historical.categories.map((c) => [c.category, c.share]));
  const cats = f.categories.filter((c) => c.share >= 0.01 || (histShare.get(c.category) ?? 0) >= 0.01);
  const nowColor = css('--series-1');
  const wasColor = alpha(faint, 0.6);

  const catLabels: Plugin<'bar'> = {
    id: 'catLabels',
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(1);
      meta.data.forEach((bar, i) => {
        drawLabel(chart.ctx, `${Math.round(cats[i].share * 100)}%`, bar.x + 6, bar.y, 'left', ink, true);
      });
    },
  };

  charts.push(
    new Chart(document.getElementById('chart-cats') as HTMLCanvasElement, {
      type: 'bar',
      data: {
        labels: cats.map((c) => `${CATEGORIES[c.category].icon} ${CATEGORIES[c.category].label}`),
        datasets: [
          {
            label: `Było (${a.years[0]}–${a.years[a.years.length - 1]})`,
            data: cats.map((c) => (histShare.get(c.category) ?? 0) * 100),
            backgroundColor: wasColor,
            borderRadius: 3,
            barPercentage: 0.8,
            categoryPercentage: 0.75,
          },
          {
            label: `Będzie (${targetYear})`,
            data: cats.map((c) => c.share * 100),
            backgroundColor: nowColor,
            borderRadius: 3,
            barPercentage: 0.8,
            categoryPercentage: 0.75,
          },
        ],
      },
      plugins: [catLabels],
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        layout: { padding: { right: 40 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10 } },
          tooltip: {
            callbacks: {
              label: (it) => `${it.dataset.label}: ${Math.round(it.raw as number)}% dni`,
            },
          },
        },
        scales: {
          x: { grid: { color: grid }, border: { display: false }, ticks: { callback: (v) => `${v}%` } },
          y: { grid: { display: false }, border: { color: grid } },
        },
      },
    }),
  );
  const top = f.categories[0];
  setCaption(
    'cap-cats',
    `Jaka pogoda: najpewniej ${CATEGORIES[top.category].label.toLowerCase()} (${Math.round(top.share * 100)}% szans)`,
  );
}
