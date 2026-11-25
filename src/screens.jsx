import React, { useMemo, useRef, useState } from 'react';
import { Button, Field, TextInput, Select, Segmented, Icon, useToast, fmtKg, fmtNum, fmtDate } from './ui.jsx';
import { fmtFecha } from './maplayers.js';
import { areaHa, lotCorners, migrateGeoref, pointKey } from './geo.js';
import { PhotoView, GRANOS } from './modals.jsx';
import { KmlImport } from './kmlImport.jsx';
import GlobalMap from './GlobalMap.jsx';
import { geodesicHa } from './kml.js';

const sumKg = arr => arr.reduce((a, s) => a + (+s.kg || 0), 0);
const fmtT = kg => (kg >= 1000 ? `${fmtNum(kg / 1000, kg < 100000 ? 1 : 0)} t` : `${fmtKg(kg)} kg`);

export function Kpis({ state }) {
  const lotsWith = new Set(state.silos.map(s => s.lote)).size;
  const ha = state.lots.reduce((a, l) => a + (+l.ha || 0), 0);
  const kg = sumKg(state.silos);
  const items = [
    { k: 'Almacenado', v: fmtT(kg), s: `${fmtKg(kg)} kg`, hero: true },
    { k: 'Silobolsas', v: fmtNum(state.silos.length), s: 'registradas' },
    { k: 'Lotes con silos', v: `${lotsWith}/${state.lots.length}`, s: 'lotes' },
    { k: 'Superficie', v: `${fmtNum(ha)} ha`, s: state.estancia.nombre },
  ];
  return (
    <div className="kpis">
      {items.map(i => <div className={`kpi ${i.hero ? 'is-hero' : ''}`} key={i.k}><span className="kpi-k">{i.k}</span><b className="kpi-v">{i.v}</b><span className="kpi-s">{i.s}</span></div>)}
    </div>
  );
}

export function LotPanel({ lot, state, geo, onEdit, onShape, onSelectSilo, compact }) {
  if (!lot) return null;
  const silos = state.silos.filter(s => s.lote === lot.num);
  const kg = sumKg(silos);
  const measured = areaHa(lot.poly, geo);
  if (compact) {
    return (
      <div className="lot-bar">
        <div className="lot-bar-main"><b>Lote {lot.num}</b><span className="muted">{lot.ha} ha · {silos.length} silo{silos.length === 1 ? '' : 's'} · {fmtT(kg)}</span></div>
        {onShape && <Button size="sm" variant="ghost" icon="edit" onClick={() => onShape(lot.num)}>Ajustar</Button>}
        <Button variant="ghost" icon="gear" onClick={() => onEdit(lot.num)} aria-label="Configurar lote" />
      </div>
    );
  }
  return (
    <section className="panel-sec">
      <div className="panel-head"><h3>Lote {lot.num}{lot.nombre ? <span className="muted"> · {lot.nombre}</span> : null}</h3><div className="row gap-s">{onShape && <Button size="sm" variant="ghost" icon="edit" onClick={() => onShape(lot.num)}>Ajustar forma</Button>}<Button size="sm" variant="ghost" icon="gear" onClick={() => onEdit(lot.num)}>Configurar</Button></div></div>
      <div className="stat-row">
        <div><span className="muted small">Hectáreas</span><b>{lot.ha}</b></div>
        <div><span className="muted small">Silos</span><b>{silos.length}</b></div>
        <div><span className="muted small">Almacenado</span><b>{fmtT(kg)}</b></div>
      </div>
      {lot.subs?.length > 0 && <div className="chips">{lot.subs.map(s => <span className="chip" key={s.id}>{lot.num}{s.id} · {s.ha} ha</span>)}</div>}
      {measured && <p className="muted small">Superficie medida por georreferencia: {fmtNum(measured)} ha</p>}
      <div className="mini-list">{silos.map(s => <SiloRow key={s.id} s={s} onClick={() => onSelectSilo(s.id)} />)}</div>
      {!silos.length && <p className="muted small">Sin silobolsas en este lote.</p>}
    </section>
  );
}

