import React, { useState, useEffect } from 'react';
import { Lock, Eye, EyeOff, KeyRound, AlertCircle, CheckCircle2, ArrowRight, Loader2 } from 'lucide-react';
import { resetPassword, checkPasswordCriteria } from './authService';
import PasswordCriteriaList from './PasswordCriteriaList';
import { useTheme } from '../context/ThemeContext';

export default function ResetPasswordPage({ token: propToken, onPasswordResetSuccess, embedded = false }) {
  const { isDark } = useTheme();
  const [token, setToken] = useState(propToken || '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isResetSuccess, setIsResetSuccess] = useState(false);

  useEffect(() => {
    if (!token) {
      const params = new URLSearchParams(window.location.search);
      const urlToken = params.get('token');
      if (urlToken) {
        setToken(urlToken);
      } else {
        setError('No password reset token found in URL. Please click the reset link directly from your email.');
      }
    }
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError('Missing reset token. Please use the link sent to your email.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter identical passwords.');
      return;
    }

    const criteria = checkPasswordCriteria(password);
    const isValidPwd = Object.values(criteria).every(Boolean);
    if (!isValidPwd) {
      setError('Password does not satisfy all criteria.');
      return;
    }

    setIsSubmitting(true);
    try {
      await resetPassword({
        token,
        password,
        confirm_password: confirmPassword
      });
      setIsResetSuccess(true);
    } catch (err) {
      setError(err.message || 'Failed to reset password. Link may be expired or already used.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isResetSuccess) {
    return (
      <div className={embedded ? "w-full p-0 text-center animate-mac-squish" : `w-full max-w-[440px] ${isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)]' : 'bg-white border-slate-200 shadow-xl'} border rounded-2xl p-6 sm:p-7 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_25px_rgba(var(--kt-accent-rgb),0.06)] relative z-10 text-center animate-mac-squish`}>
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 border ${
          isDark
            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.3)]'
            : 'bg-emerald-50 border-emerald-200 text-emerald-600 shadow-sm'
        }`}>
          <CheckCircle2 size={34} />
        </div>
        <h2 className={`text-xl font-extrabold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>Password Updated!</h2>
        <p className={`text-xs mt-1 mb-5 leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          Your VerboLabs account password has been changed successfully. You can now sign in with your new password.
        </p>

        <button
          type="button"
          onClick={onPasswordResetSuccess}
          className={`w-full py-2.5 px-4 rounded-xl text-xs font-semibold tracking-normal transition-all cursor-pointer flex items-center justify-center gap-2 ${
            isDark
              ? 'bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.3)]'
              : 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-md'
          }`}
        >
          <span>Sign In with New Password</span>
          <ArrowRight size={15} />
        </button>
      </div>
    );
  }

  const inputClasses = isDark
    ? "w-full pl-8 pr-8 py-1.5 bg-[var(--kt-s0)] border border-[var(--kt-s4)] focus:border-[var(--kt-accent)] focus:ring-1 focus:ring-[var(--kt-accent)] rounded-lg text-xs text-white placeholder-slate-600 outline-none transition-all"
    : "w-full pl-8 pr-8 py-1.5 bg-slate-50 border border-slate-300 focus:border-blue-600 focus:ring-1 focus:ring-blue-500 rounded-lg text-xs text-slate-900 placeholder-slate-400 outline-none transition-all";

  return (
    <div className={embedded ? "w-full p-0 flex flex-col justify-between relative" : `w-full max-w-[460px] ${isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)] hover:border-[var(--kt-accent)]/30' : 'bg-white border-slate-200 shadow-xl'} border rounded-2xl p-6 sm:p-7 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_25px_rgba(var(--kt-accent-rgb),0.06)] relative z-10 transition-all duration-300`}>
      <div className="text-center mb-4">
        <div className={`inline-flex items-center justify-center w-11 h-11 rounded-xl mb-2 border ${
          isDark
            ? 'bg-gradient-to-tr from-[var(--kt-accent)]/20 to-transparent border-[var(--kt-accent)]/30 text-[var(--kt-accent)] shadow-[0_0_15px_rgba(var(--kt-accent-rgb),0.2)]'
            : 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm'
        }`}>
          <KeyRound size={22} />
        </div>
        <h1 className={`text-xl font-extrabold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
          Choose <span className={isDark ? "text-[var(--kt-accent)]" : "text-blue-600"}>New Password</span>
        </h1>
        <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          Enter a strong new password meeting enterprise security standards
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

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className={`block text-[11px] font-semibold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-700'}`}>
            New Password <span className={isDark ? "text-[var(--kt-accent)]" : "text-blue-600"}>*</span>
          </label>
          <div className="relative flex items-center">
            <Lock size={15} className={`absolute left-3 pointer-events-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter new password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              className={inputClasses}
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className={`absolute right-2 p-0.5 cursor-pointer bg-transparent border-0 ${isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700'}`}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <PasswordCriteriaList password={password} />
        </div>

        <div>
          <label className={`block text-[11px] font-semibold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-700'}`}>
            Confirm Password <span className={isDark ? "text-[var(--kt-accent)]" : "text-blue-600"}>*</span>
          </label>
          <div className="relative flex items-center">
            <Lock size={15} className={`absolute left-3 pointer-events-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              className={`${inputClasses} ${
                confirmPassword && confirmPassword !== password ? '!border-rose-500' : ''
              }`}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className={`absolute right-2 p-0.5 cursor-pointer bg-transparent border-0 ${isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700'}`}
            >
              {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          {confirmPassword && confirmPassword !== password && (
            <span className="block mt-1 text-[10.5px] text-rose-500">
              Passwords do not match
            </span>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full mt-2 py-2.5 px-4 rounded-xl text-xs font-semibold tracking-normal transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            isDark
              ? 'bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.3)]'
              : 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-md'
          }`}
        >
          {isSubmitting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span>Updating Password...</span>
            </>
          ) : (
            <>
              <span>Save & Sign In</span>
              <ArrowRight size={15} />
            </>
          )}
        </button>
      </form>
    </div>
  );
}
