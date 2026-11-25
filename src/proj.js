// acopia · conversión de coordenadas proyectadas a lat/lng (WGS84 / GRS80)
// Soporta EPSG:4326, 3857, UTM WGS84 (326xx norte / 327xx sur),
// POSGAR 2007 y POSGAR 98 fajas 1–7 (EPSG 5343–5349 y 22171–22177).

const A = 6378137, F = 1 / 298.257223563, E2 = F * (2 - F), EP2 = E2 / (1 - E2);
const D2R = Math.PI / 180;

function meridianArc(phi) {
  const e4 = E2 * E2, e6 = e4 * E2;
  return A * ((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi
    - ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi)
    - ((35 * e6) / 3072) * Math.sin(6 * phi));
}

// Transversa de Mercator inversa (fórmulas de Snyder)
export function tmInverse(E, N, { lon0, lat0 = 0, k0, FE, FN }) {
  const M = meridianArc(lat0 * D2R) + (N - FN) / k0;
  const mu = M / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const p1 = mu + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const s = Math.sin(p1), c = Math.cos(p1), t = Math.tan(p1);
  const N1 = A / Math.sqrt(1 - E2 * s * s), T1 = t * t, C1 = EP2 * c * c;
  const R1 = (A * (1 - E2)) / (1 - E2 * s * s) ** 1.5, D = (E - FE) / (N1 * k0);
  const lat = p1 - ((N1 * t) / R1) * (D * D / 2 - ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * EP2) * D ** 4) / 24
    + ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * EP2 - 3 * C1 * C1) * D ** 6) / 720);
  const lon = lon0 * D2R + (D - ((1 + 2 * T1 + C1) * D ** 3) / 6
    + ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * EP2 + 24 * T1 * T1) * D ** 5) / 120) / c;
  return [lat / D2R, lon / D2R];
}

export function crsName(code) {
  if (code === 4326) return 'WGS84 (lat/lng)';
  if (code === 3857) return 'Web Mercator';
  if (code >= 32601 && code <= 32660) return `UTM ${code - 32600}N`;
  if (code >= 32701 && code <= 32760) return `UTM ${code - 32700}S`;
  if (code >= 5343 && code <= 5349) return `POSGAR 2007 faja ${code - 5342}`;
  if (code >= 22171 && code <= 22177) return `POSGAR 98 faja ${code - 22170}`;
  return `EPSG:${code}`;
}

// (x, y) en el sistema `code` → [lat, lng]
export function toLatLng(code, x, y) {
  if (code === 4326) return [y, x];
  if (code === 3857) return [(2 * Math.atan(Math.exp(y / A)) - Math.PI / 2) / D2R, x / A / D2R];
  if ((code >= 32601 && code <= 32660) || (code >= 32701 && code <= 32760)) {
    const south = code > 32700, zone = code - (south ? 32700 : 32600);
    return tmInverse(x, y, { lon0: (zone - 1) * 6 - 180 + 3, k0: 0.9996, FE: 500000, FN: south ? 10000000 : 0 });
  }
  if ((code >= 5343 && code <= 5349) || (code >= 22171 && code <= 22177)) {
    const faja = code >= 22171 ? code - 22170 : code - 5342;
    return tmInverse(x, y, { lon0: -72 + (faja - 1) * 3, lat0: -90, k0: 1, FE: faja * 1000000 + 500000, FN: 0 });
  }
  throw new Error(`Sistema de coordenadas no soportado (${crsName(code)}). Exportá el mapa en WGS84, UTM o POSGAR.`);
}
