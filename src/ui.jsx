import React, { useEffect, useRef, useState, createContext, useContext, useCallback } from 'react';
import { createPortal } from 'react-dom';

/* ---------- Íconos (trazo 1.75, 24×24) ---------- */
const P = {
  map: 'M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Zm0 0v13.5m6-11v13.5',
  sat: 'M4.5 13.5 10.5 7.5m-6 6 3 3m-3-3 1.5-1.5m4.5-4.5 3 3m-3-3L12 6m1.5 4.5-6 6m6-6 1.5-1.5m-7.5 7.5L6 18m10.5-6a4.5 4.5 0 0 1-4.5 4.5m7.5-4.5A7.5 7.5 0 0 1 12 19.5',
  cube: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Zm0 0v0M4 7.5l8 4.5 8-4.5M12 12v9',
  // silobolsa: boca en arco al frente y cuerpo largo y bajo apoyado en el suelo
  silo: 'M2.5 19c0-5.5 1.8-9.5 4-9.5s4 4 4 9.5M6.5 9.5h10c3 0 5 4.2 5 9.5M2 19h20',
  lots: 'M4 4h7v7H4V4Zm9 0h7v4h-7V4Zm0 6h7v10h-7V10ZM4 13h7v7H4v-7Z',
  users: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm13 9v-1a4 4 0 0 0-3-3.9M16 3.1a3.5 3.5 0 0 1 0 6.8',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h5l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  plus: 'M12 5v14M5 12h14',
  gps: 'M12 19a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm0-4a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0-13v3m0 14v3M2 12h3m14 0h3',
  pin: 'M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 1 1 13 0c0 5.4-6.5 11-6.5 11Zm0-8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0-14v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12.5 4.5 4.5L19 7.5',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4V8Zm8 9a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  trash: 'M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3',
  move: 'M12 3v18M3 12h18M12 3 9.5 5.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Zm9-13 4 4',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 2-4-4',
  download: 'M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M4 19h16',
  upload: 'M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M4 19h16',
  zin: 'M12 6v12M6 12h12',
  zout: 'M6 12h12',
  rotl: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4',
  rotr: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4',
  target: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  chev: 'm6 9 6 6 6-6',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Zm9.5 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeoff: 'M3 3l18 18M10.6 6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.1 9.5 6.1a17 17 0 0 1-2.6 3.3M6.6 6.6C4 8.3 2.5 12 2.5 12S6 18.1 12 18.1c1.8 0 3.3-.5 4.6-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-10v6m0-9.5v.5',
  alert: 'M12 4 2.5 20h19L12 4Zm0 6v4.5m0 2.5v.5',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.5m-.5 6h.5m-.5 6h.5',
  back: 'M21 6H9l-6 6 6 6h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1Zm-4 3-6 6m0-6 6 6',
  shift: 'M12 4 4 12h4.5v7h7v-7H20Z',
  enter: 'M20 5v7a3 3 0 0 1-3 3H5m0 0 4-4m-4 4 4 4',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Zm-7 9a7 7 0 0 0 14 0M12 19v2',
  navi: 'M12 3 19 20 12 16 5 20Z',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
};
export function Icon({ name, size = 20, className = '', ...rest }) {
  return (
    <svg className={`ic ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={P[name] || ''} />
    </svg>
  );
}

/* ---------- Logo acopia (marca enderezada: bordes verticales) ---------- */
export const LOGO_PATH = 'M0.08 22.33Q0.16 23.37 0.56 23.72Q0.96 24.07 1.52 24.31Q2.08 24.55 3.12 24.49Q4.16 24.44 5.66 24.12Q7.15 23.80 12.22 22.39Q17.29 20.97 19.26 20.25Q21.24 19.53 24.76 18.01Q28.28 16.49 32.60 14.30Q36.93 12.11 39.65 10.33Q42.37 8.54 43.65 7.58Q44.93 6.62 46.85 4.78Q48.77 2.93 48.99 2.64Q49.20 2.35 49.25 1.84Q49.31 1.33 49.09 1.07Q48.88 0.80 48.48 0.59Q48.08 0.37 47.23 0.21Q46.37 0.05 25.13 0.05Q3.90 0.05 2.83 0.16Q1.76 0.27 1.33 0.53Q0.91 0.80 0.53 1.28Q0.16 1.76 0.19 4.54Q0.21 7.31 0.11 8.64Q0.00 9.98 0.08 13.71Q0.16 17.45 0.08 19.37Q0.00 21.29 0.08 22.33ZM106.94 1.68Q106.78 1.23 106.43 0.93Q106.08 0.64 105.60 0.45Q105.12 0.27 104.06 0.16Q102.99 0.05 89.25 0.08Q75.51 0.11 73.99 0.43Q72.47 0.75 71.37 1.23Q70.28 1.71 69.69 2.16Q69.10 2.61 67.18 4.67Q65.26 6.72 63.85 8.72Q62.43 10.73 61.26 13.13Q60.09 15.53 58.67 19.50Q57.26 23.48 56.83 24.17Q56.40 24.87 56.08 25.72Q55.76 26.57 54.54 28.68Q53.31 30.79 51.92 32.82Q50.53 34.85 49.60 35.91Q48.67 36.98 48.35 37.49Q48.03 37.99 45.41 40.85Q42.80 43.70 41.54 44.93Q40.29 46.16 37.78 48.32Q35.27 50.48 32.47 52.56Q29.67 54.64 26.92 56.40Q24.17 58.16 21.29 59.82Q18.41 61.47 16.57 62.38Q14.73 63.29 11.05 64.89Q7.36 66.49 5.79 67.00Q4.22 67.50 3.23 68.04Q2.24 68.57 1.97 68.81Q1.71 69.05 1.49 69.45Q1.28 69.85 1.15 70.41Q1.01 70.97 1.07 74.84Q1.12 78.71 1.01 80.07Q0.91 81.43 0.93 83.64Q0.96 85.86 1.09 86.69Q1.23 87.51 1.12 92.32Q1.01 97.12 1.09 97.41Q1.17 97.71 1.52 98.16Q1.87 98.61 2.75 99.25Q3.63 99.89 8.96 99.87Q14.30 99.84 15.07 99.71Q15.85 99.57 17.90 98.43Q19.96 97.28 21.69 96.02Q23.43 94.77 26.52 92.18Q29.62 89.59 32.34 86.85Q35.06 84.10 37.11 81.56Q39.17 79.03 40.90 76.60Q42.64 74.17 44.18 71.58Q45.73 69.00 47.20 66.04Q48.67 63.07 50.21 59.23Q51.76 55.39 52.00 55.02Q52.24 54.64 52.35 54.00Q52.45 53.36 54.94 46.53Q57.42 39.70 57.74 39.14Q58.06 38.58 58.67 36.85Q59.28 35.11 60.70 32.50Q62.11 29.88 63.39 28.01Q64.67 26.15 65.74 24.97Q66.81 23.80 67.18 23.24Q67.56 22.68 68.89 21.34Q70.22 20.01 71.99 18.60Q73.75 17.18 75.77 15.88Q77.80 14.57 79.72 13.58Q81.64 12.59 83.72 11.66Q85.81 10.73 89.06 9.55Q92.32 8.38 95.52 7.55Q98.72 6.72 101.01 6.30Q103.31 5.87 104.35 5.52Q105.39 5.18 106.22 4.46Q107.04 3.74 107.07 2.93Q107.10 2.13 106.94 1.68ZM105.15 37.43Q104.70 37.03 103.60 36.66Q102.51 36.29 101.68 36.31Q100.85 36.34 98.77 37.33Q96.69 38.31 95.54 39.11Q94.40 39.91 93.22 40.85Q92.05 41.78 90.72 43.14Q89.38 44.50 87.59 46.66Q85.81 48.83 84.04 51.31Q82.28 53.79 81.24 55.66Q80.20 57.52 79.75 58.11Q79.30 58.70 79.03 59.34Q78.76 59.98 77.59 62.01Q76.41 64.03 74.20 68.41Q71.99 72.79 70.52 75.96Q69.05 79.14 68.28 80.52Q67.50 81.91 66.78 83.59Q66.06 85.27 65.53 86.13Q64.99 86.98 64.30 88.53Q63.61 90.07 62.99 91.06Q62.38 92.05 61.90 93.06Q61.42 94.08 61.23 94.77Q61.05 95.46 61.10 96.08Q61.15 96.69 61.45 97.31Q61.74 97.92 62.14 98.40Q62.54 98.88 63.71 99.39Q64.89 99.89 74.36 99.84Q83.83 99.79 84.85 99.87Q85.86 99.95 87.86 99.87Q89.86 99.79 90.98 99.87Q92.10 99.95 93.01 99.87Q93.92 99.79 96.77 99.89Q99.63 100.00 100.67 99.89Q101.71 99.79 102.40 99.89Q103.09 100.00 104.03 99.63Q104.96 99.25 105.39 98.91Q105.82 98.56 106.27 97.60Q106.72 96.64 106.64 95.84Q106.56 95.04 106.59 90.05Q106.62 85.06 106.54 84.36Q106.46 83.67 106.46 81.46Q106.46 79.24 106.56 78.31Q106.67 77.37 106.54 76.57Q106.40 75.77 106.35 72.44Q106.30 69.10 106.35 64.49Q106.40 59.87 106.32 55.95Q106.24 52.03 106.35 51.52Q106.46 51.01 106.32 50.53Q106.19 50.05 106.24 49.57Q106.30 49.09 106.22 48.67Q106.14 48.24 106.11 44.96Q106.08 41.68 106.16 40.42Q106.24 39.17 105.92 38.50Q105.60 37.83 105.15 37.43Z';
export const LOGO_W = 107.10;
export function Logo({ size = 32 }) {
  return (
    <svg width={Math.round(size * LOGO_W / 100)} height={size} viewBox={`0 0 ${LOGO_W} 100`} aria-label="Acopia" role="img" className="logo">
      <path d={LOGO_PATH} fill="var(--logo)" />
    </svg>
  );
}

/* Enter = Guardar: en cualquier campo de texto, Enter aprieta el botón de guardar del mismo bloque
   (el botón marcado con data-enter, o el principal). El botón sigue estando para quien prefiera tocarlo. */
const ENTER_STOP = '.modal, .set-group, .set-sec, .cap-sheet, .kml-file, .map-banner, .lot-bar';
export function useEnterToSave() {
  useEffect(() => {
    function onKey(e) {
      if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.defaultPrevented) return;
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || ['checkbox', 'radio', 'file', 'button', 'submit'].includes(t.type)) return;
      if (t.closest('form') || t.closest('[data-noenter]')) return; // el ingreso ya envía su formulario
      for (let el = t.parentElement; el && !el.matches('.screen, .main, body'); el = el.parentElement) {
        const btn = el.querySelector('[data-enter]:not(:disabled)') || el.querySelector('.btn-primary:not(:disabled)');
        if (btn) { e.preventDefault(); btn.click(); return; }
        if (el.matches(ENTER_STOP)) return;
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
}

export function Button({ variant = 'default', icon, children, className = '', size, ...rest }) {
  return (
    <button type="button" className={`btn btn-${variant} ${size ? 'btn-' + size : ''} ${!children ? 'btn-icon' : ''} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 16 : 18} />}
      {children && <span>{children}</span>}
    </button>
  );
}

