import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Logo, Icon, Button, Field, TextInput, Segmented, Select, ToastProvider, useToast, fmtNum, useEnterToSave } from './ui.jsx';
import { detectMode, createStore, resolvePhoto } from './store.js';
import { fmtFecha, parseFecha, readMapFile, defaultCorners } from './maplayers.js';
import { buildGeo, locateLot, controlPoints, metersBetween, pointInPoly, snapToBorder, isSiloLot, normalizeState, siloLot, lotName } from './geo.js';
import { exportKml, estancias, estanciaFilter } from './kml.js';
import { GpsCapture } from './capture.jsx';
import { UpdateButton } from './update.jsx';
import { cloneGeom, moveVertex, insertVertex, removeVertex, restoreLot, buildShapeChange, isLocked } from './shapes.js';
import SatMap from './SatMap.jsx';
import { SiloModal, LotModal, EditMapModal, SiloCard } from './modals.jsx';
import { meters, bearing, dirName, nearestSilos, nearestOnSeg, siloLL, fmtDist, fmtWalk, trailLength, greeting } from './nav.js';
import { Kpis, LotPanel, RecentPanel, SilosScreen, LotsScreen, SettingsScreen, MapsScreen } from './screens.jsx';

const pref = {
  get(k, d) { try { return localStorage.getItem('semia.' + k) || d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('semia.' + k, v); } catch { /* */ } },
};

