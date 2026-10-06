import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Menu as MenuIcon } from 'lucide-react';
import { Kbd } from './ui/controls';

/**
 * Data-driven menu bar.
 *
 * menus: [{ id, label, items: Item[] }]
 * Item:  { type?: 'separator' | 'heading', label, icon, shortcut, onSelect, disabled, checked, danger }
 *
 * Behaves like a desktop menu bar: click to open, hover to switch while open, arrow keys to
 * move, Enter to run, Esc to close. `compact` folds every menu into a single button.
 */

function MenuItems({ items, onRun }) {
  return items.map((item, i) => {
    if (item.type === 'separator') return <div key={`sep-${i}`} role="separator" className="h-px my-1.5 mx-2 bg-[var(--ss-line)]" />;
    if (item.type === 'heading') {
      return <div key={`h-${i}`} className="px-3 pt-2 pb-1 text-[11px] font-semibold text-[var(--ss-faint)]">{item.label}</div>;
    }
    const Icon = item.icon;
    const checkable = typeof item.checked === 'boolean';
    return (
      <button
        key={item.id || `${item.label}-${i}`}
        type="button"
        role={checkable ? 'menuitemcheckbox' : 'menuitem'}
        aria-checked={checkable ? item.checked : undefined}
        data-menu-item
        disabled={item.disabled}
        onClick={() => onRun(item)}
        className={`w-full h-8 px-2.5 rounded-md flex items-center gap-2.5 text-left text-[12.5px] cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none ${
          item.danger
            ? 'text-[var(--ss-danger)] hover:bg-[var(--ss-danger)]/15 focus:bg-[var(--ss-danger)]/15'
            : 'text-[var(--ss-text)] hover:bg-[var(--ss-hover)] focus:bg-[var(--ss-hover)] disabled:hover:bg-transparent'
        }`}
      >
        <span className="w-4 shrink-0 flex items-center justify-center text-[var(--ss-muted)]">
          {checkable ? (item.checked ? <Check size={13} className="text-[var(--ss-accent)]" /> : null) : Icon ? <Icon size={14} /> : null}
        </span>
        <span className="flex-1 min-w-0 truncate">{item.label}</span>
        {item.shortcut && <Kbd className="shrink-0">{item.shortcut}</Kbd>}
      </button>
    );
  });
}

const PANEL = 'rounded-xl border border-[var(--ss-line)] bg-[var(--ss-panel)] shadow-2xl p-1.5 max-h-[72vh] overflow-y-auto';

function onMenuKeys(e, close) {
  const items = [...e.currentTarget.querySelectorAll('[data-menu-item]:not(:disabled)')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
  else if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
  else if (e.key === 'End') { e.preventDefault(); items[items.length - 1]?.focus(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
}

export default function StudioMenuBar({ menus, compact = false }) {
  const [openId, setOpenId] = useState(null);
  const rootRef = useRef(null);

  const close = useCallback((refocus = false) => {
    setOpenId((cur) => {
      if (cur && refocus) rootRef.current?.querySelector(`[data-menu-trigger="${cur}"]`)?.focus();
      return null;
    });
  }, []);

  useEffect(() => {
    if (!openId) return undefined;
    const onDown = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpenId(null); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [openId]);

  // Focus the first enabled item when a menu opens by keyboard
  const focusFirst = (id) => {
    requestAnimationFrame(() => rootRef.current?.querySelector(`[data-menu-panel="${id}"] [data-menu-item]:not(:disabled)`)?.focus());
  };

  const run = (item) => {
    setOpenId(null);
    // run after the menu has closed so focus-stealing actions (dialogs, file pickers) behave
    setTimeout(() => item.onSelect?.(), 0);
  };

  if (compact) {
    return (
      <div ref={rootRef} className="relative">
        <button
          type="button"
          data-menu-trigger="all"
          aria-haspopup="menu"
          aria-expanded={openId === 'all'}
          aria-label="Menu"
          title="Menu"
          onClick={() => { const next = openId === 'all' ? null : 'all'; setOpenId(next); if (next) focusFirst('all'); }}
          className={`h-8 px-2.5 rounded-lg inline-flex items-center gap-1.5 text-[12px] font-medium cursor-pointer transition-colors ${openId === 'all' ? 'bg-[var(--ss-raised)] text-[var(--ss-text)]' : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)] hover:bg-[var(--ss-raised)]'}`}
        >
          <MenuIcon size={16} />
          <span className="hidden sm:inline">Menu</span>
        </button>
        {openId === 'all' && (
          <div role="menu" data-menu-panel="all" onKeyDown={(e) => onMenuKeys(e, close)} className={`absolute left-0 top-full mt-1.5 z-50 w-72 ${PANEL}`}>
            {menus.map((m, idx) => (
              <div key={m.id}>
                {idx > 0 && <div role="separator" className="h-px my-1.5 mx-2 bg-[var(--ss-line)]" />}
                <div className="px-3 pt-1.5 pb-1 text-[11px] font-semibold text-[var(--ss-accent)]">{m.label}</div>
                <MenuItems items={m.items} onRun={run} />
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const move = (dir) => {
    const idx = menus.findIndex((m) => m.id === openId);
    const next = menus[(idx + dir + menus.length) % menus.length];
    setOpenId(next.id);
    focusFirst(next.id);
  };

  return (
    <nav ref={rootRef} role="menubar" aria-label="Main menu" className="flex items-center gap-0.5">
      {menus.map((m) => {
        const open = openId === m.id;
        return (
          <div key={m.id} className="relative">
            <button
              type="button"
              role="menuitem"
              data-menu-trigger={m.id}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => { setOpenId(open ? null : m.id); if (!open) focusFirst(m.id); }}
              onMouseEnter={() => { if (openId && !open) setOpenId(m.id); }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') { e.preventDefault(); setOpenId(m.id); focusFirst(m.id); }
                else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                  const idx = menus.findIndex((x) => x.id === m.id);
                  const next = menus[(idx + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length];
                  rootRef.current?.querySelector(`[data-menu-trigger="${next.id}"]`)?.focus();
                  if (openId) { setOpenId(next.id); focusFirst(next.id); }
                }
              }}
              className={`h-8 px-2.5 rounded-lg text-[12.5px] font-medium cursor-pointer transition-colors ${open ? 'bg-[var(--ss-raised)] text-[var(--ss-text)]' : 'text-[var(--ss-muted)] hover:text-[var(--ss-text)] hover:bg-[var(--ss-raised)]'}`}
            >
              {m.label}
            </button>
            {open && (
              <div
                role="menu"
                aria-label={m.label}
                data-menu-panel={m.id}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight') { e.preventDefault(); move(1); }
                  else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1); }
                  else onMenuKeys(e, close);
                }}
                className={`absolute left-0 top-full mt-1.5 z-50 w-72 ${PANEL}`}
              >
                <MenuItems items={m.items} onRun={run} />
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
