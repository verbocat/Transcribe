import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  UserPlus, Search, Eye, SlidersHorizontal, X, Copy, Check, Trash2, KeyRound, Ban, UserCheck, ListOrdered, Pencil, RefreshCw, AlertTriangle,
  ShieldCheck, ShieldOff,
} from 'lucide-react';

// Where an administrator's rights come from (only those granted in this panel can be removed here).
const ADMIN_SOURCE = {
  builtin: 'Built-in super administrator',
  server: 'Set on the server (ADMIN_EMAILS), cannot be removed here',
  granted: 'Made administrator in this panel',
};
import { API_BASE } from '../../config';
import { useAuth } from '../../auth_views/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { formatHours } from '../UsageBadge';
import AdminLimitsModal from './AdminLimitsModal';
import { exact } from './adminUi';

const api = async (token, path, { method = 'GET', body } = {}) => {
  const res = await fetch(`${API_BASE}/api/admin${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Request failed');
  return data;
};

function Meter({ b, split, isDark }) {
  const sub = split && (
    <div className={`mt-1 text-[10.5px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
      Transcription {formatHours(split.transcribe.used_hours)} · Translation {formatHours(split.translate.used_hours)}
    </div>
  );
  if (b.unlimited) return <div><span className={isDark ? 'text-slate-300' : 'text-slate-600'}>Unlimited · used {formatHours(b.used_hours)}</span>{sub}</div>;
  const total = b.limit_hours || 0;
  const pct = total > 0 ? Math.min(100, ((b.used_hours + b.reserved_hours) / total) * 100) : 100;
  const bar = pct >= 100 ? 'bg-rose-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div className="min-w-[150px]">
      <div className="flex justify-between font-mono text-[11px] mb-1">
        <span className={isDark ? 'text-white font-bold' : 'text-slate-900 font-bold'}>{formatHours(b.remaining_hours)} left</span>
        <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>of {formatHours(b.limit_hours)}</span>
      </div>
      <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-[var(--kt-s3)]' : 'bg-slate-200'}`}>
        <div className={`h-full ${bar}`} style={{ width: `${pct}%` }} />
      </div>
      {sub}
    </div>
  );
}

