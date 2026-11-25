// acopia · lector de GeoTIFF (se carga solo cuando se sube un mapa: tiff.js)
import { fromBlob } from 'geotiff';
import { toLatLng, crsName } from './proj.js';

async function readGeoTiff(file, { maxDim = 4096, onStep = () => {} } = {}) {
  onStep('Leyendo encabezado del GeoTIFF…', 8);
  const tiff = await fromBlob(file);
  const img = await tiff.getImage();
  const W = img.getWidth(), H = img.getHeight();
  const keys = img.getGeoKeys() || {};
  const code = keys.ProjectedCSTypeGeoKey && keys.ProjectedCSTypeGeoKey !== 32767 ? keys.ProjectedCSTypeGeoKey
    : keys.GeographicTypeGeoKey === 4326 || keys.GeographicTypeGeoKey === 4269 ? 4326 : null;
  if (!code) throw new Error('El GeoTIFF no indica su sistema de coordenadas. Exportalo en WGS84, UTM o POSGAR.');
  let origin, res;
  try { origin = img.getOrigin(); res = img.getResolution(); } catch { throw new Error('El GeoTIFF no tiene georreferencia (origen y resolución).'); }
  const px = (i, j) => toLatLng(code, origin[0] + i * res[0], origin[1] + j * res[1]);
  const corners = [px(0, 0), px(W, 0), px(W, H), px(0, H)]; // NO, NE, SE, SO de la imagen

  const k = Math.min(1, maxDim / Math.max(W, H)), tw = Math.max(1, Math.round(W * k)), th = Math.max(1, Math.round(H * k));
  onStep(`Reduciendo imagen ${W}×${H} → ${tw}×${th}…`, 25);
  const spp = img.getSamplesPerPixel(), bits = img.getBitsPerSample();
  const nodata = img.getGDALNoData();
  const ras = await tiff.readRasters({ width: tw, height: th, interleave: true, resampleMethod: 'bilinear' });
  onStep('Preparando imagen…', 70);
  const out = new Uint8ClampedArray(tw * th * 4);
  const isFloat = img.getSampleFormat() === 3, n = tw * th;
  if (spp >= 3) {
    // escala para 16 bits
    let max = 255;
    if (bits > 8 || isFloat) { max = 0; for (let i = 0; i < n * spp; i += spp) max = Math.max(max, ras[i], ras[i + 1], ras[i + 2]); max = max || 1; }
    const f = 255 / max;
    for (let i = 0; i < n; i++) {
      const r = ras[i * spp], g = ras[i * spp + 1], b = ras[i * spp + 2];
      const a = spp >= 4 ? (bits > 8 ? (ras[i * spp + 3] > 0 ? 255 : 0) : ras[i * spp + 3]) : (r === 0 && g === 0 && b === 0) || (nodata !== null && r === nodata) ? 0 : 255;
      out[i * 4] = r * f; out[i * 4 + 1] = g * f; out[i * 4 + 2] = b * f; out[i * 4 + 3] = a;
    }
  } else {
    // una banda (p. ej. NDVI o reflectancia): estiramiento 2–98 %
    const vals = [];
    for (let i = 0; i < n; i += Math.max(1, Math.floor(n / 20000))) { const v = ras[i * spp]; if (isFinite(v) && v !== nodata) vals.push(v); }
    vals.sort((a, b) => a - b);
    const lo = vals[Math.floor(vals.length * 0.02)] ?? 0, hi = vals[Math.floor(vals.length * 0.98)] ?? 1, span = hi - lo || 1;
    for (let i = 0; i < n; i++) {
      const v = ras[i * spp], ok = isFinite(v) && v !== nodata, g = ok ? ((v - lo) / span) * 255 : 0;
      out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = g; out[i * 4 + 3] = ok ? 255 : 0;
    }
  }
  onStep('Comprimiendo imagen…', 88);
  const cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
  cv.getContext('2d').putImageData(new ImageData(out, tw, th), 0, 0);
  let dataUrl = cv.toDataURL('image/webp', 0.86);
  if (!dataUrl.startsWith('data:image/webp')) dataUrl = cv.toDataURL('image/jpeg', 0.86);
  let dt = null;
  try { const fd = img.fileDirectory; dt = typeof fd?.loadValue === 'function' ? await fd.loadValue('DateTime') : fd?.DateTime; } catch { dt = null; }
  const fecha = typeof dt === 'string' && /^\d{4}:\d{2}:\d{2}/.test(dt) ? dt.slice(0, 10).replace(/:/g, '-') : null;
  return { dataUrl, w: tw, h: th, corners, crs: crsName(code), fecha, original: [W, H] };
}

window.SemiaTiff = { readGeoTiff };
