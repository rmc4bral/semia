// Teclados propios de Acopia (solo en pantallas táctiles; con teclado físico se escribe normal)
//  · NumField: teclado numérico con la conversión a toneladas (u otra) en vivo
//  · KbTextArea: teclado de texto en español (ñ, tildes, números y signos) con tecla «Sistema»
//    para volver al teclado del celular (dictado por voz)
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, fmtNum } from './ui.jsx';

const coarse = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const buzz = () => { try { navigator.vibrate?.(6); } catch { /* */ } };

// Mientras hay un teclado abierto, el contenido sube para no quedar tapado
function useDock(open, ref, fieldRef) {
  useEffect(() => {
    if (!open) return undefined;
    const set = () => {
      const h = ref.current?.offsetHeight || 0;
      document.documentElement.style.setProperty('--kb-h', `${h}px`);
      document.documentElement.classList.add('kb-open');
      // el campo que se está escribiendo queda a la vista, por encima del teclado
      requestAnimationFrame(() => fieldRef?.current?.scrollIntoView({ block: 'nearest' }));
    };
    set(); const id = setTimeout(set, 80), id2 = setTimeout(set, 260);
    return () => { clearTimeout(id); clearTimeout(id2); document.documentElement.classList.remove('kb-open'); document.documentElement.style.removeProperty('--kb-h'); };
  }, [open, ref, fieldRef]);
}
// Cerrar al tocar fuera del teclado y del campo
function useOutside(open, refs, onClose) {
  useEffect(() => {
    if (!open) return undefined;
    const h = e => { if (!refs.some(r => r.current && r.current.contains(e.target))) onClose(); };
    document.addEventListener('pointerdown', h, true);
    return () => document.removeEventListener('pointerdown', h, true);
  }, [open, onClose]); // eslint-disable-line
}
// Tecla: responde al apoyar el dedo (más rápido que el click) y no roba el foco
function Key({ k, label, wide, kind = '', onKey, repeat, aria }) {
  const t = useRef(null);
  const stop = () => { clearTimeout(t.current); clearInterval(t.current); };
  useEffect(() => stop, []);
  return (
    <button type="button" data-k={k} className={`kb-key ${kind} ${wide ? `w${wide}` : ''}`} aria-label={aria || (typeof label === 'string' ? label : k)}
      onPointerDown={e => { e.preventDefault(); buzz(); onKey(k); if (repeat) t.current = setTimeout(() => { t.current = setInterval(() => onKey(k), 70); }, 420); }}
      onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onKey(k); } }}>
      {label ?? k}
    </button>
  );
}

/* ---------- Números ---------- */
// «180000» → «180.000»; con decimales: «123,5»
export function fmtTyped(raw, decimals) {
  let [i, d] = String(raw ?? '').replace(/\./g, '').split(',');
  i = (i || '').replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const int = i ? i.replace(/\B(?=(\d{3})+(?!\d))/g, '.') : (d !== undefined ? '0' : '');
  if (!decimals || d === undefined) return int;
  return `${int},${(d || '').replace(/\D/g, '').slice(0, decimals)}`;
}
export const kgToT = n => `${fmtNum(n / 1000, n % 1000 ? (n < 100000 ? 2 : 1) : 0)} t`;

export function NumField({ value, onChange, unit, decimals = 0, maxDigits = 7, conv, placeholder, disabled, label, id }) {
  const [open, setOpen] = useState(false), [touch] = useState(coarse);
  const kb = useRef(null), field = useRef(null);
  useDock(open, kb, field);
  useOutside(open, [kb, field], () => setOpen(false));
  const raw = String(value ?? '');
  const n = raw === '' ? null : Number(raw.replace(/\./g, '').replace(',', '.'));
  const extra = n != null && isFinite(n) && conv ? conv(n) : null;
  function key(k) {
    let [i, d] = raw.replace(/\./g, '').split(',');
    i = i || '';
    if (k === 'del') { if (d !== undefined) d = d.length ? d.slice(0, -1) : undefined; else i = i.slice(0, -1); if (d === '' && raw.endsWith(',')) d = undefined; }
    else if (k === 'clr') { i = ''; d = undefined; }
    else if (k === ',') { if (decimals && d === undefined) d = ''; }
    else if (d !== undefined) { if (d.length < decimals) d += k; }
    else if ((i + k).replace(/^0+/, '').length <= maxDigits) i += k;
    const s = i === '' && d === undefined ? '' : fmtTyped(d === undefined ? i : `${i},${d}`, decimals);
    onChange(s);
  }
  return (
    <>
      <div className={`num-field ${open ? 'is-open' : ''}`} ref={field}>
        <input id={id} className="input num-input" value={raw} placeholder={placeholder} disabled={disabled}
          inputMode={touch ? 'none' : 'decimal'} readOnly={touch} autoComplete="off" aria-label={label}
          onFocus={() => touch && !disabled && setOpen(true)} onClick={() => touch && !disabled && setOpen(true)}
          onChange={e => onChange(fmtTyped(e.target.value.replace(decimals ? /[^\d,]/g : /\D/g, ''), decimals))} />
        {unit && <span className="num-unit">{unit}</span>}
      </div>
      {extra && <span className="num-conv">= {extra}</span>}
      {open && createPortal(
        <div className="kb kb-num" ref={kb} role="group" aria-label={`Teclado numérico${label ? ` · ${label}` : ''}`}>
          <div className="kb-display">
            <span className="kb-label">{label}</span>
            <b className="kb-val">{raw || '0'}<small>{unit}</small></b>
            <span className="kb-conv">{extra ? `= ${extra}` : ' '}</span>
          </div>
          <div className="kb-grid">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(d => <Key key={d} k={d} onKey={key} />)}
            {decimals ? <Key k="," onKey={key} kind="kb-soft" /> : <Key k="clr" label="Borrar" onKey={key} kind="kb-soft kb-small" />}
            <Key k="0" onKey={key} />
            <Key k="del" label={<Icon name="back" size={22} />} aria="Borrar último" onKey={key} repeat kind="kb-soft" />
          </div>
          <button type="button" className="kb-done" onPointerDown={e => { e.preventDefault(); setOpen(false); }}>Listo</button>
        </div>, document.body)}
    </>
  );
}

