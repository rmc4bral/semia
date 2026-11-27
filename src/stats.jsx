import React, { useEffect, useMemo, useState } from 'react';
import { Field, Select, Icon, DateRange, dayOf, fmtDay, fmtNum } from './ui.jsx';
import { variedadesFiltro, PRIOS, prioOf, PrioTag } from './modals.jsx';
import { siloLot, isSiloLot, lotName, estanciaNombre } from './geo.js';

/* ---------- Estadísticas: resumen del acopio con anillos y gráficos propios (sin librerías) ---------- */
const t = kg => (+kg || 0) / 1000;
const sumT = arr => arr.reduce((a, s) => a + t(s.kg), 0);
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
// paleta propia: lima, tinta y sus mezclas (una sola tonalidad en toda la app)
const TONES = ['var(--accent)', 'var(--text)', 'color-mix(in srgb, var(--accent) 50%, var(--surface))', 'color-mix(in srgb, var(--text) 45%, var(--surface))', 'color-mix(in srgb, var(--accent) 22%, var(--surface))', 'var(--muted)'];
const PRIO_TONE = { alta: 'var(--accent)', media: 'color-mix(in srgb, var(--accent) 45%, var(--surface))', baja: 'var(--text)', sin: 'var(--line-2)' };

// los números suben al aparecer (una vez); respeta «reducir movimiento»
function useCount(target, ms = 900) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setV(target); return; }
    let raf, t0;
    const step = ts => { t0 = t0 || ts; const k = Math.min(1, (ts - t0) / ms); setV(target * (1 - Math.pow(1 - k, 3))); if (k < 1) raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
function Num({ v, d = 0, suffix = '' }) { const x = useCount(v); return <>{fmtNum(x, d)}{suffix}</>; }

// anillo de porcentaje que se completa al aparecer
function Ring({ pct, size = 112, stroke = 8, tone = 'var(--accent)', children, label }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r;
  const [on, setOn] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(id); }, []);
  return (
    <div className="ring" style={{ width: size, height: size }} role="img" aria-label={label}>
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={tone} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={on ? c * (1 - Math.max(0, Math.min(1, pct))) : c} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="ring-arc" />
      </svg>
      <div className="ring-in">{children}</div>
    </div>
  );
}

// anillo segmentado (variedades)
function Donut({ parts, size = 168, stroke = 14 }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, tot = parts.reduce((a, p) => a + p.v, 0) || 1, gap = parts.length > 1 ? 3 : 0;
  const [on, setOn] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(id); }, []);
  let acc = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} className="donut" aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
      {parts.map((p, i) => {
        const len = Math.max(0, (p.v / tot) * c - gap), off = acc; acc += (p.v / tot) * c;
        return <circle key={p.k} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.tone} strokeWidth={stroke}
          strokeDasharray={`${on ? len : 0} ${c}`} strokeDashoffset={-off} transform={`rotate(-90 ${size / 2} ${size / 2})`} className="ring-arc" style={{ transitionDelay: `${i * 80}ms` }} />;
      })}
    </svg>
  );
}

function Bars({ rows, unit = 't', d = 1, onRow }) {
  const max = Math.max(1e-9, ...rows.map(r => r.v));
  const [on, setOn] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(id); }, []);
  return (
    <div className="hbars">
      {rows.map((r, i) => (
        <button type="button" className="hbar" key={r.k} onClick={onRow ? () => onRow(r) : undefined} disabled={!onRow}>
          <span className="hbar-l">{r.label}{r.meta && <small className="muted">{r.meta}</small>}</span>
          <span className="hbar-track"><i style={{ width: on ? `${(r.v / max) * 100}%` : 0, background: r.tone || 'var(--accent)', transitionDelay: `${i * 50}ms` }} /></span>
          <b className="hbar-v">{fmtNum(r.v, d)} <span className="muted">{unit}</span></b>
        </button>
      ))}
    </div>
  );
}