export function SiloRow({ s, onClick, thumb }) {
  return (
    <button type="button" className="silo-row" onClick={onClick}>
      <span className="silo-ic"><Icon name="silo" size={18} /></span>
      <span className="silo-row-main"><b className="mono">{s.id}</b><span className="muted small">Lote {s.lote}{s.grano ? ` · ${s.grano}` : ''} · {fmtDate(s.creadoEn)}</span></span>
      {thumb && s.foto && <PhotoView refPath={s.foto} className="silo-thumb" />}
      <span className="silo-row-kg"><b>{fmtKg(s.kg)}</b><span className="muted small">kg</span></span>
    </button>
  );
}

export function RecentPanel({ state, onSelectSilo }) {
  const recent = [...state.silos].sort((a, b) => String(b.creadoEn).localeCompare(String(a.creadoEn))).slice(0, 8);
  return (
    <section className="panel-sec grow">
      <div className="panel-head"><h3>Últimos registros</h3></div>
      <div className="mini-list">{recent.map(s => <SiloRow key={s.id} s={s} onClick={() => onSelectSilo(s.id)} />)}</div>
      {!recent.length && <div className="empty"><Icon name="silo" size={28} /><p>Todavía no hay silobolsas. Tocá <b>+</b> y marcá con el GPS la cabecera y la cola de la bolsa.</p></div>}
    </section>
  );
}

/* ---------- Pantalla Silos ---------- */
export function SilosScreen({ state, onOpenSilo, onExportCsv, onExportKml }) {
  const [q, setQ] = useState(''), [lote, setLote] = useState('all'), [grano, setGrano] = useState('all');
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return state.silos.filter(s => (lote === 'all' || s.lote === lote) && (grano === 'all' || s.grano === grano)
      && (!t || s.id.toLowerCase().includes(t) || (s.obs || '').toLowerCase().includes(t)))
      .sort((a, b) => a.id.localeCompare(b.id));
  }, [state.silos, q, lote, grano]);
  const lotOpts = [{ value: 'all', label: 'Todos los lotes' }, ...state.lots.map(l => ({ value: l.num, label: `Lote ${l.num}` }))];
  return (
    <div className="screen">
      <div className="screen-head">
        <div><h1>Silobolsas</h1><p className="muted">{list.length} de {state.silos.length} · {fmtT(sumKg(list))}</p></div>
        <div className="row gap-s"><Button icon="download" onClick={onExportKml}>KML</Button><Button icon="download" onClick={onExportCsv}>CSV</Button></div>
      </div>
      <div className="filters">
        <Field label="Buscar"><div className="input-ic"><Icon name="search" size={16} /><TextInput value={q} onChange={setQ} placeholder="ID u observación" /></div></Field>
        <Field label="Lote"><Select value={lote} options={lotOpts} onChange={setLote} /></Field>
        <Field label="Grano"><Select value={grano} options={[{ value: 'all', label: 'Todos' }, ...GRANOS.map(g => ({ value: g, label: g }))]} onChange={setGrano} /></Field>
      </div>
      <div className="card list-card">
        {list.map(s => <SiloRow key={s.id} s={s} thumb onClick={() => onOpenSilo(s.id)} />)}
        {!list.length && <div className="empty"><Icon name="search" size={28} /><p>No hay silobolsas que coincidan.</p></div>}
      </div>
    </div>
  );
}

