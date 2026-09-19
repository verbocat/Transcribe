import React, { useState, useEffect } from 'react';
import { AlertTriangle, Monitor, ShieldAlert, CheckCircle2, LogOut, ArrowRight } from 'lucide-react';

export default function DeviceTakeoverAlertModal({
  isOpen,
  takeover,
  onKeepWorking,
  onLogOutNow
}) {
  if (!isOpen || !takeover) return null;

  const [secondsLeft, setSecondsLeft] = useState(takeover.remaining_seconds || 60);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setSecondsLeft(takeover.remaining_seconds || 60);
  }, [takeover]);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const interval = setInterval(() => {
      setSecondsLeft((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [secondsLeft]);

  const handleKeep = async () => {
    setIsSubmitting(true);
    try {
      await onKeepWorking(takeover.takeover_id);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRelease = async () => {
    setIsSubmitting(true);
    try {
      await onLogOutNow(takeover.takeover_id);
    } finally {
      setIsSubmitting(false);
    }
  };

  const progressPercent = Math.max(0, Math.min(100, (secondsLeft / 60) * 100));

  return (
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md select-none animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md bg-[#14151a] border-2 border-amber-500/40 rounded-2xl p-6 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95),0_0_35px_rgba(245,158,11,0.2)] relative overflow-hidden animate-mac-squish text-slate-200">
        {/* Glow Header */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-48 h-12 bg-amber-500/20 blur-2xl pointer-events-none rounded-full" />

        {/* Header Icon */}
        <div className="flex flex-col items-center text-center mb-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/15 border border-amber-500/40 text-amber-400 flex items-center justify-center mb-3 shadow-[0_0_20px_rgba(245,158,11,0.3)] animate-pulse">
            <ShieldAlert size={30} />
          </div>
          <h3 className="text-lg font-extrabold text-white tracking-tight">
            Session Takeover Request
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xs">
            Another device is attempting to log into your Karya Studio account.
          </p>
        </div>

        {/* Requesting Device Card */}
        <div className="p-3 bg-[#0e0f12] border border-[#262734] rounded-xl text-center mb-4">
          <span className="text-[11px] text-slate-500 block mb-1">Incoming Login From:</span>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#1c1e28] border border-[#2d3042] text-xs font-mono text-amber-300">
            <Monitor size={13} />
            <span>{takeover.requesting_device || 'Remote Workstation'}</span>
          </div>
        </div>

        {/* 60s Countdown Timer Bar */}
        <div className="mb-5 bg-[#0e0f12] border border-[#262734] rounded-xl p-3 text-center">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-slate-400">Automatic Logout In:</span>
            <span className="font-mono font-bold text-amber-400 text-sm">
              00:{secondsLeft.toString().padStart(2, '0')}
            </span>
          </div>
          <div className="w-full h-1.5 bg-[#1f202b] rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-amber-500 to-rose-500 transition-all duration-1000"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-[11px] text-slate-500 mt-2">
            If you do not respond, this workstation will be logged out automatically to yield access to the new device.
          </p>
        </div>

        {/* Decision Actions */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={handleKeep}
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-[#00e5be] hover:bg-[#00d4af] text-black transition-all shadow-[0_0_20px_rgba(0,229,190,0.3)] hover:shadow-[0_0_25px_rgba(0,229,190,0.45)] cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <CheckCircle2 size={16} />
            <span>Keep Working on This Device (Decline)</span>
          </button>

          <button
            type="button"
            onClick={handleRelease}
            disabled={isSubmitting}
            className="w-full py-2 px-4 rounded-xl text-xs font-semibold bg-[#1a1b24] hover:bg-[#252836] text-slate-300 hover:text-white border border-[#2f3142] transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
          >
            <LogOut size={14} />
            <span>Log Out Now (Allow Other Device)</span>
          </button>
        </div>
      </div>
    </div>
  );
}
