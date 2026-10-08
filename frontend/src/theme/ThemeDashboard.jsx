import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Palette, X, RotateCcw, Check, Download, Upload, Copy, Type, Users, Accessibility, Sparkles,
  SlidersHorizontal, Braces, Contrast, WandSparkles,
} from 'lucide-react';
import './appearance.css';
import {
  DEFAULT_THEME, PRESETS, FONT_CHOICES, applyTheme, resetTheme, themeFromPreset, normalizeTheme,
  exportThemeJson, importThemeJson, contrast, mix, bestInk, isHex, getTheme,
} from './themeEngine';

const clone = (o) => JSON.parse(JSON.stringify(o));

/* ---------------------------------------------------------------- small controls */

function ColorField({ label, hint, value, defaultValue, onChange }) {
  const [typed, setTyped] = useState(null);   // text being typed; null means "show the real value"
  const draft = typed ?? value;
  const setDraft = setTyped;
  const commit = (v) => {
    let x = v.trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(x)) x = '#' + [...x.slice(1)].map((c) => c + c).join('');
    if (isHex(x)) onChange(x);
  };
  return (
    <div className="kt-field">
      <label className="kt-swatch" style={{ background: value }} title="Pick a colour">
        <input type="color" value={value} aria-label={`${label} colour`} onChange={(e) => onChange(e.target.value.toLowerCase())} />
      </label>
      <div className="kt-field-text">
        <b>{label}</b>
        {hint && <span>{hint}</span>}
      </div>
      <input
        className="kt-hex" value={draft} spellCheck={false} aria-label={`${label} hex value`}
        aria-invalid={!isHex(draft) && !/^#[0-9a-f]{3}$/i.test(draft)}
        onChange={(e) => { setDraft(e.target.value); commit(e.target.value); }}
        onBlur={() => setTyped(null)}
      />
      {defaultValue && value !== defaultValue && (
        <button type="button" className="kt-reset" title="Reset to default" aria-label={`Reset ${label}`} onClick={() => onChange(defaultValue)}>
          <RotateCcw size={13} />
        </button>
      )}
    </div>
  );
}

function Slider({ label, hint, value, min, max, step = 1, unit = '', onChange, defaultValue }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div className="kt-row">
        <div>
          <b style={{ fontWeight: 500 }}>{label}</b>
          {hint && <div className="kt-sub">{hint}</div>}
        </div>
        <div className="flex items-center gap-2" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="kt-val">{value}{unit}</span>
          {defaultValue !== undefined && value !== defaultValue && (
            <button type="button" className="kt-reset" title="Reset to default" aria-label={`Reset ${label}`} onClick={() => onChange(defaultValue)}>
              <RotateCcw size={13} />
            </button>
          )}
        </div>
      </div>
      <input className="kt-range" type="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Toggle({ checked, onChange, label }) {
  return <button type="button" role="switch" aria-checked={checked} aria-label={label} className="kt-toggle" onClick={() => onChange(!checked)} />;
}

function ContrastRow({ label, fg, bg }) {
  const ratio = contrast(fg, bg);
  const aa = ratio >= 4.5;
  return (
    <>
      <span>{label}</span>
      <span className="kt-val">{ratio.toFixed(1)} : 1</span>
      <span className={`kt-badge ${aa ? 'kt-ok' : 'kt-bad'}`}>{aa ? 'AA pass' : ratio >= 3 ? 'Large text only' : 'Fails'}</span>
    </>
  );
}

/* ---------------------------------------------------------------- live preview */

