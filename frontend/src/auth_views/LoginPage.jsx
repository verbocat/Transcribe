import React, { useState, useEffect } from 'react';
import { Mail, Lock, User as UserIcon, Building2, Eye, EyeOff, AlertCircle, CheckCircle2, ArrowRight, ArrowLeft, Loader2, Sparkles, ShieldCheck, RotateCw, Clock, KeyRound, Monitor, ShieldAlert } from 'lucide-react';
import { useAuth } from './AuthContext';
import { loginUser, resendVerification, verifyLoginOtp, resendLoginOtp, getBotChallenge, getTakeoverStatus } from './authService';
import AuthProcessModal from './AuthProcessModal';

export default function LoginPage({ onSwitchToSignup, onSwitchToForgotPassword, initialSuccessMsg = '' }) {
  const { login, sessionNotice, clearSessionNotice } = useAuth();

  // Step 1 Form fields
  const [name, setName] = useState('');
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

  const validateEmailDomain = (val) => {
    const clean = val.trim().toLowerCase();
    if (!clean) return false;
    return clean.endsWith('.verbolabs.com') || clean.endsWith('@verbolabs.com');
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

    if (!validateEmailDomain(cleanEmail)) {
      setError('Access restricted: Only official @verbolabs.com email addresses are permitted.');
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
    setProcessStage('connecting');
    setProcessModalOpen(true);

    try {
      setTimeout(() => {
        setProcessStage('authenticating');
      }, 350);

      const data = await loginUser({
        name: name.trim() || undefined,
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
      await new Promise(r => setTimeout(r, 450));

      setProcessStage('success');
      await new Promise(r => setTimeout(r, 650));

      if (typeof window !== 'undefined' && window.history.replaceState) {
        window.history.replaceState({ tool: null }, '', '/');
      }

      setProcessModalOpen(false);
      login(data.token, data.user);
    } catch (err) {
      const errMsg = err.message || 'Login failed.';
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
      const errMsg = err.message || 'Verification failed.';
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
      setTimeout(() => {
        setProcessModalOpen(false);
      }, 800);
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
    <div className="w-full max-w-md bg-[#14151a] border border-[#262734] rounded-2xl p-6 sm:p-8 shadow-2xl relative text-slate-200">
      {/* Brand Header */}
      <div className="text-center mb-6">
        <div className="inline-flex p-3 rounded-2xl bg-gradient-to-tr from-[#00e5be]/20 to-[#00b4d8]/10 text-[#00e5be] border border-[#00e5be]/30 mb-3 shadow-[0_0_15px_rgba(0,229,190,0.2)]">
          {step === 'takeover_waiting' ? (
            <Monitor size={24} className="text-amber-400" />
          ) : step === 'mfa' ? (
            <ShieldCheck size={24} />
          ) : (
            <Building2 size={22} />
          )}
        </div>
        <h1 className="text-xl font-extrabold text-white tracking-tight">
          {step === 'takeover_waiting' ? (
            <>Active <span className="text-amber-400 drop-shadow-[0_0_10px_rgba(245,158,11,0.35)]">Workstation</span></>
          ) : step === 'mfa' ? (
            <>Two-Step <span className="text-[#00e5be] drop-shadow-[0_0_10px_rgba(0,229,190,0.35)]">Verification</span></>
          ) : (
            <>Karya <span className="text-[#00e5be] drop-shadow-[0_0_10px_rgba(0,229,190,0.35)]">Studio</span></>
          )}
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          {step === 'takeover_waiting' ? (
            'Resolving single active session with currently logged in device'
          ) : step === 'mfa' ? (
            'Enter the temporary 6-digit code sent to your email'
          ) : (
            <>Sign in with your official <strong className="text-[#00e5be] font-semibold">@verbolabs.com</strong> account</>
          )}
        </p>
      </div>

      {/* Brute-Force Lockout Banner */}
      {lockoutSeconds > 0 && (
        <div className="mb-4 p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-rose-300 text-xs flex items-start gap-2.5 leading-relaxed animate-in fade-in">
          <ShieldAlert size={18} className="text-rose-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-bold text-rose-200">Account Temporarily Locked</div>
            <div className="mt-0.5 text-[11px] text-rose-300/90">
              Too many failed password attempts. Access is locked for: <strong className="font-mono text-white">{formatTimer(lockoutSeconds)}</strong>
            </div>
          </div>
        </div>
      )}

      {/* 30-Minute Workstation Takeover Lockout Banner */}
      {takeoverLockoutSeconds > 0 && (
        <div className="mb-4 p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 text-xs flex items-start gap-2.5 leading-relaxed animate-in fade-in">
          <ShieldAlert size={18} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="font-bold text-amber-100 flex items-center justify-between">
              <span>Workstation Protected (Exporting/Active)</span>
              <span className="font-mono text-amber-300 font-bold">{formatTimer(takeoverLockoutSeconds)}</span>
            </div>
            <div className="mt-1 text-[11px] text-amber-300/90 leading-relaxed">
              The active workstation declined remote login to prevent interruptions during export or editing. Remote logins are paused for 30 minutes. If the active workstation logs out, you can sign in immediately.
            </div>
          </div>
        </div>
      )}

      {/* Session Expired / Inactivity Notice */}
      {sessionNotice && !error && step === 'credentials' && lockoutSeconds === 0 && (
        <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs flex items-start gap-2.5 leading-relaxed animate-in fade-in duration-200">
          <AlertCircle size={16} className="text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span>{sessionNotice}</span>
          </div>
        </div>
      )}

      {/* Error Alert */}
      {error && !processModalOpen && (
        <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5 leading-relaxed">
          <AlertCircle size={16} className="text-rose-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <div>{error}</div>
            {unverifiedEmail && (
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={isResending}
                className="mt-2 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-[#1a1b24] hover:bg-[#252836] text-white border border-[#2f3142] transition-colors cursor-pointer"
              >
                {isResending ? 'Sending...' : 'Resend Verification Email'}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Info Alert */}
      {infoMessage && (
        <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-start gap-2.5 leading-relaxed">
          <CheckCircle2 size={16} className="text-emerald-400 shrink-0 mt-0.5" />
          <div>{infoMessage}</div>
        </div>
      )}

      {/* STEP 1: CREDENTIALS FORM */}
      {step === 'credentials' && (
        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Full Name */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1 tracking-wide">
              Full Name
            </label>
            <div className="relative flex items-center">
              <UserIcon size={16} className="absolute left-3 text-slate-500 pointer-events-none" />
              <input
                type="text"
                placeholder="e.g. John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                disabled={lockoutSeconds > 0}
                className="w-full pl-9 pr-3 py-2 bg-[#0e0f12] border border-[#262734] focus:border-[#00e5be] focus:ring-1 focus:ring-[#00e5be] rounded-lg text-xs text-white placeholder-slate-600 outline-none transition-all disabled:opacity-50"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1 tracking-wide">
              Work Email <span className="text-[#00e5be]">*</span>
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
                disabled={lockoutSeconds > 0}
                className={`w-full pl-9 pr-3 py-2 bg-[#0e0f12] border ${
                  email && !validateEmailDomain(email) ? 'border-rose-500' : 'border-[#262734] focus:border-[#00e5be]'
                } focus:ring-1 focus:ring-[#00e5be] rounded-lg text-xs text-white placeholder-slate-600 outline-none transition-all disabled:opacity-50`}
              />
            </div>
            {email && !validateEmailDomain(email) && (
              <span className="block mt-1 text-[11px] text-rose-400">
                Must end with @verbolabs.com
              </span>
            )}
          </div>

          {/* Operating Location */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-400 mb-1 tracking-wide">
              Operating Location <span className="text-[#00e5be]">*</span>
            </label>
            <div className="relative flex items-center">
              <Building2 size={16} className="absolute left-3 text-slate-500 pointer-events-none" />
              <select
                value={operatingLocation}
                onChange={(e) => setOperatingLocation(e.target.value)}
                required
                disabled={lockoutSeconds > 0}
                className="w-full pl-9 pr-8 py-2 bg-[#0e0f12] border border-[#262734] focus:border-[#00e5be] focus:ring-1 focus:ring-[#00e5be] rounded-lg text-xs text-white outline-none transition-all appearance-none cursor-pointer disabled:opacity-50"
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
              <label className="text-[11px] font-semibold text-slate-400 tracking-wide">
                Password <span className="text-[#00e5be]">*</span>
              </label>
              {onSwitchToForgotPassword && (
                <button
                  type="button"
                  onClick={onSwitchToForgotPassword}
                  className="text-[11px] font-medium text-[#00e5be] hover:underline cursor-pointer bg-transparent border-0 p-0"
                >
                  Forgot Password?
                </button>
              )}
            </div>
            <div className="relative flex items-center">
              <Lock size={16} className="absolute left-3 text-slate-500 pointer-events-none" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                disabled={lockoutSeconds > 0}
                className="w-full pl-9 pr-9 py-2 bg-[#0e0f12] border border-[#262734] focus:border-[#00e5be] focus:ring-1 focus:ring-[#00e5be] rounded-lg text-xs text-white placeholder-slate-600 outline-none transition-all disabled:opacity-50"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 text-slate-500 hover:text-slate-300 p-0.5 cursor-pointer bg-transparent border-0"
                title={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Bot Defense Challenge (Shown after 2 failed attempts) */}
          {botChallenge && (
            <div className="p-3 bg-[#181a24] border border-[#2f3145] rounded-xl space-y-2 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#00e5be]">
                  <ShieldCheck size={14} />
                  <span>{botChallenge.question}</span>
                </div>
                <button
                  type="button"
                  onClick={loadBotChallenge}
                  disabled={isLoadingChallenge}
                  className="text-[11px] text-slate-400 hover:text-white cursor-pointer bg-transparent border-0 p-0"
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
                className="w-full px-3 py-1.5 bg-[#0e0f12] border border-[#262734] focus:border-[#00e5be] focus:ring-1 focus:ring-[#00e5be] rounded-lg text-xs text-white placeholder-slate-600 outline-none"
              />
              <p className="text-[10px] text-slate-500">
                Human verification required to protect server email quota.
              </p>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting || lockoutSeconds > 0}
            className="w-full mt-2 py-2.5 px-4 rounded-xl text-xs font-bold bg-[#00e5be] hover:bg-[#00d4af] text-black transition-all shadow-[0_0_20px_rgba(0,229,190,0.3)] hover:shadow-[0_0_25px_rgba(0,229,190,0.45)] cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
        </form>
      )}

      {/* STEP 2: MFA OTP VERIFICATION */}
      {step === 'mfa' && (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          {/* Target Email Indicator */}
          <div className="p-3 bg-[#0e0f12] border border-[#262734] rounded-xl text-center">
            <span className="text-[11px] text-slate-400 block mb-1">Code sent to official email:</span>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#181a24] border border-[#2f3245] text-xs font-mono text-[#00e5be]">
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
                className="w-full text-center font-mono text-2xl tracking-[14px] sm:tracking-[18px] py-3 px-4 bg-[#0e0f12] border border-[#262734] focus:border-[#00e5be] focus:ring-1 focus:ring-[#00e5be] rounded-xl text-white outline-none transition-all placeholder-slate-600 disabled:opacity-50"
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
            className="w-full py-2.5 px-4 rounded-xl text-xs font-bold bg-[#00e5be] hover:bg-[#00d4af] text-black transition-all shadow-[0_0_20px_rgba(0,229,190,0.3)] hover:shadow-[0_0_25px_rgba(0,229,190,0.45)] cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
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
              className="text-[#00e5be] hover:underline disabled:opacity-40 disabled:hover:no-underline flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed bg-transparent border-0 p-0 font-medium"
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
          <div className="p-3.5 bg-[#0e0f12] border border-amber-500/30 rounded-xl text-center">
            <span className="text-[11px] text-slate-400 block mb-1">Currently Logged In Device:</span>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#181a24] border border-[#2f3245] text-xs font-mono text-amber-300">
              <Monitor size={13} />
              <span>{existingDevice}</span>
            </div>
          </div>

          <div className="p-4 bg-[#0e0f12] border border-[#262734] rounded-xl text-center space-y-2">
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
            className="w-full py-2 px-4 rounded-xl text-xs font-semibold bg-[#1a1b24] hover:bg-[#252836] text-slate-300 hover:text-white border border-[#2f3142] transition-colors cursor-pointer flex items-center justify-center gap-1.5"
          >
            <ArrowLeft size={14} />
            <span>Cancel Login Request</span>
          </button>
        </div>
      )}

      {/* Footer link (only in credentials step) */}
      {step === 'credentials' && (
        <div className="mt-5 pt-3.5 border-t border-[#22232c] text-center text-xs text-slate-400">
          <span>Don't have an account yet?</span>{' '}
          <button
            type="button"
            onClick={onSwitchToSignup}
            className="font-bold text-[#00e5be] hover:underline cursor-pointer bg-transparent border-0 p-0"
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

