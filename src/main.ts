import './style.css';
import { fetchHistory, isoDate, searchPlaces, type Place } from './api';
import { renderCharts } from './charts';
import { createMap } from './map';
import { analyze, type Analysis, type TempForecast } from './stats';
import { CATEGORIES } from './weatherCodes';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const state = { lat: 52.2297, lon: 21.0122, label: 'Warszawa, Polska' };

const form = $<HTMLFormElement>('form');
const dateInput = $<HTMLInputElement>('date');
const yearsInput = $<HTMLInputElement>('years');
const aheadInput = $<HTMLInputElement>('ahead');
const targetInput = $<HTMLInputElement>('target');
const targetHint = $('target-hint');
const locationOut = $('location');
const submit = $<HTMLButtonElement>('submit');
const search = $<HTMLInputElement>('search');
const suggestions = $<HTMLUListElement>('suggestions');

const fmtDate = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtDay = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const t = (x: number) => `${x.toFixed(1)}°C`;
const pct = (x: number) => `${Math.round(x * 100)}%`;

dateInput.value = isoDate(new Date());

const DAY_MS = 86_400_000;
const parseIso = (v: string) => new Date(`${v}T00:00:00Z`);

function targetDate(): Date | null {
  return targetInput.value ? parseIso(targetInput.value) : null;
}

function updateHint() {
  const d = targetDate();
  if (!d) {
    targetHint.textContent = '';
    return;
  }
  const yearsAhead = (d.getTime() - Date.now()) / (365.25 * DAY_MS);
  targetHint.textContent =
    `${fmtDate.format(d)}` +
    (yearsAhead > 1 ? ` · ok. ${yearsAhead.toFixed(1)} lat w przód – przedział niepewności rośnie z odległością` : '');
}

/** Odniesienie + M → data docelowa. */
function syncTargetFromAhead() {
  if (!dateInput.value) return;
  const d = parseIso(dateInput.value);
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.round(Number(aheadInput.value) || 0)));
  targetInput.value = isoDate(d);
  updateHint();
}

/** Data docelowa → M (gdy cel jest przed odniesieniem, odniesienie przesuwa się na cel). */
function syncAheadFromTarget() {
  const d = targetDate();
  if (!d || !dateInput.value) return updateHint();
  let ref = parseIso(dateInput.value);
  if (d < ref) {
    dateInput.value = targetInput.value;
    ref = d;
  }
  aheadInput.value = String(Math.round((d.getTime() - ref.getTime()) / DAY_MS));
  updateHint();
}

function updateLocation() {
  locationOut.textContent = `📍 ${state.label} (${state.lat.toFixed(3)}, ${state.lon.toFixed(3)})`;
}

const map = createMap($('map'), state, (lat, lon) => {
  state.lat = lat;
  state.lon = lon;
  state.label = 'Wybrany punkt';
  updateLocation();
});

[dateInput, aheadInput].forEach((el) => el.addEventListener('input', syncTargetFromAhead));
targetInput.addEventListener('input', syncAheadFromTarget);
syncTargetFromAhead();
updateLocation();

// ---------- wyszukiwarka miejsc ----------
let searchTimer: number | undefined;
let places: Place[] = [];

function choosePlace(p: Place) {
  state.lat = p.lat;
  state.lon = p.lon;
  state.label = [p.name, p.admin1, p.country].filter(Boolean).join(', ');
  map.setLocation(p.lat, p.lon, state.label, true);
  updateLocation();
  suggestions.hidden = true;
  search.value = p.name;
}

search.addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  const q = search.value.trim();
  if (q.length < 2) {
    suggestions.hidden = true;
    return;
  }
  searchTimer = window.setTimeout(async () => {
    places = await searchPlaces(q).catch(() => []);
    suggestions.replaceChildren(
      ...places.map((p) => {
        const li = document.createElement('li');
        li.textContent = p.name + ' ';
        const small = document.createElement('small');
        small.textContent = [p.admin1, p.country].filter(Boolean).join(', ');
        li.append(small);
        li.addEventListener('mousedown', (e) => {
          e.preventDefault();
          choosePlace(p);
        });
        return li;
      }),
    );
    suggestions.hidden = places.length === 0;
  }, 300);
});
search.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (places[0]) choosePlace(places[0]);
  } else if (e.key === 'Escape') {
    suggestions.hidden = true;
  }
});
search.addEventListener('blur', () => setTimeout(() => (suggestions.hidden = true), 150));

// ---------- analiza ----------
let last: { a: Analysis; years: number; ahead: number } | null = null;

