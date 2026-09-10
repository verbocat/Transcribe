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
  onClose = null
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
    <div className="bg-[#14151a] border border-[#262734] rounded-2xl p-4 shadow-2xl flex flex-col gap-3.5 h-full overflow-y-auto custom-scrollbar text-slate-200">
      {/* Header with Close Button */}
      <div className="flex items-center justify-between pb-2 border-b border-[#262734]">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[#00e5be]" />
          <h3 className="font-bold text-xs uppercase tracking-wider text-slate-200">Netflix QC Audit Panel</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-slate-400">Target ≥ 98%</span>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-[#22232c] text-slate-400 hover:text-white transition-colors cursor-pointer"
              title="Close Panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Compliance Scorecard */}
      <div className={`p-3.5 rounded-xl border transition-all ${
        isPassing
          ? 'bg-[#00e5be]/10 border-[#00e5be]/40 text-slate-200'
          : isAmber
          ? 'bg-amber-950/30 border-amber-800/60 text-amber-200'
          : 'bg-rose-950/40 border-rose-800/60 text-rose-200'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-baseline gap-2">
              <span className={`text-2xl font-black font-mono ${
                isPassing ? 'text-[#00e5be]' : isAmber ? 'text-amber-400' : 'text-rose-400'
              }`}>
                {complianceScore}%
              </span>
              <span className={`text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded ${
                isPassing
                  ? 'bg-[#00e5be]/20 text-[#00e5be] border border-[#00e5be]/40'
                  : isAmber
                  ? 'bg-amber-900/60 text-amber-300 border border-amber-700'
                  : 'bg-rose-900/60 text-rose-300 border border-rose-700'
              }`}>
                {isPassing ? 'PASSED' : isAmber ? 'NEEDS FIX' : 'VIOLATIONS'}
              </span>
            </div>
            <p className="text-[11px] text-slate-300 mt-1 font-medium">
              {totalErrors} Errors · {totalWarnings} Warnings
            </p>
          </div>

          {isPassing ? (
            <div className="h-9 w-9 rounded-xl bg-[#00e5be]/20 text-[#00e5be] flex items-center justify-center border border-[#00e5be]/40 shadow-[0_0_10px_rgba(0,229,190,0.2)]">
              <CheckCircle2 className="w-5 h-5" />
            </div>
          ) : isAmber ? (
            <div className="h-9 w-9 rounded-xl bg-amber-900/50 text-amber-400 flex items-center justify-center border border-amber-700">
              <AlertTriangle className="w-5 h-5" />
            </div>
          ) : (
            <div className="h-9 w-9 rounded-xl bg-rose-900/50 text-rose-400 flex items-center justify-center border border-rose-700">
              <AlertCircle className="w-5 h-5" />
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col gap-2">
        {onAcousticSync && (
          <button
            onClick={onAcousticSync}
            disabled={!events.length || isSyncingAudio}
            className="w-full py-2 px-3 bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 disabled:opacity-40 text-black font-bold rounded-xl shadow-[0_0_15px_rgba(16,185,129,0.25)] flex items-center justify-center gap-2 transition-all text-xs cursor-pointer border-none"
            title="Re-synchronize all subtitle timestamps to exact speech audio acoustics via Whisper and VAD"
          >
            <Volume2 className={`w-4 h-4 ${isSyncingAudio ? 'animate-bounce text-black' : 'text-black'}`} />
            {isSyncingAudio ? 'Acoustically Syncing Audio...' : 'Acoustic Audio Re-Sync (Whisper)'}
          </button>
        )}

        {onGeminiFix && (
          <button
            onClick={onGeminiFix}
            disabled={!events.length || isFixingWithGemini}
            className="w-full py-2 px-3 bg-gradient-to-r from-[#00e5be] to-[#00b4d8] hover:from-[#00c9a7] hover:to-[#0096c7] disabled:opacity-40 text-black font-bold rounded-xl shadow-[0_0_15px_rgba(0,229,190,0.25)] flex items-center justify-center gap-2 transition-all text-xs cursor-pointer border-none"
            title="Coordinate with Gemini AI to rewrite, split, and re-time violating subtitles"
          >
            <Sparkles className={`w-4 h-4 ${isFixingWithGemini ? 'animate-spin' : 'text-black'}`} />
            {isFixingWithGemini ? 'Gemini AI Fixing Violations...' : 'AI Auto-Fix with Gemini'}
          </button>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onAutoFix}
            disabled={!events.length}
            className="py-2 px-2.5 bg-[#181920] hover:bg-[#22232c] active:scale-95 disabled:opacity-40 text-[#00e5be] font-bold rounded-xl shadow-xs flex items-center justify-center gap-1.5 transition-all text-xs cursor-pointer border border-[#262734]"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Rule Auto-Fix
          </button>
          <button
            onClick={onExport}
            disabled={!events.length}
            className="py-2 px-2.5 bg-[#00e5be] hover:bg-[#00c9a7] active:scale-95 disabled:opacity-40 text-black font-bold rounded-xl shadow-[0_0_12px_rgba(0,229,190,0.25)] flex items-center justify-center gap-1.5 transition-all text-xs cursor-pointer border-none"
          >
            <Download className="w-3.5 h-3.5" />
            Export
          </button>
        </div>
      </div>

      {onRebreakAll && (
        <button
          onClick={onRebreakAll}
          disabled={!events.length}
          className="w-full py-1.5 px-2.5 bg-[#181920] hover:bg-[#22232c] text-cyan-400 font-semibold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer border border-[#262734]"
        >
          <Layers className="w-3.5 h-3.5 text-cyan-400" />
          Re-Break Lines (Netflix Rules)
        </button>
      )}

      {/* CPS Statistics Card */}
      <div className="bg-[#181920] p-3 rounded-xl border border-[#262734] space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-200">
            <Activity className="w-3.5 h-3.5 text-[#00e5be]" />
            CPS Speedometer
          </div>
          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-[#14151a] border border-[#262734] rounded text-slate-300">
            Max {cpsLimit} CPS
          </span>
        </div>
        
        <div className="grid grid-cols-4 gap-1.5 text-center text-xs">
          <div className="p-1 rounded-lg bg-[#14151a] border border-[#262734]">
            <span className="text-[9px] text-slate-500 block font-medium">Min</span>
            <span className="font-mono font-bold text-slate-300">{safeCpsStats.min_cps.toFixed(1)}</span>
          </div>
          <div className="p-1 rounded-lg bg-[#14151a] border border-[#262734]">
            <span className="text-[9px] text-slate-500 block font-medium">Avg</span>
            <span className="font-mono font-bold text-slate-300">{safeCpsStats.avg_cps.toFixed(1)}</span>
          </div>
          <div className="p-1 rounded-lg bg-[#14151a] border border-[#262734]">
            <span className="text-[9px] text-slate-500 block font-medium">P95</span>
            <span className="font-mono font-bold text-slate-300">{safeCpsStats.p95_cps.toFixed(1)}</span>
          </div>
          <div className="p-1 rounded-lg bg-rose-950/40 border border-rose-800">
            <span className="text-[9px] text-rose-400 block font-medium">Violations</span>
            <span className="font-mono font-bold text-rose-300">{safeCpsStats.events_over_limit}</span>
          </div>
        </div>
      </div>

      {/* Error Breakdown */}
      <div className="flex-1 space-y-2">
        <h4 className="text-[11px] font-bold text-slate-300 border-b border-[#262734] pb-1 uppercase tracking-wider">
          QC Rule Violations
        </h4>
        
        {Object.entries(errorGroups).map(([category, catErrors]) => {
          if (catErrors.length === 0) return null;
          
          const isExpanded = expandedCategories[category];
          
          return (
            <div key={category} className="bg-[#181920] border border-[#262734] rounded-xl overflow-hidden shadow-xs">
              <button 
                onClick={() => toggleCategory(category)}
                className="w-full flex items-center justify-between p-2 bg-[#181920] hover:bg-[#22232c] transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-2">
                  <div className="text-[#00e5be]">
                    {categoryIcons[category]}
                  </div>
                  <span className="text-xs font-bold text-slate-200">{category}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-bold font-mono bg-rose-950 text-rose-300 border border-rose-800 px-1.5 py-0.2 rounded-full">
                    {catErrors.length}
                  </span>
                  {isExpanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
                </div>
              </button>
              
              {isExpanded && (
                <div className="p-1.5 space-y-1 max-h-40 overflow-y-auto bg-[#14151a] custom-scrollbar">
                  {catErrors.map((err, idx) => (
                    <div 
                      key={idx} 
                      onClick={() => onJumpToEvent(err.eventId)}
                      className={`p-2 rounded-lg border text-left cursor-pointer hover:brightness-125 transition-all flex items-start gap-1.5 ${
                        err.severity === 'warning' ? 'bg-amber-950/40 border-amber-800 text-amber-200' : 'bg-rose-950/40 border-rose-800 text-rose-200'
                      }`}
                    >
                      <span className="font-mono font-bold text-[9px] bg-black/60 px-1.5 py-0.5 rounded border border-[#262734] shrink-0 text-white">
                        #{err.eventId}
                      </span>
                      <div className="flex-1 min-w-0">
                        <span className="text-[10px] font-medium leading-tight block">
                          {err.message}
                        </span>
                        {err.suggestedFix && (
                          <span className="text-[9px] text-[#00e5be] block mt-0.5 font-semibold">
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

        {totalErrors === 0 && totalWarnings === 0 && events.length > 0 && (
          <div className="p-3.5 rounded-xl bg-[#00e5be]/10 border border-[#00e5be]/30 text-center text-[#00e5be] text-xs">
            <CheckCircle2 className="w-5 h-5 mx-auto mb-1 text-[#00e5be]" />
            <p className="font-bold">100% Netflix Certified</p>
            <p className="text-[10px] text-slate-300 mt-0.5">Zero CPL, CPS, duration, or gap violations detected.</p>
          </div>
        )}
      </div>

      {/* Netflix Guidelines Quick Reference */}
      <div className="mt-auto pt-2 border-t border-[#262734]">
        <button 
          onClick={() => setShowGuidelines(!showGuidelines)}
          className="flex items-center justify-between w-full text-xs font-semibold text-slate-400 hover:text-white cursor-pointer p-1"
        >
          <div className="flex items-center gap-1.5">
            <BookOpen className="w-3.5 h-3.5 text-[#00e5be]" />
            Netflix Timed Text Guide
          </div>
          {showGuidelines ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        
        {showGuidelines && (
          <div className="mt-2 p-2.5 bg-[#0e0f12] text-slate-300 rounded-xl text-[10px] space-y-1.5 border border-[#262734]">
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
