// SemIA · importar lotes desde KML / KMZ (vista previa, numeración y confirmación)
import React, { useMemo, useRef, useState } from 'react';
import { Button, Field, TextInput, Icon, useToast, fmtNum, fmtDate } from './ui.jsx';
import { readKmlFile, parseKml, buildKmlImport } from './kml.js';

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
  const [job, setJob] = useState(null); // { file, parsed, rows, confirm, busy, err }
  const isKml = state.georef?.mode === 'kml';
  const g = state.georef?.kml;

  async function pick(file) {
    setJob({ file, busy: true });
    try {
      const parsed = parseKml(await readKmlFile(file));
      const rows = {};
      parsed.features.forEach(f => { rows[f.key] = { num: f.num ? String(f.num) : '', nombre: f.nombre || '', include: true }; });
      setJob({ file, parsed, rows });
    } catch (e) { setJob({ file, err: e.message || 'No se pudo leer el archivo' }); }
  }
  const setRow = (key, patch) => setJob(j => ({ ...j, confirm: false, rows: { ...j.rows, [key]: { ...j.rows[key], ...patch } } }));

  const check = useMemo(() => {
    if (!job?.parsed) return null;
    const lots = job.parsed.features.filter(f => !f.isOutline && job.rows[f.key].include);
    const nums = lots.map(f => job.rows[f.key].num.trim());
    const bad = lots.filter(f => { const n = +job.rows[f.key].num; return !(Number.isInteger(n) && n >= 1 && n <= 99); }).map(f => f.key);
    const dupNums = nums.filter((n, i) => n && nums.indexOf(n) !== i);
    const dup = lots.filter(f => dupNums.includes(job.rows[f.key].num.trim())).map(f => f.key);
    return { count: lots.length, bad, dup, ok: lots.length > 0 && !bad.length && !dup.length };
  }, [job]);

  async function apply() {
    if (!check?.ok) return;
    if (!job.confirm) { setJob(j => ({ ...j, confirm: true })); return; }
    setJob(j => ({ ...j, busy: true }));
    try {
      const rows = Object.entries(job.rows).map(([key, r]) => ({ key, num: +r.num, nombre: r.nombre, include: r.include }));
      const change = buildKmlImport(job.parsed, rows, state, geo, { archivo: job.file.name });
      const st = await store.importKml(change, me);
      onState(st); setJob(null);
      toast(`${change.lots.length} lotes cargados desde ${job.file.name}${state.silos.length ? ` · ${state.silos.length} silos reubicados` : ''}`, 'ok', 5000);
      if (change.sinCoord) toast(`${change.sinCoord} silos no tenían coordenadas: quedaron en el centro de su lote. Movelos desde su ficha.`, 'info', 7000);
      onShowLots?.();
    } catch (e) { setJob(j => ({ ...j, busy: false, confirm: false })); toast(e.message, 'error'); }
  }

  const f = job?.parsed?.features || [];
  return (
    <section className="card set-sec kml-sec">
      <div className="panel-head"><h3><Icon name="lots" size={18} /> Lotes desde KML</h3>{isKml && <span className="badge badge-ok">KML</span>}</div>
      <p className="muted small">
        {isKml ? <>Lotes actuales: <b>{g?.archivo || 'KML'}</b> · {g?.lotes} lotes · {fmtDate(g?.fecha)}. Están en coordenadas reales: no hacen falta puntos de control.</>
          : <>Los lotes actuales vienen del plano digitalizado. Cargá un KML o KMZ (Google Earth, QGIS, Pix4Dfields) para usar los límites reales de cada lote.</>}
      </p>
      {!job && (
        <button type="button" className="dropzone" onClick={() => inp.current.click()}>
          <Icon name="upload" size={26} /><b>{isKml ? 'Reemplazar con otro KML' : 'Elegir KML o KMZ'}</b><span className="muted small">Cada polígono es un lote · el número se toma del nombre</span>
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
          <Preview features={f} rows={job.rows} />
          <div className="kml-list" role="list">
            {f.map(x => {
              const r = job.rows[x.key], err = check.bad.includes(x.key) ? 'Número 1 a 99' : check.dup.includes(x.key) ? 'Repetido' : null;
              return (
                <div key={x.key} className={`kml-row ${r.include ? '' : 'is-off'}`} role="listitem">
                  <button type="button" className={`tick ${r.include ? 'is-on' : ''}`} onClick={() => setRow(x.key, { include: !r.include })} aria-pressed={r.include} aria-label={`${r.include ? 'Excluir' : 'Incluir'} ${x.name}`}><Icon name="check" size={14} /></button>
                  {x.isOutline ? (
                    <div className="kml-row-main"><b>Contorno del campo</b><span className="muted small">{x.name} · {fmtNum(x.ha)} ha</span></div>
                  ) : (
                    <>
                      <Field label="Lote" error={r.include ? err : null} className="kml-num"><TextInput value={r.num} onChange={v => setRow(x.key, { num: v.replace(/\D/g, '').slice(0, 2) })} inputMode="numeric" disabled={!r.include} aria-label={`Número de lote para ${x.name}`} /></Field>
                      <div className="kml-row-main"><b>{x.name}</b><span className="muted small">{fmtNum(x.haKml ?? x.ha, 1)} ha{x.haKml != null && Math.abs(x.haKml - x.ha) > x.ha * 0.05 ? ` (medido ${fmtNum(x.ha, 1)})` : ''}{x.folder ? ` · ${x.folder}` : ''}{x.multi ? ' · varias partes: se usa la mayor' : ''}</span></div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {job.confirm && (
            <p className="kml-confirm"><Icon name="alert" size={16} />
              Se reemplazan los {state.lots.length} lotes actuales por {check.count}. {state.silos.length ? `Los ${state.silos.length} silos se reubican por sus coordenadas.` : ''} Se borran los puntos de control y las subdivisiones.
            </p>
          )}
          <div className="row end gap-s">
            <Button onClick={() => setJob(null)} disabled={job.busy}>Cancelar</Button>
            <Button variant="primary" icon="check" onClick={apply} disabled={!check.ok || job.busy}>{job.busy ? 'Cargando…' : job.confirm ? 'Confirmar reemplazo' : `Usar ${check.count} lotes`}</Button>
          </div>
        </div>
      )}
    </section>
  );
}
