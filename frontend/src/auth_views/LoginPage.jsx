import React, { useState, useEffect } from 'react';
import { Mail, Lock, User as UserIcon, Building2, Eye, EyeOff, AlertCircle, CheckCircle2, ArrowRight, ArrowLeft, Loader2, Sparkles, ShieldCheck, RotateCw, Clock, KeyRound, Monitor, ShieldAlert } from 'lucide-react';
import { useAuth } from './AuthContext';
import { useTheme } from '../context/ThemeContext';
import { loginUser, resendVerification, verifyLoginOtp, resendLoginOtp, getBotChallenge, getTakeoverStatus } from './authService';
import AuthProcessModal from './AuthProcessModal';

import { Server } from 'lucide-react';

export default function LoginPage({ onSwitchToSignup, onSwitchToForgotPassword, onOpenBackendSettings, initialSuccessMsg = '', embedded = false }) {
  const { login, sessionNotice, clearSessionNotice } = useAuth();
  const { isDark } = useTheme();

  // Step 1 Form fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [operatingLocation, setOperatingLocation] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Step state: 'credentials' | 'mfa' | 'takeover_waiting'
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

  // Takeover Waiting state (Device B)
  const [takeoverId, setTakeoverId] = useState('');
  const [existingDevice, setExistingDevice] = useState('');
  const [takeoverRemainingSeconds, setTakeoverRemainingSeconds] = useState(60);
  const [takeoverLockoutSeconds, setTakeoverLockoutSeconds] = useState(0);

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

  // Takeover Lockout Countdown tick (30-minute protection when Device A denies)
  useEffect(() => {
    if (takeoverLockoutSeconds <= 0) return;
    const timer = setInterval(() => {
      setTakeoverLockoutSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [takeoverLockoutSeconds]);

  // MFA Countdown & Cooldown tick
  useEffect(() => {
    if (step !== 'mfa') return;
    const timer = setInterval(() => {
      setMfaExpiresIn((prev) => (prev > 0 ? prev - 1 : 0));
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [step]);

  // Takeover Waiting Polling (Device B)
  useEffect(() => {
    if (step !== 'takeover_waiting' || !takeoverId) return;

    const countdown = setInterval(() => {
      setTakeoverRemainingSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);

    const poller = setInterval(async () => {
      try {
        const res = await getTakeoverStatus(takeoverId);
        if (res.status === 'approved') {
          clearInterval(poller);
          clearInterval(countdown);
          login(res.token, res.user);
        } else if (res.status === 'rejected') {
          clearInterval(poller);
          clearInterval(countdown);
          const remSecs = res.lockout_seconds !== undefined ? res.lockout_seconds : 1800;
          setTakeoverLockoutSeconds(remSecs);
          setError(res.message || 'Login request was declined by the active workstation. Remote logins are paused for 30 minutes.');
          setStep('credentials');
        } else if (res.remaining_seconds !== undefined) {
          setTakeoverRemainingSeconds(res.remaining_seconds);
        }
      } catch (err) {
        console.warn('Takeover polling note:', err);
      }
    }, 2000);

    return () => {
      clearInterval(countdown);
      clearInterval(poller);
    };
  }, [step, takeoverId, login]);

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

  // Step 1: Submit email + password
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

    // 1. Email check
    if (!cleanEmail) {
      setError('Please enter your email address.');
      return;
    }

    if (!validateEmailFormat(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }

    // 2. Operating location check
    if (!operatingLocation) {
      setError('Please select where you are operating from (In Office or Remote).');
      return;
    }

    // 3. Password presence check
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    // 4. Bot challenge check if required
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
      const data = await loginUser({
        email: cleanEmail,
        password,
        operating_location: operatingLocation,
        bot_challenge_token: challengeToken
      });

      // If MFA Challenge was generated (normal secure path)
      if (data.mfa_required) {
        setProcessModalOpen(false);
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

      // If direct login token returned (fallback)
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
      const errMsg = err.message || 'Invalid email or password. Please verify your credentials.';
      setProcessStage('error');
      setProcessError(errMsg);
      setError(errMsg);

      // Check if locked out (429)
      if (err.status === 429 || errMsg.toLowerCase().includes('locked')) {
        setLockoutSeconds(900); // 15 minutes
      }

      // Check if workstation takeover locked out (403 active workstation protected mode)
      if (err.status === 403 && (errMsg.toLowerCase().includes('declined') || errMsg.toLowerCase().includes('protect') || errMsg.toLowerCase().includes('exporting'))) {
        const match = errMsg.match(/locked for (\d+) more minute/);
        const mins = match ? parseInt(match[1], 10) : 30;
        setTakeoverLockoutSeconds(mins * 60);
      }

      // Check if bot challenge required (403 or message trigger)
      if ((err.status === 403 && !errMsg.toLowerCase().includes('declined')) || errMsg.toLowerCase().includes('verification required') || errMsg.toLowerCase().includes('puzzle') || errMsg.toLowerCase().includes('security verification')) {
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

      // Check if another device is currently active (Takeover Grace Period)
      if (data.takeover_pending) {
        setProcessModalOpen(false);
        setTakeoverId(data.takeover_id);
        setExistingDevice(data.existing_device || 'Active Workstation');
        setTakeoverRemainingSeconds(data.wait_seconds || 60);
        setStep('takeover_waiting');
        return;
      }

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
      if (err.status === 403 && (errMsg.toLowerCase().includes('declined') || errMsg.toLowerCase().includes('protect') || errMsg.toLowerCase().includes('exporting'))) {
        const match = errMsg.match(/locked for (\d+) more minute/);
        const mins = match ? parseInt(match[1], 10) : 30;
        setTakeoverLockoutSeconds(mins * 60);
        setStep('credentials');
      }
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
    setTakeoverId('');
    setOtp('');
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

  return (
    <div className={embedded ? "w-full flex flex-col justify-between relative" : `w-full max-w-md border rounded-2xl p-6 sm:p-7 shadow-2xl relative ${isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)] text-slate-200' : 'bg-white border-slate-200 text-slate-800'}`}>
      {/* Brand Header */}
      <div className="text-center mb-3 sm:mb-4">
        <div className={`inline-flex p-2.5 rounded-2xl mb-2 shadow-xs ${
          isDark
            ? 'bg-gradient-to-tr from-[var(--kt-accent)]/20 to-[var(--kt-accent-2)]/10 text-[var(--kt-accent)] border border-[var(--kt-accent)]/30 shadow-[0_0_15px_rgba(var(--kt-accent-rgb),0.2)]'
            : 'bg-blue-50 text-blue-700 border border-blue-200'
        }`}>
          {step === 'takeover_waiting' ? (
            <Monitor size={22} className="text-amber-500" />
          ) : step === 'mfa' ? (
            <ShieldCheck size={22} className={isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'} />
          ) : (
            <Building2 size={20} className={isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'} />
          )}
        </div>
        <h1 className={`text-lg sm:text-xl font-extrabold tracking-tight ${isDark ? 'text-white' : 'text-slate-900'}`}>
          {step === 'takeover_waiting' ? (
            <>Active <span className="text-amber-400 drop-shadow-[0_0_10px_rgba(245,158,11,0.35)]">Workstation</span></>
          ) : step === 'mfa' ? (
            <>Two-Step <span className={`${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'} drop-shadow-[0_0_10px_rgba(var(--kt-accent-rgb),0.35)]`}>Verification</span></>
          ) : (
            <>Karya <span className={`${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'} drop-shadow-[0_0_10px_rgba(var(--kt-accent-rgb),0.35)]`}>Studio</span></>
          )}
        </h1>
        <p className={`text-xs mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
          {step === 'takeover_waiting' ? (
            'Resolving single active session with currently logged in device'
          ) : step === 'mfa' ? (
            'Enter the temporary 6-digit code sent to your email'
          ) : (
            <>Sign in to your <strong className={isDark ? 'text-[var(--kt-accent)] font-semibold' : 'text-blue-700 font-semibold'}>workstation</strong> account</>
          )}
        </p>
      </div>

      {/* Brute-Force Lockout Banner */}
      {lockoutSeconds > 0 && (
        <div className={`mb-4 p-3 rounded-xl border text-xs flex items-start gap-2.5 leading-relaxed animate-in fade-in ${
          isDark
            ? 'bg-rose-500/15 border-rose-500/40 text-rose-300'
            : 'bg-rose-50 border-rose-200 text-rose-900 shadow-xs'
        }`}>
          <ShieldAlert size={18} className={`shrink-0 mt-0.5 ${isDark ? 'text-rose-400' : 'text-rose-600'}`} />
          <div>
            <div className={`font-bold ${isDark ? 'text-rose-200' : 'text-rose-950'}`}>Account Temporarily Locked</div>
            <div className={`mt-0.5 text-[11px] ${isDark ? 'text-rose-300/90' : 'text-rose-800'}`}>
              Too many failed password attempts. Access is locked for: <strong className={`font-mono ${isDark ? 'text-white' : 'text-rose-950 font-bold'}`}>{formatTimer(lockoutSeconds)}</strong>
            </div>
          </div>
        </div>
      )}

      {/* 30-Minute Workstation Takeover Lockout Banner */}
      {takeoverLockoutSeconds > 0 && (
        <div className={`mb-4 p-3 rounded-xl border text-xs flex items-start gap-2.5 leading-relaxed animate-in fade-in ${
          isDark
            ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
            : 'bg-amber-50 border-amber-200 text-amber-900 shadow-xs'
        }`}>
          <ShieldAlert size={18} className={`shrink-0 mt-0.5 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
          <div className="flex-1">
            <div className={`font-bold flex items-center justify-between ${isDark ? 'text-amber-100' : 'text-amber-950'}`}>
              <span>Workstation Protected (Exporting/Active)</span>
              <span className={`font-mono font-bold ${isDark ? 'text-amber-300' : 'text-amber-700'}`}>{formatTimer(takeoverLockoutSeconds)}</span>
            </div>
            <div className={`mt-1 text-[11px] leading-relaxed ${isDark ? 'text-amber-300/90' : 'text-amber-800 font-medium'}`}>
              The active workstation declined remote login to prevent interruptions during export or editing. Remote logins are paused for 30 minutes. If the active workstation logs out, you can sign in immediately.
            </div>
          </div>
        </div>
      )}

      {/* Session Expired / Inactivity Notice */}
      {sessionNotice && !error && step === 'credentials' && lockoutSeconds === 0 && (
        <div className={`mb-4 p-3 rounded-xl border text-xs flex items-start gap-2.5 leading-relaxed animate-in fade-in duration-200 ${
          isDark
            ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
            : 'bg-amber-50 border-amber-200 text-amber-900 shadow-xs'
        }`}>
          <AlertCircle size={16} className={`shrink-0 mt-0.5 ${isDark ? 'text-amber-400' : 'text-amber-600'}`} />
          <div className="flex-1">
            <span className={isDark ? 'text-amber-300' : 'text-amber-900 font-medium'}>{sessionNotice}</span>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {error && !processModalOpen && (
        <div className={`mb-4 p-3 rounded-xl border text-xs flex items-start gap-2.5 leading-relaxed ${
          isDark
            ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
            : 'bg-rose-50 border-rose-200 text-rose-900 shadow-xs'
        }`}>
          <AlertCircle size={16} className={`shrink-0 mt-0.5 ${isDark ? 'text-rose-400' : 'text-rose-600'}`} />
          <div className="flex-1">
            <div className={isDark ? 'text-rose-200' : 'text-rose-900 font-medium'}>{error}</div>
            {unverifiedEmail && (
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={isResending}
                className={`mt-2 px-3 py-1 rounded-lg text-[11px] font-semibold transition-colors cursor-pointer border ${
                  isDark
                    ? 'bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-white border-[var(--kt-s5)]'
                    : 'bg-white hover:bg-slate-50 text-rose-800 border-rose-300 shadow-xs'
                }`}
              >
                {isResending ? 'Sending...' : 'Resend Verification Email'}
              </button>
            )}
            {(error.toLowerCase().includes('timed out') || error.toLowerCase().includes('connect') || error.toLowerCase().includes('network') || error.toLowerCase().includes('server is running')) && onOpenBackendSettings && (
              <button
                type="button"
                onClick={onOpenBackendSettings}
                className={`mt-2 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1.5 border ${
                  isDark
                    ? 'bg-[var(--kt-accent)]/10 hover:bg-[var(--kt-accent)]/20 text-[var(--kt-accent)] border-[var(--kt-accent)]/30'
                    : 'bg-white hover:bg-slate-50 text-blue-700 border-blue-200 shadow-xs'
                }`}
              >
                <Server size={12} />
                <span>Configure Backend URL / Switch Port</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Info Alert */}
      {infoMessage && (
        <div className={`mb-4 p-3 rounded-xl border text-xs flex items-start gap-2.5 leading-relaxed ${
          isDark
            ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
            : 'bg-emerald-50 border-emerald-200 text-emerald-900 shadow-xs'
        }`}>
          <CheckCircle2 size={16} className={`shrink-0 mt-0.5 ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`} />
          <div className={isDark ? 'text-emerald-300' : 'text-emerald-900 font-medium'}>{infoMessage}</div>
        </div>
      )}

      {/* STEP 1: CREDENTIALS FORM */}
      {step === 'credentials' && (
        <form onSubmit={handleSubmit} className="space-y-2.5">
          {/* Email */}
          <div>
            <label className={`block text-[11px] mb-1 tracking-wide ${isDark ? 'text-slate-400 font-semibold' : 'text-slate-700 font-semibold'}`}>
              Email Address <span className={isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'}>*</span>
            </label>
            <div className="relative flex items-center">
              <Mail size={16} className={`absolute left-3 pointer-events-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
              <input
                type="email"
                placeholder="name@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                disabled={lockoutSeconds > 0}
                className={`w-full pl-9 pr-3 py-2 border rounded-lg text-xs outline-none transition-all disabled:opacity-50 ${
                  email && !validateEmailFormat(email)
                    ? 'border-rose-500'
                    : isDark
                    ? 'bg-[var(--kt-s0)] border-[var(--kt-s4)] text-white placeholder-slate-600 focus:border-[var(--kt-accent)] focus:ring-1 focus:ring-[var(--kt-accent)]'
                    : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600/20'
                }`}
              />
            </div>
            {email && !validateEmailFormat(email) && (
              <span className="block mt-1 text-[11px] text-rose-400">
                Please enter a valid email address
              </span>
            )}
          </div>

          {/* Operating Location */}
          <div>
            <label className={`block text-[11px] mb-1 tracking-wide ${isDark ? 'text-slate-400 font-semibold' : 'text-slate-700 font-semibold'}`}>
              Operating Location <span className={isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'}>*</span>
            </label>
            <div className="relative flex items-center">
              <Building2 size={16} className={`absolute left-3 pointer-events-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
              <select
                value={operatingLocation}
                onChange={(e) => setOperatingLocation(e.target.value)}
                required
                disabled={lockoutSeconds > 0}
                className={`w-full pl-9 pr-8 py-2 border rounded-lg text-xs outline-none transition-all appearance-none cursor-pointer disabled:opacity-50 ${
                  isDark
                    ? 'bg-[var(--kt-s0)] border-[var(--kt-s4)] text-white focus:border-[var(--kt-accent)] focus:ring-1 focus:ring-[var(--kt-accent)]'
                    : 'bg-slate-50 border-slate-300 text-slate-900 focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600/20'
                }`}
              >
                <option value="">Select where you are operating from...</option>
                <option value="In Office">🏢 In Office</option>
                <option value="Remote">🏠 Remote</option>
              </select>
            </div>
          </div>

          {/* Password */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className={`text-[11px] tracking-wide ${isDark ? 'text-slate-400 font-semibold' : 'text-slate-700 font-semibold'}`}>
                Password <span className={isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'}>*</span>
              </label>
              {onSwitchToForgotPassword && (
                <button
                  type="button"
                  onClick={onSwitchToForgotPassword}
                  className={`text-[11px] font-medium hover:underline cursor-pointer bg-transparent border-0 p-0 ${
                    isDark ? 'text-[var(--kt-accent)]' : 'text-blue-700 font-semibold'
                  }`}
                >
                  Forgot Password?
                </button>
              )}
            </div>
            <div className="relative flex items-center">
              <Lock size={16} className={`absolute left-3 pointer-events-none ${isDark ? 'text-slate-500' : 'text-slate-400'}`} />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={lockoutSeconds > 0}
                className={`w-full pl-9 pr-9 py-2 border rounded-lg text-xs outline-none transition-all disabled:opacity-50 ${
                  isDark
                    ? 'bg-[var(--kt-s0)] border-[var(--kt-s4)] text-white placeholder-slate-600 focus:border-[var(--kt-accent)] focus:ring-1 focus:ring-[var(--kt-accent)]'
                    : 'bg-slate-50 border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:bg-white focus:ring-1 focus:ring-blue-600/20'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={`absolute right-3 p-0.5 cursor-pointer bg-transparent border-0 ${
                  isDark ? 'text-slate-500 hover:text-slate-300' : 'text-slate-400 hover:text-slate-600'
                }`}
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Bot Defense Challenge (Shown after 2 failed attempts) */}
          {botChallenge && (
            <div className={`p-3 border rounded-xl space-y-2 animate-in fade-in ${
              isDark ? 'bg-[var(--kt-s2)] border-[var(--kt-s5)]' : 'bg-slate-50 border-slate-200'
            }`}>
              <div className="flex items-center justify-between">
                <div className={`flex items-center gap-1.5 text-xs font-semibold ${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-700'}`}>
                  <ShieldCheck size={14} />
                  <span>{botChallenge.question}</span>
                </div>
                <button
                  type="button"
                  onClick={loadBotChallenge}
                  disabled={isLoadingChallenge}
                  className={`text-[11px] cursor-pointer bg-transparent border-0 p-0 ${
                    isDark ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {isLoadingChallenge ? 'Loading...' : 'New question'}
                </button>
              </div>
              <input
                type="text"
                placeholder="Enter answer (e.g. 14)"
                value={botAnswer}
                onChange={(e) => setBotAnswer(e.target.value)}
                required
                className={`w-full px-3 py-1.5 border rounded-lg text-xs outline-none ${
                  isDark
                    ? 'bg-[var(--kt-s0)] border-[var(--kt-s4)] text-white placeholder-slate-600 focus:border-[var(--kt-accent)]'
                    : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-600'
                }`}
              />
              <p className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
                Human verification required to protect server email quota.
              </p>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || lockoutSeconds > 0}
            className={`w-full mt-2 py-2.5 px-4 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed ${
              isDark
                ? 'bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.3)] hover:shadow-[0_0_25px_rgba(var(--kt-accent-rgb),0.45)]'
                : 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-md hover:shadow-blue-500/20'
            }`}
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Validating Credentials...</span>
              </>
            ) : lockoutSeconds > 0 ? (
              <span>Locked ({formatTimer(lockoutSeconds)})</span>
            ) : (
              <>
                <span>Continue with Security Verification</span>
                <ArrowRight size={15} />
              </>
            )}
          </button>

          {/* Social / Workstation SSO Options */}
          <div className={`pt-2.5 border-t text-center ${isDark ? 'border-[var(--kt-s4)]/80' : 'border-slate-200'}`}>
            <div className={`text-[11px] font-medium mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Or continue with</div>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setError('Direct Google SSO is enabled for corporate accounts. Please enter your work email above to sign in.');
                }}
                className={`flex items-center justify-center w-12 h-8.5 rounded-xl border transition-all cursor-pointer shadow-xs ${
                  isDark ? 'border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] hover:border-slate-500' : 'border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300'
                }`}
                title="Sign in with Google"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"/>
                </svg>
              </button>

              <button
                type="button"
                onClick={() => {
                  setError('Apple ID SSO is available for macOS workstations. Please enter your work email above to authenticate.');
                }}
                className={`flex items-center justify-center w-12 h-8.5 rounded-xl border transition-all cursor-pointer shadow-xs ${
                  isDark ? 'border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] hover:border-slate-500 text-white' : 'border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 text-slate-800'
                }`}
                title="Sign in with Apple"
              >
                <svg className="w-4 h-4 fill-current" viewBox="0 0 170 170">
                  <path d="M150.37 130.25c-2.45 5.66-5.35 10.87-8.71 15.66-4.58 6.53-8.33 11.05-11.22 13.56-4.48 4.12-9.28 6.23-14.42 6.35-3.69 0-8.14-1.05-13.32-3.18-5.19-2.12-9.97-3.17-14.34-3.17-4.58 0-9.49 1.05-14.75 3.17-5.26 2.13-9.5 3.24-12.74 3.35-4.35.13-9.16-1.9-14.42-6.08-3.7-3.04-7.66-7.85-11.87-14.42-6.53-10.22-11.66-21.68-15.38-34.38-3.72-12.7-5.58-24.81-5.58-36.33 0-14.7 3.59-27.15 10.77-37.34 7.18-10.19 16.48-15.38 27.9-15.58 4.89 0 10.37 1.25 16.44 3.75 6.07 2.5 10.25 3.8 12.54 3.9 1.85 0 6.13-1.4 12.84-4.2 6.71-2.8 12.44-4.05 17.19-3.75 12.84.76 23.36 5.61 31.56 14.55-11.2 6.74-16.63 16.2-16.3 28.37.33 9.46 3.91 17.45 10.74 23.97 6.83 6.52 14.95 10.25 24.36 11.19-2.07 6.3-4.73 12.87-7.98 19.7zM119.22 33.55c0-7.39 2.61-14.24 7.83-20.55 5.22-6.31 11.74-10.33 19.56-12.06.33 1.09.49 2.18.49 3.27 0 7.28-2.67 14.24-8.01 20.88-5.34 6.64-12.01 10.55-20.01 11.73-.11-.98-.16-1.98-.16-3.27z"/>
                </svg>
              </button>

              <button
                type="button"
                onClick={() => {
                  setError('Corporate Single-Sign-On is available for verified organization accounts.');
                }}
                className={`flex items-center justify-center w-12 h-8.5 rounded-xl border transition-all cursor-pointer shadow-xs ${
                  isDark ? 'border-[var(--kt-s5)] bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] text-[var(--kt-accent)]' : 'border-slate-200 bg-slate-50 hover:bg-slate-100 text-blue-700'
                }`}
                title="Sign in with Enterprise Workstation SSO"
              >
                <KeyRound size={15} />
              </button>
            </div>
          </div>
        </form>
      )}

      {/* STEP 2: MFA OTP VERIFICATION */}
      {step === 'mfa' && (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          {/* Target Email Indicator */}
          <div className="p-3 bg-[var(--kt-s0)] border border-[var(--kt-s4)] rounded-xl text-center">
            <span className="text-[11px] text-slate-400 block mb-1">Code sent to official email:</span>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--kt-s2)] border border-[var(--kt-s5)] text-xs font-mono text-[var(--kt-accent)]">
              <Mail size={12} />
              <span>{maskedEmail}</span>
            </div>
          </div>

          {/* OTP Input & Expiration Timer */}
          <div>
            <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1.5">
              <span className="font-semibold tracking-wide">6-Digit Verification Code</span>
              <span className={`flex items-center gap-1 font-mono ${mfaExpiresIn < 60 ? 'text-rose-400 font-bold animate-pulse' : 'text-slate-400'}`}>
                <Clock size={12} />
                <span>{mfaExpiresIn > 0 ? `Expires in ${formatTimer(mfaExpiresIn)}` : 'Code expired'}</span>
              </span>
            </div>
            <div className="relative">
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                placeholder="······"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                autoFocus
                disabled={isSubmitting || mfaExpiresIn === 0}
                className="w-full text-center font-mono text-2xl tracking-[14px] sm:tracking-[18px] py-3 px-4 bg-[var(--kt-s0)] border border-[var(--kt-s4)] focus:border-[var(--kt-accent)] focus:ring-1 focus:ring-[var(--kt-accent)] rounded-xl text-white outline-none transition-all placeholder-slate-600 disabled:opacity-50"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-500 text-center leading-relaxed">
              Temporary single-use OTP. Immediately deleted after successful login.
            </p>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || otp.length !== 6 || mfaExpiresIn === 0}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black transition-all shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.3)] hover:shadow-[0_0_25px_rgba(var(--kt-accent-rgb),0.45)] cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Verifying Security Code...</span>
              </>
            ) : (
              <>
                <span>Verify & Launch Workspace</span>
                <ArrowRight size={15} />
              </>
            )}
          </button>

          {/* Resend & Back Navigation */}
          <div className="pt-2 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={handleBackToCredentials}
              className="text-slate-400 hover:text-white flex items-center gap-1.5 transition-colors cursor-pointer bg-transparent border-0 p-0"
            >
              <ArrowLeft size={14} />
              <span>Back to Sign In</span>
            </button>

            <button
              type="button"
              onClick={handleResendLoginOtp}
              disabled={resendCooldown > 0 || isResending}
              className="text-[var(--kt-accent)] hover:underline disabled:opacity-40 disabled:hover:no-underline flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed bg-transparent border-0 p-0 font-medium"
            >
              <RotateCw size={12} className={isResending ? 'animate-spin' : ''} />
              <span>
                {isResending ? 'Sending code...' : resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend Code'}
              </span>
            </button>
          </div>
        </form>
      )}

      {/* STEP 3: DEVICE B TAKEOVER WAITING VIEW */}
      {step === 'takeover_waiting' && (
        <div className="space-y-4 animate-in fade-in">
          <div className="p-3.5 bg-[var(--kt-s0)] border border-amber-500/30 rounded-xl text-center">
            <span className="text-[11px] text-slate-400 block mb-1">Currently Logged In Device:</span>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[var(--kt-s2)] border border-[var(--kt-s5)] text-xs font-mono text-amber-300">
              <Monitor size={13} />
              <span>{existingDevice}</span>
            </div>
          </div>

          <div className="p-4 bg-[var(--kt-s0)] border border-[var(--kt-s4)] rounded-xl text-center space-y-2">
            <div className="flex items-center justify-center gap-2 text-amber-400">
              <Loader2 size={18} className="animate-spin" />
              <span className="text-xs font-semibold">Waiting for Workstation Authorization</span>
            </div>
            <div className="text-2xl font-mono font-bold text-white">
              00:{takeoverRemainingSeconds.toString().padStart(2, '0')}
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              An alert has been sent to the active device. If it does not decline within 60 seconds, your session on this device will activate automatically.
            </p>
          </div>

          <button
            type="button"
            onClick={handleBackToCredentials}
            className="w-full py-2 px-4 rounded-xl text-xs font-semibold bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-slate-300 hover:text-white border border-[var(--kt-s5)] transition-colors cursor-pointer flex items-center justify-center gap-1.5"
          >
            <ArrowLeft size={14} />
            <span>Cancel Login Request</span>
          </button>
        </div>
      )}

      {/* Footer link (only in credentials step) */}
      {step === 'credentials' && (
        <div className={`mt-3.5 pt-2.5 border-t text-center text-xs ${
          isDark ? 'border-[var(--kt-s3)] text-slate-400' : 'border-slate-200 text-slate-600'
        }`}>
          <span>Don't have an account yet?</span>{' '}
          <button
            type="button"
            onClick={onSwitchToSignup}
            className={`font-bold hover:underline cursor-pointer bg-transparent border-0 p-0 ${
              isDark ? 'text-[var(--kt-accent)]' : 'text-blue-700'
            }`}
          >
            Create an Account
          </button>
        </div>
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

