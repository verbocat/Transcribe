import React, { useState } from 'react';
import { Mail, Lock, User as UserIcon, BadgeCheck, Eye, EyeOff, AlertCircle, CheckCircle2, ArrowRight, Loader2, Send } from 'lucide-react';
import { signupUser, checkPasswordCriteria } from './authService';
import PasswordCriteriaList from './PasswordCriteriaList';

export default function SignupPage({ onSwitchToLogin }) {
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



  const validateEmailDomain = (val) => {
    const clean = val.trim().toLowerCase();
    if (!clean) return false;
    return clean.endsWith('.verbolabs.com') || clean.endsWith('@verbolabs.com');
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
      setError('Please enter your work email.');
      return;
    }

    // 2. Domain check
    if (!validateEmailDomain(cleanEmail)) {
      setError('Access restricted: Only official @verbolabs.com email addresses are permitted to sign up.');
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
      <div className="w-full max-w-[440px] bg-[#14151a] border border-[#262734] rounded-2xl p-6 sm:p-7 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_25px_rgba(0,229,190,0.06)] relative z-10 text-center animate-mac-squish">
        <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-[#00e5be]/20 to-transparent border border-[#00e5be]/40 text-[#00e5be] flex items-center justify-center mx-auto mb-4 shadow-[0_0_20px_rgba(0,229,190,0.3)]">
          <Send size={28} />
        </div>
        <h2 className="text-xl font-extrabold text-white tracking-tight">Verify Your Email</h2>
        <p className="text-xs text-slate-400 mt-1 mb-4">
          Account created for:<br />
          <strong className="text-sm text-[#00e5be] font-mono">{signedUpEmail}</strong>
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
          className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-[#00e5be] hover:bg-[#00d4af] text-black transition-all shadow-[0_0_20px_rgba(0,229,190,0.3)] cursor-pointer flex items-center justify-center gap-2"
        >
          <span>Proceed to Sign In</span>
          <ArrowRight size={15} />
        </button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[460px] bg-[#14151a] border border-[#262734] hover:border-[#00e5be]/30 rounded-2xl p-6 sm:p-7 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.9),0_0_25px_rgba(0,229,190,0.06)] relative z-10 transition-all duration-300">
      {/* Brand Header */}
      <div className="text-center mb-4">
        <div className="inline-flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-tr from-[#00e5be]/20 via-[#00c9ff]/20 to-transparent border border-[#00e5be]/30 text-[#00e5be] mb-2 shadow-[0_0_15px_rgba(0,229,190,0.25)]">
          <BadgeCheck size={22} />
        </div>
        <h1 className="text-xl font-extrabold text-white tracking-tight">
          Join <span className="text-[#00e5be] drop-shadow-[0_0_10px_rgba(0,229,190,0.35)]">Studio</span>
        </h1>
        <p className="text-xs text-slate-400 mt-0.5">
          Create your workstation account with <strong className="text-[#00e5be] font-semibold">@verbolabs.com</strong>
        </p>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mb-3.5 p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs flex items-start gap-2.5 animate-mac-squish">
          <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
          <div className="leading-relaxed flex-1">
            <span className="font-semibold block text-white">{error}</span>
            {error.toLowerCase().includes('already exists') && (
              <button
                type="button"
                onClick={onSwitchToLogin}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-[#00e5be] hover:underline cursor-pointer bg-transparent border-0 p-0"
              >
                Sign in to your existing account &rarr;
              </button>
            )}
          </div>
        </div>
      )}

      {/* Signup Form */}
      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Name & Employee ID */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              Full Name <span className="text-[#00e5be]">*</span>
            </label>
            <div className="relative flex items-center">
              <UserIcon size={15} className="absolute left-3 text-slate-500 pointer-events-none" />
              <input
                type="text"
                placeholder="e.g. John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
                className="w-full pl-8 pr-2.5 py-1.5 bg-[#0e0f12] border border-[#262734] focus:border-[#00e5be] focus:ring-1 focus:ring-[#00e5be] rounded-lg text-xs text-white placeholder-slate-600 outline-none transition-all"
              />
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              Employee ID
            </label>
            <div className="relative flex items-center">
              <BadgeCheck size={15} className="absolute left-3 text-slate-500 pointer-events-none" />
              <input
                type="text"
                placeholder="e.g. VL-1042"
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className="w-full pl-8 pr-2.5 py-1.5 bg-[#0e0f12] border border-[#262734] focus:border-[#00e5be] focus:ring-1 focus:ring-[#00e5be] rounded-lg text-xs text-white placeholder-slate-600 outline-none transition-all"
              />
            </div>
          </div>
        </div>

        {/* Work Email */}
        <div>
          <label className="block text-[11px] font-semibold text-slate-400 mb-1">
            Work Email <span className="text-[#00e5be]">*</span>
          </label>
          <div className="relative flex items-center">
            <Mail size={15} className="absolute left-3 text-slate-500 pointer-events-none" />
            <input
              type="email"
              placeholder="yourname@verbolabs.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className={`w-full pl-8 pr-2.5 py-1.5 bg-[#0e0f12] border ${
                email && !validateEmailDomain(email) ? 'border-rose-500' : 'border-[#262734] focus:border-[#00e5be]'
              } focus:ring-1 focus:ring-[#00e5be] rounded-lg text-xs text-white placeholder-slate-600 outline-none transition-all`}
            />
          </div>
          {email && !validateEmailDomain(email) && (
            <span className="block mt-1 text-[10.5px] text-rose-400">
              Must end with @verbolabs.com
            </span>
          )}
        </div>

        {/* Passwords */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              Password <span className="text-[#00e5be]">*</span>
            </label>
            <div className="relative flex items-center">
              <Lock size={15} className="absolute left-3 text-slate-500 pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
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
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1">
              Confirm <span className="text-[#00e5be]">*</span>
            </label>
            <div className="relative flex items-center">
              <Lock size={15} className="absolute left-3 text-slate-500 pointer-events-none" />
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                placeholder="Confirm"
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
          </div>
        </div>

        {confirmPassword && confirmPassword !== password && (
          <span className="block text-[10.5px] text-rose-400">
            Passwords do not match
          </span>
        )}

        <PasswordCriteriaList password={password} />

        {/* Submit Button */}
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full mt-2 py-2.5 px-4 rounded-xl text-xs font-bold bg-[#00e5be] hover:bg-[#00d4af] text-black transition-all shadow-[0_0_20px_rgba(0,229,190,0.3)] hover:shadow-[0_0_25px_rgba(0,229,190,0.45)] cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              <span>Creating Account...</span>
            </>
          ) : (
            <>
              <span>Create Account</span>
              <ArrowRight size={15} />
            </>
          )}
        </button>
      </form>

      {/* Footer link */}
      <div className="mt-4 pt-3 border-t border-[#22232c] text-center text-xs text-slate-400">
        <span>Already have an account?</span>{' '}
        <button
          type="button"
          onClick={onSwitchToLogin}
          className="font-bold text-[#00e5be] hover:underline cursor-pointer bg-transparent border-0 p-0"
        >
          Sign In
        </button>
      </div>
    </div>
  );
}