function Preview({ theme }) {
  const sp = theme.speakers;
  return (
    <div aria-label="Live preview">
      <div className="kt-h3">Live preview</div>
      <p className="kt-hint">Everything here updates as you change a setting.</p>
      <div className="kt-pv">
        <div className="kt-pv-bar">
          <span className="kt-pv-logo"><Sparkles size={13} /></span>
          <b style={{ fontSize: 13 }}>Transcribe</b>
          <span style={{ flex: 1 }} />
          <span className="kt-chip accent">QC 97%</span>
          <button type="button" className="kt-btn kt-btn-primary kt-btn-sm" tabIndex={-1}>Export</button>
        </div>
        <div className="kt-pv-body">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="kt-btn kt-btn-primary kt-btn-sm" tabIndex={-1}>Primary</button>
            <button type="button" className="kt-btn kt-btn-sm" tabIndex={-1}>Secondary</button>
            <button type="button" className="kt-btn kt-btn-ghost kt-btn-sm" tabIndex={-1}>Ghost</button>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className="kt-chip ok">Passed</span>
            <span className="kt-chip warn">Needs review</span>
            <span className="kt-chip bad">Error</span>
            <span className="kt-chip">Neutral</span>
          </div>
          <div className="kt-pv-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: sp[0] }} />
              <b>Tulsi</b>
              <span className="kt-val" style={{ marginLeft: 'auto' }}>3 lines · 0:07</span>
            </div>
          </div>
          <div>
            <div className="kt-pv-row sel">
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: sp[0], marginTop: 6 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--kt-font-script)', fontSize: 'var(--kt-transcript-size)', lineHeight: 1.5 }}>माँ कहती हैं कि पहले भगवान की पूजा करनी चाहिए।</div>
                <div className="kt-val">00:07.100 · 2.60s</div>
              </div>
            </div>
            <div className="kt-pv-row">
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: sp[1], marginTop: 6 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'var(--kt-font-script)', fontSize: 'var(--kt-transcript-size)', lineHeight: 1.5, color: 'var(--kt-muted)' }}>Take care, Lord Ganesha.</div>
                <div className="kt-val">00:10.200 · 1.90s</div>
              </div>
            </div>
          </div>
          <svg viewBox="0 0 300 44" width="100%" height="44" role="img" aria-label="Waveform sample">
            {Array.from({ length: 60 }, (_, i) => {
              const h = 6 + Math.abs(Math.sin(i * 0.55) * Math.cos(i * 0.21)) * 32;
              return <rect key={i} x={i * 5} y={22 - h / 2} width="3" height={h} rx="1.5" fill={i < 24 ? 'var(--kt-accent)' : 'var(--kt-faint)'} opacity={i < 24 ? 1 : 0.55} />;
            })}
          </svg>
          <div style={{ height: 4, borderRadius: 4, background: 'var(--kt-s4)' }}><div style={{ width: '62%', height: '100%', borderRadius: 4, background: 'linear-gradient(90deg, var(--kt-accent), var(--kt-accent-2))' }} /></div>
          <input className="kt-hex" style={{ width: '100%', height: 32 }} defaultValue="Search text or speaker" aria-label="Sample input" tabIndex={-1} />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- sections */

const SECTIONS = [
  { id: 'presets', label: 'Presets', icon: Sparkles },
  { id: 'colors', label: 'Colours', icon: Palette },
  { id: 'type', label: 'Typography', icon: Type },
  { id: 'shape', label: 'Shape & spacing', icon: SlidersHorizontal },
  { id: 'speakers', label: 'Speakers', icon: Users },
  { id: 'access', label: 'Accessibility', icon: Accessibility },
  { id: 'share', label: 'Import & export', icon: Braces },
];

