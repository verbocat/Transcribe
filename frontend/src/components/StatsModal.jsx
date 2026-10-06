import React, { useMemo, useState, useEffect } from 'react';
import { X, BarChart2, Clock, Users, Type, ShieldCheck, Activity } from 'lucide-react';

export default function StatsModal({ isOpen, onClose, segments, audioInfo, filename, complianceScore }) {
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

  const stats = useMemo(() => {
    if (!segments || segments.length === 0) {
      return null;
    }

    const totalSegs = segments.length;
    let totalSpeechDuration = 0;
    const speakerDurations = {};
    const speakerWords = {};
    let totalWords = 0;
    let sumConfidence = 0;
    let countConfidence = 0;
    const wordFreq = new Set();

    segments.forEach((seg) => {
      const dur = Math.max(0, seg.end_time - seg.start_time);
      totalSpeechDuration += dur;

      const spk = seg.speaker || 'Speaker 1';
      speakerDurations[spk] = (speakerDurations[spk] || 0) + dur;

      const words = (seg.transcript || '').trim().split(/\s+/).filter(Boolean);
      totalWords += words.length;
      speakerWords[spk] = (speakerWords[spk] || 0) + words.length;

      words.forEach(w => wordFreq.add(w.toLowerCase()));

      if (seg.confidence !== undefined && seg.confidence !== null) {
        sumConfidence += seg.confidence;
        countConfidence++;
      }
    });

    const totalDuration = (audioInfo && audioInfo.duration) > 0 ? audioInfo.duration : (segments[segments.length - 1]?.end_time || totalSpeechDuration);
    const silenceDuration = Math.max(0, totalDuration - totalSpeechDuration);
    const speechPercent = totalDuration > 0 ? Math.min(100, (totalSpeechDuration / totalDuration) * 100) : 100;
    const avgConfidence = countConfidence > 0 ? (sumConfidence / countConfidence) * 100 : 95;
    const wpm = totalSpeechDuration > 0 ? Math.round((totalWords / (totalSpeechDuration / 60))) : 0;

    return {
      totalSegs,
      totalDuration,
      totalSpeechDuration,
      silenceDuration,
      speechPercent,
      totalWords,
      uniqueWords: wordFreq.size,
      avgConfidence,
      wpm,
      speakerDurations,
      speakerWords
    };
  }, [segments, audioInfo]);

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-opacity duration-200 ${
        isClosing ? 'animate-mac-backdrop-exit pointer-events-none' : 'animate-in fade-in duration-200'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
    >
      <div className={`bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-2xl w-full max-w-2xl p-6 shadow-2xl flex flex-col max-h-[90vh] overflow-y-auto text-slate-200 custom-scrollbar ${
        isClosing ? 'animate-mac-squish-exit' : 'animate-mac-squish'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[var(--kt-s4)] mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[var(--kt-s3)] text-[var(--kt-accent)] border border-[var(--kt-s4)] rounded-xl shadow-xs">
              <BarChart2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white tracking-tight">Transcript Analytics & Statistics</h2>
              <p className="text-xs text-slate-400 font-medium">{filename || 'Audio Transcription'}</p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border border-[var(--kt-s4)] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {stats ? (
          <div className="space-y-5">
            {/* Top Metric Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 bg-[var(--kt-s2)] border border-[var(--kt-s4)] rounded-xl">
                <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-semibold mb-1">
                  <Clock className="w-3.5 h-3.5 text-[var(--kt-accent)]" />
                  <span>Duration</span>
                </div>
                <div className="text-base font-black text-white">{stats.totalDuration.toFixed(1)}s</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{stats.speechPercent.toFixed(0)}% speech ratio</div>
              </div>

              <div className="p-3.5 bg-[var(--kt-s2)] border border-[var(--kt-s4)] rounded-xl">
                <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-semibold mb-1">
                  <Type className="w-3.5 h-3.5 text-[var(--kt-info)]" />
                  <span>Total Words</span>
                </div>
                <div className="text-base font-black text-white">{stats.totalWords}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{stats.uniqueWords} unique tokens</div>
              </div>

              <div className="p-3.5 bg-[var(--kt-s2)] border border-[var(--kt-s4)] rounded-xl">
                <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-semibold mb-1">
                  <Activity className="w-3.5 h-3.5 text-amber-400" />
                  <span>Pace (WPM)</span>
                </div>
                <div className="text-base font-black text-white">{stats.wpm}</div>
                <div className="text-[10px] text-slate-500 mt-0.5">words per minute</div>
              </div>

              <div className="p-3.5 bg-[var(--kt-s2)] border border-[var(--kt-s4)] rounded-xl">
                <div className="flex items-center gap-1.5 text-slate-400 text-[11px] font-semibold mb-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-[var(--kt-accent)]" />
                  <span>Compliance</span>
                </div>
                <div className="text-base font-black text-[var(--kt-accent)]">{complianceScore || 100}%</div>
                <div className="text-[10px] text-slate-500 mt-0.5">{stats.avgConfidence.toFixed(0)}% avg acoustic conf</div>
              </div>
            </div>

            {/* Speaker Breakdown Section */}
            <div className="bg-[var(--kt-s2)] p-4 rounded-xl border border-[var(--kt-s4)]">
              <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-[var(--kt-accent)]" />
                <span>Speaker Diarization Distribution</span>
              </h3>

              <div className="space-y-3">
                {Object.entries(stats.speakerDurations).map(([speaker, dur]) => {
                  const percent = stats.totalSpeechDuration > 0 ? (dur / stats.totalSpeechDuration) * 100 : 0;
                  const words = stats.speakerWords[speaker] || 0;
                  const isSpk1 = speaker === 'Speaker 1';

                  return (
                    <div key={speaker} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 font-bold text-slate-200">
                          <span className={`w-2.5 h-2.5 rounded-full ${isSpk1 ? 'bg-[var(--kt-accent)] shadow-[0_0_8px_rgba(var(--kt-accent-rgb),0.5)]' : 'bg-[var(--kt-info)] shadow-[0_0_8px_rgba(var(--kt-accent-rgb),0.5)]'}`} />
                          <span>{speaker}</span>
                        </div>
                        <div className="text-slate-400 font-mono text-[11px]">
                          <span className="font-bold text-white">{dur.toFixed(1)}s</span> ({percent.toFixed(0)}%) • <span className="font-bold text-white">{words}</span> words
                        </div>
                      </div>
                      <div className="w-full bg-[var(--kt-s0)] h-2 rounded-full overflow-hidden border border-[var(--kt-s4)]/50">
                        <div
                          className={`h-full rounded-full transition-all ${isSpk1 ? 'bg-[var(--kt-accent)]' : 'bg-[var(--kt-info)]'}`}
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Audio Info Breakdown */}
            {audioInfo && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono bg-[var(--kt-s0)] p-3 rounded-xl border border-[var(--kt-s4)]">
                <div>
                  <span className="text-[10px] text-slate-500 block font-sans">Sample Rate</span>
                  <span className="font-bold text-slate-300">{audioInfo.sample_rate || 16000} Hz</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block font-sans">Channels</span>
                  <span className="font-bold text-slate-300">{audioInfo.channels || 1} ({audioInfo.channels === 2 ? 'Stereo' : 'Mono'})</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block font-sans">Loudness (RMS)</span>
                  <span className="font-bold text-[var(--kt-accent)]">{audioInfo.rms_db ? `${audioInfo.rms_db.toFixed(1)} dBFS` : '-20 dBFS'}</span>
                </div>
                <div>
                  <span className="text-[10px] text-slate-500 block font-sans">Est. SNR</span>
                  <span className="font-bold text-[var(--kt-info)]">{audioInfo.snr_db ? `${audioInfo.snr_db.toFixed(1)} dB` : '25 dB'}</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="py-12 text-center text-slate-500 text-xs">
            No active segments to compute statistics.
          </div>
        )}

        <div className="mt-5 pt-3 border-t border-[var(--kt-s4)] flex justify-end">
          <button
            onClick={handleDismiss}
            className="px-4 py-2 bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black rounded-xl text-xs font-bold transition-all shadow-[0_0_15px_rgba(var(--kt-accent-rgb),0.2)] cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
