import React, { useEffect, useRef, useState, createContext, useContext, useCallback } from 'react';
import { createPortal } from 'react-dom';

/* ---------- Íconos (trazo 1.75, 24×24) ---------- */
const P = {
  map: 'M9 4 3 6.5v13.5l6-2.5 6 2.5 6-2.5V4l-6 2.5L9 4Zm0 0v13.5m6-11v13.5',
  sat: 'M4.5 13.5 10.5 7.5m-6 6 3 3m-3-3 1.5-1.5m4.5-4.5 3 3m-3-3L12 6m1.5 4.5-6 6m6-6 1.5-1.5m-7.5 7.5L6 18m10.5-6a4.5 4.5 0 0 1-4.5 4.5m7.5-4.5A7.5 7.5 0 0 1 12 19.5',
  cube: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Zm0 0v0M4 7.5l8 4.5 8-4.5M12 12v9',
  silo: 'M4 15.5c0-2.5 2-4.5 4.5-4.5h7c2.5 0 4.5 2 4.5 4.5S18 20 15.5 20h-7C6 20 4 18 4 15.5Zm4-4.5V8m8 3V8M7 15.5h10',
  lots: 'M4 4h7v7H4V4Zm9 0h7v4h-7V4Zm0 6h7v10h-7V10ZM4 13h7v7H4v-7Z',
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

/* ---------- Logo SemIA: semilla + nodos de IA ---------- */
export function Logo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-label="SemIA" className="logo">
      <circle cx="24" cy="24" r="24" fill="#CCFF00" />
      <path d="M24 8.5c7.4 6 11 12.5 11 18.6C35 33.6 30.1 39 24 39s-11-5.4-11-11.9C13 21 16.6 14.5 24 8.5Z" fill="none" stroke="#000" strokeWidth="2.6" strokeLinejoin="round" />
      <path d="M24 39V22.5m0 7.5-5.5-4.6m5.5 0 5.5-4.6" stroke="#000" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <circle cx="18.5" cy="25.4" r="2.5" fill="#000" /><circle cx="29.5" cy="20.8" r="2.5" fill="#000" /><circle cx="24" cy="21.6" r="2.6" fill="#CCFF00" stroke="#000" strokeWidth="2.2" />
    </svg>
  );
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
