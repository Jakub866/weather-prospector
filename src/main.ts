import './style.css';
import { fetchHistory, isoDate, searchPlaces, type Place } from './api';
import { renderCharts } from './charts';
import { createMap } from './map';
import { analyze, type Analysis, type TempForecast } from './stats';
import { CATEGORIES, categorize } from './weatherCodes';

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
const deg = (x: number) => `${Math.round(x)}°C`;
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

  renderStory(a);

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

const esc = (x: string) => x.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const row = (label: string, value: string) => `<div class="row"><span>${label}</span><strong>${value}</strong></div>`;
const cat = (code: number) => {
  const c = CATEGORIES[categorize(code)];
  return `${c.icon} ${c.label}`;
};
const inTen = (p: number) => `${Math.round(p * 10)} na 10 dni`;
const dayDot = '<i class="dot day"></i>W dzień';
const nightDot = '<i class="dot night"></i>W nocy';

function renderStory(a: Analysis) {
  const h = a.historical;
  const f = a.forecast;
  const y0 = a.years[0];
  const y1 = a.years[a.years.length - 1];
  const targetYear = a.target.getUTCFullYear();
  const dayName = fmtDay.format(a.target);
  const latest = [...a.exactDays].reverse().find((d) => d.date < isoDate(a.target));
  const hTop = CATEGORIES[h.categories[0].category];
  const fTop = CATEGORIES[f.categories[0].category];

  const cards = [
    `<div class="card"><div class="when">Było</div><div class="sub">średnio ${y0}–${y1}, okolice ${esc(dayName)}</div>
      ${row(dayDot, deg(h.tMaxMean))}
      ${row(nightDot, deg(h.tMinMean))}
      ${row('Najczęściej', `${hTop.icon} ${hTop.label}`)}
      ${row('Opad', inTen(h.rainProbability))}</div>`,
  ];
  if (latest) {
    cards.push(
      `<div class="card"><div class="when">Ostatnio</div><div class="sub">${esc(fmtDate.format(new Date(`${latest.date}T00:00:00Z`)))}</div>
        ${row(dayDot, deg(latest.tMax))}
        ${row(nightDot, deg(latest.tMin))}
        ${row('Pogoda', cat(latest.code))}
        ${row('Opad', latest.precip >= 0.1 ? `${latest.precip.toFixed(1)} mm` : 'brak')}</div>`,
    );
  }
  const rng = (fc: TempForecast) => `~${deg(fc.expected)} <span class="range">(${deg(fc.p10)}…${deg(fc.p90)})</span>`;
  cards.push(
    `<div class="card future"><div class="when">Będzie (prognoza)</div><div class="sub">${esc(fmtDate.format(a.target))}</div>
      ${row(dayDot, rng(f.tMax))}
      ${row(nightDot, rng(f.tMin))}
      ${row('Najpewniej', `${fTop.icon} ${fTop.label} (${pct(f.categories[0].share)})`)}
      ${row('Szansa opadu', pct(f.rainProbability))}</div>`,
  );
  $('story').innerHTML = cards.join('');

  const diff = f.tMax.expected - h.tMaxMean;
  const diffText =
    Math.abs(diff) < 0.5
      ? 'mniej więcej tyle samo co zwykle'
      : `o ${Math.abs(diff).toFixed(1)}°C ${diff > 0 ? 'cieplej' : 'chłodniej'} niż średnio dotąd`;
  $('summary').innerHTML =
    `W latach ${y0}–${y1} około ${esc(dayName)} było zwykle <strong>${deg(h.tMaxMean)} w dzień</strong> i ` +
    `<strong>${deg(h.tMinMean)} w nocy</strong>, najczęściej ${esc(hTop.label.toLowerCase())}. ` +
    `W ${targetYear} r. spodziewaj się ok. <strong>${deg(f.tMax.expected)} w dzień</strong> (${diffText}), ` +
    `najpewniej ${esc(fTop.label.toLowerCase())}; szansa opadu ${pct(f.rainProbability)}.`;
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
    saveToUrl(years);
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

// ---------- stan w adresie URL (link do konkretnego wyniku) ----------
function saveToUrl(years: number) {
  const p = new URLSearchParams({
    lat: state.lat.toFixed(4),
    lon: state.lon.toFixed(4),
    place: state.label,
    date: dateInput.value,
    target: targetInput.value,
    years: String(years),
  });
  history.replaceState(null, '', `?${p}`);
}

function loadFromUrl() {
  const p = new URLSearchParams(location.search);
  const lat = Number(p.get('lat'));
  const lon = Number(p.get('lon'));
  if (!p.has('lat') || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  state.lat = lat;
  state.lon = lon;
  state.label = p.get('place') || 'Wybrany punkt';
  map.setLocation(lat, lon, state.label, true);
  updateLocation();
  const isDate = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (isDate(p.get('date'))) dateInput.value = p.get('date')!;
  if (p.get('years')) yearsInput.value = p.get('years')!;
  if (isDate(p.get('target'))) {
    targetInput.value = p.get('target')!;
    syncAheadFromTarget();
  } else {
    syncTargetFromAhead();
  }
  form.requestSubmit();
}

loadFromUrl();
