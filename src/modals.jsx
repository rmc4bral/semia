import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Button, Field, TextInput, TextArea, Select, Icon, useToast, fmtKg, fmtDate, fmtNum, parseNum } from './ui.jsx';
import { nextSiloId, snapToBorder, areaHa, pointInPoly } from './geo.js';
import { resolvePhoto } from './store.js';

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
export function SiloModal({ draft, state, me, geo, store, onClose, onSaved, onRelocate, onStartMove }) {
  const toast = useToast();
  const isNew = !draft.prevId;
  const isAdmin = me.rol === 'admin';
  const canEdit = isNew || isAdmin || draft.creadoPor === me.user;
  const [f, setF] = useState(() => ({ ...draft, kg: draft.kg ?? '', obs: draft.obs ?? '', grano: draft.grano ?? '' }));
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const cam = useRef(null), gal = useRef(null);
  const sigla = state.estancia.sigla || 'RB';
  const lotOpts = state.lots.map(l => ({ value: l.num, label: `Lote ${l.num}`, meta: `${l.ha} ha` }));
  const lot = state.lots.find(l => l.num === f.lote);

  // ID automático según lote
  useEffect(() => {
    if (isNew || f.lote !== draft.lote) setF(x => ({ ...x, id: nextSiloId(sigla, x.lote, state.silos, draft.prevId) }));
    else setF(x => ({ ...x, id: draft.prevId }));
  }, [f.lote]); // eslint-disable-line

  const changeLot = num => {
    const l = state.lots.find(x => x.num === num);
    const base = f.rawMap || f.map;
    const sn = base && l ? snapToBorder(base, l.poly) : null;
    setF(x => ({ ...x, lote: num, ...(sn ? { map: sn.point, t: sn.t, ang: sn.angle } : {}) }));
  };

  const pickFile = async e => {
    const file = e.target.files?.[0]; e.target.value = '';
    if (!file) return;
    try { const d = await compressImage(file); setF(x => ({ ...x, fotoData: d })); } catch (err) { toast(err.message, 'error'); }
  };

  const kgNum = parseNum(f.kg);
  const err = { kg: f.kg !== '' && (isNaN(kgNum) || kgNum < 0) ? 'Ingresá un número válido' : null };

  async function save() {
    if (!lot) return toast('Elegí un lote', 'error');
    if (!f.map) return toast('Falta la ubicación del silo', 'error');
    if (f.kg === '' || err.kg) return toast('Ingresá los kg del silo', 'error');
    setBusy(true);
    try {
      const id = isNew || f.lote !== draft.lote ? nextSiloId(sigla, f.lote, state.silos, draft.prevId) : draft.prevId;
      let foto = f.fotoData === null ? null : f.foto || null;
      if (f.fotoData) foto = await store.uploadPhoto(id, f.fotoData);
      const silo = {
        id, lote: f.lote, kg: kgNum, grano: f.grano || '', obs: (f.obs || '').trim(), foto,
        map: f.map.map(v => Math.round(v * 100) / 100), t: Math.round(f.t * 100) / 100, ang: Math.round(f.ang * 1e4) / 1e4,
        latlng: geo ? geo.toLatLng(f.map).map(v => +v.toFixed(7)) : (draft.latlng || null),
        gps: f.gps || null, origen: f.origen || 'mapa',
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
    <Modal title={isNew ? 'Nueva silobolsa' : `Silobolsa ${draft.prevId}`} subtitle={isNew ? 'Se ubica sobre el borde del lote' : `Registrada ${fmtDate(draft.creadoEn)} por ${draft.creadoPor || '—'}`}
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
      <div className="form-grid">
        <Field label="ID de silo" hint={`${sigla} · lote ${String(f.lote).padStart(2, '0')} · bolsa ${String(f.id || '').slice(-3)}`}>
          <div className="input input-static mono">{f.id}</div>
        </Field>
        <Field label="Lote">
          <Select value={f.lote} options={lotOpts} onChange={changeLot} disabled={!canEdit} />
        </Field>
        <Field label="Kg" error={err.kg}>
          <TextInput value={f.kg} onChange={v => setF(x => ({ ...x, kg: v }))} numeric placeholder="Ej: 180000" disabled={!canEdit} />
        </Field>
        <Field label="Grano">
          <Select value={f.grano} options={[{ value: '', label: 'Sin especificar' }, ...GRANOS.map(g => ({ value: g, label: g }))]} onChange={v => setF(x => ({ ...x, grano: v }))} disabled={!canEdit} />
        </Field>
        <Field label="Observación" className="span-2">
          <TextArea value={f.obs} onChange={v => setF(x => ({ ...x, obs: v }))} rows={3} placeholder="Estado de la bolsa, cosecha, destino…" disabled={!canEdit} />
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
        <Field label="Ubicación" className="span-2">
          <div className="loc-box">
            <Icon name={f.origen === 'gps' ? 'gps' : 'pin'} size={18} />
            <div className="loc-txt">
              {f.origen === 'gps' && f.gps ? <span>GPS ±{fmtNum(f.gps.acc)} m · ajustado al borde del lote {f.lote}{insideLot === false ? ' (fuera del lote, se tomó el borde más cercano)' : ''}</span>
                : <span>Marcado en el mapa · borde del lote {f.lote}</span>}
              {geo && f.map && <span className="muted small mono">{geo.toLatLng(f.map).map(v => v.toFixed(6)).join(', ')}</span>}
            </div>
            {canEdit && isNew && <Button size="sm" variant="ghost" onClick={() => onRelocate(f)}>Marcar en mapa</Button>}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

/* ---------- Configuración de lote ---------- */
export function LotModal({ lot, state, me, geo, store, onClose, onSaved }) {
  const toast = useToast();
  const isAdmin = me.rol === 'admin';
  const [f, setF] = useState(() => ({ num: String(lot.num), nombre: lot.nombre || '', ha: String(lot.ha), obs: lot.obs || '', subs: (lot.subs || []).map(s => ({ ...s, ha: String(s.ha) })) }));
  const [busy, setBusy] = useState(false);
  const silos = state.silos.filter(s => s.lote === lot.num);
  const kg = silos.reduce((a, s) => a + (+s.kg || 0), 0);
  const measured = useMemo(() => areaHa(lot.poly, geo), [lot, geo]);
  const subSum = f.subs.reduce((a, s) => a + (parseNum(s.ha) || 0), 0);

  async function save() {
    const num = parseInt(f.num, 10), ha = parseNum(f.ha);
    if (!(num > 0 && num < 100)) return toast('El número de lote debe ser entre 1 y 99', 'error');
    if (!(ha > 0)) return toast('Ingresá las hectáreas', 'error');
    if (num !== lot.num && silos.length) return toast('El lote tiene silos registrados: no se puede cambiar su número', 'error');
    const subs = f.subs.map(s => ({ ...s, ha: parseNum(s.ha) }));
    if (subs.some(s => !(s.ha > 0))) return toast('Revisá las hectáreas de las subdivisiones', 'error');
    setBusy(true);
    try {
      const st = await store.saveLot({ _origNum: lot.num, num, ha, nombre: f.nombre.trim(), obs: f.obs.trim(), subs }, me);
      toast(`Lote ${num} guardado`, 'ok'); onSaved(st, num);
    } catch (e) { toast(e.message, 'error'); } finally { setBusy(false); }
  }

  return (
    <Modal title={`Lote ${lot.num}`} subtitle={lot.nombre || 'Configuración del lote'} onClose={onClose}
      footer={<><Button onClick={onClose}>{isAdmin ? 'Cancelar' : 'Cerrar'}</Button>{isAdmin && <Button variant="primary" icon="check" onClick={save} disabled={busy}>Guardar</Button>}</>}>
      <div className="stat-row">
        <div><span className="muted small">Silobolsas</span><b>{silos.length}</b></div>
        <div><span className="muted small">Kg almacenados</span><b>{fmtKg(kg)}</b></div>
        <div><span className="muted small">Sup. medida</span><b>{measured ? `${fmtNum(measured)} ha` : '—'}</b></div>
      </div>
      <div className="form-grid">
        <Field label="Número de lote"><TextInput value={f.num} onChange={v => setF(x => ({ ...x, num: v.replace(/\D/g, '').slice(0, 2) }))} numeric disabled={!isAdmin} /></Field>
        <Field label="Hectáreas" hint={f.subs.length ? `Suma de subdivisiones: ${fmtNum(subSum)} ha` : null}><TextInput value={f.ha} onChange={v => setF(x => ({ ...x, ha: v }))} numeric disabled={!isAdmin} /></Field>
        <Field label="Nombre o referencia" className="span-2"><TextInput value={f.nombre} onChange={v => setF(x => ({ ...x, nombre: v }))} placeholder="Ej: Lote del molino" disabled={!isAdmin} /></Field>
        {f.subs.map((s, i) => (
          <Field key={s.id} label={`Subdivisión ${lot.num}${s.id} · ha`}>
            <TextInput value={s.ha} numeric disabled={!isAdmin} onChange={v => setF(x => ({ ...x, subs: x.subs.map((y, j) => (j === i ? { ...y, ha: v } : y)) }))} />
          </Field>
        ))}
        <Field label="Observaciones" className="span-2"><TextArea value={f.obs} onChange={v => setF(x => ({ ...x, obs: v }))} rows={2} disabled={!isAdmin} /></Field>
      </div>
      {!isAdmin && <p className="muted small">Solo el administrador puede modificar los datos del lote.</p>}
    </Modal>
  );
}
