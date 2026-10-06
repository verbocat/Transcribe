import React, { useState } from 'react';
import { Mail, KeyRound, AlertCircle, CheckCircle2, ArrowRight, ArrowLeft, Loader2, Send } from 'lucide-react';
import { requestPasswordReset } from './authService';
import { useTheme } from '../context/ThemeContext';

export default function ForgotPasswordPage({ onSwitchToLogin, embedded = false }) {
  const { isDark } = useTheme();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState(null);

  const validateEmailFormat = (val) => {
    const clean = val.trim().toLowerCase();
    if (!clean) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) {
      setError('Please enter your email address.');
      return;
    }

    if (!validateEmailFormat(cleanEmail)) {
      setError('Please enter a valid email address.');
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
      <div className={embedded ? "w-full p-0 text-center animate-mac-squish" : `w-full max-w-[440px] ${isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)]' : 'bg-white border-slate-200 shadow-xl'} border rounded-2xl p-6 sm:p-7 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_25px_rgba(var(--kt-accent-rgb),0.06)] relative z-10 text-center animate-mac-squish`}>
        <div className={`w-13 h-13 rounded-2xl flex items-center justify-center mx-auto mb-3.5 border ${
          isDark
            ? 'bg-rose-500/15 border-rose-500/30 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.3)]'
            : 'bg-rose-50 border-rose-200 text-rose-600 shadow-sm'
        }`}>
          <Send size={26} />
        </div>
        <h2 className={`text-xl font-extrabold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>Reset Link Sent</h2>
        <p className={`text-xs mt-1 mb-4 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          We've sent password reset instructions to:<br />
          <strong className={`text-sm font-mono ${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-700'}`}>{submittedEmail}</strong>
        </p>

        <div className={`p-3 mb-5 rounded-xl border text-xs text-left flex items-start gap-2.5 ${
          isDark
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-emerald-50 border-emerald-200 text-emerald-800'
        }`}>
          <CheckCircle2 size={16} className={`shrink-0 mt-0.5 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`} />
          <div className="leading-relaxed text-[11.5px]">
            Please check your inbox and click the reset button. The link is single-use and valid for 1 hour.
          </div>
        </div>

        <button
          type="button"
          onClick={onSwitchToLogin}
          className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold tracking-normal transition-colors cursor-pointer flex items-center justify-center gap-2 ${
            isDark
              ? 'bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-white border border-[var(--kt-s5)]'
              : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300'
          }`}
        >
          <ArrowLeft size={15} />
          <span>Back to Sign In</span>
        </button>
      </div>
    );
  }

  return (
    <div className={embedded ? "w-full p-0 flex flex-col justify-between relative" : `w-full max-w-[440px] ${isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)] hover:border-[var(--kt-accent)]/30' : 'bg-white border-slate-200 shadow-xl'} border rounded-2xl p-6 sm:p-7 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_25px_rgba(var(--kt-accent-rgb),0.06)] relative z-10 transition-all duration-300`}>
      <div className="text-center mb-4">
        <div className={`inline-flex items-center justify-center w-11 h-11 rounded-xl mb-2 border ${
          isDark
            ? 'bg-rose-500/15 border-rose-500/30 text-rose-400 shadow-[0_0_15px_rgba(244,63,94,0.25)]'
            : 'bg-rose-50 border-rose-200 text-rose-600 shadow-sm'
        }`}>
          <KeyRound size={22} />
        </div>
        <h1 className={`text-xl font-extrabold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
          Reset <span className={isDark ? "text-[var(--kt-accent)]" : "text-blue-600"}>Password</span>
        </h1>
        <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          Enter your email address to receive a recovery link
        </p>
      </div>

      {error && (
        <div className={`mb-3.5 p-2.5 rounded-xl border text-xs flex items-start gap-2 ${
          isDark ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          <AlertCircle size={15} className={`shrink-0 mt-0.5 ${isDark ? 'text-rose-400' : 'text-rose-600'}`} />
          <div>{error}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <label className={`block text-[11px] font-semibold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-700'}`}>
            Email Address <span className={isDark ? "text-[var(--kt-accent)]" : "text-blue-600"}>*</span>
          </label>
          <div className="relative flex items-center">
            <Mail size={15} className={`absolute left-3 pointer-events-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
            <input
              type="email"
              placeholder="name@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className={`w-full pl-9 pr-3 py-2 rounded-lg text-xs outline-none transition-all ${
                isDark
                  ? 'bg-[var(--kt-s0)] border border-[var(--kt-s4)] focus:border-[var(--kt-accent)] focus:ring-1 focus:ring-[var(--kt-accent)] text-white placeholder-slate-600'
                  : 'bg-slate-50 border border-slate-300 focus:border-blue-600 focus:ring-1 focus:ring-blue-500 text-slate-900 placeholder-slate-400'
              } ${email && !validateEmailFormat(email) ? '!border-rose-500' : ''}`}
            />
          </div>
          {email && !validateEmailFormat(email) && (
            <span className="block mt-1 text-[11px] text-rose-500">
              Please enter a valid email address
            </span>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold tracking-normal transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            isDark
              ? 'bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.3)]'
              : 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-md'
          }`}
        >
          {isSubmitting ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              <span className="tracking-normal font-semibold">Sending Link...</span>
            </>
          ) : (
            <>
              <span className="tracking-normal font-semibold text-xs">Send Reset Link</span>
              <ArrowRight size={15} />
            </>
          )}
        </button>
      </form>

      <div className={`mt-5 pt-3.5 border-t text-center text-xs ${isDark ? 'border-[var(--kt-s3)] text-slate-400' : 'border-slate-200 text-slate-600'}`}>
        <button
          type="button"
          onClick={onSwitchToLogin}
          className={`font-semibold flex items-center justify-center gap-1.5 mx-auto transition-colors cursor-pointer bg-transparent border-0 p-0 ${
            isDark ? 'text-slate-400 hover:text-white' : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ArrowLeft size={13} />
          <span>Back to Sign In</span>
        </button>
      </div>
    </div>
  );
}
