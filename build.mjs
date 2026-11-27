// Compila src/ → public_html/script.js y public_html/style.css (node build.mjs)
import { build } from 'esbuild';
import { readFileSync, writeFileSync, copyFileSync } from 'fs';
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

// Landing (/): página estática liviana, sin React ni mapa. Logo, íconos y surcos del fondo se insertan acá.
{
  const ui = readFileSync('src/ui.jsx', 'utf8');
  const logo = ui.match(/LOGO_PATH = '([^']+)'/)[1];
  const icon = n => { const m = ui.match(new RegExp(`\\n  ${n}: '([^']+)'`)); return m ? m[1] : ''; };
  const svg = d => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  const shield = 'M12 3 4 6v6c0 5 3.4 8.4 8 9 4.6-.6 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4';
  // surcos: curvas suaves y paralelas, como un lote arado visto de arriba
  let furrows = '';
  for (let i = 0; i < 26; i++) { const y = -60 + i * 38; furrows += `<path d="M-40 ${y} C 300 ${y - 70}, 760 ${y + 90}, 1240 ${y - 20}"/>`; }
  let html = readFileSync('src/landing.html', 'utf8')
    .replaceAll('__LOGO__', logo).replace('__FURROWS__', furrows)
    .replace('__IC_LOTS__', svg(icon('lots'))).replace('__IC_GPS__', svg(icon('gps'))).replace('__IC_ID__', svg(icon('silo')))
    .replace('__IC_NAV__', svg(icon('navi'))).replace('__IC_USERS__', svg(icon('users'))).replace('__IC_SAFE__', svg(shield));
  // CSS compacto (sin comentarios ni espacios de más)
  html = html.replace(/<style>([\s\S]*?)<\/style>/, (_, css) => `<style>${css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s*\n\s*/g, '').replace(/\s*([{}:;,>])\s*/g, '$1').replace(/;}/g, '}')}</style>`);
  if (/__[A-Z_]+__/.test(html)) throw new Error('landing: quedó un marcador sin reemplazar');
  writeFileSync('public_html/index.html', html);
}
console.log('build ok · versión', v);