function tile(label: string, value: string, sub = ''): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<div class="tile"><div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>${
    sub ? `<div class="sub">${esc(sub)}</div>` : ''
  }</div>`;
}

const range = (f: TempForecast) => `zakres P10–P90: ${t(f.p10)} … ${t(f.p90)}`;

function render(a: Analysis, years: number, ahead: number) {
  $('empty').hidden = true;
  $('status').hidden = true;
  $('output').hidden = false;

  $('out-title').textContent = `${state.label} — ${fmtDate.format(a.target)}`;
  $('out-meta').textContent =
    `${a.sampleSize} dni z ${a.years.length} lat (${a.years[0]}–${a.years[a.years.length - 1]}), ` +
    `okno ±7 dni wokół ${fmtDay.format(a.target)}` +
    (ahead ? ` · ${ahead} dni od daty odniesienia` : '') +
    (a.forecast.extrapolationYears > 0 ? ` · ekstrapolacja ${a.forecast.extrapolationYears} lat poza dane` : '') +
    (a.years.length < years ? ` · dostępne ${a.years.length} z ${years} lat` : '');

  const f = a.forecast;
  const top = f.categories[0];
  const second = f.categories[1];
  $('forecast-tiles').innerHTML = [
    tile('Temp. średnia', t(f.tMean.expected), range(f.tMean)),
    tile('Temp. maksymalna', t(f.tMax.expected), range(f.tMax)),
    tile('Temp. minimalna', t(f.tMin.expected), range(f.tMin)),
    tile(
      'Najbardziej prawdopodobnie',
      `${CATEGORIES[top.category].icon} ${pct(top.share)}`,
      `${CATEGORIES[top.category].label}` +
        (second && second.share > 0 ? ` · potem: ${CATEGORIES[second.category].label} ${pct(second.share)}` : ''),
    ),
    tile('Szansa opadu ≥ 1 mm', pct(f.rainProbability)),
    tile(
      'Trend ocieplenia',
      f.trendUsed ? `${f.trendPerDecade >= 0 ? '+' : ''}${f.trendPerDecade.toFixed(2)}°C/10 lat` : '—',
      f.trendUsed ? `R² = ${f.trendR2.toFixed(2)}` : 'za mało lat (min. 8) – bez trendu',
    ),
  ].join('');

  const h = a.historical;
  const hTop = h.categories[0];
  const mode = (b: typeof h.tMaxMode) => (b ? `${b.from}…${b.to}°C` : '—');
  $('history-tiles').innerHTML = [
    tile('Najczęstsza temp. max', mode(h.tMaxMode), h.tMaxMode ? `${h.tMaxMode.count} dni` : ''),
    tile('Najczęstsza temp. min', mode(h.tMinMode), h.tMinMode ? `${h.tMinMode.count} dni` : ''),
    tile('Średnia (mediana)', `${t(h.tMean.mean)}`, `mediana ${t(h.tMean.median)} · σ ${h.tMean.std.toFixed(1)}°C`),
    tile('Rekordy', `${t(h.tMean.min)} / ${t(h.tMean.max)}`, 'najniższa min / najwyższa max'),
    tile(
      'Najczęstsza pogoda',
      `${CATEGORIES[hTop.category].icon} ${CATEGORIES[hTop.category].label}`,
      `${pct(hTop.share)} dni`,
    ),
    tile(
      'Dni z opadem',
      pct(h.rainProbability),
      Number.isFinite(h.medianWetPrecip) ? `mediana ${h.medianWetPrecip.toFixed(1)} mm w dniu z opadem` : '',
    ),
    tile('Średni max. wiatr', `${h.meanWind.toFixed(0)} km/h`),
  ].join('');

  renderCharts(a);
}

function showStatus(msg: string, error = false) {
  $('empty').hidden = true;
  const s = $('status');
  s.hidden = false;
  s.textContent = msg;
  s.classList.toggle('error', error);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const target = targetDate();
  const years = Math.min(50, Math.max(1, Math.round(Number(yearsInput.value) || 30)));
  const ahead = Math.max(0, Math.round(Number(aheadInput.value) || 0));
  if (target && target.getUTCFullYear() > 2100) {
    showStatus('Maksymalna data docelowa to 31.12.2100.', true);
    return;
  }
  if (!target) return;

  submit.disabled = true;
  showStatus(`Pobieram dane z ${years} lat…`);
  try {
    const records = await fetchHistory(state.lat, state.lon, years);
    const analysis = analyze(records, target);
    last = { a: analysis, years, ahead };
    render(analysis, years, ahead);
  } catch (err) {
    $('output').hidden = true;
    showStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    submit.disabled = false;
  }
});

// przerysuj wykresy po zmianie motywu systemowego (kolory serii pochodzą z CSS)
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (last) render(last.a, last.years, last.ahead);
});
