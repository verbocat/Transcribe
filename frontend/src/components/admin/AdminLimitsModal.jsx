import React, { useEffect, useMemo, useState } from 'react';
import { X, Timer, CalendarClock, Loader2, Check, ShieldCheck } from 'lucide-react';
import { API_BASE } from '../../config';
import { useAuth } from '../../auth_views/AuthContext';
import { hrs, exact } from './adminUi';

/**
 * Limits & access for one account, all enforced on the server:
 *  - one shared hours limit (transcription and translation both spend from it) entered as hours + minutes, or unlimited
 *  - longest file per job and jobs per 24 hours
 *  - studio and feature switches
 *  - last day the account can be used
 */

const SWITCHES = [
  ['can_transcribe_studio', 'Transcribe Studio', 'Transcribe audio and video into speaker-labelled transcripts.'],
  ['can_subtitle_studio', 'Subtitle Studio', 'Generate subtitles and re-sync them to the audio.'],
  ['can_translate', 'AI translation', 'Translate transcripts and subtitles into other languages.'],
  ['can_ai_optimize', 'AI assistance', 'Context autofill, AI proofreading, speaker review and script analysis.'],
  ['can_export', 'Exports & downloads', 'Download SRT, VTT, Excel, Word, CSV, dubbing scripts and other files.'],
  ['can_audio_peaks', 'Audio waveform', 'Draw the audio waveform on the timeline.'],
];

const toHM = (hours) => {
  if (hours == null) return { h: '', m: '' };
  const total = Math.round(hours * 60);
  return { h: String(Math.floor(total / 60)), m: String(total % 60) };
};
const fromHM = ({ h, m }) => (Number(h || 0) * 60 + Number(m || 0)) / 60;

const field = 'h-9 rounded-lg border border-[var(--kt-s4)] bg-[var(--kt-s0)] px-3 text-[13px] text-[var(--kt-text)] tabular-nums placeholder:text-[var(--kt-faint)] focus:outline-none focus:border-[var(--kt-accent)] disabled:opacity-40';
const chip = (on) => `h-7 px-2.5 rounded-md text-[12px] font-medium cursor-pointer transition-colors ${on ? 'bg-[var(--kt-accent)] text-[var(--kt-accent-ink)]' : 'bg-[var(--kt-s2)] text-[var(--kt-muted)] hover:text-[var(--kt-text)]'}`;

function Toggle({ on, onChange, disabled, label }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative w-9 h-5 rounded-full shrink-0 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${on ? 'bg-[var(--kt-accent)]' : 'bg-[var(--kt-s4)]'}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}

