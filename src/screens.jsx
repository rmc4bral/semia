import React, { useMemo, useRef, useState } from 'react';
import { Button, Field, TextInput, Select, Segmented, Icon, useToast, fmtKg, fmtNum, fmtDate } from './ui.jsx';
import { areaHa, lotCorners, migrateGeoref, pointKey } from './geo.js';
import { PhotoView, GRANOS } from './modals.jsx';

const fmtFechaCorta = iso => { if (!iso) return 'sin fecha'; const [y, m, d] = iso.split('-'); return `${d}/${m}/${y}`; };
const sumKg = arr => arr.reduce((a, s) => a + (+s.kg || 0), 0);
const fmtT = kg => (kg >= 1000 ? `${fmtNum(kg / 1000, kg < 100000 ? 1 : 0)} t` : `${fmtKg(kg)} kg`);

export function Kpis({ state }) {
  const lotsWith = new Set(state.silos.map(s => s.lote)).size;
  const ha = state.lots.reduce((a, l) => a + (+l.ha || 0), 0);
  const kg = sumKg(state.silos);
  const items = [
    { k: 'Silobolsas', v: fmtNum(state.silos.length), s: 'registradas' },
    { k: 'Almacenado', v: fmtT(kg), s: `${fmtKg(kg)} kg` },
    { k: 'Lotes con silos', v: `${lotsWith}/${state.lots.length}`, s: 'lotes' },
    { k: 'Superficie', v: `${fmtNum(ha)} ha`, s: state.estancia.nombre },
  ];
  return (
    <div className="kpis">
      {items.map(i => <div className="kpi" key={i.k}><span className="kpi-k">{i.k}</span><b className="kpi-v">{i.v}</b><span className="kpi-s">{i.s}</span></div>)}
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
      {!recent.length && <div className="empty"><Icon name="silo" size={28} /><p>Todavía no hay silobolsas. Tocá <b>+</b> para registrar la primera con tu ubicación actual.</p></div>}
    </section>
  );
}

/* ---------- Pantalla Silos ---------- */
export function SilosScreen({ state, onOpenSilo, onExportCsv }) {
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
        <Button icon="download" onClick={onExportCsv}>Exportar CSV</Button>
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
export function SettingsScreen({ state, me, store, geo, gps, captureFix, theme, setTheme, onState, onLogout, mode, onUploadMapFile, onShowMap, onAdjustMap, onEditMap }) {
  const toast = useToast();
  const isAdmin = me.rol === 'admin';
  const [pts, setPts] = useState(() => migrateGeoref(state.georef, state.lots).points.map(p => ({ ...p, lat: p.lat ?? '', lng: p.lng ?? '' })));
  const [taking, setTaking] = useState(null);
  const [est, setEst] = useState({ nombre: state.estancia.nombre, sigla: state.estancia.sigla });
  const [nu, setNu] = useState({ user: '', nombre: '', pass: '', rol: 'operador' });
  const [myPass, setMyPass] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const imp = useRef(null), mapIn = useRef(null);
  const maps = [...(state.maps || [])].sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
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

        <section className="card set-sec">
          <div className="panel-head"><h3><Icon name="layers" size={18} /> Mapas propios</h3><span className="badge">{maps.length}</span></div>
          <p className="muted small">Subí ortomosaicos del dron (GeoTIFF en WGS84, UTM o POSGAR: se ubican solos) o imágenes JPG/PNG que ubicás arrastrando sus esquinas. En Satélite elegís ver uno, todos o ninguno.</p>
          <div className="user-list">
            {maps.map(m => (
              <div className="user-row map-row" key={m.id}>
                <span className="avatar"><Icon name="layers" size={16} /></span>
                <span className="grow"><b>{m.nombre}</b><span className="muted small"> · {fmtFechaCorta(m.fecha)} · {m.crs || 'ubicado a mano'}</span></span>
                <Button size="sm" variant="ghost" icon="eye" onClick={() => onShowMap(m.id)} aria-label={`Ver ${m.nombre}`} />
                {isAdmin && <Button size="sm" variant="ghost" icon="move" onClick={() => onAdjustMap(m.id)} aria-label={`Ajustar posición de ${m.nombre}`} />}
                {isAdmin && <Button size="sm" variant="ghost" icon="edit" onClick={() => onEditMap(m.id)} aria-label={`Editar ${m.nombre}`} />}
              </div>
            ))}
            {!maps.length && <p className="muted small">Todavía no hay mapas propios.</p>}
          </div>
          {isAdmin && <div className="row end"><Button variant="primary" icon="upload" onClick={() => mapIn.current.click()}>Subir mapa</Button></div>}
          <input ref={mapIn} type="file" accept=".tif,.tiff,image/tiff,image/jpeg,image/png,image/webp" hidden onChange={e => { const fl = e.target.files?.[0]; e.target.value = ''; if (fl) onUploadMapFile(fl); }} />
        </section>

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
