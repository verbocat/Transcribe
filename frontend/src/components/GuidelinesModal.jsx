import React, { useState, useEffect } from 'react';
import { X, BookOpen } from 'lucide-react';

export default function GuidelinesModal({ isOpen, onClose }) {
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

  if (!isOpen) return null;

  const handleDismiss = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 220);
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
      <div className={`bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-2xl max-w-3xl w-full p-6 shadow-xl relative max-h-[85vh] overflow-y-auto text-slate-200 custom-scrollbar ${
        isClosing ? 'animate-mac-squish-exit' : 'animate-mac-squish'
      }`}>
        <button
          onClick={handleDismiss}
          className="absolute top-5 right-5 p-1.5 text-slate-400 hover:text-white rounded-lg bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border border-[var(--kt-s4)] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="mb-6">
          <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[var(--kt-accent)]" />
            Karya Transcription Guidelines Cheatsheet
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Strict project compliance rules. Target overall batch acceptance quality: <strong className="text-[var(--kt-accent)]">≥ 98%</strong>.
          </p>
        </div>

        <div className="space-y-4 text-xs text-slate-300">
          {/* Section 1 */}
          <div className="bg-[var(--kt-s2)] p-4 rounded-xl border border-[var(--kt-s4)]">
            <h3 className="font-bold text-[var(--kt-accent)] text-sm mb-2">1. Segmentation Rules (§5)</h3>
            <ul className="list-disc pl-5 space-y-1 text-slate-400 leading-relaxed">
              <li><strong className="text-slate-200">Duration:</strong> Minimum <strong className="text-slate-200">0.5s</strong>, Maximum <strong className="text-slate-200">20.0s</strong>.</li>
              <li><strong className="text-slate-200">Buffers:</strong> Maintain approximately <strong className="text-slate-200">0.3-second buffer</strong> at start and end without cutting off words.</li>
              <li><strong className="text-slate-200">Silence Limits:</strong> No segment should contain continuous silence/noise longer than <strong className="text-slate-200">4.0s</strong> (treat as boundary).</li>
              <li><strong className="text-slate-200">No Overlaps:</strong> <code className="bg-[var(--kt-s1)] px-1 py-0.5 rounded border border-[var(--kt-s4)] text-slate-300">End_Time[n] &le; Start_Time[n+1]</code> strictly.</li>
            </ul>
          </div>

          {/* Section 2 */}
          <div className="bg-[var(--kt-s2)] p-4 rounded-xl border border-[var(--kt-s4)]">
            <h3 className="font-bold text-[var(--kt-accent)] text-sm mb-2">2. Speaker & Gender Tags (§5)</h3>
            <ul className="list-disc pl-5 space-y-1 text-slate-400 leading-relaxed">
              <li><strong className="text-slate-200">Speaker 1:</strong> The participant who speaks first in the recording.</li>
              <li><strong className="text-slate-200">Speaker 2:</strong> The second participant in the conversation.</li>
              <li><strong className="text-slate-200">Gender:</strong> Allowed values: <code className="bg-[var(--kt-s1)] px-1 py-0.5 rounded border border-[var(--kt-s4)] text-slate-300">Male</code>, <code className="bg-[var(--kt-s1)] px-1 py-0.5 rounded border border-[var(--kt-s4)] text-slate-300">Female</code>, <code className="bg-[var(--kt-s1)] px-1 py-0.5 rounded border border-[var(--kt-s4)] text-slate-300">Unknown</code>.</li>
            </ul>
          </div>

          {/* Section 3 */}
          <div className="bg-[var(--kt-s2)] p-4 rounded-xl border border-[var(--kt-s4)]">
            <h3 className="font-bold text-[var(--kt-accent)] text-sm mb-2">3. Full Verbatim Transcription Rules (§6)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
              <div className="p-3 rounded-lg bg-[var(--kt-s1)] border border-[var(--kt-s4)]">
                <span className="font-bold text-slate-200 block mb-1">Type Exactly as Spoken</span>
                <p className="text-slate-400">Do not fix grammar, slang, or colloquialisms. Never beautify sentences.</p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--kt-s1)] border border-[var(--kt-s4)]">
                <span className="font-bold text-slate-200 block mb-1">Numbers in Words Only</span>
                <p className="text-slate-400">Never use digits (<code className="text-[var(--kt-accent)]">0-9</code> or <code className="text-[var(--kt-accent)]">०-९</code>). Write <code>तीन</code> or <code>three</code>.</p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--kt-s1)] border border-[var(--kt-s4)]">
                <span className="font-bold text-slate-200 block mb-1">Punctuation Whitelist</span>
                <p className="text-slate-400">Only <code className="text-[var(--kt-accent)]">. , ? ! - _ ' ।</code> are permitted. No <code>% & ; : "</code>.</p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--kt-s1)] border border-[var(--kt-s4)]">
                <span className="font-bold text-slate-200 block mb-1">No Code-Mixed Scripts</span>
                <p className="text-slate-400">Transliterate foreign words into target script (e.g. <code>मीटिंग</code>, not <code>meeting</code>).</p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--kt-s1)] border border-[var(--kt-s4)]">
                <span className="font-bold text-slate-200 block mb-1">Stutters with Hyphens</span>
                <p className="text-slate-400">Retain repetitions with hyphens: <code>म-म-मैं क-क-कल आऊँगा।</code></p>
              </div>
              <div className="p-3 rounded-lg bg-[var(--kt-s1)] border border-[var(--kt-s4)]">
                <span className="font-bold text-slate-200 block mb-1">Incomplete Sentences</span>
                <p className="text-slate-400">Trailing/unfinished sentences end with double hyphen <code>--</code>.</p>
              </div>
            </div>
          </div>

          {/* Section 4 */}
          <div className="bg-[var(--kt-s2)] p-4 rounded-xl border border-[var(--kt-s4)]">
            <h3 className="font-bold text-[var(--kt-accent)] text-sm mb-2">4. Special Acoustic Tags (§6.3)</h3>
            <ul className="list-disc pl-5 space-y-1 text-slate-400 leading-relaxed">
              <li><code className="bg-[var(--kt-s1)] px-1 py-0.5 rounded border border-[var(--kt-s4)] text-slate-300">[unintelligible]</code>: Speech is audible but unintelligible due to accent or pronunciation.</li>
              <li><code className="bg-[var(--kt-s1)] px-1 py-0.5 rounded border border-[var(--kt-s4)] text-slate-300">[inaudible]</code>: Speech cannot be heard due to low volume, noise, clipping, or distortion.</li>
            </ul>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-[var(--kt-s4)] flex justify-end">
          <button
            onClick={handleDismiss}
            className="px-5 py-2 bg-[var(--kt-accent)] hover:bg-[var(--kt-accent-strong)] text-black rounded-xl text-xs font-bold shadow-[0_0_12px_rgba(var(--kt-accent-rgb),0.25)] cursor-pointer"
          >
            Got It
          </button>
        </div>
      </div>
    </div>
  );
}
