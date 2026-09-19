import React, { useMemo, useState } from 'react';
import { X, Copy, Check, AlertTriangle, Film } from 'lucide-react';

function srtTime(secs) {
  const s = Math.max(0, secs);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

export default function SrtPreviewModal({ isOpen, onClose, segments, filename }) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState('formatted');
  const [isClosing, setIsClosing] = useState(false);

  React.useEffect(() => {
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

  const { srtLines, issues, lineItems } = useMemo(() => {
    if (!segments || segments.length === 0) {
      return { srtLines: '', issues: [], lineItems: [] };
    }

    const lines = [];
    const foundIssues = [];
    const items = [];

    segments.forEach((seg, idx) => {
      const s = srtTime(seg.start_time);
      const e = srtTime(seg.end_time);
      const speakerPrefix = seg.speaker ? `[${seg.speaker}] ` : '';
      const text = `${speakerPrefix}${seg.transcript || ''}`;

      let isOverlap = false;
      let isGap = false;
      let gapVal = 0;

      if (idx > 0) {
        const prev = segments[idx - 1];
        const gap = seg.start_time - prev.end_time;
        gapVal = gap;
        if (gap < -0.001) {
          isOverlap = true;
          foundIssues.push({
            type: 'overlap',
            seg1: prev.segment_id,
            seg2: seg.segment_id,
            value: Math.abs(gap).toFixed(3)
          });
        } else if (gap > 2.0) {
          isGap = true;
          foundIssues.push({
            type: 'gap',
            seg1: prev.segment_id,
            seg2: seg.segment_id,
            value: gap.toFixed(2)
          });
        }
      }

      const charCount = text.length;
      const hasLongLine = charCount > 42;

      lines.push(`${idx + 1}\n${s} --> ${e}\n${text}`);
      items.push({
        i: idx + 1,
        segId: seg.segment_id,
        s,
        e,
        speaker: seg.speaker,
        text,
        charCount,
        hasLongLine,
        isOverlap,
        isGap,
        gapVal
      });
    });

    const srtText = lines.join('\n\n');
    return { srtLines: srtText, issues: foundIssues, lineItems: items };
  }, [segments]);

  const handleCopy = () => {
    navigator.clipboard.writeText(srtLines).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    const blob = new Blob([srtLines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(filename || 'transcription').replace(/\.[^/.]+$/, '')}.srt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-opacity duration-200 ${
        isClosing ? 'animate-mac-backdrop-exit pointer-events-none' : 'animate-in fade-in'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
    >
      <div className={`bg-[#14151a] border border-[#262734] rounded-2xl w-full max-w-3xl p-5 shadow-2xl flex flex-col max-h-[90vh] text-slate-200 ${
        isClosing ? 'animate-mac-squish-exit' : 'animate-mac-squish'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#262734]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#1c1d25] text-[#00e5be] border border-[#262734] rounded-xl shadow-xs">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white tracking-tight">SRT Live Subtitle Preview</h2>
                <span className="text-[11px] bg-[#1c1d25] text-[#00e5be] px-2 py-0.5 rounded-full font-mono font-bold border border-[#262734]">
                  {(segments && segments.length) || 0} subtitles
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Real-time rendered SRT format with instant gap & overlap quality checks
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[#0e0f12] p-0.5 rounded-lg border border-[#262734] text-xs font-semibold">
              <button
                onClick={() => setActiveTab('formatted')}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  activeTab === 'formatted'
                    ? 'bg-[#22232c] text-[#00e5be] font-bold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Cards
              </button>
              <button
                onClick={() => setActiveTab('raw')}
                className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                  activeTab === 'raw'
                    ? 'bg-[#22232c] text-[#00e5be] font-bold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Raw Text
              </button>
            </div>

            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#181920] hover:bg-[#22232c] text-slate-300 hover:text-white border border-[#262734] rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              title="Copy all SRT content to clipboard"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-[#00e5be]" /> : <Copy className="w-3.5 h-3.5 text-slate-400" />}
              <span>{copied ? 'Copied!' : 'Copy'}</span>
            </button>

            <button
              onClick={handleDismiss}
              className="p-1.5 text-slate-400 hover:text-white rounded-xl bg-[#181920] hover:bg-[#22232c] border border-[#262734] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quality Warnings Banner */}
        {issues.length > 0 && (
          <div className="mt-3 p-3 bg-amber-950/30 border border-amber-500/30 rounded-xl flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="flex-1 text-xs text-amber-200">
              <div className="font-bold mb-1 text-amber-300">Acoustic Timing Warnings ({issues.length})</div>
              <div className="flex flex-wrap gap-2">
                {issues.map((issue, idx) => (
                  <span
                    key={idx}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[11px] font-bold ${
                      issue.type === 'overlap'
                        ? 'bg-rose-950/60 text-rose-300 border border-rose-500/40'
                        : 'bg-amber-950/60 text-amber-300 border border-amber-500/40'
                    }`}
                  >
                    {issue.type === 'overlap'
                      ? `⛔ Overlap #${issue.seg1} → #${issue.seg2} (-${issue.value}s)`
                      : `⚠️ Gap #${issue.seg1} → #${issue.seg2} (+${issue.value}s)`}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Main View */}
        <div className="flex-1 overflow-y-auto mt-3 pr-1 space-y-2 custom-scrollbar">
          {activeTab === 'raw' ? (
            <textarea
              readOnly
              value={srtLines}
              rows={18}
              className="w-full bg-[#0e0f12] text-[#00e5be] font-mono text-xs p-4 rounded-xl border border-[#262734] focus:outline-none resize-none leading-relaxed select-all"
            />
          ) : (
            lineItems.map((item) => (
              <div
                key={item.i}
                className={`p-3 rounded-xl border transition-all ${
                  item.isOverlap
                    ? 'bg-rose-950/30 border-rose-500/40 ring-1 ring-rose-500/20'
                    : item.isGap
                    ? 'bg-amber-950/30 border-amber-500/40'
                    : 'bg-[#181920] border-[#262734] hover:border-slate-600'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-xs px-2 py-0.5 rounded bg-[#0e0f12] border border-[#262734] text-slate-300">
                      #{item.i}
                    </span>
                    <span className="font-mono text-xs font-semibold text-[#00e5be] bg-[#0e0f12] px-2 py-0.5 rounded border border-[#262734]">
                      {item.s} ➔ {item.e}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {item.isOverlap && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-950/70 text-rose-300 border border-rose-500/50">
                        ⛔ OVERLAP ({item.gapVal.toFixed(3)}s)
                      </span>
                    )}
                    {item.isGap && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-950/70 text-amber-300 border border-amber-500/50">
                        ⚠️ GAP (+{item.gapVal.toFixed(2)}s)
                      </span>
                    )}
                    <span
                      className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                        item.hasLongLine
                          ? 'bg-rose-950/60 text-rose-300 border border-rose-500/40'
                          : 'bg-[#0e0f12] text-slate-400 border border-[#262734]'
                      }`}
                      title={item.hasLongLine ? 'Subtitles > 42 chars per line may wrap poorly' : 'Character count'}
                    >
                      {item.charCount} chars {item.hasLongLine && '⚠️ >42'}
                    </span>
                  </div>
                </div>

                <div className="mt-1 text-xs font-medium text-slate-200 bg-[#14151a] p-2.5 rounded-lg border border-[#262734] leading-relaxed">
                  {item.text || <span className="text-slate-500 italic font-normal">(Empty transcript)</span>}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 mt-3 border-t border-[#262734] text-xs">
          <span className="text-slate-400">
            Standard format: <code className="font-mono bg-[#0e0f12] px-1.5 py-0.5 rounded border border-[#262734] text-slate-300">00:00:00,000 --&gt; 00:00:00,000</code>
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDismiss}
              className="px-3.5 py-1.5 bg-[#181920] hover:bg-[#22232c] text-slate-300 hover:text-white rounded-xl font-semibold border border-[#262734] transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              onClick={handleDownload}
              className="px-4 py-1.5 bg-[#00e5be] hover:bg-[#00c8a5] text-black rounded-xl font-bold transition-all shadow-[0_0_15px_rgba(0,229,190,0.2)] cursor-pointer"
            >
              Download .SRT File
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
