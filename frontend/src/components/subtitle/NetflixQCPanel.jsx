import React, { useMemo, useState } from 'react';
import { 
  ShieldCheck, Download, AlertCircle, AlertTriangle, CheckCircle2, 
  Clock, Type, Users, Video, ChevronDown, ChevronUp, Activity, Wand2, BookOpen,
  Sparkles, Layers, X, Volume2
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

  const [expandedCategories, setExpandedCategories] = useState({
    Timing: true,
    'Reading Speed': true,
    Formatting: true,
    Speaker: true,
    Content: false
  });

  const toggleCategory = (cat) => {
    setExpandedCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const [showGuidelines, setShowGuidelines] = useState(false);

  // Group errors by category
  const errorGroups = useMemo(() => {
    const groups = {
      Timing: [],
      'Reading Speed': [],
      Formatting: [],
      Speaker: [],
      Content: []
    };

    events.forEach(event => {
      const errList = event.qc_errors || event.errors || [];
      const eventId = event.id ?? event.event_id;
      const start = event.start_time ?? event.start ?? 0;

      errList.forEach(err => {
        const ruleId = (err.rule_id || err.error_type || '').toUpperCase();
        const msg = (err.message || '').toLowerCase();
        
        // Skip pyramid errors
        if (ruleId.includes('PYRAMID') || msg.includes('pyramid') || msg.includes('bottom-heavy')) {
          return;
        }

        let cat = 'Content';
        let sev = err.severity || 'error';
        
        if (ruleId.includes('CPS') || ruleId.includes('SPEED') || msg.includes('cps')) {
          cat = 'Reading Speed';
          sev = 'warning'; // CPS is warning/yellow
        } else if (ruleId.includes('DURATION') || ruleId.includes('GAP') || ruleId.includes('OVERLAP') || ruleId.includes('SHOT') || ruleId.includes('TIME')) {
          cat = 'Timing';
        } else if (ruleId.includes('CPL') || ruleId.includes('LINE') || ruleId.includes('BREAK') || ruleId.includes('ORPHAN') || ruleId.includes('ELLIPSIS')) {
          cat = 'Formatting';
        } else if (ruleId.includes('SPEAKER') || ruleId.includes('DUAL') || ruleId.includes('GENDER')) {
          cat = 'Speaker';
        }

        groups[cat].push({
          eventId: eventId,
          ruleId: err.rule_id || err.error_type || 'QC',
          message: err.message,
          severity: sev,
          suggestedFix: err.suggested_fix,
          time: start
        });
      });
    });

    return groups;
  }, [events]);

  const categoryIcons = {
    Timing: <Clock className="w-3.5 h-3.5" />,
    'Reading Speed': <Activity className="w-3.5 h-3.5" />,
    Formatting: <Type className="w-3.5 h-3.5" />,
    Speaker: <Users className="w-3.5 h-3.5" />,
    Content: <Video className="w-3.5 h-3.5" />
  };

  const safeCpsStats = {
    min_cps: cpsStats?.min_cps ?? 0,
    max_cps: cpsStats?.max_cps ?? 0,
    avg_cps: cpsStats?.avg_cps ?? 0,
    p95_cps: cpsStats?.p95_cps ?? 0,
    events_over_limit: cpsStats?.events_over_limit ?? 0,
  };

  return (
    <div className="bg-[var(--ss-panel)] border border-[var(--ss-line)] rounded-none p-4 shadow-2xl flex flex-col gap-3.5 h-full overflow-y-auto custom-scrollbar text-slate-200">
      {/* Header with Close Button */}
      <div className="flex items-center justify-between pb-2 border-b border-[var(--ss-line)]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[var(--ss-accent)]" />
          <h3 className="font-semibold text-sm text-slate-200">Quality check</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">Netflix rules · target 98%</span>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-none hover:bg-[var(--ss-hover)] text-slate-400 hover:text-white transition-colors cursor-pointer"
              title="Close Panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Compliance Scorecard */}
      {qcUnavailable ? (
        <div className="p-3.5 border border-[var(--ss-line)] bg-[var(--ss-raised)] text-slate-200">
          <div className="flex items-center gap-2 font-semibold text-sm">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            Quality check couldn't run
          </div>
          <p className="text-[11px] text-slate-400 mt-1.5 leading-relaxed">
            The backend is offline, so these results are not up to date. Start the backend, then edit any subtitle to check again.
          </p>
        </div>
      ) : (
      <div className={`p-3.5 rounded-none border transition-all ${
        isPassing
          ? 'bg-[var(--ss-accent)]/10 border-[var(--ss-accent)]/40 text-slate-200'
          : isAmber
          ? 'bg-amber-950/30 border-amber-800/60 text-amber-200'
          : 'bg-rose-950/40 border-rose-800/60 text-rose-200'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-semibold font-mono ${
                isPassing ? 'text-[var(--ss-accent)]' : isAmber ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {complianceScore}%
              </span>
              <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded-none ${
                isPassing
                  ? 'bg-[var(--ss-accent)]/20 text-[var(--ss-accent)] border border-[var(--ss-accent)]/40'
                  : isAmber
                  ? 'bg-amber-900/60 text-amber-300 border border-amber-700'
                  : 'bg-rose-900/60 text-rose-300 border border-rose-700'
              }`}>
                {isPassing ? 'Passing' : isAmber ? 'Needs fixes' : 'Failing'}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 mt-1 font-medium">
              {totalErrors} {totalErrors === 1 ? 'error' : 'errors'}, {totalWarnings} {totalWarnings === 1 ? 'warning' : 'warnings'}
            </p>
          </div>

          {isPassing ? (
            <div className="h-9 w-9 rounded-none bg-[var(--ss-accent)]/20 text-[var(--ss-accent)] flex items-center justify-center border border-[var(--ss-accent)]/40 shadow-[0_0_10px_rgba(var(--kt-accent-rgb),0.2)]">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          ) : isAmber ? (
            <div className="h-9 w-9 rounded-none bg-amber-900/50 text-amber-400 flex items-center justify-center border border-amber-700">
              <AlertTriangle className="w-5 h-5" />
            </div>
          ) : (
            <div className="h-9 w-9 rounded-none bg-rose-900/50 text-rose-400 flex items-center justify-center border border-rose-700">
              <AlertCircle className="w-5 h-5" />
            </div>
          )}
        </div>
      </div>
      )}

      {/* Actions: rule-based fix is the primary, free action; AI/audio tools are secondary */}
      <div className="flex flex-col gap-2">
        <button
          onClick={onAutoFix}
          disabled={!events.length || qcUnavailable}
          className="w-full py-2 px-3 bg-[var(--ss-accent)] hover:bg-[var(--ss-accent-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-[var(--ss-accent-ink)] font-semibold rounded-md flex items-center justify-center gap-2 transition-colors text-xs cursor-pointer"
          title="Fix timing, gaps, reading speed and line length using the Netflix rules (you review every change before it's kept)"
        >
          <Wand2 className="w-4 h-4" />
          Auto-fix rule issues
        </button>
        {onRebreakAll && (
          <button
            onClick={onRebreakAll}
            disabled={!events.length || qcUnavailable}
            className="w-full py-1.5 px-3 bg-[var(--ss-raised)] hover:bg-[var(--ss-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 font-medium rounded-md text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer border border-[var(--ss-line)]"
            title={`Re-break every subtitle's lines to fit ${cplLimit} characters`}
          >
            <Layers className="w-3.5 h-3.5" />
            Re-break all lines
          </button>
        )}
        {(onGeminiFix || onAcousticSync) && (
          <div className="grid grid-cols-2 gap-2">
            {onGeminiFix && (
              <button
                onClick={onGeminiFix}
                disabled={!events.length || isFixingWithGemini || qcUnavailable}
                className="py-1.5 px-2 bg-[var(--ss-raised)] hover:bg-[var(--ss-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 font-medium rounded-md text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer border border-[var(--ss-line)]"
                title="Ask Gemini AI to rewrite, split and re-time subtitles that break the rules (uses Gemini credits)"
              >
                <Sparkles className={`w-3.5 h-3.5 ${isFixingWithGemini ? 'animate-spin' : ''}`} />
                {isFixingWithGemini ? 'Fixing with Gemini…' : 'Fix with Gemini AI'}
              </button>
            )}
            {onAcousticSync && (
              <button
                onClick={onAcousticSync}
                disabled={!events.length || isSyncingAudio || qcUnavailable}
                className="py-1.5 px-2 bg-[var(--ss-raised)] hover:bg-[var(--ss-hover)] disabled:opacity-40 disabled:cursor-not-allowed text-slate-200 font-medium rounded-md text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer border border-[var(--ss-line)]"
                title="Move each subtitle's start and end to where speech actually starts and stops in the audio"
              >
                <Volume2 className="w-3.5 h-3.5" />
                {isSyncingAudio ? 'Re-syncing…' : 'Re-sync to speech'}
              </button>
            )}
          </div>
        )}
      </div>

      {/* CPS Statistics Card */}
      {!qcUnavailable && (
      <div className="bg-[var(--ss-raised)] p-3 rounded-none border border-[var(--ss-line)] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-200">
            <Activity className="w-3.5 h-3.5 text-[var(--ss-accent)]" />
            Reading speed
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-[var(--ss-panel)] border border-[var(--ss-line)] rounded-none text-slate-300">
            Limit {cpsLimit} chars/sec
          </span>
        </div>
        
        <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
          <div className="p-1 rounded-none bg-[var(--ss-panel)] border border-[var(--ss-line)]">
            <span className="text-[9px] text-slate-500 block font-medium">Min</span>
            <span className="font-mono font-bold text-slate-300">{safeCpsStats.min_cps.toFixed(1)}</span>
          </div>
          <div className="p-1 rounded-none bg-[var(--ss-panel)] border border-[var(--ss-line)]">
            <span className="text-[9px] text-slate-500 block font-medium">Avg</span>
            <span className="font-mono font-bold text-slate-300">{safeCpsStats.avg_cps.toFixed(1)}</span>
          </div>
          <div className="p-1 rounded-none bg-[var(--ss-panel)] border border-[var(--ss-line)]">
            <span className="text-[9px] text-slate-500 block font-medium">P95</span>
            <span className="font-mono font-bold text-slate-300">{safeCpsStats.p95_cps.toFixed(1)}</span>
          </div>
          <div className="p-1 rounded-none bg-rose-950/40 border border-rose-800">
            <span className="text-[9px] text-rose-400 block font-medium">Violations</span>
            <span className="font-mono font-bold text-rose-300">{safeCpsStats.events_over_limit}</span>
          </div>
        </div>
      </div>
      )}

      {/* Error Breakdown */}
      <div className="flex-1 space-y-2">
        <h4 className="text-[11px] font-bold text-slate-300 border-b border-[var(--ss-line)] pb-1 uppercase tracking-wider">
          Issues by rule
        </h4>
        
        {Object.entries(errorGroups).map(([category, catErrors]) => {
          if (catErrors.length === 0) return null;
          
          const isExpanded = expandedCategories[category];
          
          return (
            <div key={category} className="bg-[var(--ss-raised)] border border-[var(--ss-line)] rounded-none overflow-hidden shadow-xs">
              <button 
                onClick={() => toggleCategory(category)}
                className="w-full flex items-center justify-between p-2 bg-[var(--ss-raised)] hover:bg-[var(--ss-hover)] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className="text-[var(--ss-accent)]">
                    {categoryIcons[category]}
                  </div>
                  <span className="text-xs font-bold text-slate-200">{category}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold font-mono bg-rose-950 text-rose-300 border border-rose-800 px-1.5 py-0.2 rounded-none">
                    {catErrors.length}
                  </span>
                  {isExpanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
                </div>
              </button>
              
              {isExpanded && (
                <div className="p-1.5 space-y-1 max-h-40 overflow-y-auto bg-[var(--ss-panel)] custom-scrollbar">
                  {catErrors.map((err, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => onJumpToEvent(err.eventId)}
                      className={`p-2 rounded-none border text-left cursor-pointer hover:brightness-125 transition-all flex items-start gap-1.5 ${
                        err.severity === 'warning' ? 'bg-amber-950/40 border-amber-800 text-amber-200' : 'bg-rose-950/40 border-rose-800 text-rose-200'
                      }`}
                    >
                      <span className="font-mono font-bold text-[9px] bg-black/60 px-1.5 py-0.5 rounded-none border border-[var(--ss-line)] shrink-0 text-white">
                        #{err.eventId}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] font-medium leading-tight block">
                          {err.message}
                        </span>
                        {err.suggestedFix && (
                          <span className="text-[9px] text-[var(--ss-accent)] block mt-0.5 font-semibold">
                            💡 Fix: {err.suggestedFix}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {!qcUnavailable && totalErrors === 0 && totalWarnings === 0 && events.length > 0 && (
          <div className="p-3.5 rounded-none bg-[var(--ss-accent)]/10 border border-[var(--ss-accent)]/30 text-center text-[var(--ss-accent)] text-xs">
            <CheckCircle2 className="w-5 h-5 mx-auto mb-1 text-[var(--ss-accent)]" />
            <p className="font-semibold">No issues found</p>
            <p className="text-[11px] text-slate-300 mt-0.5">Line length, reading speed, durations and gaps all meet the rules.</p>
          </div>
        )}
      </div>

      {/* Netflix Guidelines Quick Reference */}
      <div className="mt-auto pt-2 border-t border-[var(--ss-line)]">
        <button 
          onClick={() => setShowGuidelines(!showGuidelines)}
          className="flex items-center justify-between w-full text-xs font-semibold text-slate-400 hover:text-white cursor-pointer p-1"
        >
          <div className="flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-[var(--ss-accent)]" />
            Netflix Timed Text Guide
          </div>
          {showGuidelines ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        
        {showGuidelines && (
          <div className="mt-2 p-2.5 bg-[var(--ss-bg)] text-slate-300 rounded-none text-[10px] space-y-1.5 border border-[var(--ss-line)]">
            <div className="grid grid-cols-2 gap-x-2 gap-y-1 font-sans">
              <span className="text-slate-400">Min Duration:</span>
              <span className="font-mono text-slate-200">5/6 sec (~0.833s)</span>
              <span className="text-slate-400">Max Duration:</span>
              <span className="font-mono text-slate-200">7.0 seconds</span>
              <span className="text-slate-400">Min Gap:</span>
              <span className="font-mono text-slate-200">2 frames (~0.083s)</span>
              <span className="text-slate-400">Gap Chaining:</span>
              <span className="font-mono text-slate-200">3-11 frames to 2f</span>
              <span className="text-slate-400">Max Lines:</span>
              <span className="font-mono text-slate-200">2 lines</span>
              <span className="text-slate-400">CPL Limit:</span>
              <span className="font-mono text-slate-200">Max {cplLimit} chars</span>
              <span className="text-slate-400">CPS Limit:</span>
              <span className="font-mono text-slate-200">Max {cpsLimit} c/s</span>
              <span className="text-slate-400">Dual Speakers:</span>
              <span className="font-mono text-slate-200">-Hyphen on each line</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

