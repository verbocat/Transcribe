import React, { forwardRef } from 'react';
import { Loader2, RotateCcw, X } from 'lucide-react';

/**
 * Subtitle Studio UI kit. One set of buttons and form controls so every surface
 * (header, dialogs, settings) shares height, radius, focus ring and colours.
 * Everything reads --ss-* tokens, so it follows the Appearance theme.
 */

const cx = (...parts) => parts.filter(Boolean).join(' ');

const BTN_BASE =
  'inline-flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap rounded-lg border font-medium select-none transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SIZE = {
  sm: 'h-7 px-2.5 text-[12px]',
  md: 'h-8 px-3 text-[12px]',
  lg: 'h-9 px-4 text-[13px]',
};
const BTN_VARIANT = {
  primary: 'bg-[var(--ss-accent)] border-[var(--ss-accent)] text-[var(--ss-accent-ink)] hover:bg-[var(--ss-accent-hover)] hover:border-[var(--ss-accent-hover)] font-semibold',
  secondary: 'bg-[var(--ss-raised)] border-[var(--ss-line)] text-[var(--ss-text)] hover:bg-[var(--ss-hover)]',
  ghost: 'bg-transparent border-transparent text-[var(--ss-muted)] hover:text-[var(--ss-text)] hover:bg-[var(--ss-raised)]',
  danger: 'bg-transparent border-[var(--ss-line)] text-[var(--ss-muted)] hover:text-[var(--ss-danger)] hover:border-[var(--ss-danger)]/50',
};

export const Button = forwardRef(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, children, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cx(BTN_BASE, BTN_SIZE[size], BTN_VARIANT[variant], className)} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 12 : 14} className={cx('shrink-0', Icon === Loader2 && 'animate-spin')} />}
      {children}
    </button>
  );
});

/** Square icon-only button. `label` is required: it is the accessible name and the tooltip. */
export const IconButton = forwardRef(function IconButton(
  { label, icon: Icon, active, size = 'md', variant = 'ghost', className, type = 'button', ...rest },
  ref,
) {
  const dim = size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-9 h-9' : 'w-8 h-8';
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active === undefined ? undefined : active}
      className={cx(
        BTN_BASE,
        dim,
        BTN_VARIANT[variant],
        active && 'bg-[var(--ss-raised)] text-[var(--ss-text)] border-[var(--ss-line)]',
        className,
      )}
      {...rest}
    >
      <Icon size={size === 'sm' ? 14 : 16} />
    </button>
  );
});

export function Kbd({ children, className }) {
  return (
    <kbd className={cx('inline-flex items-center h-[18px] px-1.5 rounded border border-[var(--ss-line)] bg-[var(--ss-bg)] text-[10px] font-mono text-[var(--ss-muted)] leading-none', className)}>
      {children}
    </kbd>
  );
}

export function Badge({ children, tone = 'accent', className }) {
  const tones = {
    accent: 'text-[var(--ss-accent)] border-[var(--ss-accent)]/40 bg-[var(--ss-accent)]/10',
    muted: 'text-[var(--ss-muted)] border-[var(--ss-line)] bg-[var(--ss-raised)]',
    warn: 'text-[var(--ss-warn)] border-[var(--ss-warn)]/40 bg-[var(--ss-warn)]/10',
    danger: 'text-[var(--ss-danger)] border-[var(--ss-danger)]/40 bg-[var(--ss-danger)]/10',
  };
  return (
    <span className={cx('inline-flex items-center h-[18px] px-1.5 rounded-full border text-[10px] font-semibold leading-none', tones[tone], className)}>
      {children}
    </span>
  );
}

/** Titled group of settings rows. */
export function Section({ title, description, action, children, className }) {
  return (
    <section className={cx('mb-6', className)}>
      {(title || action) && (
        <div className="flex items-end justify-between gap-3 mb-2">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-[var(--ss-text)]">{title}</h3>
            {description && <p className="mt-0.5 text-[12px] leading-snug text-[var(--ss-faint)]">{description}</p>}
          </div>
          {action}
        </div>
      )}
      <div className="rounded-xl border border-[var(--ss-line)] bg-[var(--ss-raised)]/40 divide-y divide-[var(--ss-line)]/70">
        {children}
      </div>
    </section>
  );
}

