import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Logo, Icon, Button, Field, TextInput, Segmented, ToastProvider, useToast, fmtNum } from './ui.jsx';
import { detectMode, createStore } from './store.js';
import { buildGeo, locateLot } from './geo.js';
import Map3D from './Map3D.jsx';
import SatMap from './SatMap.jsx';
import { SiloModal, LotModal } from './modals.jsx';
import { Kpis, LotPanel, RecentPanel, SilosScreen, LotsScreen, SettingsScreen } from './screens.jsx';

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
      p => { setFix({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, ts: Date.now() }); setErr(null); },
      e => setErr(e.code === 1 ? 'Permiso de ubicación denegado' : 'Sin señal GPS'),
      { enableHighAccuracy: true, maximumAge: 4000, timeout: 25000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return { fix, err };
}
function captureFix(ms = 7000) {
  return new Promise((res, rej) => {
    if (!('geolocation' in navigator)) return rej(new Error('GPS no disponible en este dispositivo'));
    let best = null;
    const done = () => { navigator.geolocation.clearWatch(id); clearTimeout(tm); best ? res(best) : rej(new Error('No se obtuvo señal GPS. Reintentá al aire libre.')); };
    const id = navigator.geolocation.watchPosition(p => {
      const f = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
      if (!best || f.acc < best.acc) best = f;
      if (f.acc <= 3) done();
    }, e => { if (e.code === 1) { navigator.geolocation.clearWatch(id); clearTimeout(tm); rej(new Error('Permiso de ubicación denegado')); } },
    { enableHighAccuracy: true, maximumAge: 0, timeout: ms });
    const tm = setTimeout(done, ms);
  });
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
        <div className="login-brand"><Logo size={48} /><div><h1>SemIA</h1><p className="muted">Registro de silobolsas</p></div></div>
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
function Shell({ store, me, state, setState, onLogout, theme, setTheme }) {
  const toast = useToast();
  const isAdmin = me.rol === 'admin';
  const [tab, setTab] = useState('mapa');
  const [view, setViewRaw] = useState(pref.get('view', '3d'));
  const setView = v => { setViewRaw(v); pref.set('view', v); };
  const [selLot, setSelLot] = useState(null), [selSilo, setSelSilo] = useState(null);
  const [pick, setPick] = useState(null), [moving, setMoving] = useState(null);
  const [draft, setDraft] = useState(null), [lotEdit, setLotEdit] = useState(null);
  const { fix, err: gpsErr } = useGps(true);
  const geo = useMemo(() => buildGeo(state.georef), [state.georef]);
  const gpsMap = useMemo(() => (geo && fix ? geo.toMap(fix.lat, fix.lng) : null), [geo, fix]);
  const lots = state.lots;

  const openSilo = useCallback(id => {
    const s = state.silos.find(x => x.id === id); if (!s) return;
    setDraft({ ...s, prevId: s.id }); setSelSilo(id);
  }, [state.silos]);

  function draftFromPoint(pt, extra) {
    const loc = locateLot(pt, lots);
    return { ...extra, lote: loc.lot.num, map: loc.snap.point, t: loc.snap.t, ang: loc.snap.angle, rawMap: pt };
  }
  function onAdd() {
    setSelSilo(null);
    if (geo && fix && Date.now() - fix.ts < 60000) {
      const m = geo.toMap(fix.lat, fix.lng);
      setDraft(draftFromPoint(m, { origen: 'gps', gps: { lat: +fix.lat.toFixed(7), lng: +fix.lng.toFixed(7), acc: Math.round(fix.acc), at: new Date().toISOString() } }));
      return;
    }
    if (view === 'sat' && !geo) setView('3d');
    setPick({ purpose: 'new' });
    toast(!geo ? 'Mapa sin georreferencia: tocá el borde del lote donde está el silo' : 'Sin señal GPS: tocá el borde del lote donde está el silo', 'info', 4500);
  }
  function onPick(pt) {
    const base = pick?.purpose === 'relocate' ? pick.form : {};
    setPick(null);
    setDraft(draftFromPoint(pt, { ...base, origen: 'mapa', gps: null }));
  }
  function startMove(id) {
    const s = state.silos.find(x => x.id === id); if (!s) return;
    setDraft(null); setTab('mapa'); setView('3d'); setSelSilo(id);
    setMoving({ id, lote: s.lote, map: s.map, t: s.t, ang: s.ang });
  }
  async function saveMove() {
    const s = state.silos.find(x => x.id === moving.id);
    try {
      const st = await store.saveSilo({ ...s, map: moving.map.map(v => Math.round(v * 100) / 100), t: Math.round(moving.t * 100) / 100, ang: Math.round(moving.ang * 1e4) / 1e4, latlng: geo ? geo.toLatLng(moving.map).map(v => +v.toFixed(7)) : s.latlng }, me, s.id);
      setState(st); toast(`Ubicación de ${s.id} corregida`, 'ok'); setMoving(null);
    } catch (e) { toast(e.message, 'error'); }
  }
  function exportCsv() {
    const head = ['ID', 'Lote', 'Kg', 'Grano', 'Observacion', 'Latitud', 'Longitud', 'Precision_m', 'Origen', 'Registrado_por', 'Fecha'];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = state.silos.map(s => [s.id, s.lote, s.kg, s.grano, s.obs, s.latlng?.[0], s.latlng?.[1], s.gps?.acc, s.origen, s.creadoPor, s.creadoEn].map(q).join(';'));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + [head.join(';'), ...rows].join('\n')], { type: 'text/csv' }));
    a.download = `silobolsas-${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  const tabs = [
    { k: 'mapa', label: 'Mapa', icon: 'map' }, { k: 'silos', label: 'Silos', icon: 'silo' },
    { k: 'lotes', label: 'Lotes', icon: 'lots' }, { k: 'ajustes', label: 'Ajustes', icon: 'gear' },
  ];
  const lot = lots.find(l => l.num === selLot);
  const gpsLabel = gpsErr ? gpsErr : fix ? `GPS ±${fmtNum(fix.acc)} m` : 'Buscando GPS…';

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Logo size={30} /><div className="brand-txt"><b>SemIA</b><span>{state.estancia.nombre}</span></div></div>
        <div className="top-act">
          <span className={`gps-chip ${fix && !gpsErr ? (fix.acc <= 10 ? 'is-good' : 'is-mid') : 'is-off'}`} title={gpsLabel}><Icon name="gps" size={16} /><span>{gpsLabel}</span></span>
          <Button variant="ghost" icon={theme === 'dark' ? 'sun' : 'moon'} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Cambiar tema" />
          <span className="avatar" title={`${me.nombre} (${me.rol})`}>{(me.nombre || me.user).slice(0, 1).toUpperCase()}</span>
        </div>
      </header>

      <nav className="nav">
        {tabs.map(t => (
          <button type="button" key={t.k} className={tab === t.k ? 'is-on' : ''} onClick={() => { setTab(t.k); setPick(null); }}>
            <Icon name={t.icon} size={20} /><span>{t.label}</span>
          </button>
        ))}
        <div className="nav-foot"><button type="button" onClick={onLogout}><Icon name="logout" size={20} /><span>Salir</span></button></div>
      </nav>

      <main className="main">
        {tab === 'mapa' && (
          <div className="dash">
            <Kpis state={state} />
            <div className="dash-body">
              <div className="card map-card">
                <div className="map-top">
                  <Segmented size="sm" value={view} onChange={setView} options={[{ value: '3d', label: 'Plano 3D', icon: 'cube' }, { value: 'sat', label: 'Satélite', icon: 'sat' }]} />
                </div>
                {view === '3d' ? (
                  <Map3D data={state} silos={state.silos} selectedLot={selLot} onSelectLot={setSelLot} selectedSilo={selSilo} onSelectSilo={setSelSilo}
                    pickMode={!!pick} onPick={onPick} moving={moving} onMoveDraft={sn => setMoving(m => ({ ...m, map: sn.point, t: sn.t, ang: sn.angle }))}
                    gpsMap={gpsMap} isAdmin={isAdmin} onEditLot={setLotEdit} onOpenSilo={openSilo} onStartMove={startMove} />
                ) : (
                  <SatMap data={state} silos={state.silos} geo={geo} selectedLot={selLot} onSelectLot={setSelLot} selectedSilo={selSilo}
                    onSelectSilo={id => { setSelSilo(id); }} pickMode={!!pick} onPick={onPick} gps={fix} onNeedGeoref={() => setTab('ajustes')} />
                )}
                {pick && <div className="map-banner"><Icon name="pin" size={18} /><span>Tocá el borde del lote donde está el silo</span><Button size="sm" onClick={() => setPick(null)}>Cancelar</Button></div>}
                {moving && <div className="map-banner"><Icon name="move" size={18} /><span>Arrastrá <b className="mono">{moving.id}</b> por el borde del lote {moving.lote}</span><Button size="sm" onClick={() => setMoving(null)}>Cancelar</Button><Button size="sm" variant="primary" onClick={saveMove}>Guardar</Button></div>}
                {view === 'sat' && selSilo && !moving && (() => { const s = state.silos.find(x => x.id === selSilo); return s ? (
                  <div className="lot-bar"><div className="lot-bar-main"><b className="mono">{s.id}</b><span className="muted">{fmtNum(s.kg)} kg · lote {s.lote}</span></div><Button size="sm" onClick={() => openSilo(s.id)}>Detalle</Button></div>) : null; })()}
                {lot && !moving && !pick && !(view === 'sat' && selSilo) && <div className="only-mobile"><LotPanel lot={lot} state={state} geo={geo} onEdit={setLotEdit} compact /></div>}
                {!moving && !pick && <button type="button" className="fab" onClick={onAdd} aria-label="Agregar silobolsa"><Icon name="plus" size={26} /></button>}
              </div>
              <aside className="side-panel">
                {lot ? <LotPanel lot={lot} state={state} geo={geo} onEdit={setLotEdit} onSelectSilo={id => setSelSilo(id)} /> : <RecentPanel state={state} onSelectSilo={id => { const s = state.silos.find(x => x.id === id); if (s) { setSelLot(s.lote); setSelSilo(id); } }} />}
              </aside>
            </div>
          </div>
        )}
        {tab === 'silos' && <SilosScreen state={state} onOpenSilo={openSilo} onExportCsv={exportCsv} />}
        {tab === 'lotes' && <LotsScreen state={state} onEditLot={setLotEdit} onShowLot={n => { setSelLot(n); setSelSilo(null); setTab('mapa'); }} />}
        {tab === 'ajustes' && <SettingsScreen state={state} me={me} store={store} geo={geo} gps={fix} captureFix={captureFix} theme={theme} setTheme={setTheme} onState={setState} onLogout={onLogout} mode={store.mode} />}
      </main>

      {draft && <SiloModal draft={draft} state={state} me={me} geo={geo} store={store} onClose={() => setDraft(null)}
        onSaved={(st, id) => { setState(st); setDraft(null); setSelSilo(id); if (id) { const s = st.silos.find(x => x.id === id); if (s) setSelLot(s.lote); } }}
        onRelocate={form => { setDraft(null); setTab('mapa'); if (view === 'sat' && !geo) setView('3d'); setPick({ purpose: 'relocate', form: { kg: form.kg, grano: form.grano, obs: form.obs, fotoData: form.fotoData } }); }}
        onStartMove={startMove} />}
      {lotEdit != null && lots.find(l => l.num === lotEdit) && <LotModal lot={lots.find(l => l.num === lotEdit)} state={state} me={me} geo={geo} store={store} onClose={() => setLotEdit(null)}
        onSaved={(st, num) => { setState(st); setLotEdit(null); setSelLot(num); }} />}
    </div>
  );
}

function App() {
  const [boot, setBoot] = useState({ phase: 'loading' });
  const [theme, setThemeRaw] = useState(pref.get('theme', 'dark'));
  const setTheme = t => { setThemeRaw(t); pref.set('theme', t); };
  useEffect(() => { document.documentElement.dataset.theme = theme; document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0F2420' : '#EDE6D9'); }, [theme]);
  useEffect(() => {
    (async () => {
      const mode = await detectMode(); const store = createStore(mode);
      const s = await store.session();
      setBoot({ phase: 'ready', store, me: s?.me || null, state: s?.state || null });
    })();
  }, []);
  if (boot.phase === 'loading') return <div className="splash"><Logo size={56} /><span className="muted">Cargando SemIA…</span></div>;
  const { store } = boot;
  if (!boot.me) return <Login store={store} mode={store.mode} onLogged={({ me, state }) => setBoot(b => ({ ...b, me, state }))} />;
  return <Shell store={store} me={boot.me} state={boot.state} theme={theme} setTheme={setTheme}
    setState={st => setBoot(b => ({ ...b, state: st }))}
    onLogout={async () => { await store.logout(); setBoot(b => ({ ...b, me: null, state: null })); }} />;
}

createRoot(document.getElementById('root')).render(<ToastProvider><App /></ToastProvider>);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
