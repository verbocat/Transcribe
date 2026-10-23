import React, { useState } from 'react';
import { Mail, Lock, User as UserIcon, Eye, EyeOff, AlertCircle, CheckCircle2, ArrowRight, Loader2, Send } from 'lucide-react';
import { signupUser, checkPasswordCriteria } from './authService';
import PasswordCriteriaList from './PasswordCriteriaList';
import '../components/noun.css';

export default function SignupPage({ onSwitchToLogin, embedded = false }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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
    return /^[^\s@]+@verbolabs\.com$/.test(clean);
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

    if (!cleanEmail.endsWith('@verbolabs.com')) {
      setError('Sign-up is restricted to @verbolabs.com email addresses.');
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
        confirm_password: confirmPassword
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

  const emailInvalid = email && !validateEmailFormat(email);
  const mismatch = confirmPassword && confirmPassword !== password;
  const eyeBtn = 'absolute right-2 h-8 w-8 grid place-items-center rounded-lg text-[var(--kt-faint)] hover:text-white hover:bg-[var(--kt-s3)] cursor-pointer border-0 bg-transparent';

  return (
    <div className={embedded ? 'w-full relative nx-rise' : 'w-full max-w-[460px] border rounded-2xl p-6 relative nx-rise bg-[var(--kt-s1)] border-[var(--kt-s4)] text-[var(--kt-text)]'}>
      <div className="mb-6">
        <h1 className="nx-display text-[32px] leading-[1.1] font-semibold text-white">Create your account</h1>
        <p className="mt-2 text-[15px] text-[var(--kt-muted)] leading-relaxed">Any valid email works. You will confirm it before signing in.</p>
      </div>

      {error && (
        <div role="alert" className="nx-notice err mb-4">
          <AlertCircle size={17} className="shrink-0 mt-0.5" />
          <div className="flex-1">
            <div>{error}</div>
            {error.toLowerCase().includes('already exists') && (
              <button type="button" onClick={onSwitchToLogin} className="nx-link mt-1.5">Sign in to your existing account</button>
            )}
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <label className="nx-field">
          <span className="nx-label">Full name</span>
          <span className="nx-input-wrap">
            <UserIcon size={16} className="lead" />
            <input type="text" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" className="nx-input" />
          </span>
        </label>

        <label className="nx-field">
          <span className="nx-label">Email</span>
          <span className="nx-input-wrap">
            <Mail size={16} className="lead" />
            <input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email"
              aria-invalid={emailInvalid ? 'true' : undefined} className={`nx-input ${emailInvalid ? 'bad' : ''}`} />
          </span>
          {emailInvalid && <span className="block mt-1.5 text-xs text-[var(--kt-danger)]">Enter a valid email address, like name@company.com.</span>}
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="nx-field">
            <label htmlFor="signup-password" className="nx-label">Password</label>
            <span className="nx-input-wrap">
              <Lock size={16} className="lead" />
              <input id="signup-password" type={showPassword ? 'text' : 'password'} placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" className="nx-input pr-11" />
              <button type="button" onClick={() => setShowPassword(!showPassword)} className={eyeBtn} aria-label={showPassword ? 'Hide password' : 'Show password'}>
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </div>
          <div className="nx-field">
            <label htmlFor="signup-confirm" className="nx-label">Confirm password</label>
            <span className="nx-input-wrap">
              <Lock size={16} className="lead" />
              <input id="signup-confirm" type={showConfirmPassword ? 'text' : 'password'} placeholder="Repeat it" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required autoComplete="new-password"
                aria-invalid={mismatch ? 'true' : undefined} className={`nx-input pr-11 ${mismatch ? 'bad' : ''}`} />
              <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className={eyeBtn} aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}>
                {showConfirmPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </div>
        </div>

        {mismatch && <span className="block text-xs text-[var(--kt-danger)]">Passwords do not match.</span>}

        <PasswordCriteriaList password={password} />

        <button type="submit" disabled={isSubmitting} className="nx-btn mt-2">
          {isSubmitting ? (
            <>
              <Loader2 size={17} className="animate-spin" />
              <span>Creating account...</span>
            </>
          ) : (
            <>
              <span>Create account</span>
              <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>

      <p className="mt-7 text-sm text-center text-[var(--kt-muted)]">
        Already have an account?{' '}
        <button type="button" onClick={onSwitchToLogin} className="nx-link">Sign in</button>
      </p>
    </div>
  );
}