// Estructura etiqueta + campo
export function Field({ label, hint, error, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {(error || hint) && <span className={`field-hint ${error ? 'is-error' : ''}`}>{error || hint}</span>}
    </label>
  );
}

export function TextInput({ value, onChange, numeric, className = '', ...rest }) {
  return (
    <input className={`input ${className}`} value={value ?? ''} inputMode={numeric ? 'decimal' : undefined}
      autoComplete="off" spellCheck="false" onChange={e => onChange(e.target.value)} {...rest} />
  );
}

export function TextArea({ value, onChange, ...rest }) {
  return <textarea className="input textarea" value={value ?? ''} onChange={e => onChange(e.target.value)} {...rest} />;
}

/* ---------- Select propio (sin controles nativos) ---------- */
export function Select({ value, options, onChange, placeholder = 'Elegir…', disabled, id }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState(null);
  const btn = useRef(null), listRef = useRef(null);
  const cur = options.find(o => o.value === value);
  const toggle = () => {
    if (disabled) return;
    const r = btn.current.getBoundingClientRect(); setRect(r); setOpen(o => !o);
  };
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!btn.current?.contains(e.target) && !listRef.current?.contains(e.target)) setOpen(false); };
    const esc = e => e.key === 'Escape' && setOpen(false);
    const reflow = () => btn.current && setRect(btn.current.getBoundingClientRect());
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', esc);
    window.addEventListener('resize', reflow); window.addEventListener('scroll', reflow, true);
    setTimeout(() => listRef.current?.querySelector('.is-sel')?.scrollIntoView({ block: 'nearest' }), 0);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); window.removeEventListener('resize', reflow); window.removeEventListener('scroll', reflow, true); };
  }, [open]);
  let style = {};
  if (rect) {
    const below = window.innerHeight - rect.bottom, up = below < 240 && rect.top > below;
    style = { left: rect.left, width: rect.width, maxHeight: Math.min(280, (up ? rect.top : below) - 12) };
    if (up) style.bottom = window.innerHeight - rect.top + 4; else style.top = rect.bottom + 4;
  }
  return (
    <>
      <button type="button" id={id} ref={btn} className={`input select ${open ? 'is-open' : ''}`} onClick={toggle} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}>
        <span className={cur ? '' : 'muted'}>{cur ? cur.label : placeholder}</span>
        <Icon name="chev" size={16} />
      </button>
      {open && createPortal(
        <div className="select-menu" style={style} ref={listRef} role="listbox">
          {options.map(o => (
            <button type="button" key={String(o.value)} role="option" aria-selected={o.value === value}
              className={`select-opt ${o.value === value ? 'is-sel' : ''}`} onClick={() => { onChange(o.value); setOpen(false); }}>
              <span>{o.label}</span>{o.meta && <span className="muted small">{o.meta}</span>}
            </button>
          ))}
        </div>, document.body)}
    </>
  );
}

