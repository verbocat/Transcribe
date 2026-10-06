import React, { useState, useEffect } from 'react';
import { CheckCircle2, AlertCircle, Loader2, ArrowRight } from 'lucide-react';
import { verifyEmailToken } from './authService';

export default function VerifyEmailPage({ token: propToken, onVerified }) {
  const [status, setStatus] = useState('verifying'); // 'verifying', 'success', 'error'
  const [message, setMessage] = useState('Verifying your email token...');

  useEffect(() => {
    let tokenToVerify = propToken;
    if (!tokenToVerify) {
      const params = new URLSearchParams(window.location.search);
      tokenToVerify = params.get('token');
    }

    if (!tokenToVerify) {
      setStatus('error');
      setMessage('No verification token found in URL. Please click the link directly from your email.');
      return;
    }

    async function executeVerification() {
      try {
        const result = await verifyEmailToken(tokenToVerify);
        setStatus('success');
        setMessage(result.message || 'Email verified successfully! You can now log in.');
      } catch (err) {
        setStatus('error');
        setMessage(err.message || 'Verification failed. The token may be expired or invalid.');
      }
    }

    executeVerification();
  }, [propToken]);

  return (
    <div className="w-full max-w-[440px] bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-2xl p-6 sm:p-7 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_25px_rgba(var(--kt-accent-rgb),0.06)] relative z-10 text-center animate-mac-squish">
      {status === 'verifying' && (
        <>
          <div className="w-14 h-14 rounded-2xl bg-[var(--kt-accent)]/10 border border-[var(--kt-accent)]/30 text-[var(--kt-accent)] flex items-center justify-center mx-auto mb-4 shadow-[0_0_15px_rgba(var(--kt-accent-rgb),0.2)]">
            <Loader2 size={28} className="animate-spin" />
          </div>
          <h2 className="text-xl font-extrabold text-white tracking-tight">Verifying Account</h2>
          <p className="text-xs text-slate-400 mt-1">{message}</p>
        </>
      )}

      {status === 'success' && (
        <>
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto mb-4 shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.3)]">
            <CheckCircle2 size={32} />
          </div>
          <h2 className="text-xl font-extrabold text-white tracking-tight">Email Verified!</h2>
          <p className="text-xs text-slate-300 mt-1 mb-5 leading-relaxed">{message}</p>
          <button
            type="button"
            onClick={onVerified}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black transition-all shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.3)] cursor-pointer flex items-center justify-center gap-2"
          >
            <span>Sign In to Studio</span>
            <ArrowRight size={15} />
          </button>
        </>
      )}

      {status === 'error' && (
        <>
          <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/40 text-rose-400 flex items-center justify-center mx-auto mb-4 shadow-[0_0_20px_rgba(244,63,94,0.3)]">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-xl font-extrabold text-white tracking-tight">Verification Failed</h2>
          <p className="text-xs text-rose-300 mt-1 mb-5 leading-relaxed">{message}</p>
          <button
            type="button"
            onClick={onVerified}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-white border border-[var(--kt-s5)] transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <span>Back to Sign In</span>
            <ArrowRight size={15} />
          </button>
        </>
      )}
    </div>
  );
}