export default function ThemeDashboard({ onClose, embedded = false }) {
  const [theme, setTheme] = useState(() => clone(getTheme()));
  const [section, setSection] = useState('presets');
  const [message, setMessage] = useState({ text: '', ok: true });
  const [paste, setPaste] = useState('');
  const [tint, setTint] = useState(30);
  const fileRef = useRef(null);
  const dialogRef = useRef(null);
  const D = DEFAULT_THEME;

  useEffect(() => {
    if (embedded) return undefined; // the host (Settings) owns Escape and focus
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    dialogRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, embedded]);

  // Keep in step if the theme changes elsewhere (another tab, reset)
  const commit = (next, rename = true) => {
    const n = normalizeTheme({ ...next, name: rename ? 'Custom' : next.name });
    setTheme(n);
    applyTheme(n);
  };
  const setColor = (key) => (value) => commit({ ...theme, colors: { ...theme.colors, [key]: value } });
  const say = (text, ok = true) => { setMessage({ text, ok }); window.setTimeout(() => setMessage((m) => (m.text === text ? { text: '', ok: true } : m)), 3500); };

  const c = theme.colors;
  const ink = theme.inkMode === 'custom' ? theme.ink : bestInk(c.accent);
  const activePreset = useMemo(() => PRESETS.find((p) => {
    const t = themeFromPreset(p.id);
    return COLORS_EQUAL(t.colors, c);
  })?.id, [c]);

  const deriveSurfaces = () => {
    const k = tint / 100 * 0.12;
    const base = ['#08090c', '#0e1014', '#15181e', '#1d2129', '#262b35', '#353c4a'];
    const [bg, panel, raised, hover, border, borderStrong] = base.map((b) => mix(b, c.accent, k));
    commit({ ...theme, colors: { ...c, bg, panel, raised, hover, border, borderStrong } });
    say('Surfaces tinted from your accent colour.');
  };

  const download = () => {
    const blob = new Blob([exportThemeJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `lowerthird-theme-${(theme.name || 'custom').toLowerCase().replace(/\s+/g, '-')}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 500);
  };
  const tryImport = (text) => {
    try {
      const next = importThemeJson(text);
      setTheme(next); applyTheme(next); say(`Applied theme "${next.name}".`);
      setPaste('');
    } catch (e) { say(e.message, false); }
  };

  const renderSection = () => {
    switch (section) {
      case 'presets':
        return (
          <>
            <div className="kt-h3">Start from a preset</div>
            <p className="kt-hint">Pick a look, then fine-tune anything in the other tabs. Changes apply instantly across the whole app and are saved on this device.</p>
            <div className="kt-grid-3">
              {PRESETS.map((p) => {
                const t = themeFromPreset(p.id);
                return (
                  <button key={p.id} type="button" className="kt-preset" aria-pressed={activePreset === p.id} onClick={() => { setTheme(t); applyTheme(t); say(`${p.name} applied.`); }}>
                    <div className="kt-chipbar" aria-hidden="true">
                      {[t.colors.bg, t.colors.raised, t.colors.accent, t.colors.accent2, t.colors.text].map((col, i) => <i key={i} style={{ background: col }} />)}
                    </div>
                    <div>
                      <b style={{ fontWeight: 600 }}>{p.name}</b>
                      <div className="kt-sub">{p.note}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        );
      case 'colors':
        return (
          <>
            <div className="kt-group">
              <div className="kt-h3">Brand</div>
              <p className="kt-hint">The accent drives primary buttons, selection, focus rings, links, charts and progress bars.</p>
              <div className="kt-grid">
                <ColorField label="Accent" hint="Buttons, selection, focus" value={c.accent} defaultValue={D.colors.accent} onChange={setColor('accent')} />
                <ColorField label="Accent, secondary" hint="Gradient end, highlights" value={c.accent2} defaultValue={D.colors.accent2} onChange={setColor('accent2')} />
              </div>
              <div className="kt-field" style={{ marginTop: 10 }}>
                <span className="kt-swatch" style={{ background: c.accent, display: 'grid', placeItems: 'center', color: ink, fontWeight: 700 }}>Aa</span>
                <div className="kt-field-text">
                  <b>Text on accent buttons</b>
                  <span>{theme.inkMode === 'auto' ? 'Chosen automatically for best readability' : 'Custom colour'}</span>
                </div>
                {theme.inkMode === 'custom' && (
                  <input type="color" aria-label="Custom text-on-accent colour" value={theme.ink} onChange={(e) => commit({ ...theme, ink: e.target.value.toLowerCase() })} style={{ width: 30, height: 30, border: 0, background: 'none', padding: 0 }} />
                )}
                <button type="button" className="kt-btn kt-btn-sm" onClick={() => commit({ ...theme, inkMode: theme.inkMode === 'auto' ? 'custom' : 'auto', ink: ink })}>
                  {theme.inkMode === 'auto' ? 'Set manually' : 'Use auto'}
                </button>
              </div>
            </div>

            <div className="kt-group">
              <div className="kt-h3">Surfaces</div>
              <p className="kt-hint">Background to borders, darkest to lightest. Keep them in this order for the best depth.</p>
              <div className="kt-grid">
                <ColorField label="App background" value={c.bg} defaultValue={D.colors.bg} onChange={setColor('bg')} />
                <ColorField label="Panels" hint="Side panels, top bar" value={c.panel} defaultValue={D.colors.panel} onChange={setColor('panel')} />
                <ColorField label="Cards" hint="Raised surfaces, inputs" value={c.raised} defaultValue={D.colors.raised} onChange={setColor('raised')} />
                <ColorField label="Hover" hint="Hovered rows and buttons" value={c.hover} defaultValue={D.colors.hover} onChange={setColor('hover')} />
                <ColorField label="Borders" value={c.border} defaultValue={D.colors.border} onChange={setColor('border')} />
                <ColorField label="Strong borders" hint="Hover and emphasis" value={c.borderStrong} defaultValue={D.colors.borderStrong} onChange={setColor('borderStrong')} />
              </div>
              <div className="kt-field" style={{ marginTop: 10 }}>
                <WandSparkles size={18} style={{ color: 'var(--kt-accent)', flex: 'none' }} />
                <div className="kt-field-text">
                  <b>Tint surfaces from the accent</b>
                  <span>Generates a matching set of six surface colours</span>
                </div>
                <input className="kt-range" type="range" min="0" max="100" value={tint} onChange={(e) => setTint(+e.target.value)} aria-label="Tint strength" style={{ width: 110 }} />
                <button type="button" className="kt-btn kt-btn-sm" onClick={deriveSurfaces}>Generate</button>
              </div>
            </div>

            <div className="kt-group">
              <div className="kt-h3">Text</div>
              <div className="kt-grid">
                <ColorField label="Primary text" value={c.text} defaultValue={D.colors.text} onChange={setColor('text')} />
                <ColorField label="Secondary text" value={c.muted} defaultValue={D.colors.muted} onChange={setColor('muted')} />
                <ColorField label="Subtle text" hint="Hints, timestamps" value={c.faint} defaultValue={D.colors.faint} onChange={setColor('faint')} />
              </div>
            </div>

            <div className="kt-group">
              <div className="kt-h3">Status</div>
              <div className="kt-grid-3">
                <ColorField label="Success" value={c.success} defaultValue={D.colors.success} onChange={setColor('success')} />
                <ColorField label="Warning" value={c.warn} defaultValue={D.colors.warn} onChange={setColor('warn')} />
                <ColorField label="Error" value={c.danger} defaultValue={D.colors.danger} onChange={setColor('danger')} />
              </div>
            </div>

            <div className="kt-group">
              <div className="kt-h3" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Contrast size={14} /> Readability check</div>
              <p className="kt-hint">Contrast needs 4.5 : 1 for body text (WCAG AA).</p>
              <div className="kt-contrast">
                <ContrastRow label="Primary text on background" fg={c.text} bg={c.bg} />
                <ContrastRow label="Secondary text on panels" fg={c.muted} bg={c.panel} />
                <ContrastRow label="Subtle text on panels" fg={c.faint} bg={c.panel} />
                <ContrastRow label="Accent text on background" fg={c.accent} bg={c.bg} />
                <ContrastRow label="Button text on accent" fg={ink} bg={c.accent} />
              </div>
            </div>
          </>
        );
      case 'type':
        return (
          <>
            <div className="kt-group">
              <div className="kt-h3">Fonts</div>
              <p className="kt-hint">The transcript font handles Hindi and other Indian scripts, with Noto fallbacks for any script a font lacks.</p>
              <div className="kt-grid-3">
                {[['ui', 'Interface'], ['script', 'Transcript text'], ['mono', 'Timecodes']].map(([key, label]) => (
                  <label key={key} style={{ display: 'block' }}>
                    <div className="kt-sub" style={{ marginBottom: 4 }}>{label}</div>
                    <select className="kt-select" value={theme.fonts[key]} onChange={(e) => commit({ ...theme, fonts: { ...theme.fonts, [key]: e.target.value } })}>
                      {FONT_CHOICES[key].map((f) => <option key={f} value={f}>{f}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <div className="kt-field" style={{ marginTop: 14, display: 'block' }}>
                <div style={{ fontFamily: 'var(--kt-font-script)', fontSize: 'var(--kt-transcript-size)', lineHeight: 1.6 }}>नमस्ते, यह एक नमूना वाक्य है। The quick brown fox jumps over the lazy dog.</div>
                <div style={{ fontFamily: 'var(--kt-font-mono)', color: 'var(--kt-muted)', marginTop: 6 }}>00:01:24.210 → 00:01:27.080 · 2.87s</div>
              </div>
            </div>
            <Slider label="Interface text size" hint="Scales menus, panels and labels" value={theme.textScale} min={85} max={130} unit="%" defaultValue={D.textScale} onChange={(v) => commit({ ...theme, textScale: v })} />
            <Slider label="Transcript text size" hint="The lines you edit" value={theme.transcriptSize} min={12} max={24} unit="px" defaultValue={D.transcriptSize} onChange={(v) => commit({ ...theme, transcriptSize: v })} />
          </>
        );
      case 'shape':
        return (
          <>
            <Slider label="Corner roundness" hint="0% is square, 100% is the default, more is softer" value={theme.radius} min={0} max={220} unit="%" defaultValue={D.radius} onChange={(v) => commit({ ...theme, radius: v })} />
            <Slider label="Spacing density" hint="Lower is more compact, higher is roomier" value={theme.density} min={80} max={130} unit="%" defaultValue={D.density} onChange={(v) => commit({ ...theme, density: v })} />
            <div className="kt-field" style={{ gap: 14, flexWrap: 'wrap' }}>
              {[1, 2, 3, 4].map((n) => (
                <div key={n} style={{ width: 60, height: 40, background: 'var(--kt-s3)', border: '1px solid var(--kt-s5)', borderRadius: `var(--kt-r${n})` }} />
              ))}
              <span className="kt-sub">Corner samples, smallest to largest</span>
            </div>
          </>
        );
      case 'speakers':
        return (
          <>
            <div className="kt-h3">Speaker colours</div>
            <p className="kt-hint">Used for speaker dots in the Transcribe list and the waveform regions. Speakers take these in order of first appearance.</p>
            <div className="kt-grid">
              {theme.speakers.map((col, i) => (
                <ColorField key={i} label={`Speaker ${i + 1}`} value={col} defaultValue={D.speakers[i]} onChange={(v) => { const s = [...theme.speakers]; s[i] = v; commit({ ...theme, speakers: s }); }} />
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <button type="button" className="kt-btn kt-btn-sm" onClick={() => commit({ ...theme, speakers: [...D.speakers] }, false)}><RotateCcw size={13} /> Reset speaker colours</button>
            </div>
          </>
        );
      case 'access':
        return (
          <>
            <div className="kt-group">
              <div className="kt-h3">Motion</div>
              <div className="kt-field">
                <div className="kt-field-text"><b>Animations and transitions</b><span>Turn off for a calmer, faster interface</span></div>
                <Toggle checked={theme.motion} onChange={(v) => commit({ ...theme, motion: v }, false)} label="Animations" />
              </div>
            </div>
            <div className="kt-group">
              <div className="kt-h3">Legibility</div>
              <p className="kt-hint">One click to the highest-contrast colours, then larger text if you need it.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="kt-btn" onClick={() => { const t = themeFromPreset('contrast'); setTheme(t); applyTheme(t); say('High contrast applied.'); }}>
                  <Contrast size={14} /> Apply high contrast
                </button>
                <button type="button" className="kt-btn" onClick={() => commit({ ...theme, textScale: 115, transcriptSize: 18 }, false)}>
                  <Type size={14} /> Larger text
                </button>
              </div>
            </div>
          </>
        );
      case 'share':
      default:
        return (
          <>
            <div className="kt-group">
              <div className="kt-h3">Save or share your theme</div>
              <p className="kt-hint">Export a theme file to back it up or give the same look to a teammate.</p>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button type="button" className="kt-btn" onClick={download}><Download size={14} /> Download theme file</button>
                <button type="button" className="kt-btn" onClick={() => { navigator.clipboard?.writeText(exportThemeJson()).then(() => say('Theme copied to clipboard.'), () => say('Copy was blocked by the browser.', false)); }}><Copy size={14} /> Copy as JSON</button>
              </div>
            </div>
            <div className="kt-group">
              <div className="kt-h3">Import</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) f.text().then(tryImport); e.target.value = ''; }} />
                <button type="button" className="kt-btn" onClick={() => fileRef.current?.click()}><Upload size={14} /> Choose theme file</button>
              </div>
              <textarea className="kt-textarea" placeholder="…or paste theme JSON here" value={paste} onChange={(e) => setPaste(e.target.value)} aria-label="Theme JSON" />
              <div style={{ marginTop: 8 }}><button type="button" className="kt-btn kt-btn-sm" disabled={!paste.trim()} onClick={() => tryImport(paste)}>Apply pasted theme</button></div>
            </div>
          </>
        );
    }
  };

  if (embedded) {
    return (
      <div className="kt-dash kt-embedded" aria-label="Appearance settings">
        <div className="kt-embed-bar">
          <div className="kt-sub" style={{ flex: 1, minWidth: 0 }}>
            Theme: <b style={{ color: 'var(--kt-text)', fontWeight: 500 }}>{theme.name}</b> · applies instantly, saved on this device
          </div>
          <button type="button" className="kt-btn kt-btn-sm" onClick={() => { const t = resetTheme(); setTheme(clone(t)); say('Reset to the default theme.'); }}>
            <RotateCcw size={13} /> Reset
          </button>
        </div>
        <nav className="kt-nav" aria-label="Appearance sections">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </nav>
        <div className="kt-main" tabIndex={-1}>
          {renderSection()}
          <div className="kt-msg" role="status" style={{ color: message.ok ? 'var(--kt-muted)' : 'var(--kt-danger)' }}>{message.text}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="kt-backdrop" data-lenis-prevent onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="kt-dash" role="dialog" aria-modal="true" aria-label="Appearance settings" tabIndex={-1} ref={dialogRef}>
        <div className="kt-head">
          <Palette size={18} style={{ color: 'var(--kt-accent)' }} />
          <div style={{ flex: 1 }}>
            <h2>Appearance</h2>
            <div className="kt-sub">Theme: <b style={{ color: 'var(--kt-text)', fontWeight: 500 }}>{theme.name}</b> · changes apply instantly and are saved on this device</div>
          </div>
          <button type="button" className="kt-btn kt-btn-sm" onClick={() => { const t = resetTheme(); setTheme(clone(t)); say('Reset to the default theme.'); }}>
            <RotateCcw size={13} /> Reset everything
          </button>
          <button type="button" className="kt-btn kt-btn-ghost kt-btn-sm" onClick={onClose} aria-label="Close appearance settings"><X size={16} /></button>
        </div>

        <div className="kt-body">
          <nav className="kt-nav" data-lenis-prevent aria-label="Appearance sections">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button key={id} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>
                <Icon size={15} /> {label}
              </button>
            ))}
          </nav>
          <main className="kt-main" data-lenis-prevent tabIndex={-1}>{renderSection()}</main>
          <aside className="kt-side" data-lenis-prevent><Preview theme={theme} /></aside>
        </div>

        <div className="kt-foot">
          <span className="kt-msg" role="status" style={{ margin: 0, color: message.ok ? 'var(--kt-muted)' : 'var(--kt-danger)' }}>
            {message.text ? (<>{message.ok && <Check size={12} style={{ verticalAlign: '-2px', marginRight: 4, color: 'var(--kt-success)' }} />}{message.text}</>) : 'Dark themes only. Light mode is not supported yet.'}
          </span>
          <button type="button" className="kt-btn kt-btn-primary kt-btn-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}

function COLORS_EQUAL(a, b) {
  return Object.keys(a).every((k) => a[k] === b[k]);
}
