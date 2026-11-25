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
const idx = readFileSync('public_html/index.html', 'utf8')
  .replace(/style\.css(\?v=\w+)?"/, `style.css?v=${v}"`).replace(/script\.js(\?v=\w+)?"/, `script.js?v=${v}"`);
writeFileSync('public_html/index.html', idx);
console.log('build ok · versión', v);
