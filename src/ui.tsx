import { useEffect, useState, type ReactNode } from 'react';
import iconsData from './icons.json';

type IconDef = { vb: string; p: { d: string; s: number; w: number | null; fr: boolean }[] };
const icons = iconsData as Record<string, IconDef>;

export function Icon({ name, size = 22, className, title }: { name: string; size?: number; className?: string; title?: string }) {
  const def = icons[name];
  if (!def) return null;
  const vbw = Number(def.vb.split(' ')[2]) || 24;
  return (
    <svg className={`icon ${className ?? ''}`} width={size} height={size} viewBox={def.vb} aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      {def.p.map((p, i) =>
        p.s ? (
          <path key={i} d={p.d} fill="none" stroke="currentColor" strokeWidth={p.w ?? vbw / 12} strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path key={i} d={p.d} fill="currentColor" fillRule={p.fr ? 'evenodd' : undefined} />
        ),
      )}
    </svg>
  );
}

// ---------- tiny hash router ----------
export function useRoute(): string[] {
  const get = () => (window.location.hash.replace(/^#\/?/, '') || '').split('?')[0].split('/').filter(Boolean).map(decodeURIComponent);
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => setRoute(get());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
export const navigate = (path: string) => {
  window.location.hash = path.startsWith('/') ? path : `/${path}`;
};
export const back = (fallback: string) => {
  if (window.history.length > 1 && document.referrer !== '' ) window.history.back();
  else navigate(fallback);
};

// ---------- layout pieces ----------
export function TopBar({ title, onBack, actions, subtitle }: { title: string; onBack?: () => void; actions?: ReactNode; subtitle?: string }) {
  return (
    <header className="topbar">
      {onBack && (
        <button className="icon-btn" onClick={onBack} aria-label="Back">
          <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      )}
      <div className="topbar-title">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="topbar-actions">{actions}</div>
    </header>
  );
}

export function IconButton({ icon, label, onClick, active, danger }: { icon: string; label: string; onClick: () => void; active?: boolean; danger?: boolean }) {
  return (
    <button className={`icon-btn ${active ? 'active' : ''} ${danger ? 'danger' : ''}`} onClick={onClick} aria-label={label} title={label}>
      <Icon name={icon} size={20} />
    </button>
  );
}

export function Fab({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button className="fab" onClick={onClick} aria-label={label} title={label}>
      <Icon name="add" size={22} />
    </button>
  );
}

export function Modal({ open, onClose, title, children, footer, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <h2>{title}</h2>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Confirm({ open, title, message, confirmLabel = 'Delete', onConfirm, onClose }: { open: boolean; title: string; message: string; confirmLabel?: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button className="btn text" onClick={onClose}>Cancel</button>
          <button className="btn danger" onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</button>
        </>
      }
    >
      <p>{message}</p>
    </Modal>
  );
}

export function Empty({ image, text, action }: { image?: string; text: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {image && <img src={image} alt="" width={140} height={140} />}
      <p>{text}</p>
      {action}
    </div>
  );
}

export function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="search">
      <Icon name="search" size={18} />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
      {value && (
        <button className="clear" onClick={() => onChange('')} aria-label="Clear search">×</button>
      )}
    </label>
  );
}

// ---------- toast ----------
type Toast = { id: number; text: string; kind: 'info' | 'error' };
let toastId = 0;
const toastListeners = new Set<(t: Toast[]) => void>();
let toasts: Toast[] = [];
export function toast(text: string, kind: Toast['kind'] = 'info') {
  const t = { id: ++toastId, text, kind };
  toasts = [...toasts, t];
  toastListeners.forEach((l) => l(toasts));
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== t.id);
    toastListeners.forEach((l) => l(toasts));
  }, 3800);
}
export function Toasts() {
  const [list, setList] = useState<Toast[]>(toasts);
  useEffect(() => {
    toastListeners.add(setList);
    return () => {
      toastListeners.delete(setList);
    };
  }, []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>
      ))}
    </div>
  );
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}