/* ---------- GPS en tiempo real ---------- */
function useGps(enabled) {
  const [fix, setFix] = useState(null), [err, setErr] = useState(null);
  useEffect(() => {
    if (!enabled) return;
    if (!('geolocation' in navigator)) { setErr('Este dispositivo no tiene GPS disponible'); return; }
    const id = navigator.geolocation.watchPosition(
      p => { const f = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now(), heading: Number.isFinite(p.coords.heading) ? p.coords.heading : null, speed: Number.isFinite(p.coords.speed) ? p.coords.speed : null }; lastLiveFix = f; setFix(f); setErr(null); },
      e => setErr(e.code === 1 ? 'Permiso de ubicación denegado' : 'Sin señal GPS'),
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 25000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return { fix, err };
}
// Toma un punto: mejor precisión durante unos segundos (usa también la última lectura en vivo si es reciente)
let lastLiveFix = null;
function captureFix(ms = 7000) {
  return new Promise((res, rej) => {
    if (!('geolocation' in navigator)) return rej(new Error('GPS no disponible en este dispositivo'));
    let best = lastLiveFix && Date.now() - lastLiveFix.ts < 15000 ? { ...lastLiveFix } : null, over = false;
    const take = p => {
      const f = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
      if (!best || f.acc < best.acc) best = f;
      if (f.acc <= 3) done();
    };
    const fail = e => { if (e.code === 1) { finish(); rej(new Error('Permiso de ubicación denegado')); } };
    const opts = { enableHighAccuracy: true, maximumAge: 0, timeout: ms };
    const id = navigator.geolocation.watchPosition(take, fail, opts);
    navigator.geolocation.getCurrentPosition(take, fail, opts);
    const tm = setTimeout(() => done(), ms);
    function finish() { if (over) return false; over = true; navigator.geolocation.clearWatch(id); clearTimeout(tm); return true; }
    function done() { if (!finish()) return; best ? res(best) : rej(new Error('No se obtuvo señal GPS. Reintentá al aire libre.')); }
  });
}

/* ---------- Primer paso: activar la ubicación ---------- */
function GeoGate({ onDone, required, onBack, est }) {
  const [st, setSt] = useState('ask'), [busy, setBusy] = useState(false);
  function pedir() {
    if (!('geolocation' in navigator)) { setSt('nogps'); return; }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      () => { pref.set('geo', 'ok'); onDone(true); },
      e => { setBusy(false); if (e.code === 1) setSt('denied'); else { pref.set('geo', 'ok'); onDone(true); } },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }
  return (
    <div className="geo-gate">
      <div className="geo-gate-art" aria-hidden="true"><span className="geo-gate-ring" /><span className="geo-gate-ring r2" /><span className="geo-gate-dot"><Icon name="gps" size={30} /></span></div>
      <div className="geo-gate-txt">
        <span className="geo-gate-step">{est ? `${est} · ` : ''}{required ? 'Paso 2 de 2' : 'Antes de empezar'}</span>
        <h1>{st === 'denied' ? 'La ubicación está bloqueada' : st === 'nogps' ? 'Este dispositivo no tiene GPS' : 'Activá tu ubicación'}</h1>
        <p className="muted">{st === 'denied'
          ? 'Habilitala en el navegador: tocá el candado junto a la dirección → Permisos → Ubicación → Permitir. Después volvé a intentar.'
          : st === 'nogps' ? 'Podés usar la app marcando las silobolsas tocando el mapa.'
          : required ? 'Para registrar silobolsas hace falta el GPS del celular: te ubica sobre los lotes y marca la cabecera y la cola de cada bolsa.'
          : 'Acopia usa el GPS del celular para ubicarte sobre los lotes y registrar la cabecera y la cola de cada silobolsa.'}</p>
      </div>
      <div className="geo-gate-act">
        {st !== 'nogps' && <Button variant="primary" className="block" icon="gps" onClick={pedir} disabled={busy}>{busy ? 'Buscando señal…' : st === 'denied' ? 'Volver a intentar' : 'Permitir ubicación'}</Button>}
        {required && st !== 'nogps' ? onBack && <Button variant="ghost" className="block" onClick={onBack}>Cambiar estancia</Button>
          : <Button variant="ghost" className="block" onClick={() => { if (!required) { try { sessionStorage.setItem('semia.geoLater', '1'); } catch { /* */ } } onDone(false); }}>{st === 'nogps' ? 'Continuar' : 'Ahora no'}</Button>}
      </div>
    </div>
  );
}

/* ---------- Navegación a pie (estilo Google Maps) ---------- */
function NavHud({ d, onEnd, onCenter, onDest, onCard }) {
  const dest = d.dest, arrived = dest && dest.d < 12;
  const rel = dest ? (d.heading != null ? dest.b - d.heading : dest.b) : 0; // con rumbo: relativa a hacia dónde caminás
  const walked = trailLength(d.trail || []);
  return (
    <>
      <div className={`nav-top ${arrived ? 'is-arrived' : ''}`} role="status" aria-live="polite">
        {dest ? (arrived ? <>
          <span className="nav-arrow is-ok"><Icon name="check" size={26} /></span>
          <div className="nav-top-txt"><b>Llegaste a {dest.id}</b><span>{dest.s.grano || 'Silobolsa'} · lote {dest.s.lote}</span></div>
          <button type="button" className="nav-top-btn" onClick={() => onCard(dest.id)}>Ficha</button>
        </> : <>
          <span className="nav-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" width="30" height="30" style={{ transform: `rotate(${Math.round(rel)}deg)` }}><path d="M12 3 19 20 12 16 5 20Z" fill="currentColor" /></svg></span>
          <div className="nav-top-txt"><b>{fmtDist(dest.d)}</b><span>hasta <b className="mono">{dest.id}</b> · {d.heading == null ? `${dirName(dest.b)} · ` : ''}{fmtWalk(dest.d)}</span></div>
        </>) : (
          <div className="nav-top-txt"><b>Navegación</b><span>{d.near.length ? 'Elegí a qué silobolsa ir' : 'No hay silobolsas cargadas cerca'}</span></div>
        )}
      </div>
      <div className="nav-panel">
        {d.near.length > 0 && <>
          <span className="nav-sec">Silobolsas cercanas</span>
          <div className="nav-near">
            {d.near.map(n => (
              <button type="button" key={n.id} className={`nav-near-row ${dest?.id === n.id ? 'is-dest' : ''}`} onClick={() => onDest(n.id)}>
                <b className="mono">{n.id}</b><span>{n.s.grano || '—'} · lote {n.s.lote}</span><em>{fmtDist(n.d)}</em>
              </button>
            ))}
          </div>
        </>}
        <div className="navi-foot">
          <span className="nav-walk"><Icon name="navi" size={14} />Recorrido {fmtDist(walked)}</span>
          {!d.follow && <Button size="sm" icon="gps" onClick={onCenter}>Centrar</Button>}
          <Button size="sm" variant="primary" onClick={onEnd}>Terminar</Button>
        </div>
      </div>
    </>
  );
}

/* ---------- Supervisor: elegir la estancia de trabajo ---------- */
function EstanciaGate({ state, me, onPick, onLogout }) {
  const list = estancias(state);
  const nBy = {}; state.silos.forEach(s => { const l = siloLot(s, state.lots); if (l?.kml) nBy[l.kml] = (nBy[l.kml] || 0) + 1; });
  return (
    <div className="geo-gate est-gate">
      <div className="est-gate-head"><Logo size={40} /><span className="geo-gate-step">Hola, {me.nombre || me.user} · Paso 1 de 2</span><h1>¿En qué estancia trabajás hoy?</h1><p className="muted">Vas a ver y registrar solo los lotes de la estancia elegida. Podés cambiarla desde Cuenta.</p></div>
      <div className="est-gate-list" role="list">
        {list.map(e => (
          <button type="button" role="listitem" key={e.id} className="est-opt" onClick={() => onPick(e.id)}>
            <span className="est-opt-sig mono">{e.sigla}</span>
            <span className="est-opt-txt"><b>{e.nombre}</b><span className="muted small">{e.n} lotes · {nBy[e.id] || 0} silobolsas</span></span>
            <Icon name="chev" size={18} className="est-opt-go" />
          </button>
        ))}
      </div>
      <div className="geo-gate-act"><Button variant="ghost" className="block" icon="logout" onClick={onLogout}>Salir</Button></div>
    </div>
  );
}

/* ---------- Login ---------- */
function Login({ store, onLogged, mode }) {
  const [u, setU] = useState(''), [p, setP] = useState(''), [show, setShow] = useState(false);
  const [err, setErr] = useState(null), [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { onLogged(await store.login(u, p)); } catch (x) { setErr(x.message); } finally { setBusy(false); }
  }
  return (
    <div className="login">
      <div className="login-art" aria-hidden="true"><svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice">
        {Array.from({ length: 9 }, (_, i) => <path key={i} d={`M-20 ${60 + i * 38} Q 200 ${20 + i * 38} 420 ${80 + i * 38}`} />)}
      </svg></div>
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><Logo size={48} /><div><h1>Acopia</h1><p className="muted">Registro de silobolsas</p></div></div>
        <Field label="Usuario"><TextInput value={u} onChange={setU} autoCapitalize="none" autoComplete="username" placeholder="usuario" /></Field>
        <Field label="Contraseña">
          <div className="input-ic right">
            <TextInput type={show ? 'text' : 'password'} value={p} onChange={setP} autoComplete="current-password" placeholder="••••••••" />
            <button type="button" className="input-btn" onClick={() => setShow(s => !s)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}><Icon name={show ? 'eyeoff' : 'eye'} size={18} /></button>
          </div>
        </Field>
        {err && <div className="form-err"><Icon name="alert" size={16} />{err}</div>}
        <Button variant="primary" className="block" disabled={busy || !u || !p} onClick={submit} type="submit">{busy ? 'Ingresando…' : 'Ingresar'}</Button>
        <p className="muted small center">Est. Rincón de Baguales · {mode === 'local' ? 'modo local' : 'conectado al servidor'}</p>
      </form>
    </div>
  );
}

/* ---------- Aplicación ---------- */
function Shell({ store, me, state, setState, onLogout, theme, setTheme, gpsOn = true, supEst = null, onChangeEst }) {
  const toast = useToast();
  const isAdmin = me.rol === 'admin';
  const [tab, setTab] = useState('mapa');
  const [selLot, setSelLot] = useState(null), [selSilo, setSelSilo] = useState(null);
  const [pick, setPick] = useState(null), [moving, setMoving] = useState(null);
  const [draft, setDraft] = useState(null), [lotEdit, setLotEdit] = useState(null);
  const [shape, setShape] = useState(null); // { lot, geom, hist, sel, locked }
  const [cap, setCap] = useState(null); // medición GPS en curso { form, a }
  // mapas propios
  const [mapFilter, setMapFilter] = useState('all'); // Inicio abre siempre con el mapa general
  const [mapOpacity, setMapOpacityRaw] = useState(+pref.get('mapOpacity', '1'));
  const setMapOpacity = v => { setMapOpacityRaw(v); pref.set('mapOpacity', String(v)); };
  const [mapUrls, setMapUrls] = useState({});
  // estancia (KML) a mostrar, compartida por Mapa, Lotes y Silos
  const [estId, setEstIdRaw] = useState('all'); // vista general: todas las estancias
  const setEstId = v => { setEstIdRaw(v); setSelLot(null); setSelSilo(null); };
  const [mapJob, setMapJob] = useState(null), [mapEditMeta, setMapEditMeta] = useState(null), [mapEdit, setMapEdit] = useState(null);
  const { fix, err: gpsErr } = useGps(gpsOn);
  // Navegación a pie (estilo Google Maps): destino, recorrido, rumbo y seguimiento de la cámara
  const [nav, setNav] = useState(null); // { dest: id|null, trail: [[lat,lng]], heading, follow, t0 }
  useEffect(() => {
    if (!nav || !fix || fix.acc > 30) return;
    const p = [fix.lat, fix.lng];
    setNav(n => {
      if (!n) return n;
      const last = n.trail[n.trail.length - 1];
      const moved = last ? meters(last, p) : Infinity;
      let heading = n.heading;
      if (fix.heading != null && (fix.speed || 0) > 0.6) heading = fix.heading;
      else if (last && moved >= 3) heading = bearing(last, p);
      return moved >= 3 ? { ...n, heading, trail: [...n.trail, p].slice(-2000) } : heading !== n.heading ? { ...n, heading } : n;
    });
  }, [fix?.ts]); // eslint-disable-line
  const startNav = dest => { setCap(null); setPick(null); setMoving(null); setNav({ dest: dest || null, trail: fix ? [[fix.lat, fix.lng]] : [], heading: null, follow: true, t0: Date.now() }); setSelSilo(null); setTab('mapa'); };
  const geo = useMemo(() => buildGeo(state.georef), [state.georef]);
  const estList = useMemo(() => estancias(state), [state.georef, state.lots]); // eslint-disable-line
  const effEst = supEst && estList.some(e => e.id === supEst) ? supEst : estList.some(e => e.id === estId) ? estId : 'all';
  const estFilterOpts = !supEst && estList.length > 1; // el supervisor trabaja en una sola estancia
  const inEst = useMemo(() => estanciaFilter(state, effEst), [state.georef, effEst]); // eslint-disable-line
  const lots = state.lots;
  const shownState = useMemo(() => (effEst === 'all' ? state : { ...state, lots: state.lots.filter(inEst), silos: state.silos.filter(s => inEst(siloLot(s, state.lots))) }), [state, effEst, inEst]);
  const estOpts = [{ value: 'all', label: 'Todas las estancias', meta: `${state.lots.length} lotes` }, ...estList.map(e => ({ value: e.id, label: e.nombre, meta: `${e.sigla} · ${e.n} lotes` }))];
  const maps = state.maps || [];
  useEffect(() => {
    let on = true;
    Promise.all(maps.map(async m => [m.id, await resolvePhoto(m.src)])).then(r => on && setMapUrls(Object.fromEntries(r)));
    return () => { on = false; };
  }, [maps.map(m => m.id + m.src).join()]); // eslint-disable-line
  const filterOk = mapFilter === 'all' || mapFilter === 'none' || maps.some(m => m.id === mapFilter);
  const effFilter = filterOk ? mapFilter : 'all';
  const overlays = useMemo(() => (effFilter === 'none' ? [] : [...maps]
    .filter(m => effFilter === 'all' || m.id === effFilter)
    .sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || ''))) // el más nuevo arriba
    .map(m => ({ id: m.id, url: mapUrls[m.id], corners: m.corners }))), [maps, effFilter, mapUrls]);
  const defaultCenter = useMemo(() => {
    if (geo) { const ll = state.outline.map(p => geo.toLatLng(p)); return [ll.reduce((a, p) => a + p[0], 0) / ll.length, ll.reduce((a, p) => a + p[1], 0) / ll.length]; }
    return fix ? [fix.lat, fix.lng] : null;
  }, [geo, fix, state.outline]);
  /* ---------- Subida de mapas (continúa aunque cambies de pestaña) ---------- */
  const jobAlive = useRef(0);
  async function startMapJob(file) {
    const jid = ++jobAlive.current;
    const mine = fn => setMapJob(j => (j && j.jid === jid ? fn(j) : j));
    setMapJob({ jid, file, stage: 'convert', pct: 2, step: 'Preparando…', nombre: file.name.replace(/\.[^.]+$/, '').slice(0, 80), fecha: '', res: null });
    try {
      const res = await readMapFile(file, (step, pct) => mine(j => ({ ...j, step, pct })));
      const iso = res.fecha || new Date(file.lastModified || Date.now()).toISOString().slice(0, 10);
      mine(j => ({ ...j, stage: 'ready', pct: 100, res, fecha: j.fecha || fmtFecha(iso) }));
    } catch (e) { mine(j => ({ ...j, stage: 'error', error: e.message || 'No se pudo leer el archivo' })); }
  }
  function cancelMapJob() { jobAlive.current++; setMapJob(null); }
  async function sendMapJob() {
    const j = mapJob; if (!j || j.stage !== 'ready') return;
    const fecha = parseFecha(j.fecha);
    if (!j.nombre.trim()) return toast('Poné un nombre al mapa', 'error');
    if (j.fecha && !fecha) return toast('Fecha inválida (dd/mm/aaaa)', 'error');
    const res = j.res; let corners = res.corners;
    if (!corners) {
      if (!defaultCenter) return toast('Para ubicar una imagen sin coordenadas, cargá los puntos de control o activá el GPS', 'error');
      corners = defaultCorners(defaultCenter, res.w, res.h);
    }
    const jid = j.jid; setMapJob({ ...j, stage: 'upload', pct: 0 });
    try {
      const tipo = /\.pdf$/i.test(j.file.name) ? 'PDF' : /\.tiff?$/i.test(j.file.name) ? 'GeoTIFF' : 'Imagen';
      const out = await store.uploadMap({ nombre: j.nombre.trim(), fecha, corners, w: res.w, h: res.h, crs: res.crs, original: res.original, tipo }, res.dataUrl, me,
        p => setMapJob(x => (x && x.jid === jid ? { ...x, pct: p } : x)));
      if (jobAlive.current !== jid) { setState(out.state); return; }
      setState(out.state); setMapJob(null); setMapFilter('all');
      toast(`Mapa «${j.nombre.trim()}» subido`, 'ok');
      if (!res.corners) { const m = out.state.maps.find(x => x.id === out.id); setTab('mapa'); setMapEdit({ id: out.id, corners: m.corners.map(c => [...c]), orig: m.corners }); }
    } catch (e) { setMapJob(x => (x && x.jid === jid ? { ...x, stage: 'error', error: e.message } : x)); toast(e.message, 'error'); }
  }
  function startMapEdit(id) {
    const m = maps.find(x => x.id === id); if (!m) return;
    setShape(null); setPick(null); setMoving(null); setSelSilo(null);
    setTab('mapa'); setMapEdit({ id, corners: m.corners.map(c => [...c]), orig: m.corners });
  }
  async function saveMapEdit() {
    const m = maps.find(x => x.id === mapEdit.id);
    try { setState(await store.saveMap({ ...m, corners: mapEdit.corners }, me)); toast(`«${m.nombre}» ubicado`, 'ok'); setMapEdit(null); }
    catch (e) { toast(e.message, 'error'); }
  }

  const [card, setCard] = useState(null); // ficha de información de un silo
  const showCard = useCallback(id => setCard(id), []);
  const openSilo = useCallback(id => {
    const s = state.silos.find(x => x.id === id); if (!s) return;
    setDraft({ ...s, prevId: s.id }); setSelSilo(id);
  }, [state.silos]);

  // Marcado en el mapa: punto libre donde se tocó (el lote es el que lo contiene, o el más cercano)
  function draftFromPoint(pt, extra) {
    const loc = locateLot(pt, lots.filter(isSiloLot));
    const map = pt.map(v => Math.round(v * 100) / 100);
    return { ...extra, lote: loc.lot.num, lot: loc.lot.id, map, map2: null, t: null, ang: 0, latlng: geo ? geo.toLatLng(map).map(v => +v.toFixed(7)) : null, latlng2: null, largo: null, gps2: null, fuera: !loc.inside };
  }
  // Lotes donde se pueden registrar silobolsas (los de la estancia en uso)
  const capLots = useMemo(() => lots.filter(l => isSiloLot(l) && inEst(l)), [lots, inEst]);
  const gpsOk = geo && 'geolocation' in navigator && gpsErr !== 'Permiso de ubicación denegado' && gpsOn;
  // datos de navegación para el mapa (y separación con las bolsas vecinas al marcar)
  const here = fix ? [fix.lat, fix.lng] : null;
  const navData = useMemo(() => {
    if (!here || !geo) return null;
    const silosV = shownState.silos;
    if (nav) {
      const near = nearestSilos(here, silosV, geo, 3);
      let dest = null;
      const ds = nav.dest && state.silos.find(x => x.id === nav.dest), ll = ds && siloLL(ds, geo);
      if (ll) { const at = nearestOnSeg(here, ll.a, ll.b); dest = { id: ds.id, at, d: meters(here, at), b: bearing(here, at), s: ds }; }
      return { on: true, me: here, heading: nav.heading, trail: nav.trail, follow: nav.follow, near, dest };
    }
    if (cap?.lot) return { on: false, me: here, near: nearestSilos(here, silosV, geo, 2) };
    return null;
  }, [here?.[0], here?.[1], nav, cap?.lot, shownState, geo]); // eslint-disable-line

  // «+»: primero se elige el lote (el GPS puede caer entre dos), después se mide la bolsa
  function onAdd(form = null) {
    setSelSilo(null); setDraft(null); setShape(null); setMapEdit(null); setMoving(null); setPick(null); setNav(null);
    setTab('mapa');
    if (!geo) { toast(isAdmin ? 'Primero cargá el KML de los lotes en Mapas' : 'Todavía no hay lotes cargados: avisale al administrador', 'error', 5000); if (isAdmin) setTab('mapas'); return; }
    const keep = form?.lot && capLots.some(l => l.id === form.lot) ? form.lot : null;
    setCap({ form, a: null, lot: keep });
  }
  // distancia (m) de un punto del plano al contorno del lote; dentro = 0
  const offLot = (p, lot) => (pointInPoly(p, lot.poly) ? 0 : snapToBorder(p, lot.poly).dist * (geo?.metersPerUnit || 1));
  // Fin de la medición: A (cabecera) y B (cola, opcional), en el lote que eligió el supervisor
  function finishCap(a, b, lotId) {
    const r = p => p.map(v => Math.round(v * 100) / 100);
    const mA = r(geo.toMap(a.lat, a.lng)), mB = b ? r(geo.toMap(b.lat, b.lng)) : null;
    const mid = mB ? [(mA[0] + mB[0]) / 2, (mA[1] + mB[1]) / 2] : mA;
    const lot = lots.find(l => l.id === lotId);
    if (!lot) { setCap(null); return toast('Elegí el lote de la bolsa', 'error'); }
    const off = offLot(mid, lot);
    const form = cap?.form || {};
    setCap(null);
    setDraft({
      ...form, origen: 'gps', lote: lot.num, lot: lot.id, map: mA, map2: mB, t: null, ang: mB ? Math.atan2(mB[1] - mA[1], mB[0] - mA[0]) : 0,
      latlng: [a.lat, a.lng], latlng2: b ? [b.lat, b.lng] : null, largo: b ? Math.round(metersBetween([a.lat, a.lng], [b.lat, b.lng]) * 10) / 10 : null,
      gps: a, gps2: b, fuera: off > 40, fueraM: Math.round(off),
    });
  }
  function onPick(pt) {
    const base = pick?.form || {}, lotId = pick?.lot;
    setPick(null);
    const lot = lotId && lots.find(l => l.id === lotId);
    if (lot) {
      const map = pt.map(v => Math.round(v * 100) / 100), off = offLot(map, lot);
      setDraft({ ...base, origen: 'mapa', gps: null, lote: lot.num, lot: lot.id, map, map2: null, t: null, ang: 0, latlng: geo ? geo.toLatLng(map).map(v => +v.toFixed(7)) : null, latlng2: null, largo: null, gps2: null, fuera: off > 40, fueraM: Math.round(off) });
      return;
    }
    setDraft(draftFromPoint(pt, { ...base, origen: 'mapa', gps: null }));
  }
  const isFree = s => !!s.map2 || !Number.isFinite(s.t);
  function startMove(id) {
    const s = state.silos.find(x => x.id === id); if (!s) return;
    setDraft(null); setCap(null); setTab('mapa'); setSelSilo(id);
    const free = true; // en el satélite la bolsa se traslada completa
    const c0 = s.map2 ? [(s.map[0] + s.map2[0]) / 2, (s.map[1] + s.map2[1]) / 2] : s.map;
    setMoving({ id, lote: s.lote, map: s.map, map2: s.map2 || null, t: s.t, ang: s.ang, free, orig: { map: s.map, map2: s.map2 || null, c0 } });
  }
  function onMoveDraft(sn) {
    setMoving(m => {
      if (!m.free) return { ...m, map: sn.point, t: sn.t, ang: sn.angle };
      const d = [sn.point[0] - m.orig.c0[0], sn.point[1] - m.orig.c0[1]], add = p => (p ? [p[0] + d[0], p[1] + d[1]] : null);
      return { ...m, map: add(m.orig.map), map2: add(m.orig.map2) };
    });
  }
  async function saveMove() {
    const s = state.silos.find(x => x.id === moving.id);
    const r = p => (p ? p.map(v => Math.round(v * 100) / 100) : null);
    const ll = p => (geo && p ? geo.toLatLng(p).map(v => +v.toFixed(7)) : null);
    let upd;
    if (moving.free) {
      const mid = moving.map2 ? [(moving.map[0] + moving.map2[0]) / 2, (moving.map[1] + moving.map2[1]) / 2] : moving.map;
      const inLot = lots.find(l => pointInPoly(mid, l.poly));
      upd = { ...s, lote: s.lote, map: r(moving.map), map2: r(moving.map2), t: null, latlng: ll(moving.map) || s.latlng, latlng2: moving.map2 ? ll(moving.map2) : null };
      if (inLot && inLot.id !== s.lot) toast(`El silo quedó dentro de ${lotName(inLot.num)}; cambiá el lote desde su ficha si corresponde`, 'info', 5000);
    } else {
      upd = { ...s, map: r(moving.map), t: Math.round(moving.t * 100) / 100, ang: Math.round(moving.ang * 1e4) / 1e4, latlng: ll(moving.map) || s.latlng };
    }
    try {
      const st = await store.saveSilo(upd, me, s.id);
      setState(st); toast(`Ubicación de ${s.id} corregida`, 'ok'); setMoving(null);
    } catch (e) { toast(e.message, 'error'); }
  }
  /* ---------- Ajuste manual de forma ---------- */
  function startShape(num) {
    if (!geo) { toast('Primero cargá al menos 4 puntos de control en Ajustes', 'error'); setTab('ajustes'); return; }
    setLotEdit(null); setDraft(null); setSelSilo(null); setMoving(null); setPick(null);
    setTab('mapa'); setSelLot(num);
    const L0 = lots.find(l => l.id === num);
    setShape({ lot: num, num: L0?.num, geom: cloneGeom(state), hist: [], sel: null, locked: controlPoints(state.georef).filter(p => p.lote === L0?.num).map(p => p.map) });
  }
  const pushGeom = (g, extra = {}) => setShape(sh => ({ ...sh, geom: g, hist: [...sh.hist.slice(-40), sh.geom], ...extra }));
  function onVertexMove(from, to) {
    if (isLocked(from, shape.locked)) return;
    pushGeom(moveVertex(shape.geom, shape.lot, from, to), { sel: to });
  }
  function onInsertVertex(num, i) { const r = insertVertex(shape.geom, num, i); pushGeom(r.geom, { sel: r.point }); }
  function onRemoveVertex() {
    const r = removeVertex(shape.geom, shape.lot, shape.sel);
    if (r.error) return toast(r.error, 'error');
    pushGeom(r.geom, { sel: null });
  }
  function onRestoreShape() {
    const lot = lots.find(l => l.id === shape.lot);
    if (!lot.poly0) return toast('Este lote conserva su forma original', 'info');
    pushGeom(restoreLot(shape.geom, lot), { sel: null });
  }
  async function saveShape() {
    const change = buildShapeChange(state, shape.geom, geo);
    if (!change.lots.length && !change.outline) { setShape(null); return; }
    try {
      setState(await store.saveShapes(change, me));
      toast(`Forma guardada (${change.lots.length} lote${change.lots.length === 1 ? '' : 's'}${change.silos.length ? `, ${change.silos.length} silos reubicados en el borde` : ''})`, 'ok');
      setShape(null);
    } catch (e) { toast(e.message, 'error'); }
  }

  function download(text, name, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const today = () => new Date().toISOString().slice(0, 10);
  function exportCsv() {
    const head = ['ID', 'Lote', 'Kg', 'Grano', 'Observacion', 'Latitud', 'Longitud', 'Latitud_fin', 'Longitud_fin', 'Largo_m', 'Precision_m', 'Origen', 'Registrado_por', 'Fecha'];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = state.silos.map(s => [s.id, s.lote, s.kg, s.grano, s.obs, s.latlng?.[0], s.latlng?.[1], s.latlng2?.[0], s.latlng2?.[1], s.largo, s.gps?.acc, s.origen, s.creadoPor, s.creadoEn].map(q).join(';'));
    download('\ufeff' + [head.join(';'), ...rows].join('\n'), `silobolsas-${today()}.csv`, 'text/csv');
  }
  function exportKmlFile() {
    if (!geo && !state.silos.some(s => s.latlng)) return toast('Los lotes no tienen coordenadas: cargá un KML o los puntos de control', 'error');
    download(exportKml(state, geo), `acopia-${today()}.kml`, 'application/vnd.google-earth.kml+xml');
  }

  // El supervisor solo ve Mapa, Silos, + y Lotes (y su cuenta para cambiar de estancia o salir)
  const tabs = isAdmin ? [
    { k: 'mapa', label: 'Inicio', icon: 'map' }, { k: 'silos', label: 'Silos', icon: 'silo' },
    { k: 'lotes', label: 'Lotes', icon: 'lots' }, { k: 'mapas', label: 'Mapas', icon: 'layers' }, { k: 'ajustes', label: 'Ajustes', icon: 'gear', desk: true },
  ] : [
    { k: 'mapa', label: 'Inicio', icon: 'map' }, { k: 'silos', label: 'Silos', icon: 'silo' },
    { k: 'lotes', label: 'Lotes', icon: 'lots' }, { k: 'ajustes', label: 'Cuenta', icon: 'user' },
  ];
  // pestaña del navegador: solo «Acopia · menú activo»
  const tabLabel = (tabs.find(t => t.k === tab) || {}).label;
  useEffect(() => { document.title = tabLabel ? `Acopia · ${tabLabel}` : 'Acopia'; }, [tabLabel]);
  function goTab(k) { setTab(k); setPick(null); if (k !== 'mapa') { setShape(null); setMapEdit(null); setCap(null); } }
  const lot = lots.find(l => l.id === selLot);
  const gpsLabel = gpsErr ? gpsErr : fix ? `GPS ±${fmtNum(fix.acc)} m` : 'Buscando GPS…';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Logo size={32} /><div className="brand-txt"><b>Acopia</b><span>{effEst !== 'all' ? estList.find(e => e.id === effEst)?.nombre : state.estancia.nombre}</span></div></div>
        <div className="top-act">
          <span className={`gps-chip ${fix && !gpsErr ? (fix.acc <= 5 ? 'is-good' : fix.acc <= 15 ? 'is-mid' : 'is-bad') : 'is-off'}`} title={gpsLabel}><Icon name="gps" size={15} /><span>{gpsLabel}</span></span>
          <button type="button" className="round-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Cambiar tema"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} /></button>
          {isAdmin && <button type="button" className={`round-btn avatar-btn ${tab === 'ajustes' ? 'is-on' : ''}`} onClick={() => goTab('ajustes')} aria-label="Ajustes" title={`${me.nombre} (${me.rol}) · Ajustes`}>{(me.nombre || me.user).slice(0, 1).toUpperCase()}</button>}
        </div>
      </header>

      <nav className="nav" aria-label="Secciones">
        <div className="nav-brand"><Logo size={30} /><div><b>Acopia</b><span>{effEst !== 'all' ? estList.find(e => e.id === effEst)?.nombre : state.estancia.nombre}</span></div></div>
        {tabs.map((t, i) => (
          <React.Fragment key={t.k}>
            {i === 2 && <button type="button" className="nav-add" onClick={() => onAdd()} aria-label="Nueva silobolsa"><i><Icon name="plus" size={30} strokeWidth="3" /></i><span>Nueva silobolsa</span></button>}
            <button type="button" className={`nav-item ${tab === t.k ? 'is-on' : ''} ${t.desk ? 'nav-desk' : ''}`} onClick={() => goTab(t.k)} aria-current={tab === t.k ? 'page' : undefined}>
              <Icon name={t.icon} size={21} /><span>{t.label}</span>
              {t.k === 'mapas' && mapJob && (mapJob.stage === 'convert' || mapJob.stage === 'upload') && <i className="nav-pct">{Math.round(mapJob.pct)}%</i>}
            </button>
          </React.Fragment>
        ))}
        <div className="nav-foot"><button type="button" className="nav-item" onClick={onLogout}><Icon name="logout" size={20} /><span>Salir</span></button></div>
      </nav>

      <main className="main">
        {tab === 'mapa' && (
          <div className="dash">
            {(() => { const g = greeting(me.nombre || me.user); return <p className="greet">{g.g}{g.first ? <>, <b>{g.first}</b></> : ''}</p>; })()}
            <Kpis state={shownState} />
            <div className="dash-body">
              <div className="card map-card">
                {!shape && !mapEdit && !cap && <div className="map-top">
                  {estFilterOpts && <div className="map-layers"><Field label="Estancia" className="map-filter"><Select value={effEst} onChange={setEstId} options={estOpts} /></Field></div>}
                  {maps.length > 0 && (
                    <div className="map-layers">
                      <Field label="Mapa a mostrar" className="map-filter"><Select value={effFilter} onChange={setMapFilter} options={[
                        { value: 'all', label: `Todos los mapas (${maps.length})` },
                        ...[...maps].sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || ''))).map(m => ({ value: m.id, label: m.nombre, meta: m.fecha ? fmtFecha(m.fecha) : '' })),
                        { value: 'none', label: 'Solo satélite' },
                      ]} /></Field>
                      {effFilter !== 'none' && <Field label="Opacidad" className="map-op"><Segmented size="sm" value={mapOpacity} onChange={setMapOpacity} options={[{ value: 0.5, label: '50%' }, { value: 0.75, label: '75%' }, { value: 1, label: '100%' }]} /></Field>}
                    </div>
                  )}
                </div>}
                <SatMap nav={navData} onUserPan={() => setNav(n => (n && n.follow ? { ...n, follow: false } : n))} data={shownState} silos={shownState.silos} geo={geo} fitKey={effEst} selectedLot={selLot} onSelectLot={setSelLot} selectedSilo={selSilo}
                  onSelectSilo={id => { setSelSilo(id); }} pickMode={!!pick} onPick={onPick} gps={fix} onNeedGeoref={() => isAdmin && setTab('mapas')}
                  moving={moving} onMoveDraft={onMoveDraft}
                  capture={cap?.a ? { a: [cap.a.lat, cap.a.lng] } : null} editing={shape} overlays={mapEdit ? [{ id: mapEdit.id, url: mapUrls[mapEdit.id], corners: mapEdit.corners }] : overlays} overlayOpacity={mapOpacity} mapEdit={mapEdit} onMapCorners={cs => setMapEdit(me_ => ({ ...me_, corners: cs }))} onVertexMove={onVertexMove} onInsertVertex={onInsertVertex} onSelectVertex={pt => setShape(sh => ({ ...sh, sel: pt }))} />
                {shape && (
                  <div className="map-banner edit-bar">
                    <div className="edit-bar-txt"><Icon name="edit" size={18} /><span><b>Ajustando {lotName(shape.num)}</b> · arrastrá los vértices; <b>+</b> agrega uno. Cada lote se ajusta por separado: los vecinos no se mueven.{shape.locked.length ? ' Los puntos GPS quedan fijos.' : ''}</span></div>
                    <div className="edit-bar-act">
                      <Button size="sm" variant="ghost" icon="rotl" disabled={!shape.hist.length} onClick={() => setShape(sh => ({ ...sh, geom: sh.hist[sh.hist.length - 1], hist: sh.hist.slice(0, -1), sel: null }))}>Deshacer</Button>
                      <Button size="sm" variant="ghost" icon="trash" disabled={!shape.sel} onClick={onRemoveVertex}>Quitar vértice</Button>
                      <Button size="sm" variant="ghost" onClick={onRestoreShape}>Original</Button>
                      <Button size="sm" onClick={() => setShape(null)}>Cancelar</Button>
                      <Button size="sm" variant="primary" icon="check" onClick={saveShape}>Guardar</Button>
                    </div>
                  </div>
                )}
                {mapEdit && (
                  <div className="map-banner edit-bar">
                    <div className="edit-bar-txt"><Icon name="move" size={18} /><span><b>Ubicando «{maps.find(m => m.id === mapEdit.id)?.nombre}»</b> · arrastrá las esquinas NO, NE, SE, SO hasta que coincidan con el satélite, o el centro ✥ para moverlo completo.</span></div>
                    <div className="edit-bar-act">
                      <Button size="sm" variant="ghost" onClick={() => setMapEdit(m => ({ ...m, corners: m.orig.map(c => [...c]) }))}>Deshacer cambios</Button>
                      <Button size="sm" onClick={() => setMapEdit(null)}>Cancelar</Button>
                      <Button size="sm" variant="primary" icon="check" onClick={saveMapEdit}>Guardar</Button>
                    </div>
                  </div>
                )}
                {nav && navData?.on && <NavHud d={navData} onEnd={() => setNav(null)} onCenter={() => setNav(n => ({ ...n, follow: true }))} onDest={id => setNav(n => ({ ...n, dest: id }))} onCard={showCard} />}
                {!nav && !cap && !pick && !moving && !shape && !mapEdit && geo && gpsOk && (
                  <button type="button" className="nav-start" onClick={() => startNav(null)} aria-label="Navegar"><Icon name="navi" size={18} />Navegar</button>
                )}
                {pick && <div className="map-banner"><Icon name="pin" size={18} /><span>{pick.lot ? `Tocá el lugar de la bolsa en el ${lotName(lots.find(l => l.id === pick.lot)?.num)}` : 'Tocá el lugar donde está el silo'}</span><Button size="sm" onClick={() => setPick(null)}>Cancelar</Button></div>}
                {moving && <div className="map-banner"><Icon name="move" size={18} /><span>Arrastrá <b className="mono">{moving.id}</b> desde el punto central</span><Button size="sm" onClick={() => setMoving(null)}>Cancelar</Button><Button size="sm" variant="primary" onClick={saveMove}>Guardar</Button></div>}
                {selSilo && !cap && !moving && !shape && !mapEdit && (() => { const s = state.silos.find(x => x.id === selSilo); return s ? (
                  <div className="lot-bar silo-bar"><div className="lot-bar-main"><b className="mono">{s.id}</b><span className="muted">{s.kg != null && s.kg !== '' ? `${fmtNum(s.kg)} kg` : 'kg sin cargar'}{s.grano ? ` · ${s.grano}` : ''} · lote {s.lote}{s.largo ? ` · ${fmtNum(s.largo)} m` : ''}</span></div>
                    {isAdmin && <Button size="sm" variant="ghost" icon="move" onClick={() => startMove(s.id)}>Mover</Button>}{gpsOk && <Button size="sm" icon="navi" onClick={() => startNav(s.id)}>Ir</Button>}<Button size="sm" variant="primary" onClick={() => showCard(s.id)}>Ficha</Button></div>) : null; })()}
                {lot && !cap && !moving && !pick && !shape && !mapEdit && !selSilo && <div className="only-mobile"><LotPanel lot={lot} state={state} geo={geo} onEdit={isAdmin ? setLotEdit : null} onShape={isAdmin && geo ? startShape : null} compact /></div>}
                {cap && <GpsCapture near={navData && !navData.on ? navData.near : []} fix={fix} gpsErr={gpsErr} lots={capLots} geo={geo} lotId={cap.lot} noGps={!gpsOk}
                  onLot={id => { setCap(c => (c ? { ...c, lot: id, a: null } : c)); setSelLot(id); }}
                  onPickMap={id => { const form = cap.form || {}; setCap(null); setPick({ purpose: 'new', form, lot: id }); }}
                  onCancel={() => setCap(null)} onDone={finishCap} onProgress={p => setCap(c => (c ? { ...c, a: p.a } : c))} />}
              </div>
              <aside className="side-panel">
                {lot ? <LotPanel lot={lot} state={state} geo={geo} onEdit={isAdmin ? setLotEdit : null} onShape={isAdmin ? startShape : null} onSelectSilo={id => setSelSilo(id)} onOpenSilo={showCard} /> : <RecentPanel state={shownState} onSelectSilo={id => { const s = state.silos.find(x => x.id === id); if (s) { setSelLot(s.lot); setSelSilo(id); } }} />}
              </aside>
            </div>
          </div>
        )}
        {tab === 'silos' && <SilosScreen state={state} onOpenSilo={showCard} onExportCsv={isAdmin ? exportCsv : null} onExportKml={isAdmin ? exportKmlFile : null} est={effEst} estOpts={estFilterOpts ? estOpts : null} onEst={setEstId} inEst={inEst} />}
        {tab === 'lotes' && <LotsScreen state={state} onEditLot={isAdmin ? setLotEdit : null} onShowLot={n => { setSelLot(n); setSelSilo(null); setTab('mapa'); }} onOpenSilo={showCard} est={effEst} estOpts={estFilterOpts ? estOpts : null} onEst={setEstId} inEst={inEst} />}
        {tab === 'mapas' && <MapsScreen state={state} me={me} job={mapJob} onPick={startMapJob} onCancel={cancelMapJob} onSend={sendMapJob}
          onJobChange={patch => setMapJob(j => (j ? { ...j, ...patch } : j))}
          onShowMap={id => { setMapFilter(id); setTab('mapa'); }} onAdjustMap={startMapEdit} onEditMap={setMapEditMeta}
          geo={geo} store={store} onState={setState} onShowLots={() => { setTab('mapa'); }} urls={mapUrls} />}
        {tab === 'ajustes' && <SettingsScreen estActual={effEst !== 'all' ? estList.find(e => e.id === effEst) : null} onChangeEst={onChangeEst} state={state} me={me} store={store} geo={geo} gps={fix} captureFix={captureFix} theme={theme} setTheme={setTheme} onState={setState} onLogout={onLogout} mode={store.mode} onGoMapas={() => setTab('mapas')} />}
      </main>

      {draft && <SiloModal draft={draft} state={state} me={me} geo={geo} store={store} onClose={() => setDraft(null)}
        onSaved={(st, id) => { setState(st); setDraft(null); setSelSilo(id); if (id) { const s = normalizeState(st).silos.find(x => x.id === id); if (s) setSelLot(s.lot); } }}
        onRelocate={form => { setDraft(null); setTab('mapa'); setPick({ purpose: 'relocate', form: { kg: form.kg, grano: form.grano, obs: form.obs, fotoData: form.fotoData } }); }}
        onRemeasure={form => onAdd({ kg: form.kg, grano: form.grano, obs: form.obs, fotoData: form.fotoData })}
        onStartMove={startMove} />}
      {card && state.silos.find(x => x.id === card) && <SiloCard silo={state.silos.find(x => x.id === card)} state={state} me={me} geo={geo} onClose={() => setCard(null)}
        onEdit={id => { setCard(null); openSilo(id); }}
        onMap={id => { const s = state.silos.find(x => x.id === id); setCard(null); setTab('mapa'); if (s) { setSelLot(s.lot); setSelSilo(id); } }} />}
      {mapEditMeta && maps.find(m => m.id === mapEditMeta) && <EditMapModal map={maps.find(m => m.id === mapEditMeta)} me={me} store={store} onClose={() => setMapEditMeta(null)} onSaved={st => { setState(st); setMapEditMeta(null); }} />}
      {lotEdit != null && lots.find(l => l.id === lotEdit) && <LotModal lot={lots.find(l => l.id === lotEdit)} state={state} me={me} geo={geo} store={store} onClose={() => setLotEdit(null)} onShape={startShape}
        onSaved={(st, num) => { setState(st); setLotEdit(null); setSelLot(num); }} />}
    </div>
  );
}