function Section({ icon: Icon, title, hint, children }) {
  return (
    <section className="space-y-3">
      <div>
        <h4 className="flex items-center gap-2 text-[13px] font-semibold text-[var(--kt-text)]"><Icon size={15} strokeWidth={1.75} className="text-[var(--kt-muted)]" />{title}</h4>
        {hint && <p className="mt-1 text-[12px] text-[var(--kt-muted)]">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function TimeBudget({ icon, label, usage, breakdown, value, onChange }) {
  const used = usage.used_hours + usage.reserved_hours;
  const limit = value.unlimited ? null : fromHM(value);
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  const Icon = icon;
  return (
    <div className="rounded-xl border border-[var(--kt-s3)] bg-[var(--kt-s0)]/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--kt-text)]"><Icon size={14} strokeWidth={1.75} />{label}</span>
        <label className="flex items-center gap-2 text-[12px] text-[var(--kt-muted)] cursor-pointer">
          Unlimited <Toggle on={value.unlimited} label={`${label} unlimited`} onChange={(u) => onChange({ ...value, unlimited: u })} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input type="number" min="0" inputMode="numeric" aria-label={`${label} hours`} disabled={value.unlimited} value={value.unlimited ? '' : value.h}
          onChange={(e) => onChange({ ...value, h: e.target.value })} placeholder="0" className={`${field} w-20`} />
        <span className="text-[12px] text-[var(--kt-muted)]">hours</span>
        <input type="number" min="0" max="59" inputMode="numeric" aria-label={`${label} minutes`} disabled={value.unlimited} value={value.unlimited ? '' : value.m}
          onChange={(e) => onChange({ ...value, m: e.target.value })} placeholder="0" className={`${field} w-16`} />
        <span className="text-[12px] text-[var(--kt-muted)]">minutes</span>
        <div className="ml-auto flex gap-1">
          {[1, 5, 10, 50].map((h) => (
            <button key={h} type="button" disabled={value.unlimited} className={`${chip(!value.unlimited && limit === h)} disabled:opacity-40`} onClick={() => onChange({ unlimited: false, h: String(h), m: '0' })}>{h}h</button>
          ))}
        </div>
      </div>
      <div className="mt-3">
        {!value.unlimited && <div className="h-1.5 rounded-full bg-[var(--kt-s3)] overflow-hidden mb-1.5"><div className={`h-full rounded-full ${pct >= 100 ? 'bg-[var(--kt-danger)]' : pct >= 80 ? 'bg-[var(--kt-warn)]' : 'bg-[var(--kt-accent)]'}`} style={{ width: `${pct}%` }} /></div>}
        <div className="text-[12px] text-[var(--kt-muted)] tabular-nums">
          Used {exact(usage.used_hours, { fromHours: true })}{usage.reserved_hours > 0 ? ` · ${exact(usage.reserved_hours, { fromHours: true })} in progress` : ''}
          {value.unlimited ? ' · no limit' : ` · ${exact(Math.max(0, (limit || 0) - used), { fromHours: true })} left of ${hrs(limit || 0)}`}
        </div>
        {breakdown && (
          <div className="mt-1 text-[12px] text-[var(--kt-faint)] tabular-nums">
            Spent so far: transcription {exact(breakdown.transcribe.used_hours, { fromHours: true })} · translation {exact(breakdown.translate.used_hours, { fromHours: true })}
          </div>
        )}
      </div>
    </div>
  );
}

function NumberLimit({ label, hint, unit, value, onChange, presets }) {
  const none = value === '';
  return (
    <div className="rounded-xl border border-[var(--kt-s3)] bg-[var(--kt-s0)]/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-medium text-[var(--kt-text)]">{label}</div>
          <div className="mt-0.5 text-[12px] text-[var(--kt-muted)]">{hint}</div>
        </div>
        <label className="flex items-center gap-2 text-[12px] text-[var(--kt-muted)] cursor-pointer shrink-0">
          No limit <Toggle on={none} label={`${label}: no limit`} onChange={(n) => onChange(n ? '' : String(presets[1]))} />
        </label>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <input type="number" min="1" inputMode="numeric" aria-label={label} disabled={none} value={value} placeholder="—"
          onChange={(e) => onChange(e.target.value)} className={`${field} w-24`} />
        <span className="text-[12px] text-[var(--kt-muted)]">{unit}</span>
        <div className="ml-auto flex gap-1">
          {presets.map((p) => <button key={p} type="button" className={chip(String(p) === value)} onClick={() => onChange(String(p))}>{p}</button>)}
        </div>
      </div>
    </div>
  );
}

export default function AdminLimitsModal({ userId, onClose, onSaved }) {
  const { token } = useAuth();
  const [user, setUser] = useState(null);
  const [form, setForm] = useState(null);
  const [initial, setInitial] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/admin/users/${userId}/access`, { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Could not load this account');
        if (!alive) return;
        const u = data.user, a = u.access;
        const f = {
          t: { unlimited: u.usage.pool.unlimited, ...toHM(u.usage.pool.limit_hours) },
          maxFile: a.max_file_minutes == null ? '' : String(a.max_file_minutes),
          perDay: a.max_jobs_per_day == null ? '' : String(a.max_jobs_per_day),
          until: a.access_until || '',
          ...Object.fromEntries(SWITCHES.map(([k]) => [k, a[k]])),
        };
        setUser(u); setForm(f); setInitial(f);
      } catch (e) { if (alive) setError(e.message); }
    })();
    return () => { alive = false; };
  }, [userId, token]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const body = useMemo(() => {
    if (!form || !initial) return {};
    const out = {};
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    if (!same(form.t, initial.t)) Object.assign(out, form.t.unlimited ? { unlimited: true } : { hours: fromHM(form.t) });
    if (form.maxFile !== initial.maxFile) out.max_file_minutes = form.maxFile === '' ? null : Number(form.maxFile);
    if (form.perDay !== initial.perDay) out.max_jobs_per_day = form.perDay === '' ? null : Number(form.perDay);
    if (form.until !== initial.until) out.access_until = form.until || null;
    SWITCHES.forEach(([k]) => { if (form[k] !== initial[k]) out[k] = form[k]; });
    return out;
  }, [form, initial]);
  const dirty = Object.keys(body).length > 0;

  const save = async () => {
    if (!form.t.unlimited && form.t.h === '' && form.t.m === '') { setError('Enter the hours, or turn on Unlimited.'); return; }
    setBusy(true); setError('');
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}/access`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Could not save');
      setInitial(form); setUser(data.user); setSaved(true);
      onSaved && onSaved(data.user);
      setTimeout(onClose, 700);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const protectedAdmin = user?.is_admin;
  const today = new Date().toISOString().slice(0, 10);
  const plusDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-xs flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()} style={{ fontFamily: 'var(--kt-font-ui)' }}>
      <div role="dialog" aria-modal="true" aria-label="Limits and access" className="w-full max-w-xl max-h-[92vh] flex flex-col rounded-2xl border border-[var(--kt-s4)] bg-[var(--kt-s1)] shadow-2xl overflow-hidden">
        <header className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-[var(--kt-s3)]">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold text-[var(--kt-text)]">Limits & access</h3>
            <p className="mt-0.5 text-[12px] text-[var(--kt-muted)] truncate">{user ? `${user.name} · ${user.email}` : 'Loading…'}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 -mr-1.5 rounded-lg text-[var(--kt-muted)] hover:text-[var(--kt-text)] hover:bg-[var(--kt-s2)] cursor-pointer"><X size={16} /></button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-7">
          {!form ? (
            <div className="py-10 text-center text-[13px] text-[var(--kt-muted)]">{error || <Loader2 size={18} className="animate-spin inline" />}</div>
          ) : (
            <>
              <Section icon={Timer} title="Hours" hint="One pool for everything. Transcription and translation both spend from it, in any mix. Measured on the server from the length of the media; translation counts the full video length × number of languages.">
                <TimeBudget icon={Timer} label="Total hours" usage={user.usage.pool} breakdown={user.usage} value={form.t} onChange={(t) => set({ t })} />
              </Section>

              <Section icon={Timer} title="Job limits" hint={`Jobs in the last 24 hours: ${user.access.jobs_last_24h ?? 0}`}>
                <NumberLimit label="Longest file per job" hint="Files longer than this are refused before any work starts." unit="minutes"
                  value={form.maxFile} onChange={(maxFile) => set({ maxFile })} presets={[30, 60, 90, 180]} />
                <NumberLimit label="Jobs per day" hint="Transcriptions, subtitle runs and translations in any 24 hours. Refunded jobs don't count." unit="jobs"
                  value={form.perDay} onChange={(perDay) => set({ perDay })} presets={[5, 10, 25, 50]} />
              </Section>

              <Section icon={ShieldCheck} title="Access" hint={protectedAdmin ? 'Administrator accounts always keep every feature.' : 'Switched-off features are refused by the server with a clear message.'}>
                <div className="rounded-xl border border-[var(--kt-s3)] divide-y divide-[var(--kt-s3)]">
                  {SWITCHES.map(([k, label, hint]) => (
                    <div key={k} className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-[var(--kt-text)]">{label}</div>
                        <div className="text-[12px] text-[var(--kt-muted)]">{hint}</div>
                      </div>
                      <Toggle on={form[k]} label={label} disabled={protectedAdmin} onChange={(v) => set({ [k]: v })} />
                    </div>
                  ))}
                </div>
              </Section>

              <Section icon={CalendarClock} title="Access period" hint="After the last day the account can't sign in or run anything. Its work and history are kept.">
                <div className="flex flex-wrap items-center gap-2">
                  <input type="date" min={today} aria-label="Last day of access" disabled={protectedAdmin} value={form.until}
                    onChange={(e) => set({ until: e.target.value })} className={`${field} w-44 [color-scheme:dark]`} />
                  <button type="button" disabled={protectedAdmin} className={chip(form.until === '')} onClick={() => set({ until: '' })}>No end date</button>
                  {[[7, '1 week'], [30, '30 days'], [90, '90 days'], [365, '1 year']].map(([n, l]) => (
                    <button key={n} type="button" disabled={protectedAdmin} className={`${chip(form.until === plusDays(n))} disabled:opacity-40`} onClick={() => set({ until: plusDays(n) })}>{l}</button>
                  ))}
                </div>
                {form.until && <p className="text-[12px] text-[var(--kt-muted)]">Works through the end of {new Date(`${form.until}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}.</p>}
                {user.access.expired && <p className="text-[12px] text-[var(--kt-danger)]">This account's access has ended. Pick a later date or "No end date" to restore it.</p>}
              </Section>
            </>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 px-6 py-4 border-t border-[var(--kt-s3)]">
          <span className="text-[12px] min-w-0 truncate">
            {error && form ? <span className="text-[var(--kt-danger)]">{error}</span>
              : saved ? <span className="text-[var(--kt-success)] inline-flex items-center gap-1"><Check size={13} /> Saved. The user has been notified.</span>
              : <span className="text-[var(--kt-faint)]">{dirty ? `${Object.keys(body).length} change${Object.keys(body).length === 1 ? '' : 's'}` : 'No changes'}</span>}
          </span>
          <div className="flex gap-2 shrink-0">
            <button type="button" onClick={onClose} className="h-9 px-4 rounded-lg text-[13px] font-medium text-[var(--kt-muted)] hover:text-[var(--kt-text)] hover:bg-[var(--kt-s2)] cursor-pointer">Cancel</button>
            <button type="button" onClick={save} disabled={!dirty || busy || !form}
              className="h-9 px-4 rounded-lg text-[13px] font-semibold bg-[var(--kt-accent)] text-[var(--kt-accent-ink)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1.5">
              {busy && <Loader2 size={14} className="animate-spin" />} Save changes
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
