// SemIA · mapas propios: capa Leaflet con deformación proyectiva por 4 esquinas y lectura de archivos
import L from 'leaflet';
import { homography } from './geo.js';

// Imagen ubicada por sus 4 esquinas [NO, NE, SE, SO] en lat/lng (transformación proyectiva exacta)
export const WarpLayer = L.Layer.extend({
  options: { opacity: 1, pane: 'semiaMaps' },
  initialize(url, corners, opts) { this._url = url; this._corners = corners; L.setOptions(this, opts); },
  onAdd(map) {
    const img = (this._img = L.DomUtil.create('img', 'warp-img leaflet-zoom-hide'));
    img.alt = ''; img.draggable = false;
    img.style.opacity = this.options.opacity;
    img.onload = () => { this._w = img.naturalWidth; this._h = img.naturalHeight; img.style.width = `${this._w}px`; img.style.height = `${this._h}px`; this._reset(); };
    img.src = this._url;
    this.getPane().appendChild(img);
    map.on('zoomend viewreset resize', this._reset, this);
  },
  onRemove(map) { L.DomUtil.remove(this._img); map.off('zoomend viewreset resize', this._reset, this); },
  setCorners(c) { this._corners = c; this._reset(); return this; },
  setOpacity(o) { this.options.opacity = o; if (this._img) this._img.style.opacity = o; return this; },
  _reset() {
    if (!this._map || !this._w) return;
    const P = this._corners.map(c => { const p = this._map.latLngToLayerPoint(c); return [p.x, p.y]; });
    const H = homography([[0, 0], [this._w, 0], [this._w, this._h], [0, this._h]], P);
    if (!H) return;
    this._img.style.transform = `matrix3d(${H[0][0]},${H[1][0]},0,${H[2][0]},${H[0][1]},${H[1][1]},0,${H[2][1]},0,0,1,0,${H[0][2]},${H[1][2]},0,${H[2][2]})`;
  },
});

// Carga diferida de lectores (tiff.js, pdf.js), para no agrandar la app
const libs = {};
function loadLib(src, global, nombre) {
  if (window[global]) return Promise.resolve(window[global]);
  if (libs[src]) return libs[src];
  libs[src] = new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src;
    s.onload = () => (window[global] ? res(window[global]) : rej(new Error(`No se pudo cargar el lector de ${nombre}`)));
    s.onerror = () => { delete libs[src]; rej(new Error(`No se pudo cargar el lector de ${nombre}`)); };
    document.head.appendChild(s);
  });
  return libs[src];
}
export const loadTiffLib = () => loadLib('tiff.js', 'SemiaTiff', 'GeoTIFF');
export const loadPdfLib = () => loadLib('pdf.js', 'SemiaPdf', 'PDF');

export const isTiff = f => /\.tiff?$/i.test(f.name) || f.type === 'image/tiff';
export const isPdf = f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf';

// Lee cualquier archivo soportado → { dataUrl, w, h, corners|null, crs, fecha, original }
export async function readMapFile(file, onStep = () => {}) {
  if (isPdf(file)) return (await loadPdfLib()).readPdf(file, { onStep });
  if (isTiff(file)) return (await loadTiffLib()).readGeoTiff(file, { onStep });
  onStep('Leyendo imagen…', 20);
  const r = await readPlainImage(file);
  onStep('Listo', 90);
  return r;
}

// Imagen común (JPG/PNG/WebP), reducida; se ubica luego arrastrando sus esquinas
export function readPlainImage(file, maxDim = 4096) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Formato de imagen no soportado')); };
    img.onload = () => {
      const k = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let dataUrl = c.toDataURL('image/webp', 0.86);
      if (!dataUrl.startsWith('data:image/webp')) dataUrl = c.toDataURL('image/jpeg', 0.86);
      res({ dataUrl, w: c.width, h: c.height, corners: null, crs: null, fecha: null, original: [img.width, img.height] });
    };
    img.src = url;
  });
}

// Rectángulo inicial para una imagen sin coordenadas: centrado en `center`, `spanM` metros de ancho
export function defaultCorners(center, w, h, spanM = 3000) {
  const [lat, lng] = center, dLng = spanM / (111320 * Math.cos((lat * Math.PI) / 180)) / 2, dLat = ((spanM * h) / w / 111320) / 2;
  return [[lat + dLat, lng - dLng], [lat + dLat, lng + dLng], [lat - dLat, lng + dLng], [lat - dLat, lng - dLng]];
}

export const fmtFecha = iso => { if (!iso) return 'Sin fecha'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
export function parseFecha(txt) {
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec((txt || '').trim());
  if (!m) return null;
  const d = new Date(+m[3], +m[2] - 1, +m[1]);
  if (d.getMonth() !== +m[2] - 1) return null;
  return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
