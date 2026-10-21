// SemIA · lector de PDF (se carga solo al subir un mapa en PDF: pdf.js + pdf.worker.js)
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = 'pdf.worker.js';

async function readPdf(file, { maxDim = 4096, page = 1, onStep = () => {} } = {}) {
  onStep('Abriendo el PDF…', 8);
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const pages = doc.numPages;
  onStep(`Leyendo página ${Math.min(page, pages)} de ${pages}…`, 25);
  const pg = await doc.getPage(Math.min(Math.max(1, page), pages));
  const base = pg.getViewport({ scale: 1 });
  const k = Math.min(4, maxDim / Math.max(base.width, base.height)); // más de 4x no aporta
  const vp = pg.getViewport({ scale: k });
  const cv = document.createElement('canvas');
  cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  onStep(`Convirtiendo a imagen ${cv.width}×${cv.height}…`, 45);
  await pg.render({ canvasContext: ctx, viewport: vp }).promise;
  onStep('Comprimiendo imagen…', 85);
  let dataUrl = cv.toDataURL('image/webp', 0.86);
  if (!dataUrl.startsWith('data:image/webp')) dataUrl = cv.toDataURL('image/jpeg', 0.86);
  const w = cv.width, h = cv.height;
  await doc.destroy();
  return { dataUrl, w, h, corners: null, crs: null, fecha: null, original: [Math.round(base.width), Math.round(base.height)], pages };
}

window.SemiaPdf = { readPdf };