/** One setting: label + hint on the left, the control on the right. */
export function Row({ label, hint, children, stacked, htmlFor }) {
  return (
    <div className={cx('px-4 py-3 flex gap-4', stacked ? 'flex-col' : 'items-center justify-between')}>
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="block text-[12.5px] text-[var(--ss-text)]">{label}</label>
        {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--ss-faint)]">{hint}</p>}
      </div>
      {children !== undefined && <div className={cx('shrink-0', stacked && 'w-full')}>{children}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, label, id }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative shrink-0 w-9 h-5 rounded-full transition-colors cursor-pointer',
        checked ? 'bg-[var(--ss-accent)]' : 'bg-[var(--ss-line)]',
      )}
    >
      <span className={cx('absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
    </button>
  );
}

/** Row with a switch on the right. */
export function SwitchRow({ label, hint, checked, onChange }) {
  return (
    <Row label={label} hint={hint}>
      <Switch checked={checked} onChange={onChange} label={label} />
    </Row>
  );
}

export function Segmented({ value, options, onChange, label, className }) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('flex gap-0.5 p-0.5 rounded-lg bg-[var(--ss-bg)] border border-[var(--ss-line)]', className)}>
      {options.map((o) => {
        const Icon = o.icon;
        const on = value === o.value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={cx(
              'flex-1 min-w-0 h-7 qc-seg px-2 rounded-md inline-flex items-center justify-center gap-1.5 text-[12px] font-medium cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
              on ? 'bg-[var(--ss-accent)] text-[var(--ss-accent-ink)]' : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)] hover:bg-[var(--ss-raised)]',
            )}
          >
            {Icon && <Icon size={13} className="shrink-0" />}
            <span className="truncate">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

const FIELD =
  'h-8 rounded-lg border border-[var(--ss-line)] bg-[var(--ss-bg)] text-[12px] text-[var(--ss-text)] placeholder:text-[var(--ss-faint)] hover:border-[var(--ss-muted)] focus:border-[var(--ss-accent)] focus:outline-none transition-colors';

export const TextInput = forwardRef(function TextInput({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(FIELD, 'px-2.5 w-full', className)} {...rest} />;
});

export function Select({ value, onChange, options, className, label, ...rest }) {
  return (
    <select
      value={value}
      aria-label={label}
      onChange={(e) => onChange(e.target.value)}
      className={cx(FIELD, 'px-2 pr-6 cursor-pointer', className)}
      {...rest}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

/** Slider with an editable number box and a reset-to-default button. */
export function Slider({ label, hint, value, min, max, step = 1, unit = '', onChange, defaultValue, decimals = 0, ticks }) {
  const dirty = defaultValue !== undefined && Math.abs(value - defaultValue) > 1e-9;
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="min-w-0">
          <div className="text-[12.5px] text-[var(--ss-text)]">{label}</div>
          {hint && <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--ss-faint)]">{hint}</p>}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number.isFinite(value) ? Number(value.toFixed(decimals)) : ''}
            onChange={(e) => {
              const n = parseFloat(e.target.value);
              if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
            }}
            aria-label={`${label}${unit ? ` (${unit})` : ''}`}
            className={cx(FIELD, 'w-[68px] px-1.5 text-right font-mono h-7')}
          />
          {unit && <span className="text-[11px] text-[var(--ss-faint)] w-5">{unit}</span>}
          <button
            type="button"
            onClick={() => onChange(defaultValue)}
            disabled={!dirty}
            aria-label={`Reset ${label}`}
            title="Reset to default"
            className="p-1 rounded text-[var(--ss-faint)] hover:text-[var(--ss-text)] disabled:opacity-0 cursor-pointer"
          >
            <RotateCcw size={12} />
          </button>
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-[var(--ss-accent)] cursor-pointer"
      />
      {ticks && (
        <div className="flex justify-between text-[10.5px] text-[var(--ss-faint)] mt-0.5">
          {ticks.map((t) => <span key={t}>{t}</span>)}
        </div>
      )}
    </div>
  );
}

/** Tiny wrapper used by dialogs: consistent modal chrome. */
export function ModalShell({ title, icon: Icon, onClose, children, footer, width = 'max-w-md', labelledBy = 'ss-modal-title' }) {
  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={cx('w-full rounded-2xl border border-[var(--ss-line)] bg-[var(--ss-panel)] text-[var(--ss-text)] shadow-2xl overflow-hidden flex flex-col max-h-[90vh]', width)}
      >
        <div className="flex items-center gap-2.5 px-5 py-3.5 border-b border-[var(--ss-line)]">
          {Icon && <Icon size={16} className="text-[var(--ss-accent)]" />}
          <h2 id={labelledBy} className="flex-1 text-[14px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 -mr-1.5 rounded-md text-[var(--ss-muted)] hover:text-[var(--ss-text)] hover:bg-[var(--ss-raised)] cursor-pointer">
            <X size={15} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-[var(--ss-line)] flex items-center justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
