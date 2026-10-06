import React from 'react';
import { Loader2, CheckCircle2, AlertCircle, ShieldCheck, Sparkles, Building2, UserCheck } from 'lucide-react';

/**
 * macOS Squish-and-Pop Synchronous Auth Process & Loader Modal.
 * Completely synced with the real asynchronous login / signup requests.
 * Styled in 100% pure Tailwind CSS.
 */
export default function AuthProcessModal({ isOpen, type = 'login', stage, errorMessage, onCloseError, userName }) {
  if (!isOpen) return null;

  // Stages definition
  const loginStages = [
    { key: 'connecting', label: 'Connecting to sovereign server...', sub: 'Establishing secure gateway handshake' },
    { key: 'authenticating', label: 'Authenticating credentials & location...', sub: 'Verifying enterprise security token' },
    { key: 'initializing', label: 'Configuring workstation environment...', sub: 'Loading speech & subtitle models' },
    { key: 'success', label: 'Authentication Complete!', sub: `Welcome back${userName ? ', ' + userName : ''}!` },
  ];

  const signupStages = [
    { key: 'connecting', label: 'Connecting to sovereign server...', sub: 'Validating security handshake' },
    { key: 'registering', label: 'Creating enterprise account...', sub: 'Registering account identity' },
    { key: 'tokenizing', label: 'Generating activation token...', sub: 'Preparing verification email' },
    { key: 'success', label: 'Account Created Successfully!', sub: 'Check your inbox to activate.' },
  ];

  const stages = type === 'signup' ? signupStages : loginStages;

  // Compute active stage index
  const stageKeys = stages.map(s => s.key);
  let currentIndex = stageKeys.indexOf(stage);
  if (currentIndex === -1) {
    if (stage === 'error') currentIndex = 1;
    else currentIndex = 0;
  }

  const isSuccess = stage === 'success';
  const isError = stage === 'error';

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md select-none"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-2xl p-6 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.95),0_0_30px_rgba(var(--kt-accent-rgb),0.1)] relative overflow-hidden animate-mac-squish">
        {/* Ambient Top Glow */}
        <div className={`absolute top-0 left-1/2 -translate-x-1/2 w-48 h-12 blur-2xl pointer-events-none rounded-full ${
          isError ? 'bg-rose-500/20' : isSuccess ? 'bg-emerald-500/25' : 'bg-[var(--kt-accent)]/20'
        }`} />

        {/* Header Icon */}
        <div className="flex flex-col items-center text-center mb-6">
          <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-3 transition-all duration-300 ${
            isError
              ? 'bg-rose-500/15 border border-rose-500/40 text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.3)]'
              : isSuccess
              ? 'bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 shadow-[0_0_25px_rgba(var(--kt-accent-rgb),0.4)] scale-105'
              : 'bg-[var(--kt-accent)]/10 border border-[var(--kt-accent)]/30 text-[var(--kt-accent)] shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.25)]'
          }`}>
            {isError ? (
              <AlertCircle size={28} className="animate-shake" />
            ) : isSuccess ? (
              <CheckCircle2 size={30} className="stroke-[2.5]" />
            ) : (
              <Loader2 size={28} className="animate-spin text-[var(--kt-accent)]" />
            )}
          </div>

          <h3 className="text-lg font-extrabold text-white tracking-tight">
            {isError
              ? (type === 'signup' ? 'Registration Failed' : 'Sign In Failed')
              : isSuccess
              ? (type === 'signup' ? 'Account Provisioned!' : 'Authentication Successful!')
              : (type === 'signup' ? 'Creating VerboLabs Account' : 'Signing In to Karya Studio')}
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-xs">
            {isError
              ? errorMessage || 'An unexpected error occurred. Please try again.'
              : isSuccess
              ? (type === 'signup' ? 'Your account has been prepared.' : 'Launching your studio workspace...')
              : 'Real-time synchronization with sovereign server'}
          </p>
        </div>

        {/* Stepped Progress Stages (Only when not in error) */}
        {!isError && (
          <div className="space-y-3 mb-6 bg-[var(--kt-s0)] border border-[var(--kt-s4)] rounded-xl p-4">
            {stages.map((stg, idx) => {
              const isPast = currentIndex > idx;
              const isCurrent = currentIndex === idx;
              return (
                <div key={stg.key} className="flex items-start gap-3 transition-opacity">
                  <div className="mt-0.5 shrink-0">
                    {isPast ? (
                      <div className="w-4 h-4 rounded-full bg-emerald-500/20 border border-emerald-500 text-emerald-400 flex items-center justify-center">
                        <CheckCircle2 size={11} className="stroke-[3]" />
                      </div>
                    ) : isCurrent ? (
                      <div className="w-4 h-4 rounded-full bg-[var(--kt-accent)]/20 border border-[var(--kt-accent)] text-[var(--kt-accent)] flex items-center justify-center">
                        {isSuccess ? (
                          <CheckCircle2 size={11} className="stroke-[3]" />
                        ) : (
                          <Loader2 size={10} className="animate-spin" />
                        )}
                      </div>
                    ) : (
                      <div className="w-4 h-4 rounded-full border border-[var(--kt-s5)] bg-[var(--kt-s1)]" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className={`text-xs font-semibold ${
                      isPast || (isCurrent && isSuccess)
                        ? 'text-emerald-300'
                        : isCurrent
                        ? 'text-[var(--kt-accent)]'
                        : 'text-slate-500'
                    }`}>
                      {stg.label}
                    </div>
                    <div className="text-[10px] text-slate-500 font-normal truncate">
                      {stg.sub}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Error Dismiss Button */}
        {isError && (
          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={onCloseError}
              className="w-full px-4 py-2.5 rounded-xl text-xs font-bold bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-white border border-[var(--kt-s5)] transition-colors cursor-pointer"
            >
              Close & Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
