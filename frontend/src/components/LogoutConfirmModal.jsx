import React, { useEffect, useState } from 'react';
import { LogOut, X, ShieldAlert, Sparkles } from 'lucide-react';

/**
 * macOS Tab Genie Squish-and-Pop Logout Confirmation Dialog.
 * Pure Tailwind CSS implementation with spring bounce physics and keyboard escape handling.
 */
export default function LogoutConfirmModal({ isOpen, onClose, onConfirm, user }) {
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
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
    }, 220);
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
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md transition-opacity duration-200 select-none"
      onClick={handleDismiss}
      role="dialog"
      aria-modal="true"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-2xl p-6 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_20px_rgba(var(--kt-accent-rgb),0.06)] relative overflow-hidden ${
          isClosing ? 'animate-mac-squish-exit' : 'animate-mac-squish'
        }`}
      >
        {/* Subtle Ambient Top Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-12 bg-rose-500/15 blur-2xl pointer-events-none rounded-full" />

        {/* Top Close Button */}
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[var(--kt-s3)] border border-transparent hover:border-[var(--kt-s5)] transition-colors cursor-pointer"
          title="Close dialog (Esc)"
        >
          <X size={16} />
        </button>

        {/* Modal Header Icon */}
        <div className="flex items-center gap-3.5 mb-4">
          <div className="w-12 h-12 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.2)] shrink-0">
            <LogOut size={22} className="stroke-[2.2]" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">Sign Out of Lower Third?</h3>
            <p className="text-xs text-slate-400">End your active workstation session</p>
          </div>
        </div>

        {/* User Card Summary */}
        {user && (
          <div className="mb-4 p-3 rounded-xl bg-[var(--kt-s0)] border border-[var(--kt-s4)] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#0284c7] to-[#2563eb] flex items-center justify-center text-white font-bold text-xs shrink-0 shadow-inner">
                {user.name ? user.name.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-bold text-white truncate">{user.name || user.email}</div>
                <div className="text-[11px] font-mono text-slate-400 truncate">{user.email}</div>
              </div>
            </div>
          </div>
        )}

        {/* Safety & Persistence Note */}
        <p className="text-xs text-slate-400 leading-relaxed mb-6">
          Your active edits, drafts, and sovereign local SQLite projects are securely saved on your server. You can safely sign back in at any time.
        </p>

        {/* Action Buttons */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-[var(--kt-s3)]">
          <button
            type="button"
            onClick={handleDismiss}
            className="px-4 py-2 rounded-xl text-xs font-semibold bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] text-slate-300 hover:text-white border border-[var(--kt-s4)] transition-colors cursor-pointer"
          >
            Stay Signed In
          </button>
          <button
            type="button"
            onClick={handleProceed}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-[0_0_15px_rgba(225,29,72,0.35)] cursor-pointer flex items-center gap-1.5"
          >
            <LogOut size={13} />
            <span>Yes, Sign Out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
