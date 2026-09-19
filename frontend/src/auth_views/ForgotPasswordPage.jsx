import React, { useState } from 'react';
import { Mail, KeyRound, AlertCircle, CheckCircle2, ArrowRight, ArrowLeft, Loader2, Send } from 'lucide-react';
import { requestPasswordReset } from './authService';

export default function ForgotPasswordPage({ onSwitchToLogin }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState(null);

  const validateEmailDomain = (val) => {
    const clean = val.trim().toLowerCase();
    if (!clean) return false;
    return clean.endsWith('.verbolabs.com') || clean.endsWith('@verbolabs.com');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError('Please enter your work email.');
      return;
    }

    if (!validateEmailDomain(cleanEmail)) {
      setError('Access restricted: Only official @verbolabs.com email addresses are permitted.');
      return;
    }

    setIsSubmitting(true);
    try {
      await requestPasswordReset(cleanEmail);
      setSubmittedEmail(cleanEmail);
    } catch (err) {
      setError(err.message || 'Failed to send password reset link.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submittedEmail) {
    return (
      <div className="w-full max-w-[440px] bg-[#14151a] border border-[#262734] rounded-2xl p-6 sm:p-7 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_25px_rgba(0,229,190,0.06)] relative z-10 text-center animate-mac-squish">
        <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto mb-4 shadow-[0_0_15px_rgba(244,63,94,0.3)]">
          <Send size={28} />
        </div>
        <h2 className="text-xl font-extrabold text-white tracking-tight">Reset Link Sent</h2>
        <p className="text-xs text-slate-400 mt-1 mb-4">
          We've sent password reset instructions to:<br />
          <strong className="text-sm text-[#00e5be] font-mono">{submittedEmail}</strong>
        </p>

        <div className="p-3 mb-5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs text-left flex items-start gap-2.5">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
          <div className="leading-relaxed">
            Please check your inbox and click the reset button. The link is single-use and valid for 1 hour.
          </div>
        </div>

        <button
          type="button"
          onClick={onSwitchToLogin}
          className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-[#1e202a] hover:bg-[#262937] text-white border border-[#2f3142] transition-colors cursor-pointer flex items-center justify-center gap-2"
        >
          <ArrowLeft size={15} />
          <span>Back to Sign In</span>
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[440px] bg-[#14151a] border border-[#262734] hover:border-[#00e5be]/30 rounded-2xl p-6 sm:p-7 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_25px_rgba(0,229,190,0.06)] relative z-10 transition-all duration-300">
      <div className="text-center mb-5">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-rose-500/15 border border-rose-500/30 text-rose-400 mb-2 shadow-[0_0_15px_rgba(244,63,94,0.25)]">
          <KeyRound size={22} />
        </div>
        <h1 className="text-xl font-extrabold text-white tracking-tight">
          Reset <span className="text-[#00e5be]">Password</span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Enter your <strong className="text-[#00e5be] font-semibold">@verbolabs.com</strong> email for recovery link
        </p>
      </div>

      {error && (
        <div className="mb-4 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
          <AlertCircle size={15} className="text-rose-400 shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1">
            VerboLabs Email <span className="text-[#00e5be]">*</span>
          </label>
          <div className="relative flex items-center">
            <Mail size={16} className="absolute left-3 text-slate-500 pointer-events-none" />
            <input
              type="email"
              placeholder="yourname@verbolabs.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className={`w-full pl-9 pr-3 py-2 bg-[#0e0f12] border ${
                email && !validateEmailDomain(email) ? 'border-rose-500' : 'border-[#262734] focus:border-[#00e5be]'
              } focus:ring-1 focus:ring-[#00e5be] rounded-lg text-xs text-white placeholder-slate-600 outline-none transition-all`}
            />
          </div>
          {email && !validateEmailDomain(email) && (
            <span className="block mt-1 text-[11px] text-rose-400">
              Must end with @verbolabs.com
            </span>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-[0_0_20px_rgba(225,29,72,0.3)] cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span>Sending Link...</span>
            </>
          ) : (
            <>
              <span>Send Reset Link</span>
              <ArrowRight size={15} />
            </>
          )}
        </button>
      </form>

      <div className="mt-5 pt-3.5 border-t border-[#22232c] text-center text-xs text-slate-400">
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="font-semibold text-slate-400 hover:text-white flex items-center justify-center gap-1.5 mx-auto transition-colors cursor-pointer bg-transparent border-0 p-0"
        >
          <ArrowLeft size={13} />
          <span>Back to Sign In</span>
        </button>
      </div>
    </div>
  );
}
