import React, { useState, useEffect } from 'react';
import { Play, Sparkles, Clock, X, Check, ArrowRight, Layers } from 'lucide-react';

function formatTime(seconds) {
  if (isNaN(seconds) || seconds == null) return "00:00.000";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

function parseTimeInput(str) {
  if (!str) return 0;
  if (typeof str === 'number') return str;
  str = str.trim();
  if (str.includes(':')) {
    const parts = str.split(':');
    if (parts.length === 3) {
      return (parseFloat(parts[0]) || 0) * 3600 + (parseFloat(parts[1]) || 0) * 60 + (parseFloat(parts[2]) || 0);
    } else if (parts.length === 2) {
      return (parseFloat(parts[0]) || 0) * 60 + (parseFloat(parts[1]) || 0);
    }
  }
  return parseFloat(str) || 0;
}

export default function CustomTimeResumeModal({
  isOpen,
  onClose,
  targetTime = null,
  playheadTime = 0,
  videoDuration = 0,
  events = [],
  onStartGeneration = () => {}
}) {
  const [timeInputStr, setTimeInputStr] = useState('');
  const [shouldPreserve, setShouldPreserve] = useState(true);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsClosing(false);
      return;
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleDismiss = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 220);
  };

  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  const lastSubEnd = lastEvent ? (lastEvent.end_time ?? lastEvent.end ?? 0) : 0;

  // Initialize input when modal opens
  useEffect(() => {
    if (isOpen) {
      let initSec = targetTime;
      if (initSec == null) {
        if (events.length > 0) {
          initSec = lastSubEnd;
        } else {
          initSec = playheadTime;
        }
      }
      setTimeInputStr(formatTime(initSec));
      setShouldPreserve(true);
    }
  }, [isOpen, targetTime, playheadTime, events, lastSubEnd]);

  if (!isOpen) return null;

  const parsedSec = parseTimeInput(timeInputStr);
  const effectiveSec = Math.max(0, Math.min(videoDuration > 0 ? videoDuration : 999999, parsedSec));

  // Subtitles that will be kept
  const preservedCount = shouldPreserve 
    ? events.filter(e => (e.start_time ?? e.start ?? 0) < effectiveSec).length
    : 0;

  const remainingDuration = Math.max(0, (videoDuration || 0) - effectiveSec);

  const handleSubmit = (e) => {
    e.preventDefault();
    onStartGeneration(effectiveSec, shouldPreserve);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-opacity duration-200 ${
        isClosing ? 'animate-mac-backdrop-exit pointer-events-none' : 'animate-in fade-in duration-200'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
    >
      <div className={`w-full max-w-lg rounded-2xl border border-[#262734] shadow-2xl overflow-hidden flex flex-col bg-[#14151a] text-slate-200 ${
        isClosing ? 'animate-mac-squish-exit' : 'animate-mac-squish'
      }`}>
        
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-[#262734] bg-[#14151a] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/15 text-amber-300 border border-amber-500/30">
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold tracking-tight text-white flex items-center gap-2">
                <span>Continue From Timeline Time</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold uppercase">
                  Custom
                </span>
              </h2>
              <p className="text-xs text-slate-400">Choose where to resume generating subtitles to the end of the video</p>
            </div>
          </div>
          <button 
            type="button"
            onClick={handleDismiss}
            className="p-1.5 rounded-lg hover:bg-[#22232c] text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-5 text-xs">
          
          {/* Quick Preset Buttons */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-2">
              Quick Pick Timeline Presets
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {/* Playhead Position */}
              <button
                type="button"
                onClick={() => setTimeInputStr(formatTime(playheadTime))}
                className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                  Math.abs(parsedSec - playheadTime) < 0.1
                    ? 'border-[#00e5be] bg-[#00e5be]/10 text-white'
                    : 'border-[#262734] bg-[#181920] hover:border-slate-500 text-slate-300'
                }`}
              >
                <div>
                  <div className="font-bold text-xs flex items-center gap-1.5">
                    <span className="text-[#00e5be]">📍 Playhead Time</span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">{formatTime(playheadTime)}</div>
                </div>
                <ArrowRight size={13} className="text-slate-400" />
              </button>

              {/* After Last Subtitle */}
              {events.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setTimeInputStr(formatTime(lastSubEnd))}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                    Math.abs(parsedSec - lastSubEnd) < 0.1
                      ? 'border-amber-400 bg-amber-500/10 text-white'
                      : 'border-[#262734] bg-[#181920] hover:border-slate-500 text-slate-300'
                  }`}
                >
                  <div>
                    <div className="font-bold text-xs flex items-center gap-1.5">
                      <span className="text-amber-300">⏭️ After Last Subtitle</span>
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">{formatTime(lastSubEnd)}</div>
                  </div>
                  <ArrowRight size={13} className="text-slate-400" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setTimeInputStr("00:00.000")}
                  className="p-2.5 rounded-xl border border-[#262734] bg-[#181920] hover:border-slate-500 text-left transition-all cursor-pointer flex items-center justify-between text-slate-300"
                >
                  <div>
                    <div className="font-bold text-xs">⏮️ Start of Video</div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">00:00.000</div>
                  </div>
                  <ArrowRight size={13} className="text-slate-400" />
                </button>
              )}
            </div>
          </div>

          {/* Timecode Input */}
          <div className="p-4 rounded-xl border border-[#262734] bg-[#181920] space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-bold text-xs text-white flex items-center gap-1.5">
                <span>Start Generating From Time:</span>
              </label>
              <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                {effectiveSec.toFixed(3)}s
              </span>
            </div>
            
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={timeInputStr}
                onChange={(e) => setTimeInputStr(e.target.value)}
                placeholder="00:00.000 or seconds (e.g. 75.5)"
                className="flex-1 rounded-lg px-3 py-2 text-sm font-mono border border-[#262734] bg-[#0e0f12] text-white focus:border-amber-400 focus:outline-none"
                autoFocus
              />
            </div>
            <p className="text-[11px] text-slate-400">
              Format: <code className="text-[#00e5be]">MM:SS.mmm</code> or seconds (e.g. <code className="text-slate-300">01:30.000</code> or <code className="text-slate-300">90</code>).
            </p>
          </div>

          {/* Generation Range & Summary */}
          <div className="p-3.5 rounded-xl border border-[#262734] bg-[#101116] space-y-2">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-slate-400">Generation Span:</span>
              <span className="text-white font-bold">
                {formatTime(effectiveSec)} ➔ {formatTime(videoDuration)}
              </span>
            </div>
            {videoDuration > 0 && (
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>Remaining Duration:</span>
                <span className="text-amber-300 font-mono font-bold">
                  {formatTime(remainingDuration)} ({Math.round((remainingDuration / Math.max(1, videoDuration)) * 100)}% of video)
                </span>
              </div>
            )}
          </div>

          {/* Preserve Subtitles Checkbox */}
          <div className="p-3.5 rounded-xl border border-[#262734] bg-[#181920] flex items-start gap-3">
            <input
              type="checkbox"
              id="preserve_before_toggle"
              checked={shouldPreserve}
              onChange={(e) => setShouldPreserve(e.target.checked)}
              className="mt-0.5 rounded accent-[#00e5be] w-4 h-4 cursor-pointer"
            />
            <label htmlFor="preserve_before_toggle" className="cursor-pointer space-y-0.5">
              <div className="font-bold text-xs text-slate-200 flex items-center gap-1.5">
                <span>Preserve subtitles before {formatTime(effectiveSec)}</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 font-bold uppercase">
                  Recommended
                </span>
              </div>
              <p className="text-[11px] text-slate-400">
                {shouldPreserve 
                  ? `Safely keeps all ${preservedCount} subtitle(s) before this time. Newly generated subtitles will append seamlessly from ${formatTime(effectiveSec)} onwards.`
                  : `Discard all existing subtitles and start completely fresh from ${formatTime(effectiveSec)}.`}
              </p>
            </label>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[#262734]">
            <button
              type="button"
              onClick={handleDismiss}
              className="px-4 py-2 rounded-lg text-xs font-semibold hover:bg-[#22232c] text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-black flex items-center gap-2 transition-all shadow-[0_0_12px_rgba(251,191,36,0.3)] cursor-pointer"
            >
              <Play className="w-3.5 h-3.5 fill-black" />
              <span>Start Generating from {formatTime(effectiveSec)}</span>
            </button>
          </div>

        </form>
      </div>
    </div>
  );
}