function Columns({ cols, series, unit = 't', fmt = v => fmtNum(v, 0) }) {
  const max = Math.max(1e-9, ...cols.flatMap(c => series.map(s => c[s.k] || 0)));
  const [on, setOn] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setOn(true)); return () => cancelAnimationFrame(id); }, []);
  return (
    <div className="cols">
      <div className="cols-plot">
        {[1, .5, 0].map(g => <span key={g} className="cols-grid" style={{ bottom: `${g * 100}%` }}><em>{fmt(max * g)}</em></span>)}
        {cols.map((c, i) => (
          <div className="col" key={c.k} title={series.map(s => `${s.label}: ${fmt(c[s.k] || 0)} ${unit}`).join(' · ')}>
            {series.map(s => <i key={s.k} className={`col-bar is-${s.k}`} style={{ height: on ? `${((c[s.k] || 0) / max) * 100}%` : 0, transitionDelay: `${i * 40}ms` }} />)}
          </div>
        ))}
      </div>
      <div className="cols-x">{cols.map(c => <span key={c.k}>{c.label}</span>)}</div>
    </div>
  );
}

export function StatsScreen({ state, est = 'all', estOpts, onEst, inEst = () => true, onOpenSilo }) {
  const [rango, setRango] = useState(null), [grano, setGrano] = useState('all');
  const inRange = iso => { const d = dayOf(iso); return !rango || (d && d >= rango.desde && d <= (rango.hasta || rango.desde)); };
  const base = useMemo(() => state.silos.filter(s => inEst(siloLot(s, state.lots)) && (grano === 'all' || s.grano === grano)), [state.silos, state.lots, inEst, grano]);
  const emb = useMemo(() => base.filter(s => inRange(s.creadoEn)), [base, rango]); // eslint-disable-line
  const stock = emb.filter(s => !s.fin), ext = stock.filter(s => s.inicio);
  const desp = base.filter(s => s.fin && inRange(s.fin));
  const stockT = sumT(stock), despT = sumT(desp);
  // humedad promedio ponderada por kilos (si falta el peso, cuenta como una bolsa más)
  const conHum = stock.filter(s => s.hum != null);
  const wSum = conHum.reduce((a, s) => a + (+s.kg || 1), 0), humAvg = wSum ? conHum.reduce((a, s) => a + s.hum * (+s.kg || 1), 0) / wSum : null;
  const variedades = Object.entries(stock.reduce((m, s) => { const g = s.grano || 'Sin grano'; m[g] = (m[g] || 0) + t(s.kg); return m; }, {}))
    .sort((a, b) => b[1] - a[1]).map(([k, v], i) => ({ k, v, tone: TONES[i % TONES.length] }));
  const prio = ['alta', 'media', 'baja', 'sin'].map(k => {
    const ss = stock.filter(s => (prioOf(s.prio) || 'sin') === k);
    return { k, n: ss.length, t: sumT(ss), pct: stock.length ? ss.length / stock.length : 0 };
  });
  const lotes = Object.values(stock.reduce((m, s) => { const l = siloLot(s, state.lots); const k = l?.id || s.lot; (m[k] = m[k] || { k, label: lotName(s.lote), meta: est === 'all' && estOpts ? estanciaNombre(l, state) : '', v: 0, n: 0 }); m[k].v += t(s.kg); m[k].n++; return m; }, {}))
    .sort((a, b) => b.v - a.v).slice(0, 10).map(r => ({ ...r, meta: [r.meta, `${r.n} bolsa${r.n === 1 ? '' : 's'}`].filter(Boolean).join(' · ') }));
  // embolsado y despachado por mes (últimos 12 meses con datos dentro del período)
  const meses = useMemo(() => {
    const m = {};
    emb.forEach(s => { const k = (dayOf(s.creadoEn) || '').slice(0, 7); if (k) (m[k] = m[k] || { emb: 0, desp: 0 }).emb += t(s.kg); });
    desp.forEach(s => { const k = s.fin.slice(0, 7); (m[k] = m[k] || { emb: 0, desp: 0 }).desp += t(s.kg); });
    const keys = Object.keys(m).sort();
    if (!keys.length) return [];
    const out = [], [y0, m0] = keys[0].split('-').map(Number), [y1, m1] = keys[keys.length - 1].split('-').map(Number);
    for (let y = y0, mo = m0; y < y1 || (y === y1 && mo <= m1); mo === 12 ? (y++, mo = 1) : mo++) { const k = `${y}-${String(mo).padStart(2, '0')}`; out.push({ k, label: MES[mo - 1], title: `${MES[mo - 1]} ${y}`, ...(m[k] || { emb: 0, desp: 0 }) }); }
    return out.slice(-12);
  }, [emb, desp]);
  const BINS = [['≤ 12 %', h => h <= 12], ['12–14 %', h => h > 12 && h <= 14], ['14–16 %', h => h > 14 && h <= 16], ['16–18 %', h => h > 16 && h <= 18], ['> 18 %', h => h > 18]];
  const humCols = BINS.map(([label, f]) => ({ k: label, label, n: conHum.filter(s => f(s.hum)).length }));
  const salidas = stock.filter(s => prioOf(s.prio) === 'alta').sort((a, b) => (a.hum ?? 99) - (b.hum ?? 99) || (+b.kg || 0) - (+a.kg || 0)).slice(0, 6);
  const periodo = rango ? (rango.hasta && rango.hasta !== rango.desde ? `${fmtDay(rango.desde)} al ${fmtDay(rango.hasta)}` : fmtDay(rango.desde)) : 'todo el período';
  const lotsWithSilos = state.lots.filter(l => isSiloLot(l) && inEst(l)).length;
  const k = `${est}|${grano}|${rango?.desde}|${rango?.hasta}`; // vuelve a animar al cambiar el filtro

  return (
    <div className="screen stats">
      <div className="screen-head"><div><h1>Estadísticas</h1><p className="muted">Embolsado de {periodo} · {stock.length} en stock · {desp.length} despachada{desp.length === 1 ? '' : 's'}</p></div></div>
      <div className={`filters stats-filters ${estOpts ? 'has-est' : ''}`}>
        {estOpts && <Field label="Sección"><Select value={est} options={estOpts} onChange={onEst} /></Field>}
        <Field label="Período"><DateRange value={rango} onChange={setRango} /></Field>
        <Field label="Variedad"><Select value={grano} options={[{ value: 'all', label: 'Todas' }, ...variedadesFiltro(state).map(g => ({ value: g, label: g }))]} onChange={setGrano} /></Field>
      </div>

      <div className="st-kpis" key={'k' + k}>
        <div className="st-kpi"><span>Silobolsas en stock</span><b><Num v={stock.length} /></b><small className="muted">{ext.length ? `${ext.length} en extracción · ` : ''}{lotsWithSilos} lotes</small></div>
        <div className="st-kpi"><span>Stock total</span><b><Num v={stockT} d={1} /> <em>t</em></b><small className="muted">{fmtNum(stockT * 1000)} kg</small></div>
        <div className="st-kpi"><span>Variedades</span><b><Num v={variedades.filter(v => v.k !== 'Sin grano').length} /></b><small className="muted">{variedades.slice(0, 3).map(v => v.k).join(' · ') || '—'}</small></div>
        <div className="st-kpi"><span>Humedad promedio</span><b>{humAvg != null ? <><Num v={humAvg} d={1} /> <em>%</em></> : '—'}</b><small className="muted">{conHum.length ? `Ponderada por kg · ${conHum.length} de ${stock.length} medidas` : 'Sin mediciones'}</small></div>
        <div className="st-kpi"><span>Despachado</span><b><Num v={despT} d={1} /> <em>t</em></b><small className="muted">{desp.length} bolsa{desp.length === 1 ? '' : 's'} finalizada{desp.length === 1 ? '' : 's'}</small></div>
      </div>

      <div className="st-grid" key={'g' + k}>
        <section className="st-sec st-prio">
          <header><h2>Prioridad de salida</h2><p className="muted small">Porcentaje de las bolsas en stock</p></header>
          <div className="rings">
            {prio.filter(p => p.k !== 'sin').map(p => (
              <div className="ring-item" key={p.k}>
                <Ring pct={p.pct} tone={PRIO_TONE[p.k]} label={`Prioridad ${p.k}: ${Math.round(p.pct * 100)} %`}><b><Num v={p.pct * 100} /><em>%</em></b></Ring>
                <span className="ring-l"><PrioTag p={p.k} short /></span>
                <small className="muted">{p.n} bolsa{p.n === 1 ? '' : 's'} · {fmtNum(p.t, 1)} t</small>
              </div>
            ))}
          </div>
          {prio[3].n > 0 && <p className="muted small st-note">{prio[3].n} bolsa{prio[3].n === 1 ? '' : 's'} sin prioridad marcada ({fmtNum(prio[3].t, 1)} t).</p>}
        </section>

        <section className="st-sec st-var">
          <header><h2>Variedades</h2><p className="muted small">Toneladas en stock por grano</p></header>
          {variedades.length ? (
            <div className="donut-wrap">
              <div className="donut-box"><Donut parts={variedades} /><div className="donut-c"><b>{fmtNum(stockT, 0)}</b><span className="muted small">t en stock</span></div></div>
              <ul className="legend">{variedades.map(v => <li key={v.k}><i style={{ background: v.tone }} /><span>{v.k}</span><b>{stockT ? Math.round((v.v / stockT) * 100) : 0} %</b><small className="muted">{fmtNum(v.v, 1)} t</small></li>)}</ul>
            </div>
          ) : <p className="muted st-empty">Sin bolsas en stock para este filtro.</p>}
        </section>

        <section className="st-sec st-mes">
          <header><h2>Embolsado y despacho por mes</h2><p className="muted small"><i className="dot is-emb" />Embolsado <i className="dot is-desp" />Despachado · toneladas</p></header>
          {meses.length ? <Columns cols={meses} series={[{ k: 'emb', label: 'Embolsado' }, { k: 'desp', label: 'Despachado' }]} /> : <p className="muted st-empty">Sin registros en el período.</p>}
        </section>

        <section className="st-sec st-hum">
          <header><h2>Humedad al embolsar</h2><p className="muted small">Cantidad de bolsas en stock por rango</p></header>
          {conHum.length ? <Columns cols={humCols} series={[{ k: 'n', label: 'Bolsas' }]} unit="bolsas" /> : <p className="muted st-empty">Todavía no hay bolsas con humedad medida.</p>}
        </section>

        <section className="st-sec st-lotes">
          <header><h2>Toneladas por lote</h2><p className="muted small">Los 10 lotes con más stock</p></header>
          {lotes.length ? <Bars rows={lotes} /> : <p className="muted st-empty">Sin bolsas en stock.</p>}
        </section>

        <section className="st-sec st-sal">
          <header><h2>Próximas salidas</h2><p className="muted small">Prioridad alta, de menor a mayor humedad</p></header>
          {salidas.length ? (
            <div className="sal-list">
              {salidas.map((s, i) => (
                <button type="button" className="sal" key={s.id} onClick={() => onOpenSilo(s.id)}>
                  <span className="sal-n">{i + 1}</span>
                  <span className="sal-main"><b className="mono">{s.id}</b><small className="muted">{lotName(s.lote)} · {s.grano || 'Sin grano'}</small></span>
                  <span className="sal-v"><b>{s.hum != null ? `${fmtNum(s.hum, 1)} %` : '—'}</b><small className="muted">{fmtNum(t(s.kg), 1)} t</small></span>
                </button>
              ))}
            </div>
          ) : <p className="muted st-empty"><Icon name="flag" size={16} /> Marcá bolsas con prioridad alta para armar la cola de salida.</p>}
        </section>
      </div>
    </div>
  );
}
