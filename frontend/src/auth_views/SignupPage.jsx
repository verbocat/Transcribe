import React, { useState } from 'react';
import { Mail, Lock, User as UserIcon, BadgeCheck, Eye, EyeOff, AlertCircle, CheckCircle2, ArrowRight, Loader2, Send } from 'lucide-react';
import { signupUser, checkPasswordCriteria } from './authService';
import PasswordCriteriaList from './PasswordCriteriaList';
import { useTheme } from '../context/ThemeContext';

export default function SignupPage({ onSwitchToLogin, embedded = false }) {
  const { isDark } = useTheme();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [signedUpEmail, setSignedUpEmail] = useState(null);
  const [deliveryError, setDeliveryError] = useState('');
  const [directVerificationUrl, setDirectVerificationUrl] = useState('');



  const validateEmailFormat = (val) => {
    const clean = val.trim().toLowerCase();
    if (!clean) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setDeliveryError('');
    setDirectVerificationUrl('');

    const cleanEmail = email.trim().toLowerCase();

    // 1. Basic checks
    if (!name.trim()) {
      setError('Please enter your full name.');
      return;
    }

    if (!cleanEmail) {
      setError('Please enter your email.');
      return;
    }

    // 2. Email format check
    if (!validateEmailFormat(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    // 3. Password match
    if (password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter identical passwords.');
      return;
    }

    // 4. Password policy check
    const criteria = checkPasswordCriteria(password);
    const isValidPwd = Object.values(criteria).every(Boolean);
    if (!isValidPwd) {
      setError('Password does not satisfy all security requirements.');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const data = await signupUser({
        name: name.trim(),
        email: cleanEmail,
        password,
        confirm_password: confirmPassword,
        employee_id: employeeId.trim() || undefined
      });

      if (data.success === false && data.account_created) {
        setDeliveryError(data.error || 'Email service error');
        setDirectVerificationUrl(data.verification_url || '');
      }

      setSignedUpEmail(cleanEmail);
    } catch (err) {
      const errMsg = err.message || 'Failed to create account.';
      setError(errMsg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // If signup succeeded, show verification instruction card
  if (signedUpEmail) {
    return (
      <div className="w-full max-w-[440px] bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-2xl p-6 sm:p-7 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_25px_rgba(var(--kt-accent-rgb),0.06)] relative z-10 text-center animate-mac-squish">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[var(--kt-accent)]/20 to-transparent border border-[var(--kt-accent)]/40 text-[var(--kt-accent)] flex items-center justify-center mx-auto mb-4 shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.3)]">
          <Send size={28} />
        </div>
        <h2 className="text-xl font-extrabold text-white tracking-tight">Verify Your Email</h2>
        <p className="text-xs text-slate-400 mt-1 mb-4">
          Account created for:<br />
          <strong className="text-sm text-[var(--kt-accent)] font-mono">{signedUpEmail}</strong>
        </p>

        {deliveryError ? (
          <div className="p-3 mb-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs text-left">
            <div className="flex items-start gap-2">
              <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
              <div>
                <strong className="block text-rose-200">Email Delivery Notice:</strong>
                <span className="text-[11px]">{deliveryError}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="p-3 mb-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs text-left flex items-start gap-2.5">
            <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
            <div className="leading-relaxed text-[11.5px]">
              Please check your inbox at <strong className="text-white">{signedUpEmail}</strong> and click the activation link to complete verification.
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={onSwitchToLogin}
          className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black transition-all shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.3)] cursor-pointer flex items-center justify-center gap-2"
        >
          <span>Proceed to Sign In</span>
          <ArrowRight size={15} />
        </button>
      </div>
    );
  }

  const inputClasses = isDark
    ? "w-full pl-8 pr-2.5 py-1.5 bg-[var(--kt-s0)] border border-[var(--kt-s4)] focus:border-[var(--kt-accent)] focus:ring-1 focus:ring-[var(--kt-accent)] rounded-lg text-xs text-white placeholder-slate-600 outline-none transition-all"
    : "w-full pl-8 pr-2.5 py-1.5 bg-slate-50 border border-slate-300 focus:border-blue-600 focus:ring-1 focus:ring-blue-500 rounded-lg text-xs text-slate-900 placeholder-slate-400 outline-none transition-all";

  const labelClasses = `block text-[11px] font-semibold mb-1 ${isDark ? 'text-slate-400' : 'text-slate-700'}`;

  return (
    <div className={embedded ? "w-full p-0 flex flex-col justify-between relative" : `w-full max-w-[460px] ${isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)] hover:border-[var(--kt-accent)]/30' : 'bg-white border-slate-200 shadow-xl'} border rounded-2xl p-5 sm:p-6 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_25px_rgba(var(--kt-accent-rgb),0.06)] relative z-10 transition-all duration-300`}>
      {/* Brand Header */}
      <div className="text-center mb-3">
        <div className={`inline-flex items-center justify-center w-10 h-10 rounded-xl mb-1.5 border transition-all ${
          isDark
            ? 'bg-gradient-to-tr from-[var(--kt-accent)]/20 via-[var(--kt-info)]/20 to-transparent border-[var(--kt-accent)]/30 text-[var(--kt-accent)] shadow-[0_0_15px_rgba(var(--kt-accent-rgb),0.25)]'
            : 'bg-blue-50 border-blue-200 text-blue-600 shadow-sm'
        }`}>
          <BadgeCheck size={20} />
        </div>
        <h1 className={`text-lg font-extrabold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
          Join <span className={isDark ? "text-[var(--kt-accent)] drop-shadow-[0_0_10px_rgba(var(--kt-accent-rgb),0.35)]" : "text-blue-600"}>Studio</span>
        </h1>
        <p className={`text-[11.5px] mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          Create your workstation account with <strong className={isDark ? "text-[var(--kt-accent)] font-semibold" : "text-blue-700 font-semibold"}>any valid email</strong>
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className={`mb-3 p-2.5 rounded-xl border text-xs flex items-start gap-2.5 animate-mac-squish ${
          isDark ? 'bg-rose-500/15 border-rose-500/40 text-rose-300' : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          <AlertCircle size={16} className={`shrink-0 mt-0.5 ${isDark ? 'text-rose-400' : 'text-rose-600'}`} />
          <div className="leading-relaxed flex-1">
            <span className={`font-semibold block ${isDark ? 'text-white' : 'text-rose-950'}`}>{error}</span>
            {error.toLowerCase().includes('already exists') && (
              <button
                type="button"
                onClick={onSwitchToLogin}
                className={`mt-1 inline-flex items-center gap-1 text-[11px] font-bold hover:underline cursor-pointer bg-transparent border-0 p-0 ${
                  isDark ? 'text-[var(--kt-accent)]' : 'text-blue-700'
                }`}
              >
                Sign in to your existing account &rarr;
              </button>
            )}
          </div>
        </div>
      )}

      {/* Signup Form */}
      <form onSubmit={handleSubmit} className="space-y-2.5">
        {/* Name & Employee ID */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className={labelClasses}>
              Full Name <span className={isDark ? "text-[var(--kt-accent)]" : "text-blue-600"}>*</span>
            </label>
            <div className="relative flex items-center">
              <UserIcon size={14} className={`absolute left-3 pointer-events-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
              <input
                type="text"
                placeholder="e.g. John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
                className={inputClasses}
              />
            </div>
          </div>

          <div>
            <label className={labelClasses}>
              Employee ID
            </label>
            <div className="relative flex items-center">
              <BadgeCheck size={14} className={`absolute left-3 pointer-events-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
              <input
                type="text"
                placeholder="e.g. VL-1042"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className={inputClasses}
              />
            </div>
          </div>
        </div>

        {/* Work Email */}
        <div>
          <label className={labelClasses}>
            Email Address <span className={isDark ? "text-[var(--kt-accent)]" : "text-blue-600"}>*</span>
          </label>
          <div className="relative flex items-center">
            <Mail size={14} className={`absolute left-3 pointer-events-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
            <input
              type="email"
              placeholder="name@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className={`${inputClasses} ${
                email && !validateEmailFormat(email) ? '!border-rose-500' : ''
              }`}
            />
          </div>
          {email && !validateEmailFormat(email) && (
            <span className="block mt-1 text-[10.5px] text-rose-500">
              Please enter a valid email address
            </span>
          )}
        </div>

        {/* Passwords */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className={labelClasses}>
              Password <span className={isDark ? "text-[var(--kt-accent)]" : "text-blue-600"}>*</span>
            </label>
            <div className="relative flex items-center">
              <Lock size={14} className={`absolute left-3 pointer-events-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="new-password"
                className={`w-full pl-8 pr-7 py-1.5 ${
                  isDark
                    ? 'bg-[var(--kt-s0)] border border-[var(--kt-s4)] focus:border-[var(--kt-accent)] focus:ring-1 focus:ring-[var(--kt-accent)] text-white placeholder-slate-600'
                    : 'bg-slate-50 border border-slate-300 focus:border-blue-600 focus:ring-1 focus:ring-blue-500 text-slate-900 placeholder-slate-400'
                } rounded-lg text-xs outline-none transition-all`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={`absolute right-2 p-0.5 cursor-pointer bg-transparent border-0 ${isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700'}`}
              >
                {showPassword ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>

          <div>
            <label className={labelClasses}>
              Confirm <span className={isDark ? "text-[var(--kt-accent)]" : "text-blue-600"}>*</span>
            </label>
            <div className="relative flex items-center">
              <Lock size={14} className={`absolute left-3 pointer-events-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Confirm"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                autoComplete="new-password"
                className={`w-full pl-8 pr-7 py-1.5 ${
                  isDark
                    ? 'bg-[var(--kt-s0)] border border-[var(--kt-s4)] focus:border-[var(--kt-accent)] focus:ring-1 focus:ring-[var(--kt-accent)] text-white placeholder-slate-600'
                    : 'bg-slate-50 border border-slate-300 focus:border-blue-600 focus:ring-1 focus:ring-blue-500 text-slate-900 placeholder-slate-400'
                } ${
                  confirmPassword && confirmPassword !== password ? '!border-rose-500' : ''
                } rounded-lg text-xs outline-none transition-all`}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className={`absolute right-2 p-0.5 cursor-pointer bg-transparent border-0 ${isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-700'}`}
              >
                {showConfirmPassword ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </div>
        </div>

        {confirmPassword && confirmPassword !== password && (
          <span className="block text-[10.5px] text-rose-500">
            Passwords do not match
          </span>
        )}

        <PasswordCriteriaList password={password} />

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className={`w-full mt-1.5 py-2.5 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
            isDark
              ? 'bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.3)] hover:shadow-[0_0_25px_rgba(var(--kt-accent-rgb),0.45)]'
              : 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-md hover:shadow-blue-500/20'
          }`}
        >
          {isSubmitting ? (
            <>
              <Loader2 size={15} className="animate-spin" />
              <span>Creating Account...</span>
            </>
          ) : (
            <>
              <span>Create Account</span>
              <ArrowRight size={14} />
            </>
          )}
        </button>

        {/* Social SSO Options */}
        <div className={`pt-2 border-t text-center ${isDark ? 'border-[var(--kt-s4)]/80' : 'border-slate-200'}`}>
          <div className={`text-[11px] font-medium mb-1.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Or continue with</div>
          <div className="flex items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={() => setError('Direct Google registration is available for corporate accounts. Enter your email above to register.')}
              className={`flex items-center justify-center w-11 h-8 rounded-xl border transition-all cursor-pointer shadow-xs ${
                isDark
                  ? 'border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] hover:border-slate-500'
                  : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300'
              }`}
              title="Register with Google"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
              </svg>
            </button>

            <button
              type="button"
              onClick={() => setError('Apple ID registration is available for macOS workstations. Enter your email above to register.')}
              className={`flex items-center justify-center w-11 h-8 rounded-xl border transition-all cursor-pointer shadow-xs ${
                isDark
                  ? 'border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] hover:border-slate-500 text-white'
                  : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-slate-800'
              }`}
              title="Register with Apple"
            >
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 170 170">
                <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.04-7.66-7.85-11.87-14.42-6.53-10.22-11.66-21.68-15.38-34.38-3.72-12.7-5.58-24.81-5.58-36.33 0-14.7 3.59-27.15 10.77-37.34 7.18-10.19 16.48-15.38 27.9-15.58 4.89 0 10.37 1.25 16.44 3.75 6.07 2.5 10.25 3.8 12.54 3.9 1.85 0 6.13-1.4 12.84-4.2 6.71-2.8 12.44-4.05 17.19-3.75 12.84.76 23.36 5.61 31.56 14.55-11.2 6.74-16.63 16.2-16.3 28.37.33 9.46 3.91 17.45 10.74 23.97 6.83 6.52 14.95 10.25 24.36 11.19-2.07 6.3-4.73 12.87-7.98 19.7zM119.22 33.55c0-7.39 2.61-14.24 7.83-20.55 5.22-6.31 11.74-10.33 19.56-12.06.33 1.09.49 2.18.49 3.27 0 7.28-2.67 14.24-8.01 20.88-5.34 6.64-12.01 10.55-20.01 11.73-.11-.98-.16-1.98-.16-3.27z"/>
              </svg>
            </button>
          </div>
        </div>
      </form>

      {/* Footer link */}
      <div className={`mt-3 pt-2.5 border-t text-center text-xs ${isDark ? 'border-[var(--kt-s3)] text-slate-400' : 'border-slate-200 text-slate-600'}`}>
        <span>Already have an account?</span>{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className={`font-bold hover:underline cursor-pointer bg-transparent border-0 p-0 ${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-700'}`}
        >
          Sign In
        </button>
      </div>
    </div>
  );
}
