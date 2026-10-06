import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { Kbd } from './ui/controls';

/**
 * Ctrl+K command palette.
 * commands: [{ id, label, group, icon, shortcut, disabled, onSelect, keywords }]
 */
export default function CommandPalette({ commands, onClose }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands
      .filter((c) => !c.disabled)
      .map((c) => {
        const hay = `${c.label} ${c.group || ''} ${c.keywords || ''}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        // label hits rank above group / keyword hits
        const score = words.reduce((s, w) => s + (c.label.toLowerCase().startsWith(w) ? 0 : c.label.toLowerCase().includes(w) ? 1 : 2), 0);
        return { c, score };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score)
      .map((r) => r.c);
  }, [commands, query]);

  useEffect(() => { setIndex(0); }, [query]);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [index]);

  const run = (cmd) => {
    if (!cmd) return;
    onClose();
    setTimeout(() => cmd.onSelect?.(), 0);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(results.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); run(results[index]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
  };

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center pt-[12vh] px-4 bg-black/55 backdrop-blur-sm"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onKeyDown} className="w-full max-w-xl rounded-2xl border border-[var(--ss-line)] bg-[var(--ss-panel)] shadow-2xl overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-[var(--ss-line)]">
          <Search size={15} className="text-[var(--ss-faint)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command, e.g. “shift”, “layout”, “export”"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="ss-palette-list"
            className="flex-1 bg-transparent text-[14px] text-[var(--ss-text)] placeholder:text-[var(--ss-faint)] focus:outline-none"
          />
          <Kbd>Esc</Kbd>
        </div>
        <ul id="ss-palette-list" ref={listRef} role="listbox" className="max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 && <li className="px-3 py-6 text-center text-[12.5px] text-[var(--ss-faint)]">No command matches “{query}”.</li>}
          {results.map((cmd, i) => {
            const Icon = cmd.icon;
            const on = i === index;
            return (
              <li
                key={cmd.id}
                role="option"
                aria-selected={on}
                onMouseMove={() => setIndex(i)}
                onClick={() => run(cmd)}
                className={`h-9 px-3 rounded-lg flex items-center gap-3 cursor-pointer text-[13px] ${on ? 'bg-[var(--ss-hover)] text-[var(--ss-text)]' : 'text-[var(--ss-muted)]'}`}
              >
                <span className="w-4 shrink-0 flex justify-center">{Icon ? <Icon size={14} /> : null}</span>
                <span className="flex-1 min-w-0 truncate">{cmd.label}</span>
                {cmd.group && <span className="text-[11px] text-[var(--ss-faint)] shrink-0">{cmd.group}</span>}
                {cmd.shortcut && <Kbd className="shrink-0">{cmd.shortcut}</Kbd>}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
