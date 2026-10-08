import React from 'react';
import { ShieldAlert, ArrowLeft, Home, Sparkles, Terminal } from 'lucide-react';
import { useAuth } from '../auth_views/AuthContext';

export default function NotFoundPage({ onNavigateHome, onNavigateStudio, onOpenAuth }) {
  const { isAuthenticated } = useAuth();

  const handleGoHome = () => {
    if (onNavigateHome) {
      onNavigateHome();
    } else if (typeof window !== 'undefined') {
      window.history.pushState({ tool: null }, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const handleGoStudio = () => {
    if (onNavigateStudio) {
      onNavigateStudio();
    } else if (typeof window !== 'undefined') {
      window.history.pushState({ tool: 'subtitle' }, '', '/subtitle');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  return (
    <div className="min-h-screen bg-[var(--kt-s0)] text-[var(--kt-text)] flex flex-col items-center justify-center p-6 relative overflow-hidden select-none">
      {/* Ambient background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-gradient-to-tr from-[var(--kt-accent)]/10 via-[#0088ff]/10 to-transparent blur-3xl pointer-events-none rounded-full" />

      <div className="w-full max-w-md bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-2xl p-8 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_30px_rgba(var(--kt-accent-rgb),0.06)] relative z-10 text-center animate-in fade-in zoom-in-95 duration-200">
        {/* Warning Icon Badge */}
        <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto mb-5 shadow-[0_0_25px_rgba(244,63,94,0.2)]">
          <ShieldAlert size={32} />
        </div>

        {/* 404 Heading */}
        <div className="font-mono text-5xl font-black tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-rose-400 via-amber-300 to-rose-400 mb-2">
          404
        </div>
        <h1 className="text-xl font-extrabold text-white tracking-tight mb-2">
          Page Not Found / Access Denied
        </h1>
        <p className="text-xs text-slate-400 leading-relaxed mb-6">
          The requested path does not exist on this server, or is strictly protected and requires elevated Super Administrator credentials.
        </p>

        {/* Action Buttons */}
        <div className="space-y-2.5">
          {isAuthenticated ? (
            <button
              onClick={handleGoStudio}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black transition-all shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.25)] cursor-pointer flex items-center justify-center gap-2"
            >
              <Sparkles size={14} />
              <span>Launch Subtitle Studio</span>
            </button>
          ) : (
            <button
              onClick={() => onOpenAuth ? onOpenAuth('login') : handleGoHome()}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black transition-all shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.25)] cursor-pointer flex items-center justify-center gap-2"
            >
              <span>Sign In to Your Account</span>
            </button>
          )}

          <button
            onClick={handleGoHome}
            className="w-full py-2 px-4 rounded-xl text-xs font-semibold bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-slate-300 border border-[var(--kt-s4)] transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <Home size={13} />
            <span>Return to Landing Page</span>
          </button>
        </div>

        {/* Footer info */}
        <div className="mt-6 pt-4 border-t border-[var(--kt-s3)] text-[10px] font-mono text-slate-500">
          Lower Third • VerboLabs
        </div>
      </div>
    </div>
  );
}