function App() {
  useEnterToSave();
  const [boot, setBoot] = useState({ phase: 'loading' });
  const [theme, setThemeRaw] = useState(pref.get('theme', 'dark'));
  const [geoGate, setGeoGate] = useState(null); // null = revisando · 'ask' · 'ok' · 'off' · 'nogps'
  const [supEst, setSupEst] = useState(() => { try { return sessionStorage.getItem('semia.estSup'); } catch { return null; } });
  useEffect(() => {
    (async () => {
      try {
        const p = await navigator.permissions?.query({ name: 'geolocation' });
        if (p?.state === 'granted') return setGeoGate('ok');
      } catch { /* sin API de permisos (iOS): se decide por lo recordado */ }
      let later = false; try { later = sessionStorage.getItem('semia.geoLater') === '1'; } catch { /* */ }
      setGeoGate(pref.get('geo', '') === 'ok' ? 'ok' : later ? 'off' : 'ask');
    })();
  }, []);
  const setTheme = t => { setThemeRaw(t); pref.set('theme', t); };
  useEffect(() => { document.documentElement.dataset.theme = theme; document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#000000' : '#F2F2F2'); }, [theme]);
  useEffect(() => {
    (async () => {
      const mode = await detectMode(); const store = createStore(mode);
      const s = await store.session();
      setBoot({ phase: 'ready', store, me: s?.me || null, state: normalizeState(s?.state || null) });
    })();
  }, []);
  if (boot.phase === 'loading') return <div className="splash"><Logo size={56} /><span className="muted">Cargando Acopia…</span></div>;
  const { store } = boot;
  if (!boot.me) return <Login store={store} mode={store.mode} onLogged={({ me, state }) => setBoot(b => ({ ...b, me, state: normalizeState(state) }))} />;
  const logout = async () => { try { sessionStorage.removeItem('semia.estSup'); } catch { /* */ } setSupEst(null); await store.logout(); setBoot(b => ({ ...b, me: null, state: null })); };
  // Supervisor: login → estancia → ubicación (obligatoria) → registro
  const sup = boot.me.rol !== 'admin';
  const ests = estancias(boot.state);
  const supId = !sup ? null : ests.length === 1 ? ests[0].id : ests.some(e => e.id === supEst) ? supEst : null;
  if (sup && ests.length > 1 && !supId) return <EstanciaGate state={boot.state} me={boot.me} onLogout={logout} onPick={id => { try { sessionStorage.setItem('semia.estSup', id); } catch { /* */ } setSupEst(id); }} />;
  if (!geoGate) return <div className="splash"><Logo size={56} /></div>;
  const changeEst = ests.length > 1 ? () => { try { sessionStorage.removeItem('semia.estSup'); } catch { /* */ } setSupEst(null); } : null;
  if (geoGate === 'ask' || (sup && geoGate !== 'ok' && geoGate !== 'nogps')) return <GeoGate required={sup} est={supId ? ests.find(e => e.id === supId)?.nombre : ''} onBack={changeEst} onDone={ok => setGeoGate(ok ? 'ok' : sup ? 'nogps' : 'off')} />;
  return <Shell key={supId || 'admin'} store={store} me={boot.me} state={boot.state} theme={theme} setTheme={setTheme} gpsOn={geoGate === 'ok'}
    supEst={supId} onChangeEst={sup ? changeEst : null}
    setState={st => setBoot(b => ({ ...b, state: normalizeState(st) }))}
    onLogout={logout} />;
}

createRoot(document.getElementById('root')).render(<ToastProvider><App /><UpdateButton /></ToastProvider>);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
