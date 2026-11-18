import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

export interface MapController {
  setLocation(lat: number, lon: number, label?: string, fly?: boolean): void;
  invalidate(): void;
}

export function createMap(
  el: HTMLElement,
  initial: { lat: number; lon: number; label: string },
  onSelect: (lat: number, lon: number, label?: string) => void,
): MapController {
  const map = L.map(el, { worldCopyJump: true }).setView([initial.lat, initial.lon], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  const marker = L.marker([initial.lat, initial.lon]).addTo(map).bindPopup(initial.label);

  const setLocation = (lat: number, lon: number, label?: string, fly = false) => {
    marker.setLatLng([lat, lon]);
    marker.bindPopup(label ?? `${lat.toFixed(3)}, ${lon.toFixed(3)}`);
    if (fly) map.flyTo([lat, lon], Math.max(map.getZoom(), 8), { duration: 0.8 });
  };

  map.on('click', (e: L.LeafletMouseEvent) => {
    const lon = ((((e.latlng.lng + 180) % 360) + 360) % 360) - 180;
    setLocation(e.latlng.lat, lon);
    onSelect(e.latlng.lat, lon);
  });

  return { setLocation, invalidate: () => map.invalidateSize() };
}
