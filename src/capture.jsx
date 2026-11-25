// SemIA · ubicación de silobolsa por GPS: cabecera (A) y cola (B) de la bolsa
import React, { useEffect, useRef, useState } from 'react';
import { Icon, Button, fmtNum } from './ui.jsx';
import { metersBetween, pointInPoly, snapToBorder, locateLot } from './geo.js';

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

// Distancia del punto vivo al contorno del lote elegido (las bolsas suelen ir sobre el contorno)
export function borderInfo(ll, lot, geo) {
  if (!ll || !lot || !geo) return null;
  const p = geo.toMap(ll.lat, ll.lng), sn = snapToBorder(p, lot.poly);
  return { m: sn.dist * (geo.metersPerUnit || 1), inside: pointInPoly(p, lot.poly) };
}

export function GpsCapture({ fix, gpsErr, lots = [], geo, lotId, onLot, noGps, onPickMap, onCancel, onDone, onProgress }) {
  const [a, setA] = useState(null), [busy, setBusy] = useState(null), [err, setErr] = useState(null);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => { onProgress?.({ a, b: null }); }, [a]); // eslint-disable-line
  const live = fix && Date.now() - fix.ts < 20000 ? fix : null;
  const lot = lots.find(l => l.id === lotId) || null;
  const step = !lot ? 0 : a ? 2 : 1;
  const dist = a && live ? metersBetween([a.lat, a.lng], [live.lat, live.lng]) : null;
  // lote sugerido por el GPS: solo como ayuda, el supervisor siempre lo confirma
  const sug = live && geo && lots.length ? (() => { const r = locateLot(geo.toMap(live.lat, live.lng), lots); return r && (r.inside || r.snap.dist * (geo.metersPerUnit || 1) < 60) ? r.lot.id : null; })() : null;
  const bi = step > 0 ? borderInfo(live, lot, geo) : null;

  async function mark() {
    setErr(null); setBusy({ pct: 0, n: 0 });
    try {
      const p = await measurePoint(5000, t => alive.current && setBusy(t), live);
      if (!alive.current) return;
      setBusy(null);
      if (!a) setA(p); else onDone(a, p, lot.id);
    } catch (e) { if (alive.current) { setBusy(null); setErr(e.message); } }
  }

  if (step === 0) {
    const sorted = [...lots].sort((x, y) => (x.id === sug ? -1 : y.id === sug ? 1 : 0));
    return (
      <div className="cap-sheet" role="dialog" aria-label="Elegir lote de la silobolsa">
        <div className="cap-top">
          <span className="cap-step">{noGps ? 'Paso 1 de 2' : 'Paso 1 de 3'}</span>
          {!noGps && <span className={`cap-acc ${accClass(live?.acc)}`}><Icon name="gps" size={14} />{live ? `±${fmtNum(live.acc)} m` : gpsErr || 'Buscando GPS…'}</span>}
        </div>
        <h2 className="cap-title">¿En qué lote está la bolsa?</h2>
        <p className="cap-sub">Elegilo vos: el GPS puede moverse o caer entre dos lotes.{sug ? ' El marcado es el que indica tu ubicación.' : ''}</p>
        {lots.length ? (
          <div className="cap-lots" role="radiogroup" aria-label="Lote">
            {sorted.map(l => (
              <button type="button" key={l.id} role="radio" aria-checked="false" className={`cap-lot ${l.id === sug ? 'is-sug' : ''}`} onClick={() => onLot(l.id)}>
                <b>{l.num}</b><span>{l.id === sug ? 'Estás acá' : `${fmtNum(l.ha, 0)} ha`}</span>
              </button>
            ))}
          </div>
        ) : <p className="form-err"><Icon name="alert" size={16} />No hay lotes con número en esta estancia.</p>}
        <div className="cap-foot"><Button variant="ghost" onClick={onCancel}>Cancelar</Button></div>
      </div>
    );
  }

  return (
    <div className="cap-sheet" role="dialog" aria-label="Ubicar silobolsa por GPS">
      <div className="cap-top">
        <span className="cap-step">{noGps ? 'Paso 2 de 2' : `Paso ${step + 1} de 3`}</span>
        <button type="button" className="cap-lot-chip" onClick={() => { setA(null); onLot(null); }} disabled={!!busy} aria-label={`Lote ${lot.num}, cambiar`}>Lote <b>{lot.num}</b><span>cambiar</span></button>
        {!noGps && <span className={`cap-acc ${accClass(live?.acc)}`}><Icon name="gps" size={14} />{live ? `±${fmtNum(live.acc)} m` : gpsErr || 'Buscando GPS…'}</span>}
      </div>
      {noGps ? <>
        <h2 className="cap-title">Tocá en el mapa dónde está la bolsa</h2>
        <p className="cap-sub">Sin GPS: marcá el punto sobre el contorno del lote {lot.num}.</p>
        <button type="button" className="cap-btn" onClick={() => onPickMap(lot.id)}><span className="cap-btn-txt"><Icon name="pin" size={20} />Marcar en el mapa</span></button>
      </> : <>
        <h2 className="cap-title">{step === 1 ? 'Parate en la cabecera de la bolsa' : 'Caminá hasta la cola de la bolsa'}</h2>
        {step === 1 ? (
          <p className="cap-sub">Quedate quieto junto a un extremo. Se toman lecturas durante 5 segundos y se promedian.</p>
        ) : (
          <div className="cap-dist">
            <b>{dist != null ? fmtNum(dist) : '—'}<small> m</small></b>
            <span>desde la cabecera · A ±{fmtNum(a.acc)} m</span>
          </div>
        )}
        {bi && <p className={`cap-border ${!bi.inside && bi.m > 40 ? 'is-far' : ''}`}><Icon name="lots" size={14} />{!bi.inside && bi.m > 40 ? `Estás a ${fmtNum(bi.m)} m afuera del lote ${lot.num}: revisá el lote elegido` : `A ${fmtNum(bi.m)} m del contorno del lote ${lot.num}`}</p>}
        {live && live.acc > 15 && !busy && <p className="cap-warn"><Icon name="alert" size={14} />Señal débil: esperá unos segundos al aire libre para mejorar la precisión.</p>}
        {err && <div className="form-err"><Icon name="alert" size={16} />{err}</div>}
        <button type="button" className="cap-btn" onClick={mark} disabled={!!busy}>
          {busy && <span className="cap-btn-fill" style={{ width: `${busy.pct}%` }} />}
          <span className="cap-btn-txt"><Icon name="pin" size={20} />{busy ? `Midiendo… ${busy.n} lectura${busy.n === 1 ? '' : 's'}` : step === 1 ? 'Marcar cabecera (A)' : 'Marcar cola (B)'}</span>
        </button>
      </>}
      <div className="cap-foot">
        <Button variant="ghost" onClick={onCancel} disabled={!!busy}>Cancelar</Button>
        {step === 2 && <Button variant="ghost" onClick={() => setA(null)} disabled={!!busy}>Rehacer A</Button>}
        {step === 2 && <Button onClick={() => onDone(a, null, lot.id)} disabled={!!busy}>Solo un punto</Button>}
      </div>
    </div>
  );
}
