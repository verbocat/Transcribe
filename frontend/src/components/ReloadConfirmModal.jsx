import React, { useEffect, useState } from 'react';
import { AlertTriangle, RefreshCw, X } from 'lucide-react';

/**
 * macOS Bottom Squish Reload Confirmation Modal.
 * Smoothly animates in from bottom with genie squish, smoothly exits to bottom on dismiss or Escape.
 */
export default function ReloadConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title = "Reload Studio?",
  description = "Are you sure you want to reload? Any unsaved edits, active waveform alignments, or AI progress will be lost."
}) {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setIsClosing(false);
      return;
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleDismiss();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleDismiss = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 200);
  };

  const handleProceed = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onConfirm();
    }, 180);
  };

  return (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs select-none transition-opacity duration-200 ${
        isClosing ? 'opacity-0' : 'opacity-100'
      }`}
      onClick={handleDismiss}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-2xl shadow-2xl max-w-md w-full p-6 text-slate-200 relative overflow-hidden ${
          isClosing ? 'animate-mac-squish-exit' : 'animate-mac-squish'
        }`}
      >
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[var(--kt-s3)] transition-colors cursor-pointer"
          title="Stay on Page (Esc)"
        >
          <X size={16} />
        </button>

        <div className="flex items-start gap-3.5 mb-4 pr-6">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 className="text-base font-bold text-white mb-1">{title}</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {description}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-[var(--kt-s4)]">
          <button
            type="button"
            onClick={handleDismiss}
            className="px-4 py-2 rounded-xl text-xs font-semibold border border-[var(--kt-s4)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            No, Stay on Page
          </button>
          <button
            type="button"
            onClick={handleProceed}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-md cursor-pointer flex items-center gap-1.5"
          >
            <RefreshCw size={13} />
            <span>Yes, Reload</span>
          </button>
        </div>
      </div>
    </div>
  );
}
