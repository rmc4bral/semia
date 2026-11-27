import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, Field, TextInput, TextArea, Select, Icon, useToast, fmtKg, fmtDate, fmtNum, parseNum } from './ui.jsx';
import { NumField, KbTextArea, kgToT, fmtTyped } from './keyboard.jsx';
import { nextSiloId, snapToBorder, areaHa, pointInPoly, isSiloLot, parseLotCode, lotName, siloLot, siglaOf, estanciaNombre } from './geo.js';
import { resolvePhoto } from './store.js';
import { fmtFecha, parseFecha } from './maplayers.js';

export const GRANOS = ['Soja', 'Maíz', 'Trigo', 'Girasol', 'Sorgo', 'Cebada', 'Otro'];

export function compressImage(file, max = 1280, q = 0.72) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error('No se pudo leer la imagen'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error('Formato de imagen no soportado'));
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', q));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

export function PhotoView({ refPath, className }) {
  const [src, setSrc] = useState(null);
  useEffect(() => { let on = true; resolvePhoto(refPath).then(s => on && setSrc(s)); return () => { on = false; }; }, [refPath]);
  return src ? <img src={src} alt="Foto del silo" className={className} /> : null;
}

/* ---------- Alta / edición de silobolsa ---------- */
export function SiloModal({ draft, state, me, geo, store, onClose, onSaved, onRelocate, onRemeasure, onStartMove }) {
  const toast = useToast();
  const isNew = !draft.prevId;
  const isAdmin = me.rol === 'admin';
  const canEdit = isNew || isAdmin || draft.creadoPor === me.user;
  const [f, setF] = useState(() => {
    const g = draft.grano ?? '', otro = g && !GRANOS.includes(g);
    return { ...draft, lot: draft.lot || siloLot(draft, state.lots)?.id || null, kg: draft.kg == null || draft.kg === '' ? '' : fmtTyped(String(draft.kg).replace('.', ','), 0), obs: draft.obs ?? '', grano: otro ? 'Otro' : g, granoOtro: otro ? g : '', hum: draft.hum == null || draft.hum === '' ? '' : String(draft.hum).replace('.', ','), prio: !!draft.prio };
  });
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const cam = useRef(null), gal = useRef(null);
  const multi = (state.georef?.kmls || []).length > 1;
  const lotOpts = state.lots.filter(isSiloLot).map(l => ({ value: l.id, label: `Lote ${l.num}`, meta: [multi ? estanciaNombre(l, state) : '', `${l.ha} ha`].filter(Boolean).join(' · ') }));
  const lot = state.lots.find(l => l.id === f.lot);
  const sigla = siglaOf(lot, state); // cada sección tiene su sigla: LG31010 = Los Gatos · lote 31 · bolsa 010
  const origLot = draft.lot || siloLot(draft, state.lots)?.id;

  // ID automático según sección y lote
  useEffect(() => {
    if (isNew || f.lot !== origLot) setF(x => ({ ...x, id: lot ? nextSiloId(sigla, lot.num, state.silos, draft.prevId) : '' }));
    else setF(x => ({ ...x, id: draft.prevId }));
  }, [f.lot]); // eslint-disable-line

  const free = !!f.map2 || !Number.isFinite(f.t); // ubicado por GPS: no se pega al borde
  const changeLot = lid => {
    const l = state.lots.find(x => x.id === lid); if (!l) return;
    if (free) { setF(x => ({ ...x, lot: lid, lote: l.num, fuera: false })); return; }
    const base = f.rawMap || f.map;
    const sn = base ? snapToBorder(base, l.poly) : null;
    setF(x => ({ ...x, lot: lid, lote: l.num, ...(sn ? { map: sn.point, t: sn.t, ang: sn.angle } : {}) }));
  };

  const pickFile = async e => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try { const d = await compressImage(file); setF(x => ({ ...x, fotoData: d })); } catch (err) { toast(err.message, 'error'); }
  };

  const kgNum = parseNum(f.kg);
  const humNum = parseNum(f.hum);
  const err = { kg: f.kg !== '' && (isNaN(kgNum) || kgNum < 0) ? 'Ingresá un número válido' : null, hum: f.hum !== '' && (isNaN(humNum) || humNum < 0 || humNum > 40) ? 'Entre 0 y 40 %' : null };
  const granoFinal = f.grano === 'Otro' ? (f.granoOtro || '').trim() : f.grano;

  async function save() {
    if (!lot) return toast('Elegí un lote', 'error');
    if (!f.map) return toast('Falta la ubicación del silo', 'error');
    if (!granoFinal) return toast(f.grano === 'Otro' ? 'Escribí qué grano es' : 'Elegí el grano', 'error');
    if (err.kg) return toast('Los kg tienen que ser un número', 'error');
    if (err.hum) return toast('La humedad va de 0 a 40 %', 'error');
    setBusy(true);
    try {
      const id = isNew || f.lot !== origLot ? nextSiloId(sigla, lot.num, state.silos, draft.prevId) : draft.prevId;
      let foto = f.fotoData === null ? null : f.foto || null;
      if (f.fotoData) foto = await store.uploadPhoto(id, f.fotoData);
      const silo = {
        id, lote: lot.num, lot: lot.id, kg: f.kg === '' ? null : kgNum, hum: f.hum === '' ? null : Math.round(humNum * 10) / 10, prio: !!f.prio, grano: granoFinal, obs: (f.obs || '').trim(), foto,
        map: f.map.map(v => Math.round(v * 100) / 100), t: free ? null : Math.round(f.t * 100) / 100, ang: Number.isFinite(f.ang) ? Math.round(f.ang * 1e4) / 1e4 : 0,
        map2: f.map2 ? f.map2.map(v => Math.round(v * 100) / 100) : null,
        latlng: f.latlng && f.origen === 'gps' ? f.latlng : geo ? geo.toLatLng(f.map).map(v => +v.toFixed(7)) : (draft.latlng || null),
        latlng2: f.map2 ? (f.latlng2 || (geo ? geo.toLatLng(f.map2).map(v => +v.toFixed(7)) : null)) : null,
        largo: f.map2 ? f.largo ?? null : null,
        gps: f.gps || null, gps2: f.map2 ? f.gps2 || null : null, origen: f.origen || 'mapa',
      };
      const st = await store.saveSilo(silo, me, draft.prevId);
      toast(isNew ? `Silo ${id} registrado` : `Silo ${id} actualizado`, 'ok');
      onSaved(st, id);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }
  async function del() {
    setBusy(true);
    try { const st = await store.deleteSilo(draft.prevId, me); toast(`Silo ${draft.prevId} eliminado`, 'ok'); onSaved(st, null); }
    catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  const insideLot = f.rawMap && lot ? pointInPoly(f.rawMap, lot.poly) : null;
  const photoShown = f.fotoData || (f.fotoData !== null && f.foto);

  return (
    <Modal title={isNew ? 'Nueva silobolsa' : `Silobolsa ${draft.prevId}`} subtitle={isNew ? (f.origen === 'gps' ? 'Ubicada con el GPS del celular' : 'Marcada en el mapa') : `Registrada ${fmtDate(draft.creadoEn)} por ${draft.creadoPor || '—'}`}
      onClose={onClose}
      footer={confirmDel ? (
        <><span className="foot-msg">¿Eliminar {draft.prevId}? No se puede deshacer.</span><Button onClick={() => setConfirmDel(false)}>Cancelar</Button><Button variant="danger" onClick={del} disabled={busy}>Eliminar</Button></>
      ) : (
        <>
          {!isNew && isAdmin && <Button variant="ghost" icon="trash" onClick={() => setConfirmDel(true)} className="foot-left" aria-label="Eliminar" />}
          {!isNew && isAdmin && <Button variant="ghost" icon="move" onClick={() => onStartMove(draft.prevId)}>Mover</Button>}
          <Button onClick={onClose}>Cancelar</Button>
          {canEdit && <Button variant="primary" icon="check" onClick={save} disabled={busy}>{busy ? 'Guardando…' : 'Guardar'}</Button>}
        </>
      )}>
      <div className="silo-id" aria-label={`Número de silobolsa ${f.id}`}>
        <span className="silo-id-num mono">{f.id || '—'}</span>
        <div className="silo-id-parts">
          <span><b className="mono">{sigla}</b>{estanciaNombre(lot, state) || 'Sección'}</span>
          <span><b className="mono">{String(lot?.num ?? '').padStart(2, '0')}</b>Lote</span>
          <span><b className="mono">{String(f.id || '').slice(-3)}</b>Bolsa</span>
        </div>
      </div>
      <div className="form-grid">
        <Field label="Lote" className="span-2">
          <Select value={f.lot} options={lotOpts} onChange={changeLot} disabled={!canEdit} />
        </Field>
        <Field label="Ubicación" className="span-2">
          {f.map2 ? (
            <div className="loc-gps">
              <div className="loc-len"><b>{f.largo != null ? fmtNum(f.largo) : '—'}</b><span>m de largo</span></div>
              <div className="loc-pts">
                <span><i>A</i>Cabecera{f.gps ? ` · ±${fmtNum(f.gps.acc)} m` : ''}<em className="mono">{(f.latlng || geo?.toLatLng(f.map) || []).map(v => (+v).toFixed(6)).join(', ')}</em></span>
                <span><i>B</i>Cola{f.gps2 ? ` · ±${fmtNum(f.gps2.acc)} m` : ''}<em className="mono">{(f.latlng2 || geo?.toLatLng(f.map2) || []).map(v => (+v).toFixed(6)).join(', ')}</em></span>
              </div>
            </div>
          ) : (
            <div className="loc-box">
              <Icon name={f.origen === 'gps' ? 'gps' : 'pin'} size={18} />
              <div className="loc-txt">
                {f.origen === 'gps' && f.gps ? <span>GPS ±{fmtNum(f.gps.acc)} m{free ? ' · punto medido' : ` · ajustado al borde del lote ${f.lote}`}</span>
                  : <span>Marcado en el mapa · {free ? 'punto libre' : `borde del lote ${f.lote}`}</span>}
                {geo && f.map && <span className="muted small mono">{geo.toLatLng(f.map).map(v => v.toFixed(6)).join(', ')}</span>}
              </div>
            </div>
          )}
          {f.fuera && <p className="field-hint is-error">{f.fueraM != null ? `La bolsa quedó a ${fmtNum(f.fueraM)} m afuera del lote ${f.lote}. Revisá que el lote elegido sea el correcto.` : `La bolsa quedó fuera de los lotes: se asignó el lote más cercano (${f.lote}). Revisá el lote.`}</p>}
          {canEdit && isNew && (
            <div className="row gap-s wrap">
              {onRemeasure && geo && <Button size="sm" icon="gps" onClick={() => onRemeasure(f)}>Volver a medir</Button>}
              <Button size="sm" variant="ghost" icon="pin" onClick={() => onRelocate(f)}>Marcar en mapa</Button>
            </div>
          )}
        </Field>
        <Field label="Grano" className="span-2">
          <div className="chips-pick" role="radiogroup" aria-label="Grano">
            {GRANOS.map(g => (
              <button type="button" key={g} role="radio" aria-checked={f.grano === g} className={`pick ${f.grano === g ? 'is-on' : ''}`} disabled={!canEdit} onClick={() => setF(x => ({ ...x, grano: g }))}>{g}</button>
            ))}
          </div>
        </Field>
        {f.grano === 'Otro' && (
          <Field label="¿Qué grano?" className="span-2"><TextInput value={f.granoOtro} onChange={v => setF(x => ({ ...x, granoOtro: v.slice(0, 30) }))} placeholder="Ej: Colza, Arveja…" disabled={!canEdit} /></Field>
        )}
        <Field label="Kg (opcional)" className="span-2" error={err.kg} hint={!err.kg ? 'Si todavía no se conoce, dejalo vacío' : null}>
          <NumField value={f.kg} onChange={v => setF(x => ({ ...x, kg: v }))} unit="kg" conv={kgToT} label="Kilos" placeholder="Ej: 180.000" disabled={!canEdit} />
        </Field>
        <Field label="Humedad (opcional)" error={err.hum}>
          <NumField value={f.hum} onChange={v => setF(x => ({ ...x, hum: v }))} unit="%" decimals={1} maxDigits={2} label="Humedad" placeholder="Ej: 13,5" disabled={!canEdit} />
        </Field>
        <Field label="Salida">
          <button type="button" role="checkbox" aria-checked={!!f.prio} className={`check check-field ${f.prio ? 'is-on' : ''}`} disabled={!canEdit} onClick={() => setF(x => ({ ...x, prio: !x.prio }))}>
            <span className="check-box">{f.prio && <Icon name="check" size={14} />}</span>Prioridad de salida
          </button>
        </Field>
        <Field label="Foto" className="span-2">
          <div className="photo-box">
            {photoShown ? (
              <div className="photo-prev">
                {f.fotoData ? <img src={f.fotoData} alt="Foto del silo" /> : <PhotoView refPath={f.foto} />}
                {canEdit && <Button size="sm" variant="ghost" icon="trash" onClick={() => setF(x => ({ ...x, fotoData: null }))}>Quitar</Button>}
              </div>
            ) : <span className="muted small">Sin foto</span>}
            {canEdit && (
              <div className="row gap-s">
                <Button size="sm" icon="camera" onClick={() => cam.current.click()}>Tomar foto</Button>
                <Button size="sm" variant="ghost" icon="upload" onClick={() => gal.current.click()}>Galería</Button>
              </div>
            )}
            <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={pickFile} />
            <input ref={gal} type="file" accept="image/*" hidden onChange={pickFile} />
          </div>
        </Field>
        <Field label="Observaciones" className="span-2" hint="Para el supervisor: estado de la bolsa, cosecha, destino…">
          <KbTextArea value={f.obs} onChange={v => setF(x => ({ ...x, obs: v }))} rows={3} label="Observaciones" placeholder="Agregá la información que haga falta" disabled={!canEdit} />
        </Field>
      </div>
    </Modal>
  );
}

/* ---------- Tarjeta de información de un silo ---------- */
export const userName = (u, state) => (state.users || []).find(x => x.user === u)?.nombre || u || '—';
export function SiloCard({ silo: s, state, me, geo, onClose, onEdit, onMap }) {
  const lot = siloLot(s, state.lots);
  const canEdit = me.rol === 'admin' || s.creadoPor === me.user;
  const ll = s.latlng || (geo && s.map ? geo.toLatLng(s.map) : null), ll2 = s.latlng2 || (geo && s.map2 ? geo.toLatLng(s.map2) : null);
  const c = p => p.map(v => (+v).toFixed(6)).join(', ');
  const hasKg = s.kg != null && s.kg !== '';
  return (
    <Modal title={`Silobolsa ${s.id}`} subtitle={`${estanciaNombre(lot, state) || state.estancia.nombre} · ${lotName(s.lote)}`} onClose={onClose}
      footer={<><Button icon="map" onClick={() => onMap(s.id)}>Ver en el mapa</Button>{canEdit && <Button variant="primary" icon="edit" onClick={() => onEdit(s.id)}>Editar</Button>}</>}>
      <div className="silo-id" aria-label={`Número de silobolsa ${s.id}`}>
        <span className="silo-id-num mono">{s.id}</span>
        <div className="silo-id-parts">
          <span><b className="mono">{siglaOf(lot, state)}</b>{estanciaNombre(lot, state) || 'Sección'}</span>
          <span><b className="mono">{String(s.lote).padStart(2, '0')}</b>Lote</span>
          <span><b className="mono">{s.id.slice(-3)}</b>Bolsa</span>
        </div>
      </div>
      <dl className="card-facts">
        <div><dt>Sección</dt><dd>{estanciaNombre(lot, state) || state.estancia.nombre}</dd></div>
        <div><dt>Lote</dt><dd>{lotName(s.lote)}{lot?.ha ? <span className="muted"> · {fmtNum(lot.ha, 0)} ha</span> : null}</dd></div>
        <div><dt>Grano</dt><dd>{s.grano || '—'}</dd></div>
        <div><dt>Kilos</dt><dd>{hasKg ? <>{fmtKg(s.kg)} kg <span className="muted">· {fmtNum(s.kg / 1000, 1)} t</span></> : <span className="muted">Sin cargar</span>}</dd></div>
        <div><dt>Humedad</dt><dd>{s.hum != null ? `${fmtNum(s.hum, 1)} %` : <span className="muted">Sin medir</span>}</dd></div>
        <div><dt>Salida</dt><dd>{s.prio ? <span className="prio-tag">Prioritaria</span> : <span className="muted">Normal</span>}</dd></div>
        <div className="span-2"><dt>Lugar</dt><dd>{ll ? <>
          {s.largo ? <span>Bolsa de {fmtNum(s.largo)} m{s.gps ? ` · GPS ±${fmtNum(s.gps.acc)} m` : ''}</span> : <span>{s.origen === 'gps' ? `Punto GPS${s.gps ? ` ±${fmtNum(s.gps.acc)} m` : ''}` : 'Marcado en el mapa'}</span>}
          <span className="mono small muted">{ll2 ? `A ${c(ll)}` : c(ll)}</span>{ll2 && <span className="mono small muted">B {c(ll2)}</span>}
        </> : <span className="muted">Sin coordenadas</span>}</dd></div>
        <div><dt>Registrado</dt><dd>{fmtDate(s.creadoEn)}</dd></div>
        <div><dt>Usuario</dt><dd>{userName(s.creadoPor, state)}</dd></div>
        {s.editadoPor && s.editadoEn && s.editadoEn !== s.creadoEn && <div className="span-2"><dt>Última edición</dt><dd>{fmtDate(s.editadoEn)} · {userName(s.editadoPor, state)}</dd></div>}
        {s.obs && <div className="span-2"><dt>Observaciones</dt><dd className="card-obs">{s.obs}</dd></div>}
      </dl>
      {s.foto && <PhotoView refPath={s.foto} className="card-photo" />}
    </Modal>
  );
}

/* ---------- Configuración de lote ---------- */
export function LotModal({ lot, state, me, geo, store, onClose, onSaved, onShape }) {
  const toast = useToast();
  const isAdmin = me.rol === 'admin';
  // hectáreas con coma decimal (419,37): parseNum toma el punto como separador de miles
  const haTxt = v => (v == null || v === '' ? '' : fmtTyped(String(Math.round(+v * 100) / 100).replace('.', ','), 2));
  const [f, setF] = useState(() => ({ num: String(lot.num), nombre: lot.nombre || '', ha: haTxt(lot.ha), obs: lot.obs || '', subs: (lot.subs || []).map(s => ({ ...s, ha: haTxt(s.ha) })) }));
  const [busy, setBusy] = useState(false);
  const silos = state.silos.filter(s => s.lot === lot.id);
  const kg = silos.reduce((a, s) => a + (+s.kg || 0), 0);
  const measured = useMemo(() => areaHa(lot.poly, geo), [lot, geo]);
  const subSum = f.subs.reduce((a, s) => a + (parseNum(s.ha) || 0), 0);

  async function save() {
    const num = parseLotCode(f.num), ha = parseNum(f.ha);
    if (num === null) return toast('Escribí un número de 1 a 99 o un nombre con letras (ej. Casco)', 'error');
    if (!(ha > 0)) return toast('Ingresá las hectáreas', 'error');
    if (num !== lot.num && silos.length) return toast('El lote tiene silos registrados: no se puede cambiar su número', 'error');
    const subs = f.subs.map(s => ({ ...s, ha: parseNum(s.ha) }));
    if (subs.some(s => !(s.ha > 0))) return toast('Revisá las hectáreas de las subdivisiones', 'error');
    setBusy(true);
    try {
      const st = await store.saveLot({ _origNum: lot.num, _origId: lot.id, num, ha, nombre: f.nombre.trim(), obs: f.obs.trim(), subs }, me);
      toast(`${lotName(num)} guardado`, 'ok'); onSaved(st, lot.kml ? `${lot.kml}:${num}` : String(num));
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <Modal title={lotName(lot.num)} subtitle={lot.nombre || (isSiloLot(lot) ? 'Configuración del lote' : 'Lote sin silobolsas')} onClose={onClose}
      footer={<>{isAdmin && onShape && <Button variant="ghost" icon="edit" className="foot-left" onClick={() => onShape(lot.id)}>Ajustar forma</Button>}<Button onClick={onClose}>{isAdmin ? 'Cancelar' : 'Cerrar'}</Button>{isAdmin && <Button variant="primary" icon="check" onClick={save} disabled={busy}>Guardar</Button>}</>}>
      <div className="stat-row">
        <div><span className="muted small">Silobolsas</span><b>{silos.length}</b></div>
        <div><span className="muted small">Kg almacenados</span><b>{fmtKg(kg)}</b></div>
        <div><span className="muted small">Sup. medida</span><b>{measured ? `${fmtNum(measured)} ha` : '—'}</b></div>
      </div>
      <div className="form-grid">
        <Field label="Número o nombre del lote" hint={/^\d+$/.test(f.num.trim()) ? 'Con número: recibe silobolsas' : 'Con letras (ej. Casco): no recibe silobolsas'}><TextInput value={f.num} onChange={v => setF(x => ({ ...x, num: v.slice(0, 16) }))} disabled={!isAdmin} /></Field>
        <Field label="Hectáreas" hint={f.subs.length ? `Suma de subdivisiones: ${fmtNum(subSum)} ha` : null}><NumField value={f.ha} onChange={v => setF(x => ({ ...x, ha: v }))} unit="ha" decimals={2} maxDigits={5} label="Hectáreas" disabled={!isAdmin} /></Field>
        <Field label="Nombre o referencia" className="span-2"><TextInput value={f.nombre} onChange={v => setF(x => ({ ...x, nombre: v }))} placeholder="Ej: Lote del molino" disabled={!isAdmin} /></Field>
        {f.subs.map((s, i) => (
          <Field key={s.id} label={`Subdivisión ${lot.num}${s.id} · ha`}>
            <NumField value={s.ha} unit="ha" decimals={2} maxDigits={5} label={`Hectáreas · ${s.nombre || `subdivisión ${i + 1}`}`} disabled={!isAdmin} onChange={v => setF(x => ({ ...x, subs: x.subs.map((y, j) => (j === i ? { ...y, ha: v } : y)) }))} />
          </Field>
        ))}
        <Field label="Observaciones" className="span-2"><KbTextArea value={f.obs} onChange={v => setF(x => ({ ...x, obs: v }))} rows={2} label="Observaciones" disabled={!isAdmin} /></Field>
      </div>
      {!isAdmin && <p className="muted small">Solo el administrador puede modificar los datos del lote.</p>}
      {isAdmin && <p className="muted small">«Ajustar forma» abre el lote sobre la imagen satelital para mover sus vértices y corregir desfasajes.{lot.poly0 ? ' Este lote ya tiene la forma ajustada.' : ''}</p>}
    </Modal>
  );
}

/* ---------- Editar nombre y fecha de un mapa ---------- */
export function EditMapModal({ map, me, store, onClose, onSaved }) {
  const toast = useToast();
  const [f, setF] = useState({ nombre: map.nombre, fecha: map.fecha ? fmtFecha(map.fecha) : '' });
  const [confirm, setConfirm] = useState(false);
  async function save() {
    const fecha = f.fecha ? parseFecha(f.fecha) : null;
    if (f.fecha && !fecha) return toast('Fecha inválida (dd/mm/aaaa)', 'error');
    try { onSaved(await store.saveMap({ ...map, nombre: f.nombre.trim() || map.nombre, fecha }, me)); toast('Mapa actualizado', 'ok'); } catch (e) { toast(e.message, 'error'); }
  }
  async function del() {
    try { onSaved(await store.deleteMap(map.id, me)); toast('Mapa eliminado', 'ok'); } catch (e) { toast(e.message, 'error'); }
  }
  return (
    <Modal title="Editar mapa" subtitle={map.crs ? `Georreferenciado · ${map.crs}` : 'Ubicado a mano'} onClose={onClose}
      footer={confirm ? <><span className="foot-msg">¿Eliminar «{map.nombre}»?</span><Button onClick={() => setConfirm(false)}>No</Button><Button variant="danger" onClick={del}>Eliminar</Button></>
        : <><Button variant="ghost" icon="trash" className="foot-left" onClick={() => setConfirm(true)}>Eliminar</Button><Button onClick={onClose}>Cancelar</Button><Button variant="primary" icon="check" onClick={save}>Guardar</Button></>}>
      <div className="form-grid">
        <Field label="Nombre"><TextInput value={f.nombre} onChange={v => setF(x => ({ ...x, nombre: v }))} /></Field>
        <Field label="Fecha del vuelo / imagen" hint="dd/mm/aaaa"><TextInput value={f.fecha} onChange={v => setF(x => ({ ...x, fecha: v.replace(/[^\d/]/g, '').slice(0, 10) }))} inputMode="numeric" /></Field>
      </div>
    </Modal>
  );
}