export function Segmented({ value, options, onChange, size }) {
  return (
    <div className={`seg ${size ? 'seg-' + size : ''}`} role="tablist">
      {options.map(o => (
        <button type="button" key={o.value} role="tab" aria-selected={value === o.value} className={value === o.value ? 'is-on' : ''} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} size={16} />}<span>{o.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- Modal / hoja inferior ---------- */
export function Modal({ title, subtitle, onClose, children, footer, wide }) {
  useEffect(() => {
    const k = e => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', k); return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return createPortal(
    <div className="modal-wrap" onPointerDown={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal-head">
          <div><h2>{title}</h2>{subtitle && <p className="muted small">{subtitle}</p>}</div>
          <Button variant="ghost" icon="close" onClick={onClose} aria-label="Cerrar" />
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>, document.body);
}

/* ---------- Avisos ---------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((msg, kind = 'info', ms = 3200) => {
    const id = Math.random().toString(36).slice(2);
    setItems(a => [...a, { id, msg, kind }]);
    setTimeout(() => setItems(a => a.filter(t => t.id !== id)), ms);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(<div className="toasts" aria-live="polite">{items.map(t => (
        <div key={t.id} className={`toast toast-${t.kind}`}><Icon name={t.kind === 'error' ? 'alert' : t.kind === 'ok' ? 'check' : 'info'} size={16} /><span>{t.msg}</span></div>
      ))}</div>, document.body)}
    </ToastCtx.Provider>
  );
}

export const fmtKg = n => (isFinite(n) && n !== '' && n !== null ? Number(n).toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '—');
export const fmtNum = (n, d = 0) => (isFinite(n) ? Number(n).toLocaleString('es-AR', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—');
export const fmtDate = iso => { if (!iso) return '—'; const d = new Date(iso); return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ' ' + d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }); };
export const parseNum = s => { if (s === '' || s == null) return null; const n = Number(String(s).replace(/\./g, '').replace(',', '.')); return isFinite(n) ? n : NaN; };