/* ---------- Pantalla Lotes ---------- */
export function LotsScreen({ state, onEditLot, onShowLot }) {
  const kgBy = {}, nBy = {};
  state.silos.forEach(s => { kgBy[s.lote] = (kgBy[s.lote] || 0) + (+s.kg || 0); nBy[s.lote] = (nBy[s.lote] || 0) + 1; });
  const max = Math.max(1, ...Object.values(kgBy));
  return (
    <div className="screen">
      <div className="screen-head"><div><h1>Lotes</h1><p className="muted">{state.lots.length} lotes · {fmtNum(state.lots.reduce((a, l) => a + l.ha, 0))} ha</p></div></div>
      <div className="lot-grid">
        {state.lots.map(l => (
          <div className="card lot-card" key={l.num}>
            <button type="button" className="lot-card-main" onClick={() => onShowLot(l.num)}>
              <span className="lot-card-num">{l.num}</span>
              <span className="lot-card-info"><b>{l.ha} ha</b><span className="muted small">{l.nombre || (l.subs?.length ? l.subs.map(s => s.id).join(' · ') : 'Sin subdivisiones')}</span></span>
            </button>
            <Button variant="ghost" icon="gear" onClick={() => onEditLot(l.num)} aria-label={`Configurar lote ${l.num}`} />
            <div className="lot-card-bar"><span style={{ width: `${((kgBy[l.num] || 0) / max) * 100}%` }} /></div>
            <div className="lot-card-foot muted small"><span>{nBy[l.num] || 0} silos</span><span>{fmtT(kgBy[l.num] || 0)}</span></div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Mini plano del lote con la esquina elegida */
function LotMini({ lot, vi, n }) {
  if (!lot) return <span className="geo-n">{n}</span>;
  const xs = lot.poly.map(p => p[0]), ys = lot.poly.map(p => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0 || 1, h = Math.max(...ys) - y0 || 1, k = 34 / Math.max(w, h);
  const P = p => [7 + (p[0] - x0) * k + (34 - w * k) / 2, 7 + (p[1] - y0) * k + (34 - h * k) / 2];
  const v = lot.poly[vi] ? P(lot.poly[vi]) : null;
  return (
    <svg className="geo-mini" width="48" height="48" viewBox="0 0 48 48" aria-label={`Punto ${n}`}>
      <polygon points={lot.poly.map(p => P(p).join(',')).join(' ')} />
      {v && <circle cx={v[0]} cy={v[1]} r="4.5" />}
      <text x="41" y="10">N</text><text x="5" y="10" className="geo-mini-n">{n}</text>
    </svg>
  );
}

/* ---------- Pantalla Ajustes ---------- */
export function SettingsScreen({ state, me, store, geo, gps, captureFix, theme, setTheme, onState, onLogout, mode }) {
  const toast = useToast();
  const isAdmin = me.rol === 'admin';
  const [pts, setPts] = useState(() => migrateGeoref(state.georef, state.lots).points.map(p => ({ ...p, lat: p.lat ?? '', lng: p.lng ?? '' })));
  const [taking, setTaking] = useState(null);
  const [est, setEst] = useState({ nombre: state.estancia.nombre, sigla: state.estancia.sigla });
  const [nu, setNu] = useState({ user: '', nombre: '', pass: '', rol: 'operador' });
  const [myPass, setMyPass] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const imp = useRef(null);
  const lotOpts = state.lots.map(l => ({ value: l.num, label: `Lote ${l.num}`, meta: `${l.ha} ha` }));
  const cornersOf = num => { const l = state.lots.find(x => x.num === num); return l ? lotCorners(l) : []; };
  const resid = Object.fromEntries((geo?.residuals || []).map(r => [r.key, r.m]));
  const setPt = (i, patch) => setPts(a => a.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const choose = (i, lote, vi) => {
    const cs = cornersOf(lote), c = cs.find(x => x.vi === vi) || cs[0];
    setPt(i, { lote, vi: c.vi, key: pointKey(lote, c.vi), map: c.map, label: `Lote ${lote} · ${c.label}` });
  };
  const addPt = () => {
    const used = new Set(pts.map(p => p.key));
    for (const l of state.lots) for (const c of lotCorners(l)) {
      const k = pointKey(l.num, c.vi);
      if (!used.has(k)) { setPts(a => [...a, { key: k, lote: l.num, vi: c.vi, map: c.map, label: `Lote ${l.num} · ${c.label}`, lat: '', lng: '', acc: null, at: null }]); return; }
    }
  };

  const declared = state.lots.reduce((a, l) => a + l.ha, 0);
  const measured = geo ? state.lots.reduce((a, l) => a + areaHa(l.poly, geo), 0) : null;

  async function take(i) {
    setTaking(i);
    try {
      const fx = await captureFix(7000);
      setPts(a => a.map((p, j) => (j === i ? { ...p, lat: fx.lat.toFixed(7), lng: fx.lng.toFixed(7), acc: Math.round(fx.acc), at: new Date().toISOString() } : p)));
      toast(`Punto ${i + 1} tomado (±${Math.round(fx.acc)} m)`, 'ok');
    } catch (e) { toast(e.message, 'error'); } finally { setTaking(null); }
  }
  async function saveGeo() {
    const out = pts.map(p => {
      const lat = p.lat === '' ? null : Number(String(p.lat).replace(',', '.')), lng = p.lng === '' ? null : Number(String(p.lng).replace(',', '.'));
      return { key: p.key, lote: p.lote, vi: p.vi, label: p.label, map: p.map, lat, lng, acc: p.acc ?? null, at: p.at ?? null };
    });
    if (out.some(p => !p.lote)) return toast('Elegí lote y esquina en todos los puntos', 'error');
    if (out.some(p => (p.lat !== null && !(Math.abs(p.lat) <= 90)) || (p.lng !== null && !(Math.abs(p.lng) <= 180)))) return toast('Coordenadas fuera de rango', 'error');
    if (new Set(out.map(p => p.key)).size < out.length) return toast('Hay dos puntos en la misma esquina', 'error');
    try { onState(await store.saveGeoref({ points: out }, me)); toast('Georreferencia guardada', 'ok'); } catch (e) { toast(e.message, 'error'); }
  }
  const clearPt = i => setPt(i, { lat: '', lng: '', acc: null, at: null });
  const done = pts.filter(p => p.lat !== '' && p.lng !== '').length;

  async function run(fn, ok) { try { onState(await fn()); if (ok) toast(ok, 'ok'); return true; } catch (e) { toast(e.message, 'error'); return false; } }

  function download(name, text, type) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const exportJson = () => { const { users, ...rest } = state; download(`semia-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(rest, null, 1), 'application/json'); };
  async function importJson(e) {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    try { const data = JSON.parse(await file.text()); await run(() => store.importData(data, me), 'Datos importados'); } catch { toast('El archivo no es un JSON válido', 'error'); }
  }

  return (
    <div className="screen">
      <div className="screen-head"><div><h1>Ajustes</h1><p className="muted">{me.nombre} · {me.rol === 'admin' ? 'Administrador' : 'Operador'} · {mode === 'local' ? 'Modo local' : 'Servidor'}</p></div></div>
      <div className="settings">
        {state.georef?.mode === 'kml' ? (
          <section className="card set-sec">
            <div className="panel-head"><h3><Icon name="gps" size={18} /> Georreferencia</h3><span className="badge badge-ok">KML</span></div>
            <p className="muted small">Los lotes se cargaron desde <b>{state.georef.kml?.archivo || 'un KML'}</b> y están en coordenadas reales. Los silobolsas se ubican directamente con el GPS del celular. Para cambiar los lotes, cargá otro KML en la pestaña Mapas.</p>
            {measured && <p className="small">Superficie calculada: <b>{fmtNum(measured)} ha</b> · declarada {fmtNum(declared)} ha</p>}
          </section>
        ) : (
        <section className="card set-sec">
          <div className="panel-head"><h3><Icon name="gps" size={18} /> Puntos de control</h3><span className={`badge ${geo ? 'badge-ok' : ''}`}>{geo ? `Activa · ${geo.count} puntos` : `${done}/4 mínimo`}</span></div>
          <p className="muted small">Elegí cualquier lote y su esquina (N, NE, E, SE, S, SO, O, NO), parate en ese punto y tocá el ícono de ubicación. Con 4 puntos el plano se ubica sobre el satélite; con más puntos el ajuste es más preciso y se informa el desvío de cada uno.</p>
          <div className="geo-pts">
            {pts.map((p, i) => {
              const lot = state.lots.find(l => l.num === p.lote);
              const cs = cornersOf(p.lote);
              return (
                <div className="geo-pt" key={i}>
                  <div className="geo-pt-head">
                    <LotMini lot={lot} vi={p.vi} n={i + 1} />
                    <Field label="Lote" className="grow"><Select value={p.lote} options={lotOpts} onChange={v => choose(i, v, 0)} disabled={!isAdmin} /></Field>
                    <Field label="Esquina" className="grow"><Select value={p.vi} options={cs.map(c => ({ value: c.vi, label: c.label }))} onChange={v => choose(i, p.lote, v)} disabled={!isAdmin} /></Field>
                  </div>
                  <div className="geo-pt-row">
                    <Field label="Latitud"><TextInput value={p.lat} onChange={v => setPt(i, { lat: v })} inputMode="text" placeholder="-36.1234567" disabled={!isAdmin} /></Field>
                    <Field label="Longitud"><TextInput value={p.lng} onChange={v => setPt(i, { lng: v })} inputMode="text" placeholder="-60.1234567" disabled={!isAdmin} /></Field>
                    <div className="geo-act">
                      <Button variant="primary" icon="gps" onClick={() => take(i)} disabled={!isAdmin || taking !== null} aria-label={`Usar mi ubicación para el punto ${i + 1}`}>{taking === i ? 'Tomando…' : null}</Button>
                      {isAdmin && (p.lat !== '' || p.lng !== '') && <Button variant="ghost" icon="close" onClick={() => clearPt(i)} aria-label="Borrar coordenadas" />}
                      {isAdmin && pts.length > 4 && <Button variant="ghost" icon="trash" onClick={() => setPts(a => a.filter((_, j) => j !== i))} aria-label="Quitar punto" />}
                    </div>
                  </div>
                  <div className="geo-meta muted small">
                    {p.acc != null && <span>GPS ±{p.acc} m · {fmtDate(p.at)}</span>}
                    {resid[p.key] != null && geo.count > 4 && <span className={resid[p.key] > 15 ? 'warn' : ''}>Desvío del ajuste: {fmtNum(resid[p.key], 1)} m</span>}
                  </div>
                </div>
              );
            })}
          </div>
          {isAdmin && pts.length < 12 && <Button icon="plus" onClick={addPt}>Agregar punto de control</Button>}
          {measured && <p className="small">Superficie calculada: <b>{fmtNum(measured)} ha</b> · declarada {fmtNum(declared)} ha ({measured >= declared ? '+' : ''}{fmtNum(((measured - declared) / declared) * 100, 1)} %)</p>}
          <div className="row end gap-s">
            {gps && <span className="muted small grow">Tu GPS: ±{Math.round(gps.acc)} m</span>}
            {isAdmin && <Button variant="primary" icon="check" onClick={saveGeo}>Guardar georreferencia</Button>}
          </div>
        </section>
        )}

        <section className="card set-sec">
          <div className="panel-head"><h3><Icon name="map" size={18} /> Estancia</h3></div>
          <div className="form-grid">
            <Field label="Nombre"><TextInput value={est.nombre} onChange={v => setEst(x => ({ ...x, nombre: v }))} disabled={!isAdmin} /></Field>
            <Field label="Sigla para IDs" hint={`Ejemplo: ${est.sigla || 'RB'}16001`}><TextInput value={est.sigla} onChange={v => setEst(x => ({ ...x, sigla: v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) }))} disabled={!isAdmin} /></Field>
          </div>
          {isAdmin && <div className="row end"><Button icon="check" onClick={() => { if (!est.nombre.trim() || !est.sigla) return toast('Completá nombre y sigla', 'error'); run(() => store.saveEstancia(est, me), 'Estancia guardada'); }}>Guardar</Button></div>}
        </section>

        <section className="card set-sec">
          <div className="panel-head"><h3><Icon name="user" size={18} /> Usuarios</h3></div>
          {isAdmin && (
            <div className="user-list">
              {state.users.map(u => (
                <div className="user-row" key={u.user}>
                  <span className="avatar">{(u.nombre || u.user).slice(0, 1).toUpperCase()}</span>
                  <span className="grow"><b>{u.nombre || u.user}</b><span className="muted small"> · {u.user} · {u.rol === 'admin' ? 'Administrador' : 'Operador'}</span></span>
                  {u.user !== me.user && <Button size="sm" variant="ghost" icon="trash" onClick={() => run(() => store.deleteUser(u.user, me), 'Usuario eliminado')} aria-label="Eliminar usuario" />}
                </div>
              ))}
            </div>
          )}
          {isAdmin && (
            <div className="form-grid">
              <Field label="Usuario"><TextInput value={nu.user} onChange={v => setNu(x => ({ ...x, user: v.toLowerCase().replace(/[^a-z0-9._-]/g, '') }))} /></Field>
              <Field label="Nombre"><TextInput value={nu.nombre} onChange={v => setNu(x => ({ ...x, nombre: v }))} /></Field>
              <Field label="Contraseña"><TextInput type="password" value={nu.pass} onChange={v => setNu(x => ({ ...x, pass: v }))} /></Field>
              <Field label="Rol"><Select value={nu.rol} options={[{ value: 'operador', label: 'Operador (registra silos)' }, { value: 'admin', label: 'Administrador' }]} onChange={v => setNu(x => ({ ...x, rol: v }))} /></Field>
              <div className="span-2 row end"><Button icon="plus" onClick={async () => {
                if (nu.user.length < 3 || nu.pass.length < 6) return toast('Usuario (3+) y contraseña (6+) requeridos', 'error');
                if (state.users.some(u => u.user === nu.user)) return toast('Ese usuario ya existe', 'error');
                if (await run(() => store.saveUser(nu, me), 'Usuario creado')) setNu({ user: '', nombre: '', pass: '', rol: 'operador' });
              }}>Agregar usuario</Button></div>
            </div>
          )}
          <div className="form-grid">
            <Field label="Nueva contraseña (tu cuenta)" className="span-2"><TextInput type="password" value={myPass} onChange={setMyPass} placeholder="Mínimo 6 caracteres" /></Field>
          </div>
          <div className="row end"><Button onClick={async () => { if (myPass.length < 6) return toast('Mínimo 6 caracteres', 'error'); if (await run(() => store.saveUser({ user: me.user, nombre: me.nombre, rol: me.rol, pass: myPass }, me), 'Contraseña actualizada')) setMyPass(''); }}>Cambiar contraseña</Button></div>
        </section>

        <section className="card set-sec">
          <div className="panel-head"><h3><Icon name="layers" size={18} /> Datos y apariencia</h3></div>
          <Field label="Tema"><Segmented value={theme} onChange={setTheme} options={[{ value: 'dark', label: 'Oscuro', icon: 'moon' }, { value: 'light', label: 'Claro', icon: 'sun' }]} /></Field>
          <div className="row wrap gap-s">
            <Button icon="download" onClick={exportJson}>Exportar respaldo</Button>
            {isAdmin && <Button icon="upload" onClick={() => imp.current.click()}>Importar respaldo</Button>}
            <input ref={imp} type="file" accept="application/json,.json" hidden onChange={importJson} />
            {isAdmin && mode === 'local' && !confirmReset && <Button variant="ghost" icon="trash" onClick={() => setConfirmReset(true)}>Restablecer datos locales</Button>}
            {confirmReset && <><span className="small">¿Borrar todo lo guardado en este dispositivo?</span><Button onClick={() => setConfirmReset(false)}>No</Button><Button variant="danger" onClick={() => { store.resetLocal(); location.reload(); }}>Sí, borrar</Button></>}
          </div>
          <div className="row end"><Button variant="ghost" icon="logout" onClick={onLogout}>Cerrar sesión</Button></div>
        </section>
      </div>
    </div>
  );
}

/* ---------- Mapas propios: subida con barra de proceso ---------- */
const STAGES = [['convert', 'Convertir'], ['ready', 'Revisar'], ['upload', 'Subir']];
export function MapsScreen({ state, me, job, onPick, onJobChange, onCancel, onSend, onShowMap, onAdjustMap, onEditMap, geo, store, onState, onShowLots, urls = {} }) {
  const isAdmin = me.rol === 'admin';
  const inp = useRef(null);
  const maps = [...(state.maps || [])].sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
  const busy = job && (job.stage === 'convert' || job.stage === 'upload');
  const idx = job ? Math.max(0, STAGES.findIndex(s => s[0] === job.stage)) : -1;
  const sizeMb = job?.res ? (job.res.dataUrl.length * 0.75) / 1048576 : 0;
  // listado general
  const [q, setQ] = useState(''), [orden, setOrden] = useState('fecha'), [sel, setSel] = useState(null);
  const [imgs, setImgs] = useState(true), [focus, setFocus] = useState(null);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    const r = (state.maps || []).map(m => ({ ...m, tipo: m.tipo || (m.crs ? 'GeoTIFF' : 'Imagen'), ha: geodesicHa(m.corners) }))
      .filter(m => !t || `${m.nombre} ${m.tipo} ${m.crs || ''} ${fmtFecha(m.fecha)}`.toLowerCase().includes(t));
    const cmp = { fecha: (a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')), nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'), ha: (a, b) => b.ha - a.ha }[orden];
    return r.sort(cmp);
  }, [state.maps, q, orden]);
  const totalHa = rows.reduce((a, m) => a + m.ha, 0);
  const fechas = (state.maps || []).map(m => m.fecha).filter(Boolean).sort();
  const pickMap = id => { setSel(id); if (id) setFocus({ id, t: Date.now() }); };
  return (
    <div className="screen maps-screen">
      <div className="screen-head"><div><h1>Mapas</h1><p className="muted">{maps.length} {maps.length === 1 ? 'mapa cargado' : 'mapas cargados'}{fechas.length ? ` · ${fmtFecha(fechas[0])} a ${fmtFecha(fechas[fechas.length - 1])}` : ''}</p></div></div>
      <div className="maps-layout">
        <div className="maps-main">
          <section className="card glob-sec">
            <div className="glob-head">
              <h3><Icon name="map" size={18} /> Mapa global</h3>
              <div className="row gap-s">
                <Segmented size="sm" value={imgs} onChange={setImgs} options={[{ value: true, label: 'Imágenes' }, { value: false, label: 'Contornos' }]} />
                <Button size="sm" variant="ghost" icon="target" onClick={() => { setSel(null); setFocus({ id: 'all', t: Date.now() }); }} aria-label="Ver todos los mapas" />
              </div>
            </div>
            <GlobalMap maps={state.maps || []} urls={urls} lots={state.lots} geo={geo} selected={sel} onSelect={id => setSel(id)} showImages={imgs} focus={focus} />
          </section>
          <section className="card set-sec maps-list-sec">
            <div className="panel-head"><h3><Icon name="layers" size={18} /> Mapas cargados</h3><span className="badge">{rows.length}{rows.length !== maps.length ? ` de ${maps.length}` : ''}</span></div>
            {maps.length > 0 && (
              <div className="maps-filters">
                <Field label="Buscar"><TextInput value={q} onChange={setQ} placeholder="Nombre, tipo o fecha" /></Field>
                <Field label="Ordenar por"><Select value={orden} onChange={setOrden} options={[{ value: 'fecha', label: 'Más recientes' }, { value: 'nombre', label: 'Nombre' }, { value: 'ha', label: 'Superficie' }]} /></Field>
              </div>
            )}
            <div className="maps-list" role="list">
              {rows.map(m => (
                <div key={m.id} role="listitem" className={`maps-item ${sel === m.id ? 'is-sel' : ''}`}>
                  <button type="button" className="maps-item-main" onClick={() => pickMap(sel === m.id ? null : m.id)} aria-pressed={sel === m.id}>
                    <span className="maps-thumb">{urls[m.id] ? <img src={urls[m.id]} alt="" loading="lazy" /> : <Icon name="layers" size={18} />}</span>
                    <span className="maps-info">
                      <b>{m.nombre}</b>
                      <span className="muted small">{fmtFecha(m.fecha)} · {m.tipo}{m.crs ? ` ${m.crs}` : ' · ubicado a mano'}</span>
                      <span className="muted small">{fmtNum(m.ha, m.ha < 10 ? 1 : 0)} ha{m.peso ? ` · ${fmtNum(m.peso / 1048576, 1)} MB` : ''}{m.original ? ` · ${m.original[0]}×${m.original[1]} px` : ''}</span>
                    </span>
                  </button>
                  <div className="maps-act">
                    <Button size="sm" variant="ghost" icon="sat" onClick={() => onShowMap(m.id)} aria-label={`Ver ${m.nombre} en el mapa satelital`} />
                    {isAdmin && <Button size="sm" variant="ghost" icon="move" onClick={() => onAdjustMap(m.id)} aria-label={`Ajustar posición de ${m.nombre}`} />}
                    {isAdmin && <Button size="sm" variant="ghost" icon="edit" onClick={() => onEditMap(m.id)} aria-label={`Editar o eliminar ${m.nombre}`} />}
                  </div>
                </div>
              ))}
              {!maps.length && <p className="muted small">Todavía no hay mapas cargados.{isAdmin ? ' Subí el primero desde «Subir mapa».' : ''}</p>}
              {maps.length > 0 && !rows.length && <p className="muted small">Ningún mapa coincide con la búsqueda.</p>}
            </div>
            {rows.length > 1 && <p className="muted small">Superficie cubierta: {fmtNum(totalHa)} ha (sumando mapas, con superposiciones).</p>}
          </section>
        </div>
        <div className="maps-side">
        {isAdmin && <KmlImport state={state} me={me} geo={geo} store={store} onState={onState} onShowLots={onShowLots} />}
        {isAdmin && (
          <section className="card set-sec">
            <div className="panel-head"><h3><Icon name="upload" size={18} /> Subir mapa</h3></div>
            <p className="muted small">Formatos: <b>GeoTIFF</b> (WGS84, UTM o POSGAR: se ubica solo), <b>PDF</b>, <b>JPG</b>, <b>PNG</b> o <b>WebP</b>. Los PDF e imágenes se ubican después arrastrando sus esquinas sobre el satélite. Podés seguir usando la app mientras se procesa.</p>
            {!job && (
              <button type="button" className="dropzone" onClick={() => inp.current.click()}>
                <Icon name="upload" size={26} /><b>Elegir archivo</b><span className="muted small">TIF · PDF · JPG · PNG · WebP</span>
              </button>
            )}
            <input ref={inp} type="file" accept=".tif,.tiff,.pdf,application/pdf,image/tiff,image/jpeg,image/png,image/webp" hidden onChange={e => { const fl = e.target.files?.[0]; e.target.value = ''; if (fl) onPick(fl); }} />
            {job && (
              <div className="job">
                <div className="job-head"><Icon name="layers" size={18} /><b className="grow">{job.file.name}</b><span className="muted small">{fmtNum(job.file.size / 1048576, 1)} MB</span></div>
                <ol className="steps">
                  {STAGES.map((s, i) => <li key={s[0]} className={i < idx ? 'is-done' : i === idx ? (job.stage === 'error' ? 'is-err' : 'is-on') : ''}><i>{i < idx ? '✓' : i + 1}</i><span>{s[1]}</span></li>)}
                </ol>
                {job.stage !== 'error' && (
                  <>
                    <div className="pbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(job.pct)}><div className="pbar-fill" style={{ width: `${Math.max(2, job.pct)}%` }} /></div>
                    <div className="pbar-txt"><span className="row gap-s">{busy && <span className="spinner sm" />}{job.stage === 'upload' ? `Subiendo al servidor… ${Math.round(job.pct)} %` : job.stage === 'convert' ? `${job.step} · ${Math.round(job.pct)} %` : 'Lista para subir'}</span></div>
                  </>
                )}
                {job.stage === 'error' && <div className="form-err"><Icon name="alert" size={16} />{job.error}</div>}
                {job.stage !== 'error' && (
                  <div className="form-grid">
                    <Field label="Nombre"><TextInput value={job.nombre} onChange={v => onJobChange({ nombre: v })} placeholder="Ej: Vuelo lote 16" disabled={job.stage === 'upload'} /></Field>
                    <Field label="Fecha del vuelo / imagen" hint="dd/mm/aaaa"><TextInput value={job.fecha} onChange={v => onJobChange({ fecha: v.replace(/[^\d/]/g, '').slice(0, 10) })} inputMode="numeric" placeholder="21/10/2026" disabled={job.stage === 'upload'} /></Field>
                  </div>
                )}
                {job.res && job.stage !== 'error' && (
                  <>
                    <div className="map-prev"><img src={job.res.dataUrl} alt="Vista previa del mapa" /></div>
                    <div className="loc-box">
                      <Icon name={job.res.corners ? 'gps' : 'move'} size={18} />
                      <div className="loc-txt">
                        {job.res.corners ? <span>Georreferenciado · {job.res.crs} · se ubica solo en el satélite</span>
                          : <span>Sin coordenadas: después de subirlo lo ubicás arrastrando sus esquinas sobre el satélite</span>}
                        <span className="muted small">{job.res.original[0]}×{job.res.original[1]}{job.res.pages > 1 ? ` · página 1 de ${job.res.pages}` : ''} → {job.res.w}×{job.res.h} px · {fmtNum(sizeMb, 1)} MB</span>
                      </div>
                    </div>
                  </>
                )}
                <div className="row end gap-s">
                  <Button onClick={onCancel} disabled={job.stage === 'upload'}>{job.stage === 'error' ? 'Cerrar' : 'Cancelar'}</Button>
                  {job.stage === 'ready' && <Button variant="primary" icon="upload" onClick={onSend}>Subir mapa</Button>}
                </div>
              </div>
            )}
          </section>
        )}
        </div>
      </div>
    </div>
  );
}