/* ---------- Texto ---------- */
const ROWS = {
  abc: [['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'], ['shift', 'z', 'x', 'c', 'v', 'b', 'n', 'm', '´', 'del'], ['num', ',', 'space', '.', 'enter']],
  num: [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['-', '/', ':', ';', '(', ')', '$', '@', '"', '%'], ['+', '=', '#', '¿', '?', '¡', '!', "'", 'kg', 'del'], ['abc', ',', 'space', '.', 'enter']],
};
const ACC = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' };

export function KbTextArea({ value, onChange, rows = 3, placeholder, disabled, maxLength = 600, label }) {
  const [open, setOpen] = useState(false), [touch] = useState(coarse), [sys, setSys] = useState(false);
  const [layer, setLayer] = useState('abc'), [shift, setShift] = useState(false), [dead, setDead] = useState(false);
  const kb = useRef(null), field = useRef(null), ta = useRef(null);
  const custom = touch && !sys;
  useDock(open && custom, kb, field);
  useOutside(open && custom, [kb, field], () => setOpen(false));
  const txt = String(value ?? '');
  // mayúscula automática al empezar y después de un punto
  const autoCap = !txt.trim() || /[.!?¡¿]\s+$|\n\s*$/.test(txt);
  const upper = shift || autoCap;
  useEffect(() => { if (open && custom) { const el = ta.current; if (el) { el.scrollTop = el.scrollHeight; } } }, [txt, open, custom]);
  function put(s) { onChange((txt + s).slice(0, maxLength)); }
  function key(k) {
    if (k === 'shift') return setShift(v => !v);
    if (k === 'num' || k === 'abc') return setLayer(k === 'num' ? 'num' : 'abc');
    if (k === 'del') return onChange(txt.slice(0, -1));
    if (k === '´') return setDead(v => !v);
    if (k === 'space') { setDead(false); return put(' '); }
    if (k === 'enter') { setDead(false); return put('\n'); }
    if (k === 'kg') return put(' kg');
    let c = k;
    if (layer === 'abc' && upper) c = c.toUpperCase();
    if (dead) { c = ACC[c] || c; setDead(false); }
    put(c); setShift(false);
  }
  function goSystem() { setSys(true); setOpen(false); setTimeout(() => { ta.current?.focus(); }, 30); }
  const lbl = k => ({ shift: <Icon name="shift" size={20} />, del: <Icon name="back" size={20} />, num: '123', abc: 'ABC', space: 'espacio', enter: <Icon name="enter" size={20} />, '´': '´' }[k] ?? (layer === 'abc' && upper && k.length === 1 ? k.toUpperCase() : dead && ACC[k] ? ACC[k] : k));
  return (
    <>
      <div className={`kb-text-field ${open && custom ? 'is-open' : ''}`} ref={field}>
        <textarea ref={ta} className="input textarea" value={txt} rows={rows} placeholder={placeholder} disabled={disabled} aria-label={label}
          inputMode={custom ? 'none' : undefined} readOnly={custom} maxLength={maxLength}
          onFocus={() => custom && !disabled && setOpen(true)} onClick={() => custom && !disabled && setOpen(true)}
          onBlur={() => { if (sys) setSys(false); }}
          onChange={e => onChange(e.target.value)} />
      </div>
      {open && custom && createPortal(
        <div className="kb kb-text" ref={kb} role="group" aria-label={`Teclado Acopia${label ? ` · ${label}` : ''}`}>
          <div className="kb-bar">
            <span className="kb-label">{label}</span>
            <span className="kb-count">{txt.length}/{maxLength}</span>
            <button type="button" className="kb-bar-btn" onPointerDown={e => { e.preventDefault(); goSystem(); }}><Icon name="mic" size={16} />Sistema</button>
            <button type="button" className="kb-bar-btn is-done" onPointerDown={e => { e.preventDefault(); setOpen(false); }}>Listo</button>
          </div>
          {ROWS[layer].map((r, i) => (
            <div className="kb-row" key={i}>
              {r.map(k => (
                <Key key={k} k={k} label={lbl(k)} onKey={key} repeat={k === 'del'}
                  aria={{ shift: 'Mayúscula', del: 'Borrar', space: 'Espacio', enter: 'Nueva línea', '´': 'Tilde', num: 'Números y signos', abc: 'Letras' }[k]}
                  wide={k === 'space' ? 5 : ['shift', 'del', 'num', 'abc', 'enter'].includes(k) ? 1.5 : null}
                  kind={`${['shift', 'del', 'num', 'abc', '´', 'enter'].includes(k) ? 'kb-soft' : ''} ${(k === 'shift' && shift) || (k === '´' && dead) ? 'is-on' : ''} ${k === 'enter' ? 'kb-accent' : ''}`} />
              ))}
            </div>
          ))}
        </div>, document.body)}
    </>
  );
}
