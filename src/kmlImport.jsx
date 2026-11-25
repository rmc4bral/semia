// SemIA · importar lotes desde KML / KMZ (vista previa, numeración y confirmación)
import React, { useMemo, useRef, useState } from 'react';
import { Button, Field, TextInput, Segmented, Icon, useToast, fmtNum, fmtDate } from './ui.jsx';
import { readKmlFile, parseKml, buildKmlImport, buildKmlRemove, buildKmlRename, kmlList } from './kml.js';
import { parseLotCode, lotKey, siglaDe } from './geo.js';

const RAD = Math.PI / 180;

function Preview({ features, rows }) {
  const inc = features.filter(f => rows[f.key]?.include);
  if (!inc.length) return null;
  const all = inc.flatMap(f => f.ring);
  const lat0 = all.reduce((a, p) => a + p[0], 0) / all.length, c = Math.cos(lat0 * RAD);
  const P = ([la, lo]) => [lo * c, -la];
  const xs = all.map(p => P(p)[0]), ys = all.map(p => P(p)[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = 320, H = Math.max(140, Math.min(300, (W * (y1 - y0)) / (x1 - x0 || 1))), pad = 10;
  const k = Math.min((W - pad * 2) / (x1 - x0 || 1), (H - pad * 2) / (y1 - y0 || 1));
  const T = p => { const [x, y] = P(p); return [pad + (x - x0) * k, pad + (y - y0) * k]; };
  return (
    <svg className="kml-prev" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Vista previa de los lotes del KML">
      {inc.map(f => {
        const pts = f.ring.map(T), cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
        const r = rows[f.key];
        return (
          <g key={f.key} className={f.isOutline ? 'is-outline' : ''}>
            <polygon points={pts.map(p => p.join(',')).join(' ')} />
            {!f.isOutline && <text x={cx} y={cy + 4}>{r.num || '?'}</text>}
          </g>
        );
      })}
    </svg>
  );
}

export function KmlImport({ state, me, geo, store, onState, onShowLots }) {
  const toast = useToast();
  const inp = useRef(null);
  const [job, setJob] = useState(null); // { file, parsed, rows, mode, confirm, busy, err }
  const [del, setDel] = useState(null), [ren, setRen] = useState(null); // ren: { id, nombre, sigla }
  const isKml = state.georef?.mode === 'kml';
  const list = kmlList(state);
  const existing = new Set(state.lots.map(l => lotKey(l.num)));

  async function pick(file) {
    setJob({ file, busy: true });
    try {
      const parsed = parseKml(await readKmlFile(file));
      const rows = {};
      parsed.features.forEach(f => { rows[f.key] = { num: f.num != null ? String(f.num) : '', nombre: f.nombre || '', include: true }; });
      const nombre = file.name.replace(/\.km[lz]$/i, '').replace(/[_-]+/g, ' ').trim().slice(0, 60);
      setJob({ file, parsed, rows, mode: isKml ? 'add' : 'replace', est: nombre, sigla: siglaDe(nombre), siglaTocada: false });
    } catch (e) { setJob({ file, err: e.message || 'No se pudo leer el archivo' }); }
  }
  const setRow = (key, patch) => setJob(j => ({ ...j, confirm: false, rows: { ...j.rows, [key]: { ...j.rows[key], ...patch } } }));
  const add = job?.mode === 'add';

  const check = useMemo(() => {
    if (!job?.parsed) return null;
    const lots = job.parsed.features.filter(f => !f.isOutline && job.rows[f.key].include);
    const code = f => parseLotCode(job.rows[f.key].num);
    const bad = lots.filter(f => code(f) === null).map(f => f.key);
    const ks = lots.map(f => (code(f) === null ? null : lotKey(code(f))));
    const dup = lots.filter((f, i) => ks[i] && ks.indexOf(ks[i]) !== ks.lastIndexOf(ks[i])).map(f => f.key);
    const taken = []; // cada KML es una estancia: los números pueden repetirse entre estancias
    const sig = (job.sigla || '').length >= 2 && !(add && list.some(k => k.sigla === job.sigla));
    return { count: lots.length, bad, dup, taken, sig, ok: lots.length > 0 && !bad.length && !dup.length && !!(job.est || '').trim() && sig };
  }, [job, state.lots]); // eslint-disable-line

  async function apply() {
    if (!check?.ok) return;
    if (!job.confirm) { setJob(j => ({ ...j, confirm: true })); return; }
    setJob(j => ({ ...j, busy: true }));
    try {
      const rows = Object.entries(job.rows).map(([key, r]) => ({ key, num: r.num, nombre: r.nombre, include: r.include }));
      const change = buildKmlImport(job.parsed, rows, state, geo, { archivo: job.file.name, mode: job.mode, nombre: job.est, sigla: job.sigla });
      const st = await store.importKml(change, me);
      onState(st); setJob(null);
      toast(change.mode === 'add' ? `Estancia ${change.estancia.nombre} (${change.estancia.sigla}) agregada con ${change.added} lotes`
        : `${change.lots.length} lotes cargados desde ${job.file.name}${state.silos.length ? ` · ${state.silos.length} silos reubicados` : ''}`, 'ok', 5000);
      if (change.sinCoord) toast(`${change.sinCoord} silos no tenían coordenadas: quedaron en el centro de su lote. Movelos desde su ficha.`, 'info', 7000);
      onShowLots?.();
    } catch (e) { setJob(j => ({ ...j, busy: false, confirm: false })); toast(e.message, 'error'); }
  }
  async function removeKml(id) {
    try {
      const change = buildKmlRemove(state, id);
      onState(await store.importKml(change, me)); setDel(null);
      toast('KML quitado junto con sus lotes', 'ok');
    } catch (e) { setDel(null); toast(e.message, 'error'); }
  }
  async function renameKml() {
    try { onState(await store.importKml(buildKmlRename(state, ren.id, { nombre: ren.nombre, sigla: ren.sigla }), me)); setRen(null); toast('Estancia actualizada', 'ok'); }
    catch (e) { toast(e.message, 'error'); }
  }

  const f = job?.parsed?.features || [];
  return (
    <section className="card set-sec kml-sec">
      <div className="panel-head"><h3><Icon name="lots" size={18} /> Estancias y lotes (KML)</h3>{isKml && <span className="badge badge-ok">{list.length} estancia{list.length === 1 ? '' : 's'} · {state.lots.length} lotes</span>}</div>
      {!isKml && <p className="muted small">Los lotes actuales vienen del plano digitalizado. El primer KML los reemplaza; después podés ir <b>agregando</b> más KML (otros campos o sectores) sin perder lo cargado.</p>}
      {isKml && (
        <div className="kml-files" role="list" aria-label="KML cargados">
          {list.map(k => (
            <div key={k.id} className="kml-file" role="listitem">
              <span className="kml-file-ic"><Icon name="lots" size={16} /></span>
              {ren?.id === k.id ? (
                <>
                  <div className="kml-ren">
                    <Field label="Estancia" className="grow"><TextInput value={ren.nombre} onChange={v => setRen(r => ({ ...r, nombre: v.slice(0, 60) }))} autoFocus /></Field>
                    <Field label="Sigla" className="kml-sigla"><TextInput value={ren.sigla} onChange={v => setRen(r => ({ ...r, sigla: v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4) }))} /></Field>
                    <div className="row gap-s"><Button size="sm" onClick={() => setRen(null)}>Cancelar</Button><Button size="sm" variant="primary" icon="check" onClick={renameKml}>Guardar</Button></div>
                  </div>
                </>
              ) : (
                <>
                  <div className="kml-row-main">
                    <b>{k.nombre} <span className="sig">{k.sigla}</span></b>
                    <span className="muted small">{k.archivo} · {k.lotes.length} lote{k.lotes.length === 1 ? '' : 's'}{k.lotes.length ? ` (${[...k.lotes].map(String).sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).join(', ')})` : ''}{k.fecha ? ` · ${fmtDate(k.fecha)}` : ''}</span>
                  </div>
                  {del === k.id ? (
                    <div className="row gap-s"><span className="small">{list.length === 1 ? '¿Quitar todos los lotes?' : '¿Quitar con sus lotes?'}</span><Button size="sm" onClick={() => setDel(null)}>No</Button><Button size="sm" variant="danger" onClick={() => removeKml(k.id)}>Quitar</Button></div>
                  ) : (
                    <div className="maps-act">
                      <Button size="sm" variant="ghost" icon="edit" onClick={() => setRen({ id: k.id, nombre: k.nombre, sigla: k.sigla })} aria-label={`Renombrar ${k.nombre}`} />
                      <Button size="sm" variant="ghost" icon="trash" onClick={() => setDel(k.id)} aria-label={`Quitar ${k.nombre} y sus lotes`} />
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}
      {!job && (
        <button type="button" className="dropzone" onClick={() => inp.current.click()}>
          <Icon name={isKml ? 'plus' : 'upload'} size={26} /><b>{isKml ? 'Agregar KML' : 'Elegir KML o KMZ'}</b><span className="muted small">Cada polígono es un lote · número (recibe silos) o nombre como «Casco»</span>
        </button>
      )}
      <input ref={inp} type="file" accept=".kml,.kmz,application/vnd.google-earth.kml+xml,application/vnd.google-earth.kmz" hidden onChange={e => { const fl = e.target.files?.[0]; e.target.value = ''; if (fl) pick(fl); }} />
      {job?.busy && !job.parsed && <div className="proc"><span className="spinner" />Leyendo {job.file.name}…</div>}
      {job?.err && (
        <>
          <div className="form-err"><Icon name="alert" size={16} />{job.err}</div>
          <div className="row end"><Button onClick={() => setJob(null)}>Cerrar</Button></div>
        </>
      )}
      {job?.parsed && (
        <div className="kml-job">
          <div className="kml-sum">
            <b>{job.file.name}</b>
            <span className="muted small">{f.filter(x => !x.isOutline).length} polígonos{f.some(x => x.isOutline) ? ' · contorno del campo' : ''}{job.parsed.lines.length ? ` · ${job.parsed.lines.length} líneas` : ''}</span>
          </div>
          <div className="kml-est">
            <Field label="Estancia" className="grow" error={!(job.est || '').trim() ? 'Escribí el nombre' : null}><TextInput value={job.est} onChange={v => setJob(j => ({ ...j, est: v.slice(0, 60), sigla: j.siglaTocada ? j.sigla : siglaDe(v), confirm: false }))} placeholder="Ej: Los Gatos" /></Field>
            <Field label="Sigla para silos" className="kml-sigla" hint={check.sig ? `Ej: ${job.sigla}31001` : null} error={!check.sig ? ((job.sigla || '').length < 2 ? '2 a 4 letras' : 'Ya existe') : null}><TextInput value={job.sigla} onChange={v => setJob(j => ({ ...j, sigla: v.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4), siglaTocada: true, confirm: false }))} /></Field>
          </div>
          {isKml && (
            <Field label="Qué hacer con los lotes actuales" hint={add ? `Se agrega como estancia nueva; los ${state.lots.length} lotes cargados no cambian.` : 'Se borran los lotes actuales y quedan solo los de este archivo.'}>
              <Segmented value={job.mode} onChange={m => setJob(j => ({ ...j, mode: m, confirm: false }))} options={[{ value: 'add', label: 'Agregar' }, { value: 'replace', label: 'Reemplazar todo' }]} />
            </Field>
          )}
          <Preview features={f} rows={job.rows} />
          <div className="kml-list" role="list">
            {f.map(x => {
              const r = job.rows[x.key];
              const err = check.bad.includes(x.key) ? 'Número 1–99 o nombre' : check.dup.includes(x.key) ? 'Repetido' : check.taken.includes(x.key) ? 'Ya existe' : null;
              const sinSilos = typeof parseLotCode(r.num) === 'string';
              return (
                <div key={x.key} className={`kml-row ${r.include ? '' : 'is-off'}`} role="listitem">
                  <button type="button" className={`tick ${r.include ? 'is-on' : ''}`} onClick={() => setRow(x.key, { include: !r.include })} aria-pressed={r.include} aria-label={`${r.include ? 'Excluir' : 'Incluir'} ${x.name}`}><Icon name="check" size={14} /></button>
                  {x.isOutline ? (
                    <div className="kml-row-main"><b>Contorno del campo</b><span className="muted small">{x.name} · {fmtNum(x.ha)} ha</span></div>
                  ) : (
                    <>
                      <Field label="Lote" error={r.include ? err : null} className="kml-num"><TextInput value={r.num} onChange={v => setRow(x.key, { num: v.slice(0, 16) })} disabled={!r.include} aria-label={`Número o nombre de lote para ${x.name}`} /></Field>
                      <div className="kml-row-main"><b>{x.name}</b><span className="muted small">{fmtNum(x.haKml ?? x.ha, 1)} ha{x.haKml != null && Math.abs(x.haKml - x.ha) > x.ha * 0.05 ? ` (medido ${fmtNum(x.ha, 1)})` : ''}{x.folder ? ` · ${x.folder}` : ''}{x.multi ? ' · varias partes: se usa la mayor' : ''}</span>{sinSilos && <span className="kml-tag">Sin silobolsas</span>}</div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {job.confirm && (
            <p className="kml-confirm"><Icon name="alert" size={16} />
              {add ? `Se agrega la estancia ${job.est} (${job.sigla}) con ${check.count} lotes. Los lotes y silos cargados no cambian.`
                : `Se reemplazan los ${state.lots.length} lotes actuales por ${check.count}. ${state.silos.length ? `Los ${state.silos.length} silos se reubican por sus coordenadas.` : ''} Se borran los puntos de control y las subdivisiones.`}
            </p>
          )}
          <div className="row end gap-s">
            <Button onClick={() => setJob(null)} disabled={job.busy}>Cancelar</Button>
            <Button variant="primary" icon={add ? 'plus' : 'check'} onClick={apply} disabled={!check.ok || job.busy}>
              {job.busy ? 'Cargando…' : job.confirm ? (add ? 'Confirmar' : 'Confirmar reemplazo') : add ? `Agregar ${check.count} lotes` : `Usar ${check.count} lotes`}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
