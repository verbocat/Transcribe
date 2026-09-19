import React, { useState, useEffect } from 'react';
import { Lock, Eye, EyeOff, KeyRound, AlertCircle, CheckCircle2, ArrowRight, Loader2 } from 'lucide-react';
import { resetPassword, checkPasswordCriteria } from './authService';
import PasswordCriteriaList from './PasswordCriteriaList';

export default function ResetPasswordPage({ token: propToken, onPasswordResetSuccess }) {
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
      <div className="w-full max-w-[440px] bg-[#14151a] border border-[#262734] rounded-2xl p-6 sm:p-7 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_25px_rgba(0,229,190,0.06)] relative z-10 text-center animate-mac-squish">
        <div className="w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto mb-4 shadow-[0_0_20px_rgba(16,185,129,0.3)]">
          <CheckCircle2 size={34} />
        </div>
        <h2 className="text-xl font-extrabold text-white tracking-tight">Password Updated!</h2>
        <p className="text-xs text-slate-400 mt-1 mb-5 leading-relaxed">
          Your VerboLabs account password has been changed successfully. You can now sign in with your new password.
        </p>

        <button
          type="button"
          onClick={onPasswordResetSuccess}
          className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-[#00e5be] hover:bg-[#00d4af] text-black transition-all shadow-[0_0_20px_rgba(0,229,190,0.3)] cursor-pointer flex items-center justify-center gap-2"
        >
          <span>Sign In with New Password</span>
          <ArrowRight size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[460px] bg-[#14151a] border border-[#262734] hover:border-[#00e5be]/30 rounded-2xl p-6 sm:p-7 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_25px_rgba(0,229,190,0.06)] relative z-10 transition-all duration-300">
      <div className="text-center mb-4">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-tr from-[#00e5be]/20 to-transparent border border-[#00e5be]/30 text-[#00e5be] mb-2 shadow-[0_0_15px_rgba(0,229,190,0.2)]">
          <KeyRound size={22} />
        </div>
        <h1 className="text-xl font-extrabold text-white tracking-tight">
          Choose <span className="text-[#00e5be]">New Password</span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Enter a strong new password meeting enterprise security standards
        </p>
      </div>

      {error && (
        <div className="mb-3.5 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2">
          <AlertCircle size={15} className="text-rose-400 shrink-0 mt-0.5" />
          <div>{error}</div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1">
            New Password <span className="text-[#00e5be]">*</span>
          </label>
          <div className="relative flex items-center">
            <Lock size={15} className="absolute left-3 text-slate-500 pointer-events-none" />
            <input
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter new password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="new-password"
              className="w-full pl-8 pr-8 py-1.5 bg-[#0e0f12] border border-[#262734] focus:border-[#00e5be] focus:ring-1 focus:ring-[#00e5be] rounded-lg text-xs text-white placeholder-slate-600 outline-none transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-2 text-slate-500 hover:text-slate-300 p-0.5 cursor-pointer bg-transparent border-0"
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <PasswordCriteriaList password={password} />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1">
            Confirm Password <span className="text-[#00e5be]">*</span>
          </label>
          <div className="relative flex items-center">
            <Lock size={15} className="absolute left-3 text-slate-500 pointer-events-none" />
            <input
              type={showConfirmPassword ? 'text' : 'password'}
              placeholder="Confirm new password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              autoComplete="new-password"
              className={`w-full pl-8 pr-8 py-1.5 bg-[#0e0f12] border ${
                confirmPassword && confirmPassword !== password ? 'border-rose-500' : 'border-[#262734] focus:border-[#00e5be]'
              } focus:ring-1 focus:ring-[#00e5be] rounded-lg text-xs text-white placeholder-slate-600 outline-none transition-all`}
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="absolute right-2 text-slate-500 hover:text-slate-300 p-0.5 cursor-pointer bg-transparent border-0"
            >
              {showConfirmPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          {confirmPassword && confirmPassword !== password && (
            <span className="block mt-1 text-[10.5px] text-rose-400">
              Passwords do not match
            </span>
          )}
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full mt-2 py-2.5 px-4 rounded-xl text-xs font-bold bg-[#00e5be] hover:bg-[#00d4af] text-black transition-all shadow-[0_0_20px_rgba(0,229,190,0.3)] cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
