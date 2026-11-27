// Compila src/ → public_html/script.js y public_html/style.css (node build.mjs)
import { build } from 'esbuild';
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { createHash } from 'crypto';
await build({
  entryPoints: ['src/main.jsx'], bundle: true, minify: true, format: 'iife', target: 'es2020',
  outfile: 'public_html/script.js', jsx: 'automatic', loader: { '.json': 'json' },
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none',
});
await build({
  entryPoints: ['src/tiff-entry.js'], bundle: true, minify: true, format: 'iife', target: 'es2020',
  outfile: 'public_html/tiff.js', legalComments: 'none',
});
await build({
  entryPoints: ['src/pdf-entry.js'], bundle: true, minify: true, format: 'iife', target: 'es2020',
  outfile: 'public_html/pdf.js', legalComments: 'none',
});
copyFileSync('node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'public_html/pdf.worker.js');
const leaflet = readFileSync('node_modules/leaflet/dist/leaflet.css', 'utf8');
writeFileSync('public_html/style.css', `/* Leaflet 1.9 (BSD-2) */\n${leaflet}\n${readFileSync('src/app.css', 'utf8')}`);
// Versión = huella de la app compilada: la app la compara con version.json para ofrecer «Actualizar»
const v = createHash('sha256').update(readFileSync('public_html/script.js')).update(readFileSync('public_html/style.css')).digest('hex').slice(0, 10);
writeFileSync('public_html/version.json', JSON.stringify({ v }) + '\n');
const idx = readFileSync('public_html/app.html', 'utf8')
  .replace(/style\.css(\?v=\w+)?"/, `style.css?v=${v}"`).replace(/script\.js(\?v=\w+)?"/, `script.js?v=${v}"`);
writeFileSync('public_html/app.html', idx);

// Sitio público: landing (/), legales y 404. Páginas estáticas livianas, sin React ni mapa, con el mismo diseño.
{
  const ui = readFileSync('src/ui.jsx', 'utf8');
  const logo = ui.match(/LOGO_PATH = '([^']+)'/)[1];
  const icon = n => { const m = ui.match(new RegExp(`\\n  ${n}: '([^']+)'`)); return m ? m[1] : ''; };
  const svg = d => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const shield = 'M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4';
  // surcos: curvas suaves y paralelas, como un lote arado visto de arriba
  let furrows = '';
  for (let i = 0; i < 26; i++) { const y = -60 + i * 38; furrows += `<path d="M-40 ${y} C 300 ${y - 70}, 760 ${y + 90}, 1240 ${y - 20}"/>`; }
  // secuencia del iPhone: capturas reales (tests/capturas.py en GitHub) con el punto que toca el dedo
  const caps = existsSync('src/capturas.json') ? JSON.parse(readFileSync('src/capturas.json', 'utf8')) : {};
  const TXT = {
    '01-inicio': [1, 'Tocá + para registrar una silobolsa'], '02-lote': [2, 'Elegí el lote: primero los más cercanos'],
    '03-cabecera': [3, 'En la cabecera, marcá el punto A con el GPS'], '04-cola': [4, 'Caminá hasta la cola y marcá el punto B'],
    '05-kilos': [5, 'Kilos con el teclado de Acopia, en toneladas al instante'], '06-ficha': [6, 'Variedad, humedad y prioridad de salida'],
    '07-guardada': [7, 'La bolsa queda sobre el borde del lote'], '08-cercanas': [8, 'Navegá a pie hasta cualquier silobolsa'],
    '10-llegaste': [8, 'Aviso al llegar a la bolsa'],
  };
  const seq = Object.keys(caps).sort().filter(k => TXT[k] || k.startsWith('09-nav')).map(k => {
    const c = caps[k], nav = k.startsWith('09-nav'), [g, txt] = TXT[k] || [8, 'Rumbo, distancia y tiempo a pie, en vivo'];
    return { s: k, g, c: txt, d: nav ? 650 : 2700, fast: nav || undefined, sb: c.sb, ink: c.ink, t: c.taps[0] };
  });
  const LEGAL_FECHA = '27 de noviembre de 2026';
  const base = readFileSync('src/landing.html', 'utf8')
    .replaceAll('__LOGO__', logo).replace('__FURROWS__', furrows)
    .replace('__IC_LOTS__', svg(icon('lots'))).replace('__IC_GPS__', svg(icon('gps'))).replace('__IC_ID__', svg(icon('silo')))
    .replace('__IC_NAV__', svg(icon('navi'))).replace('__IC_USERS__', svg(icon('users'))).replace('__IC_CHART__', svg(icon('chart'))).replace('__IC_SAFE__', svg(shield))
    .replaceAll('__ID__', 'LA36001').replace('__SEQ__', JSON.stringify(seq))
    .replace(/<style>([\s\S]*?)<\/style>/, (_, css) => `<style>${css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '').replace(/\s*([{}:;,>])\s*/g, '$1').replace(/;}/g, '}')}</style>`);
  const PAGES = [
    { out: 'index.html', path: '/', title: 'Acopia · Control preciso de tu Producción', desc: 'Registrá cada silobolsa en el lote correcto con el GPS del celular: ubicación, variedad, kilos, humedad y prioridad de salida. Probalo 10 días gratis.', preload: '<link rel="preload" href="/img/app/01-inicio.webp" as="image" type="image/webp">' },
    { out: 'privacidad.html', src: 'privacidad', path: '/privacidad', title: 'Política de privacidad · Acopia', desc: 'Qué datos trata Acopia, para qué los usa y cómo ejercer tus derechos según la Ley 25.326.' },
    { out: 'terminos.html', src: 'terminos', path: '/terminos', title: 'Términos y condiciones · Acopia', desc: 'Condiciones de uso del servicio Acopia para el registro y control de silobolsas.' },
    { out: 'cookies.html', src: 'cookies', path: '/cookies', title: 'Política de cookies · Acopia', desc: 'Acopia usa solo las cookies necesarias para iniciar sesión y recordar tus preferencias.' },
    { out: '404.html', src: '404', path: '/404', title: 'Página no encontrada · Acopia', desc: 'La página que buscás no existe.', robots: '<meta name="robots" content="noindex">' },
  ];
  for (const pg of PAGES) {
    let html = base.replace('__TITLE__', pg.title).replaceAll('__TITLE__', pg.title).replaceAll('__DESC__', pg.desc).replaceAll('__PATH__', pg.path)
      .replace('__ROBOTS__', pg.robots || '').replace('__PRELOAD__', pg.preload || '');
    if (pg.src) html = html.replace(/<!--MAIN-->[\s\S]*<!--\/MAIN-->/, readFileSync(`src/paginas/${pg.src}.html`, 'utf8').replaceAll('__FECHA__', LEGAL_FECHA));
    html = html.replace(/<!--\/?MAIN-->\n?/g, '');
    if (/__[A-Z_]+__/.test(html)) throw new Error(`${pg.out}: quedó un marcador sin reemplazar (${html.match(/__[A-Z_]+__/)[0]})`);
    writeFileSync(`public_html/${pg.out}`, html);
  }
}
console.log('build ok · versión', v);
