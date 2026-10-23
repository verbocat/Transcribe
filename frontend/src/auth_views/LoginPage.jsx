import React, { useState, useEffect } from 'react';
import { Mail, Lock, Eye, EyeOff, AlertCircle, CheckCircle2, ArrowRight, ArrowLeft, Loader2, ShieldCheck, RotateCw, Clock, ShieldAlert } from 'lucide-react';
import { useAuth } from './AuthContext';
import { loginUser, resendVerification, verifyLoginOtp, resendLoginOtp, requestLoginOtp, getBotChallenge } from './authService';
import AuthProcessModal from './AuthProcessModal';
import '../components/noun.css';

import { Server } from 'lucide-react';

export default function LoginPage({ onSwitchToSignup, onSwitchToForgotPassword, onOpenBackendSettings, initialSuccessMsg = '', embedded = false }) {
  const { login, sessionNotice, clearSessionNotice } = useAuth();

  // Step 1 Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Sign-in method: 'password' signs in directly; 'otp' emails a one-time code instead
  const [method, setMethod] = useState('password');
  const [showPassword, setShowPassword] = useState(false);

  // Step state: 'credentials' | 'mfa' (code emailed, waiting for it)
  const [step, setStep] = useState('credentials');
  const [challengeId, setChallengeId] = useState('');
  const [maskedEmail, setMaskedEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [mfaExpiresIn, setMfaExpiresIn] = useState(300);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Brute-force lockout state
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  // Bot Defense Challenge state
  const [botChallenge, setBotChallenge] = useState(null);
  const [botAnswer, setBotAnswer] = useState('');
  const [isLoadingChallenge, setIsLoadingChallenge] = useState(false);

  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState(initialSuccessMsg);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState('');
  const [isResending, setIsResending] = useState(false);

  // Synchronous Process Modal state
  const [processModalOpen, setProcessModalOpen] = useState(false);
  const [processStage, setProcessStage] = useState('connecting');
  const [processError, setProcessError] = useState('');

  // Lockout Countdown tick (15-minute brute-force lockout)
  useEffect(() => {
    if (lockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [lockoutSeconds]);

  // MFA Countdown & Cooldown tick
  useEffect(() => {
    if (step !== 'mfa') return;
    const timer = setInterval(() => {
      setMfaExpiresIn((prev) => (prev > 0 ? prev - 1 : 0));
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [step]);

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const validateEmailFormat = (val) => {
    const clean = val.trim().toLowerCase();
    if (!clean) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean);
  };

  const loadBotChallenge = async () => {
    setIsLoadingChallenge(true);
    try {
      const chal = await getBotChallenge();
      setBotChallenge(chal);
      setBotAnswer('');
    } catch (err) {
      console.error('Failed to fetch bot challenge:', err);
    } finally {
      setIsLoadingChallenge(false);
    }
  };

  // Step 1: Submit email + password (password method) or email only (OTP method)
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (clearSessionNotice) clearSessionNotice();
    setError('');
    setInfoMessage('');
    setUnverifiedEmail('');

    if (lockoutSeconds > 0) {
      setError(`Account / IP is locked due to repeated attempts. Please wait ${formatTimer(lockoutSeconds)}.`);
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    if (!cleanEmail) {
      setError('Please enter your email address.');
      return;
    }

    if (!validateEmailFormat(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    if (method === 'password' && !password) {
      setError('Please enter your password.');
      return;
    }

    if (botChallenge && !botAnswer.trim()) {
      setError('Please solve the security verification question.');
      return;
    }

    let challengeToken = null;
    if (botChallenge && botAnswer.trim()) {
      challengeToken = `${botChallenge.challenge_id}:${botAnswer.trim()}:${botChallenge.timestamp}:${botChallenge.signature}`;
    }

    setIsSubmitting(true);
    setProcessError('');
    setError('');

    try {
      if (method === 'otp') {
        // OTP sign-in: email the code, then ask for it on the next step
        const data = await requestLoginOtp({ email: cleanEmail, bot_challenge_token: challengeToken });
        setChallengeId(data.challenge_id);
        setMaskedEmail(data.email_masked || cleanEmail);
        setMfaExpiresIn(data.expires_in_seconds || 300);
        setResendCooldown(data.resend_cooldown_seconds || 60);
        setInfoMessage(data.message || `Verification code sent to ${data.email_masked || cleanEmail}`);
        setStep('mfa');
        setOtp('');
        setBotChallenge(null);
        setBotAnswer('');
        return;
      }

      // Password sign-in: a correct password signs in directly, no code needed
      const data = await loginUser({
        email: cleanEmail,
        password,
        bot_challenge_token: challengeToken
      });

      setProcessStage('initializing');
      setProcessModalOpen(true);
      await new Promise(r => setTimeout(r, 450));

      setProcessStage('success');
      await new Promise(r => setTimeout(r, 650));

      if (typeof window !== 'undefined' && window.history.replaceState) {
        window.history.replaceState({ tool: null }, '', '/');
      }

      setProcessModalOpen(false);
      login(data.token, data.user);
    } catch (err) {
      setProcessModalOpen(false);
      const errMsg = err.message || (method === 'otp' ? 'Could not send the code. Please try again.' : 'Invalid email or password. Please verify your credentials.');
      setProcessStage('error');
      setProcessError(errMsg);
      setError(errMsg);

      // Check if locked out (429), but not the plain "wait before requesting another code" cooldown
      if (err.status === 429 && errMsg.toLowerCase().includes('locked')) {
        setLockoutSeconds(900); // 15 minutes
      }

      // Check if bot challenge required (403 or message trigger)
      if ((err.status === 403 && !errMsg.toLowerCase().includes('not been verified') && !errMsg.toLowerCase().includes('suspended')) || errMsg.toLowerCase().includes('verification required') || errMsg.toLowerCase().includes('puzzle') || errMsg.toLowerCase().includes('security verification') || challengeToken) {
        // a solved question is single-use on the server, so any failed attempt needs a fresh one
        setBotAnswer('');
        loadBotChallenge();
      }

      if (errMsg.toLowerCase().includes('verified') || errMsg.toLowerCase().includes('inbox')) {
        setUnverifiedEmail(cleanEmail);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOtp = async (e) => {
    if (e) e.preventDefault();
    const cleanOtp = otp.trim();
    if (!cleanOtp) {
      setError('Please enter the 6-digit code sent to your email.');
      return;
    }
    if (cleanOtp.length !== 6) {
      setError('Please enter the complete 6-digit code.');
      return;
    }
    if (mfaExpiresIn === 0) {
      setError('This verification code has expired. Please click Resend Code to receive a new one.');
      return;
    }

    setIsSubmitting(true);
    setError('');
    setProcessError('');
    setProcessStage('authenticating');
    setProcessModalOpen(true);

    try {
      const data = await verifyLoginOtp({
        challenge_id: challengeId,
        otp: cleanOtp
      });

      // Stage 3: Initializing workspace
      setProcessStage('initializing');
      await new Promise(r => setTimeout(r, 450));

      // Stage 4: Success complete
      setProcessStage('success');
      await new Promise(r => setTimeout(r, 650));

      if (typeof window !== 'undefined' && window.history.replaceState) {
        window.history.replaceState({ tool: null }, '', '/');
      }

      setProcessModalOpen(false);
      login(data.token, data.user);
    } catch (err) {
      setProcessModalOpen(false);
      const errMsg = err.message || 'Verification failed. Incorrect or expired code.';
      setProcessStage('error');
      setProcessError(errMsg);
      setError(errMsg);
      setOtp('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendLoginOtp = async () => {
    if (resendCooldown > 0 || isResending) return;
    setIsResending(true);
    setError('');
    setInfoMessage('');
    try {
      const data = await resendLoginOtp({ challenge_id: challengeId });
      setMfaExpiresIn(data.expires_in_seconds || 300);
      setResendCooldown(data.resend_cooldown_seconds || 60);
      setInfoMessage(data.message || 'A fresh 6-digit code has been sent to your email.');
      setOtp('');
    } catch (err) {
      setError(err.message || 'Failed to resend verification code.');
    } finally {
      setIsResending(false);
    }
  };

  const handleBackToCredentials = () => {
    setStep('credentials');
    setChallengeId('');
    setOtp('');
    setPassword('');
    setError('');
    setInfoMessage('');
  };

  const handleResendVerification = async () => {
    if (!unverifiedEmail) return;
    setIsResending(true);
    try {
      const res = await resendVerification(unverifiedEmail);
      setInfoMessage(res.message || 'A fresh verification link has been sent to your email.');
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to resend verification email.');
    } finally {
      setIsResending(false);
    }
  };

  const emailInvalid = email && !validateEmailFormat(email);
  const showResendHint = (error.toLowerCase().includes('timed out') || error.toLowerCase().includes('connect') || error.toLowerCase().includes('network') || error.toLowerCase().includes('server is running')) && onOpenBackendSettings;

  return (
    <div className={embedded ? 'w-full relative nx-rise' : 'w-full max-w-md border rounded-2xl p-6 sm:p-7 shadow-2xl relative nx-rise bg-[var(--kt-s1)] border-[var(--kt-s4)] text-[var(--kt-text)]'}>
      <div className="mb-6">
        <h1 className="nx-display text-[32px] leading-[1.1] font-semibold text-white">
          {step === 'mfa' ? 'Check your email' : 'Welcome back'}
        </h1>
        <p className="mt-2 text-[15px] text-[var(--kt-muted)] leading-relaxed">
          {step === 'mfa' ? 'Enter the 6-digit code we sent to finish signing in.' : 'Sign in to pick up your projects.'}
        </p>
      </div>

      <div className="space-y-3 empty:hidden mb-4" aria-live="polite">
        {lockoutSeconds > 0 && (
          <div role="alert" className="nx-notice err">
            <ShieldAlert size={18} className="shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold">Too many attempts</div>
              <div className="mt-0.5">Sign-in is paused for <strong className="font-mono">{formatTimer(lockoutSeconds)}</strong>. Try again then.</div>
            </div>
          </div>
        )}

        {sessionNotice && !error && step === 'credentials' && lockoutSeconds === 0 && (
          <div className="nx-notice warn">
            <AlertCircle size={17} className="shrink-0 mt-0.5" />
            <span>{sessionNotice}</span>
          </div>
        )}

        {error && !processModalOpen && (
          <div role="alert" className="nx-notice err">
            <AlertCircle size={17} className="shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div>{error}</div>
              {unverifiedEmail && (
                <button type="button" onClick={handleResendVerification} disabled={isResending} className="nx-link mt-2 block">
                  {isResending ? 'Sending...' : 'Resend verification email'}
                </button>
              )}
              {showResendHint && (
                <button type="button" onClick={onOpenBackendSettings} className="nx-link mt-2 flex items-center gap-1.5">
                  <Server size={13} />
                  <span>Check server connection</span>
                </button>
              )}
            </div>
          </div>
        )}

        {infoMessage && (
          <div className="nx-notice ok">
            <CheckCircle2 size={17} className="shrink-0 mt-0.5" />
            <span>{infoMessage}</span>
          </div>
        )}
      </div>

      {/* STEP 1: CREDENTIALS FORM */}
      {step === 'credentials' && (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div role="tablist" aria-label="Sign-in method" className="nx-seg">
            {[['password', 'Password', Lock], ['otp', 'Email code', Mail]].map(([key, label, Icon]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={method === key}
                onClick={() => { setMethod(key); setError(''); setInfoMessage(''); }}
              >
                <Icon size={14} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          <label className="nx-field">
            <span className="nx-label">Email</span>
            <span className="nx-input-wrap">
              <Mail size={16} className="lead" />
              <input
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                autoFocus
                aria-invalid={emailInvalid ? 'true' : undefined}
                disabled={lockoutSeconds > 0}
                className={`nx-input ${emailInvalid ? 'bad' : ''}`}
              />
            </span>
            {emailInvalid && <span className="block mt-1.5 text-xs text-[var(--kt-danger)]">Enter a valid email address, like name@company.com.</span>}
          </label>

          {method === 'password' && (
            <div className="nx-field">
              <div className="nx-label">
                <label htmlFor="login-password">Password</label>
                {onSwitchToForgotPassword && (
                  <button type="button" onClick={onSwitchToForgotPassword} className="nx-link text-xs">Forgot password?</button>
                )}
              </div>
              <span className="nx-input-wrap">
                <Lock size={16} className="lead" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  disabled={lockoutSeconds > 0}
                  className="nx-input pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 h-8 w-8 grid place-items-center rounded-lg text-[var(--kt-faint)] hover:text-white hover:bg-[var(--kt-s3)] cursor-pointer border-0 bg-transparent"
                  title={showPassword ? 'Hide password' : 'Show password'}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </div>
          )}

          {botChallenge && (
            <div className="p-3.5 rounded-xl border border-[var(--kt-s5)] bg-[var(--kt-s2)] space-y-2.5 nx-rise">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-[var(--kt-accent-soft)]">
                  <ShieldCheck size={15} />
                  <span>{botChallenge.question}</span>
                </div>
                <button type="button" onClick={loadBotChallenge} disabled={isLoadingChallenge} className="nx-link text-xs shrink-0">
                  {isLoadingChallenge ? 'Loading...' : 'New question'}
                </button>
              </div>
              <input
                type="text"
                placeholder="Your answer"
                aria-label="Security question answer"
                value={botAnswer}
                onChange={(e) => setBotAnswer(e.target.value)}
                required
                className="nx-input pl-3.5 h-11"
              />
              <p className="text-xs text-[var(--kt-faint)]">This quick check keeps automated sign-ups away.</p>
            </div>
          )}

          <button type="submit" disabled={isSubmitting || lockoutSeconds > 0} className="nx-btn mt-2">
            {isSubmitting ? (
              <>
                <Loader2 size={17} className="animate-spin" />
                <span>{method === 'otp' ? 'Sending code...' : 'Signing in...'}</span>
              </>
            ) : lockoutSeconds > 0 ? (
              <span>Try again in {formatTimer(lockoutSeconds)}</span>
            ) : (
              <>
                <span>{method === 'otp' ? 'Send me a code' : 'Sign in'}</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>
      )}

      {/* STEP 2: EMAILED CODE */}
      {step === 'mfa' && (
        <form onSubmit={handleVerifyOtp} className="space-y-5">
          <div className="flex items-center gap-2.5 px-3.5 py-3 rounded-xl bg-[var(--kt-s1)] border border-[var(--kt-s4)] text-sm">
            <Mail size={16} className="text-[var(--kt-accent-soft)] shrink-0" />
            <span className="text-[var(--kt-muted)]">Sent to</span>
            <span className="font-mono text-[13px] text-white truncate">{maskedEmail}</span>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-2">
              <label htmlFor="login-otp" className="font-semibold text-[var(--kt-muted)] text-[12.5px]">Verification code</label>
              <span className={`flex items-center gap-1.5 font-mono ${mfaExpiresIn < 60 ? 'text-[var(--kt-danger)]' : 'text-[var(--kt-faint)]'}`}>
                <Clock size={12} />
                <span>{mfaExpiresIn > 0 ? `Expires in ${formatTimer(mfaExpiresIn)}` : 'Code expired'}</span>
              </span>
            </div>
            <input
              id="login-otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              autoFocus
              disabled={isSubmitting || mfaExpiresIn === 0}
              className="nx-input text-center font-mono text-[28px] tracking-[0.5em] h-16 pl-[0.5em]"
            />
            <p className="mt-2 text-xs text-[var(--kt-faint)]">Each code works once and is deleted after you sign in.</p>
          </div>

          <button type="submit" disabled={isSubmitting || otp.length !== 6 || mfaExpiresIn === 0} className="nx-btn">
            {isSubmitting ? (
              <>
                <Loader2 size={17} className="animate-spin" />
                <span>Verifying...</span>
              </>
            ) : (
              <>
                <span>Verify and sign in</span>
                <ArrowRight size={16} />
              </>
            )}
          </button>

          <div className="flex items-center justify-between text-[13px]">
            <button type="button" onClick={handleBackToCredentials} className="flex items-center gap-1.5 text-[var(--kt-muted)] hover:text-white transition-colors cursor-pointer bg-transparent border-0 p-0">
              <ArrowLeft size={14} />
              <span>Back</span>
            </button>
            <button type="button" onClick={handleResendLoginOtp} disabled={resendCooldown > 0 || isResending} className="nx-link flex items-center gap-1.5 disabled:opacity-45 disabled:no-underline disabled:cursor-not-allowed">
              <RotateCw size={12} className={isResending ? 'animate-spin' : ''} />
              <span>{isResending ? 'Sending...' : resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}</span>
            </button>
          </div>
        </form>
      )}

      {step === 'credentials' && (
        <p className="mt-7 text-sm text-center text-[var(--kt-muted)]">
          New to Noun?{' '}
          <button type="button" onClick={onSwitchToSignup} className="nx-link">Create an account</button>
        </p>
      )}

      {/* Synchronous Process Modal */}
      <AuthProcessModal
        isOpen={processModalOpen}
        type="login"
        stage={processStage}
        errorMessage={processError}
        userName={name}
        onCloseError={() => setProcessModalOpen(false)}
      />
    </div>
  );
}