function HoursField({ label, hours, unlimited, onHours, onUnlimited, isDark }) { // `hours` holds minutes
  const input = isDark ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-white' : 'bg-white border-slate-300 text-slate-900';
  return (
    <div>
      <label className={`block font-semibold mb-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{label}</label>
      <div className="flex items-center gap-3">
        <input
          type="number" min="0" step="any" inputMode="decimal" disabled={unlimited} value={unlimited ? '' : hours}
          placeholder={unlimited ? 'Unlimited' : 'Minutes, e.g. 60'} onChange={(e) => onHours(e.target.value)}
          className={`w-32 px-3 py-1.5 rounded-lg border text-xs disabled:opacity-50 ${input}`} aria-label={`${label} (minutes)`}
        />
        <label className={`flex items-center gap-1.5 cursor-pointer ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
          <input type="checkbox" checked={unlimited} onChange={(e) => onUnlimited(e.target.checked)} /> Unlimited
        </label>
      </div>
    </div>
  );
}

function RoleField({ value, onChange, isDark }) {
  const on = isDark ? 'bg-[var(--kt-accent)] text-[var(--kt-accent-ink)] border-transparent' : 'bg-blue-600 text-white border-transparent';
  const off = isDark ? 'bg-[var(--kt-s2)] text-slate-300 border-[var(--kt-s4)]' : 'bg-white text-slate-700 border-slate-300';
  return (
    <div>
      <label className={`block font-semibold mb-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Role</label>
      <div className="grid grid-cols-2 gap-2">
        {[['coordinator', 'Project coordinator', 'Transcribes and translates (uses minutes), shares projects with linguists.'],
          ['linguist', 'Linguist', 'Only reviews and edits subtitles shared with them. No minutes.']].map(([v, t, d]) => (
          <button key={v} type="button" onClick={() => onChange(v)} className={`text-left p-2.5 rounded-lg border cursor-pointer ${value === v ? on : off}`}>
            <div className="font-bold">{t}</div><div className="text-[11px] opacity-80">{d}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children, isDark }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`border rounded-2xl max-w-lg w-full max-h-[90vh] overflow-auto shadow-2xl ${isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)]' : 'bg-white border-slate-200'}`}>
        <div className={`p-4 border-b flex items-center justify-between ${isDark ? 'border-[var(--kt-s3)]' : 'border-slate-200'}`}>
          <h3 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{title}</h3>
          <button type="button" onClick={onClose} className={`p-1 rounded-lg cursor-pointer ${isDark ? 'text-slate-400 hover:text-white hover:bg-[var(--kt-s3)]' : 'text-slate-400 hover:bg-slate-100'}`} aria-label="Close"><X size={16} /></button>
        </div>
        <div className="p-5 text-xs space-y-4">{children}</div>
      </div>
    </div>
  );
}

const OFF_LABELS = {
  can_transcribe_studio: 'No Transcribe Studio', can_subtitle_studio: 'No Subtitle Studio', can_translate: 'No translation',
  can_ai_optimize: 'No AI assistance', can_export: 'No exports', can_audio_peaks: 'No waveform',
};

/** Small chips under the account name for every limit or switched-off feature, so restrictions are visible at a glance. */
function AccessBadges({ a }) {
  if (!a) return null;
  const chips = [];
  if (a.expired) chips.push(['Access ended', true]);
  else if (a.access_until) chips.push([`Until ${new Date(`${a.access_until}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`, false]);
  Object.entries(OFF_LABELS).forEach(([k, l]) => { if (a[k] === false) chips.push([l, true]); });
  if (!chips.length) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {chips.map(([label, warn]) => (
        <span key={label} className={`text-[10.5px] px-1.5 py-0.5 rounded-md ${warn ? 'bg-[var(--kt-danger)]/12 text-[var(--kt-danger)]' : 'bg-[var(--kt-s3)] text-[var(--kt-muted)]'}`}>{label}</span>
      ))}
    </div>
  );
}

const LEDGER_TONE = { Charged: 'text-[var(--kt-success)]', Refunded: 'text-[var(--kt-muted)]', Running: 'text-[var(--kt-accent)]', 'Limit changed': 'text-[var(--kt-warn)]' };

/** The ledger records "reserve" then "settle"/"refund" for every job; show one row per job with its outcome. */
function ledgerRows(ledger) {
  const closed = new Map();
  ledger.forEach((r) => { if ((r.event === 'settle' || r.event === 'refund') && r.reservation_id) closed.set(r.reservation_id, r); });
  return ledger
    .filter((r) => r.event !== 'settle' && r.event !== 'refund')
    .map((r) => {
      if (r.event === 'limit_change') return { ...r, status: 'Limit changed', what: (r.note || '').replace(/^limit /, '') };
      const end = closed.get(r.reservation_id);
      return { ...r, status: !end ? 'Running' : end.event === 'settle' ? 'Charged' : 'Refunded', what: r.ref || r.route || '', at: r.at };
    });
}

export default function AdminAccounts({ refreshKey = 0, onOpenDossier }) {
  const { token, user: me } = useAuth();
  const { isDark } = useTheme();
  const [users, setUsers] = useState([]);
  const [limitsFor, setLimitsFor] = useState(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null); // {type:'create'|'hours'|'edit'|'ledger'|'delete'|'secret', user?, ...}
  const [form, setForm] = useState({});
  const [copied, setCopied] = useState(false);
  const [ledger, setLedger] = useState([]);
  const [toast, setToast] = useState('');
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(''), 3500); return () => clearTimeout(t); }, [toast]);

  // `manual` is the Refresh button: it calls .../users/refresh so the request is named for what was clicked
  const load = useCallback(async (manual = false) => {
    try {
      const data = await api(token, manual === true ? '/users/refresh?limit=200' : '/users?limit=200');
      setUsers(data.users || []);
      setError('');
    } catch (e) { setError(e.message); }
  }, [token]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => !q || (u.name || '').toLowerCase().includes(q) || (u.email || '').toLowerCase().includes(q));
  }, [users, search]);

  const hoursBody = (f) => (f.role === 'linguist' ? {} : f.unl ? { unlimited: true } : { hours: f.hours === '' ? null : Number(f.hours) / 60 });

  const run = async (fn) => {
    setBusy(true); setError('');
    try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };

  const openCreate = () => { setForm({ name: '', email: '', password: '', hours: '60', unl: false, role: 'coordinator' }); setDialog({ type: 'create' }); setError(''); };
  const openEdit = (u) => { setForm({ name: u.name, email: u.email, newPassword: '', role: u.role === 'linguist' ? 'linguist' : 'coordinator' }); setDialog({ type: 'edit', user: u }); setError(''); };
  const openLedger = (u) => run(async () => {
    const data = await api(token, `/users/${u.id}/usage?limit=200`);
    setLedger(data.ledger || []); setDialog({ type: 'ledger', user: u });
  });

  const submitCreate = (e) => {
    e.preventDefault();
    run(async () => {
      const data = await api(token, '/users', { method: 'POST', body: { name: form.name, email: form.email, password: form.password || null, role: form.role, ...hoursBody(form) } });
      setDialog(data.generated_password ? { type: 'secret', user: data.user, password: data.generated_password } : null);
    });
  };
  const submitEdit = (e, reset = false) => {
    e.preventDefault();
    run(async () => {
      const body = { name: form.name, email: form.email, ...(reset ? { reset_password: true } : form.newPassword ? { new_password: form.newPassword } : {}) };
      const data = await api(token, `/users/${dialog.user.id}/edit`, { method: 'PATCH', body });
      const roleBefore = dialog.user.role === 'linguist' ? 'linguist' : 'coordinator';
      if (!dialog.user.is_admin && form.role && form.role !== roleBefore) await api(token, `/users/${dialog.user.id}/role`, { method: 'PATCH', body: { role: form.role } });
      setDialog(data.generated_password ? { type: 'secret', user: data.user, password: data.generated_password } : null);
    });
  };
  const toggleBlock = (u) => run(() => api(token, `/users/${u.id}/${u.is_blocked ? 'enable' : 'disable'}`, { method: 'PATCH', body: { is_blocked: !u.is_blocked } }));
  const confirmDelete = () => run(async () => { const gone = dialog.user; await api(token, `/users/${gone.id}/delete`, { method: 'DELETE' }); setDialog(null); setToast(`Account ${gone.email} deleted.`); });
  const confirmAdmin = () => run(async () => { await api(token, `/users/${dialog.user.id}/admin`, { method: 'PUT', body: { admin: dialog.grant } }); setDialog(null); });

  const card = isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s3)]' : 'bg-white border-slate-200 shadow-2xs';
  const input = isDark ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-white placeholder-slate-500' : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400';
  const btn = isDark ? 'bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] text-slate-200 border-[var(--kt-s4)]' : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300';
  const primary = isDark ? 'bg-[var(--kt-accent)] text-[var(--kt-accent-ink)]' : 'bg-blue-600 text-white';
  const muted = isDark ? 'text-slate-400' : 'text-slate-500';
  const strong = isDark ? 'text-white' : 'text-slate-900';

  return (
    <div className="space-y-4" data-testid="admin-accounts">
      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] px-4 py-2.5 rounded-xl text-[13px] font-medium shadow-lg bg-emerald-600 text-white flex items-center gap-2">
          <Check size={14} /> {toast}
        </div>
      )}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className={`text-base font-bold ${strong}`}>Accounts &amp; Minutes</h2>
          <p className={`text-xs ${muted}`}>Create accounts on any email domain and set how many minutes each person can use, for transcription and translation in any mix. Limits are enforced on the server.</p>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => load(true)} className={`p-2 rounded-lg border cursor-pointer ${btn}`} title="Refresh" aria-label="Refresh"><RefreshCw size={14} /></button>
          <button type="button" onClick={openCreate} className={`px-3 py-2 rounded-lg text-xs font-bold flex items-center gap-1.5 cursor-pointer ${primary}`}><UserPlus size={14} /> Create account</button>
        </div>
      </div>

      {error && !dialog && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 flex items-center gap-2"><AlertTriangle size={14} /> {error}</div>
      )}

      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or email..." className={`w-full pl-9 pr-3 py-1.5 rounded-lg border text-xs ${input}`} />
      </div>

      <div className={`border rounded-2xl overflow-x-auto ${card}`}>
        <table className="w-full text-xs">
          <thead>
            <tr className={`text-left ${muted} border-b ${isDark ? 'border-[var(--kt-s3)]' : 'border-slate-200'}`}>
              <th className="p-3 font-semibold">Account</th>
              <th className="p-3 font-semibold">Minutes</th>
              <th className="p-3 font-semibold text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => (
              <tr key={u.id} className={`border-b last:border-0 ${isDark ? 'border-[var(--kt-s3)]' : 'border-slate-100'}`}>
                <td className="p-3">
                  <div className={`font-semibold ${strong}`}>{u.name} {u.is_admin && <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-[var(--kt-accent)]/20 text-[var(--kt-accent)] font-bold" title={ADMIN_SOURCE[u.admin_source] || 'Administrator'}>ADMIN</span>} {u.is_blocked && <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-400 font-bold">DISABLED</span>} {!u.is_admin && <span className={`ml-1 text-[9px] px-1.5 py-0.5 rounded font-bold ${u.role === 'linguist' ? 'bg-violet-500/20 text-violet-400' : 'bg-sky-500/20 text-sky-400'}`}>{u.role === 'linguist' ? 'LINGUIST' : 'COORDINATOR'}</span>}</div>
                  <AccessBadges a={u.access} />
                  <div className={`font-mono ${muted}`}>{u.email}</div>
                </td>
                <td className="p-3">{u.role === 'linguist' ? <span className={muted}>No minutes (review only)</span> : <Meter b={u.usage.pool} split={u.usage} isDark={isDark} />}</td>
                <td className="p-3">
                  <div className="flex justify-end gap-1.5">
                    <button type="button" onClick={() => setLimitsFor(u.id)} className={`px-2 py-1.5 rounded-lg border flex items-center gap-1 cursor-pointer ${btn}`} title="Usage time, job limits, feature access and end date"><SlidersHorizontal size={12} /> Limits</button>
                    {onOpenDossier && <button type="button" onClick={() => onOpenDossier(u.id)} className={`p-1.5 rounded-lg border cursor-pointer ${btn}`} title="Details: sessions, logins, productions, send a notice" aria-label="Details"><Eye size={13} /></button>}
                    <button type="button" onClick={() => openLedger(u)} className={`p-1.5 rounded-lg border cursor-pointer ${btn}`} title="Usage history" aria-label="Usage history"><ListOrdered size={13} /></button>
                    <button type="button" onClick={() => openEdit(u)} className={`p-1.5 rounded-lg border cursor-pointer ${btn}`} title="Edit account" aria-label="Edit account"><Pencil size={13} /></button>
                    {!u.is_admin && !u.is_blocked && (
                      <button type="button" onClick={() => { setError(''); setDialog({ type: 'admin', user: u, grant: true }); }} className={`p-1.5 rounded-lg border cursor-pointer ${btn}`} title="Make administrator" aria-label="Make administrator"><ShieldCheck size={13} /></button>
                    )}
                    {u.is_admin && u.admin_source === 'granted' && u.id !== me?.id && (
                      <button type="button" onClick={() => { setError(''); setDialog({ type: 'admin', user: u, grant: false }); }} className="p-1.5 rounded-lg border border-amber-500/40 text-amber-400 hover:bg-amber-500/10 cursor-pointer" title="Remove administrator access" aria-label="Remove administrator access"><ShieldOff size={13} /></button>
                    )}
                    {!u.is_admin && (
                      <>
                        <button type="button" onClick={() => toggleBlock(u)} className={`p-1.5 rounded-lg border cursor-pointer ${btn}`} title={u.is_blocked ? 'Enable account' : 'Disable account'} aria-label={u.is_blocked ? 'Enable account' : 'Disable account'}>{u.is_blocked ? <UserCheck size={13} /> : <Ban size={13} />}</button>
                        <button type="button" onClick={() => setDialog({ type: 'delete', user: u })} className="p-1.5 rounded-lg border border-rose-500/40 text-rose-400 hover:bg-rose-500/10 cursor-pointer" title="Delete account" aria-label="Delete account"><Trash2 size={13} /></button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={4} className={`p-6 text-center ${muted}`}>No accounts found.</td></tr>}
          </tbody>
        </table>
      </div>

      {dialog?.type === 'create' && (
        <Modal title="Create account" onClose={() => setDialog(null)} isDark={isDark}>
          <form onSubmit={submitCreate} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div><label className={`block font-semibold mb-1 ${strong}`}>Name</label><input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`w-full px-3 py-1.5 rounded-lg border ${input}`} /></div>
              <div><label className={`block font-semibold mb-1 ${strong}`}>Email (any domain)</label><input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`w-full px-3 py-1.5 rounded-lg border ${input}`} /></div>
            </div>
            <div><label className={`block font-semibold mb-1 ${strong}`}>Password <span className={`font-normal ${muted}`}>(leave empty to generate one)</span></label><input type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className={`w-full px-3 py-1.5 rounded-lg border font-mono ${input}`} placeholder="Generated if empty" /></div>
            <RoleField value={form.role} onChange={(role) => setForm({ ...form, role })} isDark={isDark} />
            {form.role === 'linguist'
              ? <p className={muted}>Linguists spend no minutes. They only see projects a coordinator shares with them.</p>
              : <HoursField label="Minutes (shared by transcription and translation)" hours={form.hours} unlimited={form.unl} onHours={(v) => setForm({ ...form, hours: v })} onUnlimited={(v) => setForm({ ...form, unl: v })} isDark={isDark} />}
            {error && <div className="text-rose-400">{error}</div>}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className={`px-3 py-2 rounded-lg border cursor-pointer ${btn}`}>Cancel</button><button disabled={busy} className={`px-4 py-2 rounded-lg font-bold cursor-pointer disabled:opacity-50 ${primary}`}>Create account</button></div>
          </form>
        </Modal>
      )}


      {dialog?.type === 'edit' && (
        <Modal title={`Edit account · ${dialog.user.email}`} onClose={() => setDialog(null)} isDark={isDark}>
          <form onSubmit={submitEdit} className="space-y-4">
            <div><label className={`block font-semibold mb-1 ${strong}`}>Name</label><input required minLength={2} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`w-full px-3 py-1.5 rounded-lg border ${input}`} /></div>
            <div><label className={`block font-semibold mb-1 ${strong}`}>Email</label><input required type="email" disabled={dialog.user.is_admin} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={`w-full px-3 py-1.5 rounded-lg border disabled:opacity-50 ${input}`} /></div>
            {!dialog.user.is_admin && <RoleField value={form.role} onChange={(role) => setForm({ ...form, role })} isDark={isDark} />}
            {!dialog.user.is_admin && dialog.user.role === 'linguist' && form.role === 'coordinator' && <p className={muted}>This account has no minutes yet. Set them under Limits after saving.</p>}
            {!(dialog.user.is_admin && dialog.user.id !== me?.id) && (
              <div><label className={`block font-semibold mb-1 ${strong}`}>New password <span className={`font-normal ${muted}`}>(optional; signs the person out everywhere)</span></label>
                <div className="flex gap-2"><input type="text" autoComplete="off" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} className={`flex-1 px-3 py-1.5 rounded-lg border font-mono ${input}`} placeholder="Leave empty to keep the current one" />
                  <button type="button" disabled={busy} onClick={(e) => submitEdit(e, true)} className={`px-3 py-1.5 rounded-lg border flex items-center gap-1 cursor-pointer ${btn}`}><KeyRound size={12} /> Generate</button></div></div>
            )}
            {error && <div className="text-rose-400">{error}</div>}
            <div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className={`px-3 py-2 rounded-lg border cursor-pointer ${btn}`}>Cancel</button><button disabled={busy} className={`px-4 py-2 rounded-lg font-bold cursor-pointer disabled:opacity-50 ${primary}`}>Save</button></div>
          </form>
        </Modal>
      )}

      {dialog?.type === 'secret' && (
        <Modal title="Account ready" onClose={() => setDialog(null)} isDark={isDark}>
          <p className={strong}>Share this password with <strong>{dialog.user.email}</strong> now. It is shown only once and is not stored anywhere readable.</p>
          <div className={`flex items-center justify-between gap-2 p-3 rounded-xl border font-mono text-sm ${isDark ? 'bg-[var(--kt-s0)] border-[var(--kt-s3)] text-white' : 'bg-slate-50 border-slate-200 text-slate-900'}`}>
            <span data-testid="generated-password" className="break-all select-all">{dialog.password}</span>
            <button type="button" onClick={() => { navigator.clipboard?.writeText(dialog.password); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className={`p-2 rounded-lg border cursor-pointer ${btn}`} aria-label="Copy password">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
          </div>
          <div className="flex justify-end"><button type="button" onClick={() => setDialog(null)} className={`px-4 py-2 rounded-lg font-bold cursor-pointer ${primary}`}>Done</button></div>
        </Modal>
      )}

      {dialog?.type === 'delete' && (
        <Modal title="Delete account" onClose={() => setDialog(null)} isDark={isDark}>
          <p className={strong}>Delete <strong>{dialog.user.email}</strong>? They are signed out and cannot sign in again. Their usage history is kept.</p>
          {error && <div className="text-rose-400">{error}</div>}
          <div className="flex justify-end gap-2"><button type="button" onClick={() => setDialog(null)} className={`px-3 py-2 rounded-lg border cursor-pointer ${btn}`}>Cancel</button><button disabled={busy} onClick={confirmDelete} className="px-4 py-2 rounded-lg font-bold bg-rose-600 text-white cursor-pointer disabled:opacity-50">Delete</button></div>
        </Modal>
      )}

      {dialog?.type === 'admin' && (
        <Modal title={dialog.grant ? 'Make administrator' : 'Remove administrator access'} onClose={() => setDialog(null)} isDark={isDark}>
          {dialog.grant ? (
            <p className={strong}>Make <strong>{dialog.user.email}</strong> an administrator? They get this admin panel: every account, limits, usage and media, and they can make or remove other administrators too. They see it after signing in again.</p>
          ) : (
            <p className={strong}>Remove administrator access from <strong>{dialog.user.email}</strong>? They become a coordinator and lose the admin panel straight away.</p>
          )}
          {error && <div className="text-rose-400">{error}</div>}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} className={`px-3 py-2 rounded-lg border cursor-pointer ${btn}`}>Cancel</button>
            <button disabled={busy} onClick={confirmAdmin} className={`px-4 py-2 rounded-lg font-bold text-white cursor-pointer disabled:opacity-50 ${dialog.grant ? 'bg-[var(--kt-accent)]' : 'bg-amber-600'}`}>{dialog.grant ? 'Make administrator' : 'Remove access'}</button>
          </div>
        </Modal>
      )}

      {dialog?.type === 'ledger' && (
        <Modal title={`Usage history · ${dialog.user.email}`} onClose={() => setDialog(null)} isDark={isDark}>
          {ledgerRows(ledger).length === 0 ? <p className={muted}>No usage yet.</p> : (
            <div className="max-h-[60vh] overflow-auto -mx-1">
              <table className="w-full text-[12px]">
                <thead><tr className={`text-left ${muted}`}><th className="py-1.5 px-1 font-medium">When</th><th className="px-1 font-medium">Type</th><th className="px-1 font-medium">Duration</th><th className="px-1 font-medium">Status</th><th className="px-1 font-medium">What</th></tr></thead>
                <tbody>{ledgerRows(ledger).map((r) => (
                  <tr key={r.id} className="border-t border-[var(--kt-s3)] text-[var(--kt-text)]">
                    <td className="py-2 px-1 whitespace-nowrap text-[var(--kt-muted)]">{r.at ? new Date(r.at + (r.at.endsWith('Z') ? '' : 'Z')).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</td>
                    <td className="px-1 whitespace-nowrap">{r.kind === 'transcribe' ? 'Transcription' : r.kind === 'translate' ? 'Translation' : 'Minutes limit'}</td>
                    <td className="px-1 font-mono whitespace-nowrap">{r.event === 'limit_change' ? '—' : exact(r.ms)}</td>
                    <td className="px-1 whitespace-nowrap"><span className={LEDGER_TONE[r.status]}>{r.status}</span></td>
                    <td className="px-1 max-w-[220px] truncate text-[var(--kt-muted)]" title={r.what}>{r.what}</td>
                  </tr>))}</tbody>
              </table>
            </div>
          )}
        </Modal>
      )}

      {limitsFor && <AdminLimitsModal userId={limitsFor} onClose={() => setLimitsFor(null)} onSaved={() => load()} />}
    </div>
  );
}
