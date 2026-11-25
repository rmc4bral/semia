// SemIA · aviso flotante «Nueva versión · Actualizar»
import React, { useEffect, useState } from 'react';
import { Icon } from './ui.jsx';

const current = (() => {
  try { return new URL(document.querySelector('script[src*="script.js"]').src).searchParams.get('v'); } catch { return null; }
})();

async function remoteVersion() {
  const r = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) return null;
  return (await r.json()).v || null;
}

export function UpdateButton() {
  const [nueva, setNueva] = useState(null), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!current || location.protocol === 'file:') return;
    let on = true;
    const check = () => remoteVersion().then(v => { if (on && v && v !== current) setNueva(v); }).catch(() => {});
    check();
    const id = setInterval(check, 3 * 60 * 1000);
    const vis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', vis); window.addEventListener('online', check);
    return () => { on = false; clearInterval(id); document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', check); };
  }, []);
  if (!nueva) return null;
  async function actualizar() {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      reg?.waiting?.postMessage('actualizar');
      await reg?.update();
      if (window.caches) await Promise.all((await caches.keys()).map(k => caches.delete(k)));
    } catch { /* se recarga igual */ }
    location.reload();
  }
  return (
    <div className="upd" role="status" aria-live="polite">
      <span className="upd-dot" /><span className="upd-txt">Nueva versión</span>
      <button type="button" className="upd-btn" onClick={actualizar} disabled={busy}>
        <Icon name="rotr" size={16} />{busy ? 'Actualizando…' : 'Actualizar'}
      </button>
      <button type="button" className="upd-x" onClick={() => setNueva(null)} aria-label="Más tarde"><Icon name="close" size={16} /></button>
    </div>
  );
}
