// Compila src/ → public_html/script.js y public_html/style.css (node build.mjs)
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
await build({
  entryPoints: ['src/main.jsx'], bundle: true, minify: true, format: 'iife', target: 'es2020',
  outfile: 'public_html/script.js', jsx: 'automatic', loader: { '.json': 'json' },
  define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none',
});
const leaflet = readFileSync('node_modules/leaflet/dist/leaflet.css', 'utf8');
writeFileSync('public_html/style.css', `/* Leaflet 1.9 (BSD-2) */\n${leaflet}\n${readFileSync('src/app.css', 'utf8')}`);
console.log('build ok');
