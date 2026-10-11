import React, { useEffect, useMemo, useState } from 'react';
import { isQcFixable } from './subtitleTools';
import '../qc/qc.css';
import {
  AlertCircle, AlertTriangle, CheckCircle2, Wand2, Sparkles, Layers, Volume2, Check, Crosshair, Loader2, ChevronDown, ChevronRight, UserRound
} from 'lucide-react';

export default function NetflixQCPanel({
  complianceScore = 100,
  totalErrors = 0,
  totalWarnings = 0,
  totalEvents = 0,
  cpsStats = { min_cps: 0, max_cps: 0, avg_cps: 0, p95_cps: 0, events_over_limit: 0 },
  events = [],
  contentType = 'adult',
  cplLimit = 42,
  cpsLimit = 20,
  onAutoFix = () => {},
  onApplyFixes = null,
  onCheckFixes = null,
  onGeminiFix = null,
  isFixingWithGemini = false,
  onAcousticSync = null,
  isSyncingAudio = false,
  onExport = () => {},
  onRebreakAll = () => {},
  onJumpToEvent = () => {},
  onClose = null,
  qcUnavailable = false
}) {
  const isPassing = complianceScore >= 98;
  const isAmber = complianceScore >= 80 && complianceScore < 98;

  // key -> { message } for issues fixed from this list
  const [fixed, setFixed] = useState({});
  const [busyKeys, setBusyKeys] = useState({});
  const [showFixed, setShowFixed] = useState(false);

  const [showGuidelines, setShowGuidelines] = useState(false);

  // Flat issue list, errors first, then in subtitle order
  const issues = useMemo(() => {
    const out = [];
    events.forEach((event) => {
      const errList = event.qc_errors || event.errors || [];
      const eventId = event.id ?? event.event_id;
      const start = event.start_time ?? event.start ?? 0;
      errList.forEach((err) => {
        const ruleId = (err.rule_id || err.error_type || '').toUpperCase();
        const msg = (err.message || '').toLowerCase();
        if (ruleId.includes('PYRAMID') || msg.includes('pyramid') || msg.includes('bottom-heavy')) return;
        const isCps = ruleId.includes('CPS') || ruleId.includes('SPEED') || msg.includes('cps');
        out.push({
          key: `${eventId}|${ruleId}|${err.message}`,
          eventId,
          ruleId: err.rule_id || err.error_type || 'QC',
          message: err.message,
          severity: isCps ? 'warning' : (err.severity || 'error'),
          suggestedFix: err.suggested_fix,
          time: start,
          canTry: isQcFixable(ruleId) && !!onApplyFixes,
        });
      });
    });
    return out.sort((a, b) => (a.severity === 'error' ? 0 : 1) - (b.severity === 'error' ? 0 : 1) || a.time - b.time);
  }, [events, onApplyFixes]);

  // Which fixes can really be done: the editor dry-runs every fix, so impossible ones (no free gap, text too
  // long, would break another rule) are never counted as automatic and are listed for a human instead.
  const [plan, setPlan] = useState({});
  useEffect(() => {
    const cand = issues.filter((i) => i.canTry);
    if (!cand.length) { setPlan({}); return undefined; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const res = onCheckFixes
          ? await onCheckFixes(cand.map((i) => ({ key: i.key, eventId: i.eventId, ruleId: i.ruleId })))
          : cand.map((i) => ({ key: i.key, ok: true }));
        if (!cancelled) setPlan(Object.fromEntries(res.map((r) => [r.key, r])));
      } catch (e) {
        if (!cancelled) setPlan({});
      }
    }, 120);
    return () => { cancelled = true; clearTimeout(t); };
  }, [issues, onCheckFixes]);

  const decorated = useMemo(() => issues.map((i) => {
    const p = plan[i.key];
    const fixable = i.canTry && !!p?.ok;
    const why = i.canTry && p && !p.ok ? p.message : (i.canTry ? '' : 'There is no automatic fix for this rule.');
    return { ...i, fixable, why };
  }), [issues, plan]);

  // The list always mirrors the latest check; "fixed" is only a record of what this panel changed
  const openIssues = decorated;
  const currentKeys = new Set(issues.map((i) => i.key));
  const groups = [
    { key: 'error', title: 'Errors', tone: 'rose', items: openIssues.filter((i) => i.severity === 'error') },
    { key: 'warning', title: 'Warnings', tone: 'amber', items: openIssues.filter((i) => i.severity !== 'error') },
  ].filter((g) => g.items.length);
  const fixableOpen = openIssues.filter((i) => i.fixable);
  const humanOpen = openIssues.filter((i) => !i.fixable);
  const fixedList = Object.entries(fixed).filter(([k]) => !currentKeys.has(k));
  const anyBusy = Object.keys(busyKeys).length > 0;

  const runFixes = async (list) => {
    if (!list.length || !onApplyFixes) return;
    setBusyKeys((b) => ({ ...b, ...Object.fromEntries(list.map((i) => [i.key, true])) }));
    let results = [];
    try {
      results = await onApplyFixes(list.map((i) => ({ key: i.key, eventId: i.eventId, ruleId: i.ruleId })));
    } catch (e) {
      results = list.map((i) => ({ key: i.key, ok: false, message: 'The fix failed. Try again or edit the subtitle.' }));
    }
    setBusyKeys((b) => { const n = { ...b }; list.forEach((i) => delete n[i.key]); return n; });
    setFixed((f) => ({ ...f, ...Object.fromEntries(results.filter((r) => r.ok).map((r) => [r.key, { message: r.message, issue: list.find((i) => i.key === r.key) }])) }));
    setPlan((p) => ({ ...p, ...Object.fromEntries(results.map((r) => [r.key, r])) }));
  };

  const safeCpsStats = {
    min_cps: cpsStats?.min_cps ?? 0,
    max_cps: cpsStats?.max_cps ?? 0,
    avg_cps: cpsStats?.avg_cps ?? 0,
    p95_cps: cpsStats?.p95_cps ?? 0,
    events_over_limit: cpsStats?.events_over_limit ?? 0,
  };

  const tone = isPassing ? 'qc-good' : isAmber ? 'qc-warn' : 'qc-bad';
  const verdict = isPassing ? 'Passing' : isAmber ? 'Needs fixes' : 'Failing';
  const toolsDisabled = !events.length || qcUnavailable;

  return (
    <div className="h-full overflow-y-auto custom-scrollbar flex flex-col gap-4 pr-1">
      {qcUnavailable ? (
        <div className="qc-score" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <div className="qc-score-label qc-warn flex items-center gap-2"><AlertTriangle size={18} /> Quality check couldn't run</div>
          <p className="qc-score-sub">The backend is offline, so these results are not up to date. Start the backend, then edit any subtitle to check again.</p>
        </div>
      ) : (
        <div className="qc-score">
          <span className={`qc-score-num ${tone}`}>{complianceScore}%</span>
          <div className="min-w-0">
            <div className={`qc-score-label ${tone}`}>{verdict}</div>
            <div className="qc-score-sub">
              {totalErrors} {totalErrors === 1 ? 'error' : 'errors'}, {totalWarnings} {totalWarnings === 1 ? 'warning' : 'warnings'}. Target 98%
            </div>
          </div>
        </div>
      )}

      {/* One obvious action: fix what can be fixed. It only shows when something can really be fixed automatically. */}
      {fixableOpen.length > 0 && (
        <button type="button" className="qc-btn qc-btn-primary qc-btn-block" onClick={() => runFixes(fixableOpen)} disabled={anyBusy}
          title="Apply every available one-click fix in one step. Ctrl+Z undoes it.">
          {anyBusy ? <Loader2 size={18} className="animate-spin" /> : <Wand2 size={18} />}
          Fix {fixableOpen.length} {fixableOpen.length === 1 ? 'issue' : 'issues'} automatically
        </button>
      )}

      <details className="qc-more">
        <summary>More tools</summary>
        <div className="qc-more-body">
          {onRebreakAll && (
            <button type="button" className="qc-btn" onClick={onRebreakAll} disabled={toolsDisabled}
              title={`Re-break every subtitle's lines to fit ${cplLimit} characters`}>
              <Layers size={16} /> Re-break all lines
            </button>
          )}
          {onGeminiFix && (
            <button type="button" className="qc-btn" onClick={onGeminiFix} disabled={toolsDisabled || isFixingWithGemini}
              title="Ask the AI to rewrite, split and re-time subtitles that break the rules (uses AI credits)">
              <Sparkles size={16} className={isFixingWithGemini ? 'animate-spin' : ''} /> {isFixingWithGemini ? 'Fixing with AI…' : 'Fix with AI'}
            </button>
          )}
          {onAcousticSync && (
            <button type="button" className="qc-btn" onClick={onAcousticSync} disabled={toolsDisabled || isSyncingAudio}
              title="Move each subtitle's start and end to where speech actually starts and stops in the audio">
              <Volume2 size={16} /> {isSyncingAudio ? 'Re-syncing…' : 'Re-sync to speech'}
            </button>
          )}
        </div>
      </details>

      {/* Findings: errors first, each with one clear action */}
      <div className="flex flex-col gap-3">
        {openIssues.length > 0 && (
          <h4 className="qc-section-title">
            {openIssues.length} to review{fixableOpen.length > 0 ? ` · ${fixableOpen.length} automatic` : ''}{humanOpen.length > 0 ? ` · ${humanOpen.length} need a person` : ''}
          </h4>
        )}

        {groups.flatMap((g) => g.items).map((it) => (
          <article key={it.key} className="qc-finding" data-sev={it.severity === 'error' ? 'error' : 'warning'}>
            <div className="qc-finding-meta">
              {it.severity === 'error' ? <AlertCircle size={16} className="qc-bad" /> : <AlertTriangle size={16} className="qc-warn" />}
              <span>Subtitle #{it.eventId}</span>
            </div>
            <p className="qc-finding-msg">{it.message}</p>
            {it.suggestedFix && <p className="qc-finding-fix">{it.suggestedFix}</p>}
            <div className="qc-finding-actions">
              {it.fixable && (
                <button type="button" className="qc-btn qc-btn-primary" onClick={() => runFixes([it])} disabled={!!busyKeys[it.key]}>
                  {busyKeys[it.key] ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  {busyKeys[it.key] ? 'Fixing…' : 'Apply fix'}
                </button>
              )}
              <button type="button" className="qc-btn" onClick={() => onJumpToEvent(it.eventId)} title="Jump to this subtitle in the editor">
                <Crosshair size={16} /> Go to subtitle
              </button>
            </div>
            {!it.fixable && (
              <p className="qc-finding-hint" style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                <UserRound size={14} style={{ flex: 'none', marginTop: 2 }} />
                <span><b>Human interaction required.</b> {it.why || 'Fix this one by hand in the editor.'}</span>
              </p>
            )}
          </article>
        ))}

        {fixedList.length > 0 && (
          <section>
            <button type="button" className="qc-btn qc-btn-quiet" aria-expanded={showFixed} onClick={() => setShowFixed((v) => !v)}>
              {showFixed ? <ChevronDown size={16} /> : <ChevronRight size={16} />} <CheckCircle2 size={16} className="qc-good" /> Fixed ({fixedList.length})
            </button>
            {showFixed && (
              <ul className="space-y-2 pt-2 pl-2">
                {fixedList.map(([k, v]) => (
                  <li key={k} className="qc-finding-hint"><b>#{v.issue?.eventId}</b> {v.message}</li>
                ))}
              </ul>
            )}
          </section>
        )}

        {!qcUnavailable && totalErrors === 0 && totalWarnings === 0 && events.length > 0 && (
          <div className="qc-score" style={{ flexDirection: 'column', textAlign: 'center' }}>
            <CheckCircle2 size={28} className="qc-good" />
            <div className="qc-score-label">No issues found</div>
            <p className="qc-score-sub">Line length, reading speed, durations and gaps all meet the rules.</p>
          </div>
        )}
      </div>

      <details className="qc-more">
        <summary>Reading speed and guideline limits</summary>
        <dl className="qc-kv pb-2">
          <dt>Reading speed (min / avg / p95)</dt><dd>{safeCpsStats.min_cps.toFixed(1)} / {safeCpsStats.avg_cps.toFixed(1)} / {safeCpsStats.p95_cps.toFixed(1)} c/s</dd>
          <dt>Over the limit</dt><dd>{safeCpsStats.events_over_limit} subtitles</dd>
          <dt>Max line length</dt><dd>{cplLimit} characters</dd>
          <dt>Max reading speed</dt><dd>{cpsLimit} c/s</dd>
          <dt>Duration</dt><dd>0.83s to 7s</dd>
          <dt>Min gap</dt><dd>2 frames</dd>
          <dt>Max lines</dt><dd>2</dd>
          <dt>Two speakers</dt><dd>hyphen on each line</dd>
        </dl>
      </details>
    </div>
  );
}
