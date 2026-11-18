# ⛅ Weather Prospector

Prosta aplikacja webowa: wybierasz miejsce na mapie i datę, a ona pobiera dzienne dane pogodowe
z **ostatnich N lat** i liczy:

- **co było statystycznie najczęściej** w tym miejscu w tym okresie roku — najczęstszy przedział
  temperatury maksymalnej i minimalnej (moda z koszyków 1 °C), średnia, mediana, odchylenie,
  rekordy, najczęstszy typ pogody (słonecznie / pochmurno / deszcz / śnieg / burza…), odsetek dni z opadem, wiatr;
- **klimatologiczną prognozę na datę odniesienia + M dni** — oczekiwana temperatura średnia/max/min
  z przedziałem P10–P90, najbardziej prawdopodobny typ pogody z procentem i szansa opadu.

🔗 **Demo:** https://jakub866.github.io/weather-prospector/

## Jak to liczy

1. **Okno sezonowe** – dla każdego z N lat brane są dni z okna ±7 dni wokół tego samego dnia
   kalendarzowego co data docelowa (obsługa przejścia przez Nowy Rok i 29 lutego).
2. **Statystyki historyczne** – zwykłe (nieważone) statystyki po wszystkich dniach z okien.
3. **Trend** – średnia temperatura okna dla każdego roku → regresja liniowa względem roku
   (gdy jest ≥ 8 lat danych). Trend jest ekstrapolowany na rok daty docelowej.
4. **Rozrzut** – reszty (wartość dzienna − poziom trendu dla jej roku) dodane do przewidywanego
   poziomu dają rozkład, z którego liczone są P10/P50/P90.
5. **Ważenie świeżości** – nowsze lata ważą więcej (wykładniczo, okres półtrwania 10 lat) przy
   kwantylach, typie pogody i szansie opadu.

> To estymacja statystyczna, nie prognoza meteorologiczna – dla kilku najbliższych dni
> lepsze będą modele numeryczne.

## Dane

- [Open-Meteo Historical Weather API](https://open-meteo.com/en/docs/historical-weather-api) (reanaliza ERA5, od 1940 r., bez klucza API)
- [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api) – wyszukiwarka miejsc
- Mapa: [Leaflet](https://leafletjs.com/) + OpenStreetMap, wykresy: [Chart.js](https://www.chartjs.org/)

## Uruchomienie lokalne

```bash
npm install
npm run dev      # serwer deweloperski
npm test         # testy modułu statystyk (Vitest)
npm run build    # build produkcyjny do dist/
```

Każdy push na `main` buduje i publikuje aplikację na GitHub Pages (`.github/workflows/deploy.yml`).

## Struktura

| Plik | Rola |
|---|---|
| `src/api.ts` | pobieranie archiwum i geokodowanie, cache w `sessionStorage` |
| `src/stats.ts` | okno sezonowe, moda, kwantyle, regresja, prognoza (czyste funkcje) |
| `src/weatherCodes.ts` | kody WMO → kategorie pogody |
| `src/map.ts` | mapa Leaflet |
| `src/charts.ts` | wykresy Chart.js |
| `src/main.ts` | UI |

## Licencja

MIT
