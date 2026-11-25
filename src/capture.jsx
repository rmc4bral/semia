// SemIA · ubicación de silobolsa por GPS: cabecera (A) y cola (B) de la bolsa
import React, { useEffect, useRef, useState } from 'react';
import { Icon, Button, fmtNum } from './ui.jsx';
import { metersBetween } from './geo.js';

// Promedia lecturas durante unos segundos (descarta las de peor precisión)
export function measurePoint(ms = 5000, onTick = () => {}, fallback = null) {
  return new Promise((res, rej) => {
    if (!('geolocation' in navigator)) return rej(new Error('Este dispositivo no tiene GPS disponible'));
    const reads = [], t0 = Date.now();
    const id = navigator.geolocation.watchPosition(
      p => { reads.push({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy || 99 }); },
      e => { if (e.code === 1) { stop(); rej(new Error('Permiso de ubicación denegado')); } },
      { enableHighAccuracy: true, maximumAge: 0, timeout: ms + 4000 });
    const tick = setInterval(() => onTick({ pct: Math.min(100, ((Date.now() - t0) / ms) * 100), n: reads.length }), 150);
    const tm = setTimeout(finish, ms);
    function stop() { navigator.geolocation.clearWatch(id); clearInterval(tick); clearTimeout(tm); }
    function finish() {
      stop();
      if (!reads.length && fallback && Date.now() - fallback.ts < 10000) reads.push(fallback);
      if (!reads.length) return rej(new Error('No se obtuvo señal GPS. Reintentá al aire libre.'));
      const best = Math.min(...reads.map(r => r.acc));
      const use = reads.filter(r => r.acc <= Math.max(best * 1.5, best + 2));
      let w = 0, la = 0, lo = 0;
      use.forEach(r => { const k = 1 / Math.max(r.acc, 1) ** 2; w += k; la += r.lat * k; lo += r.lng * k; });
      res({ lat: +(la / w).toFixed(7), lng: +(lo / w).toFixed(7), acc: Math.round(best * 10) / 10, n: use.length, at: new Date().toISOString() });
    }
  });
}

const accClass = a => (a == null ? 'is-off' : a <= 5 ? 'is-good' : a <= 15 ? 'is-mid' : 'is-bad');

export function GpsCapture({ fix, gpsErr, onCancel, onDone, onProgress }) {
  const [a, setA] = useState(null), [busy, setBusy] = useState(null), [err, setErr] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { onProgress?.({ a, b: null }); }, [a]); // eslint-disable-line
  const step = a ? 2 : 1;
  const live = fix && Date.now() - fix.ts < 20000 ? fix : null;
  const dist = a && live ? metersBetween([a.lat, a.lng], [live.lat, live.lng]) : null;

  async function mark() {
    setErr(null); setBusy({ pct: 0, n: 0 });
    try {
      const p = await measurePoint(5000, t => alive.current && setBusy(t), live);
      if (!alive.current) return;
      setBusy(null);
      if (!a) setA(p); else onDone(a, p);
    } catch (e) { if (alive.current) { setBusy(null); setErr(e.message); } }
  }

  return (
    <div className="cap-sheet" role="dialog" aria-label="Ubicar silobolsa por GPS">
      <div className="cap-top">
        <span className="cap-step">Paso {step} de 2</span>
        <span className={`cap-acc ${accClass(live?.acc)}`}><Icon name="gps" size={14} />{live ? `±${fmtNum(live.acc)} m` : gpsErr || 'Buscando GPS…'}</span>
      </div>
      <h2 className="cap-title">{step === 1 ? 'Parate en la cabecera de la bolsa' : 'Caminá hasta la cola de la bolsa'}</h2>
      {step === 1 ? (
        <p className="cap-sub">Quedate quieto junto a un extremo. Se toman lecturas durante 5 segundos y se promedian.</p>
      ) : (
        <div className="cap-dist">
          <b>{dist != null ? fmtNum(dist) : '—'}<small> m</small></b>
          <span>desde la cabecera · A ±{fmtNum(a.acc)} m</span>
        </div>
      )}
      {live && live.acc > 15 && !busy && <p className="cap-warn"><Icon name="alert" size={14} />Señal débil: esperá unos segundos al aire libre para mejorar la precisión.</p>}
      {err && <div className="form-err"><Icon name="alert" size={16} />{err}</div>}
      <button type="button" className="cap-btn" onClick={mark} disabled={!!busy}>
        {busy && <span className="cap-btn-fill" style={{ width: `${busy.pct}%` }} />}
        <span className="cap-btn-txt"><Icon name="pin" size={20} />{busy ? `Midiendo… ${busy.n} lectura${busy.n === 1 ? '' : 's'}` : step === 1 ? 'Marcar cabecera (A)' : 'Marcar cola (B)'}</span>
      </button>
      <div className="cap-foot">
        <Button variant="ghost" onClick={onCancel} disabled={!!busy}>Cancelar</Button>
        {step === 2 && <Button variant="ghost" onClick={() => setA(null)} disabled={!!busy}>Rehacer A</Button>}
        {step === 2 && <Button onClick={() => onDone(a, null)} disabled={!!busy}>Solo un punto</Button>}
      </div>
    </div>
  );
}
