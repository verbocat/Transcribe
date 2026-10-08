import React, { useState, useEffect } from 'react';
import { ArrowLeft, X, Server, Settings, Check, RotateCw, AlertCircle, CheckCircle2, Wifi, WifiOff } from 'lucide-react';
import LoginPage from './LoginPage';
import BrandLogo from '../components/BrandLogo';
import SignupPage from './SignupPage';
import VerifyEmailPage from './VerifyEmailPage';
import ForgotPasswordPage from './ForgotPasswordPage';
import ResetPasswordPage from './ResetPasswordPage';
import AuthSplitVisual from './AuthSplitVisual';
import ThemeToggle from '../components/ThemeToggle';
import { useTheme } from '../context/ThemeContext';
import { getApiBase, setCustomApiBase, testBackendHealth, detectAndSelectLiveBackend, cleanUrl, isLocalhostHost } from '../config';

/**
 * Authentication Screen Overlay.
 * Allows dismissing via ESC key, clicking outside the card, or clicking the close buttons.
 * Includes direct pre-login Backend Server Status & Configuration to break the login paradox.
 */
export default function AuthScreen({ onBackToHome, initialView = 'login' }) {
  const { isDark } = useTheme();
  const [view, setView] = useState(initialView); // 'login', 'signup', 'verify', 'forgot', 'reset'
  const [loginSuccessMsg, setLoginSuccessMsg] = useState('');
  const [urlToken, setUrlToken] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  // Backend Connectivity & Configuration State
  const [backendUrl, setBackendUrl] = useState(() => getApiBase());
  const [backendStatus, setBackendStatus] = useState('checking'); // 'connected' | 'error' | 'checking'
  const [backendLatency, setBackendLatency] = useState(null);
  const [backendModalOpen, setBackendModalOpen] = useState(false);
  const [inputUrl, setInputUrl] = useState(() => getApiBase());
  const [testResult, setTestResult] = useState(null);
  const [isTesting, setIsTesting] = useState(false);

  // Synchronize backendUrl when config changes
  useEffect(() => {
    const handleUrlChange = (e) => {
      const newUrl = e.detail?.url ?? getApiBase();
      setBackendUrl(newUrl);
      setInputUrl(newUrl);
      checkConnection(newUrl);
    };

    window.addEventListener('karya_api_url_changed', handleUrlChange);
    return () => window.removeEventListener('karya_api_url_changed', handleUrlChange);
  }, []);

  const checkConnection = async (target) => {
    setBackendStatus('checking');
    const res = await testBackendHealth(target);
    if (res.ok) {
      setBackendStatus('connected');
      setBackendLatency(res.latencyMs);
    } else {
      setBackendStatus('error');
      setBackendLatency(null);
    }
    return res;
  };

  // Initial connection probe on mount
  useEffect(() => {
    const current = getApiBase();
    checkConnection(current);

    // If on localhost and initial check fails, attempt live port auto-detection
    if (isLocalhostHost()) {
      detectAndSelectLiveBackend().then((resolved) => {
        if (resolved && resolved !== current) {
          setBackendUrl(resolved);
          setInputUrl(resolved);
          checkConnection(resolved);
        }
      });
    }

    const interval = setInterval(() => {
      checkConnection(getApiBase());
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleOpenConfigModal = () => {
    const current = getApiBase();
    setInputUrl(current);
    setTestResult(null);
    setBackendModalOpen(true);
  };

  const handleTestUrl = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testBackendHealth(inputUrl);
      setTestResult(res);
    } finally {
      setIsTesting(false);
    }
  };

  const handleApplyUrl = async (urlToSave) => {
    const clean = cleanUrl(urlToSave);
    setCustomApiBase(clean);
    setBackendUrl(clean);
    setInputUrl(clean);
    setBackendModalOpen(false);
    await checkConnection(clean);
  };

  const handleDismiss = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      if (onBackToHome) onBackToHome();
    }, 200);
  };

  // Keyboard Escape key dismissal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (backendModalOpen) {
          setBackendModalOpen(false);
        } else {
          handleDismiss();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isClosing, onBackToHome, backendModalOpen]);

  useEffect(() => {
    const pathname = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      setUrlToken(token);
    }

    if (pathname.includes('reset-password') || (token && pathname.includes('reset'))) {
      setView('reset');
    } else if (token || pathname.includes('verify-email')) {
      setView('verify');
    }
  }, []);

  const handleCleanUrlAndLogin = (successMessage = '') => {
    if (window.history.replaceState) {
      const cleanUrlStr = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.replaceState({ path: cleanUrlStr }, '', cleanUrlStr);
    }
    setLoginSuccessMsg(successMessage);
    setView('login');
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !backendModalOpen) {
          handleDismiss();
        }
      }}
      className={`min-h-screen w-screen flex flex-col justify-between relative overflow-y-auto custom-scrollbar select-none transition-all duration-300 ${isDark ? 'bg-[var(--kt-s0)] text-slate-200' : 'bg-[#f4f6fb] text-slate-800'
        } ${isClosing ? 'opacity-0' : 'opacity-100'}`}
    >
      {/* Ambient background glow effects */}
      <div className={`absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[400px] blur-[130px] pointer-events-none rounded-full ${isDark ? 'bg-gradient-to-tr from-[var(--kt-accent)]/10 to-indigo-600/10' : 'bg-gradient-to-tr from-blue-500/10 to-indigo-400/10'
        }`} />
      <div className={`absolute bottom-10 right-10 w-[400px] h-[300px] blur-[110px] pointer-events-none rounded-full ${isDark ? 'bg-gradient-to-br from-blue-500/10 to-transparent' : 'bg-gradient-to-br from-blue-400/10 to-transparent'
        }`} />

      {/* Top Header / Tab Bar */}
      <header className="relative z-30 w-full max-w-5xl mx-auto px-4 sm:px-6 py-2.5 sm:py-3.5 flex items-center justify-between shrink-0">
        {/* Left: Brand */}
        <div className="flex items-center gap-2.5">
          <BrandLogo variant="wordmark" size={34} />
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Acoustic Theme Toggle Button */}
          <ThemeToggle />

          {/* Backend Server Status Pill */}
          <button
            type="button"
            onClick={handleOpenConfigModal}
            className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[11px] font-mono backdrop-blur-md transition-all cursor-pointer ${backendStatus === 'connected'
                ? (isDark ? 'bg-[var(--kt-s1)]/90 border-emerald-500/30 text-emerald-400 hover:border-emerald-500/60' : 'bg-white border-emerald-500/40 text-emerald-700 shadow-2xs')
                : backendStatus === 'checking'
                  ? (isDark ? 'bg-[var(--kt-s1)]/90 border-amber-500/30 text-amber-400 hover:border-amber-500/60' : 'bg-white border-amber-500/40 text-amber-700 shadow-2xs')
                  : 'bg-rose-950/40 border-rose-500/50 text-rose-300 hover:border-rose-500 hover:bg-rose-900/50 animate-pulse'
              }`}
            title="Click to view or change Backend Server API URL"
          >
            {backendStatus === 'connected' ? (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            ) : backendStatus === 'checking' ? (
              <RotateCw size={10} className="animate-spin text-amber-400" />
            ) : (
              <AlertCircle size={11} className="text-rose-400" />
            )}
            <span>{backendStatus === 'connected' ? `Server Live${backendLatency ? ` (${backendLatency}ms)` : ''}` : 'Server Offline'}</span>
          </button>

          {/* Return to Home / Studio Button */}
          {onBackToHome && (
            <button
              type="button"
              onClick={handleDismiss}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all shadow-xs backdrop-blur-md cursor-pointer ${isDark
                  ? 'border-[var(--kt-s4)] bg-[var(--kt-s1)]/90 hover:bg-[var(--kt-s3)] hover:border-[var(--kt-accent)]/40 text-slate-300 hover:text-white'
                  : 'border-slate-200 bg-white hover:bg-slate-50 hover:border-blue-500/40 text-slate-700 hover:text-slate-900'
                }`}
              title="Return to Home Landing Page (Esc)"
            >
              <ArrowLeft size={13} className={isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'} />
              <span>Back</span>
            </button>
          )}
        </div>
      </header>

      {/* Main Split-Screen Card Canvas */}
      <main className="relative z-20 w-full max-w-5xl mx-auto px-4 my-auto py-2 sm:py-3 flex justify-center items-center">
        <div className={`w-full border rounded-3xl overflow-hidden shadow-2xl flex flex-col lg:flex-row transition-all duration-300 ${isDark
            ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)]'
            : 'bg-white border-slate-200/90 shadow-slate-200/60'
          } ${isClosing ? 'animate-mac-squish-exit' : 'animate-mac-squish'}`}>
          {/* Left Column: Interactive Form & Tab Switcher */}
          <div className="w-full lg:w-[54%] flex flex-col justify-between p-5 sm:p-7 xl:p-8">
            {/* Top Navigation Tabs for Login vs Signup */}
            {(view === 'login' || view === 'signup') && (
              <div className={`inline-flex p-1 rounded-xl border mb-3 self-start ${
                isDark ? 'bg-[var(--kt-s0)] border-[var(--kt-s4)]' : 'bg-slate-100 border-slate-200'
              }`}>
                <button
                  type="button"
                  onClick={() => {
                    setLoginSuccessMsg('');
                    setView('login');
                    if (window.history.pushState && window.location.pathname !== '/login') {
                      window.history.pushState({ tool: null, auth: 'login' }, '', '/login');
                    }
                  }}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${view === 'login'
                      ? (isDark ? 'bg-[var(--kt-accent)] text-black shadow-xs font-bold' : 'bg-white text-blue-700 shadow-sm border border-slate-200/80 font-bold')
                      : (isDark ? 'text-slate-400 hover:text-white font-medium' : 'text-slate-600 hover:text-slate-900 font-medium')
                    }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoginSuccessMsg('');
                    setView('signup');
                    if (window.history.pushState && window.location.pathname !== '/signup') {
                      window.history.pushState({ tool: null, auth: 'signup' }, '', '/signup');
                    }
                  }}
                  className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${view === 'signup'
                      ? (isDark ? 'bg-[var(--kt-accent)] text-black shadow-xs font-bold' : 'bg-white text-blue-700 shadow-sm border border-slate-200/80 font-bold')
                      : (isDark ? 'text-slate-400 hover:text-white font-medium' : 'text-slate-600 hover:text-slate-900 font-medium')
                    }`}
                >
                  Create Account
                </button>
              </div>
            )}

            {/* Form View Content */}
            {view === 'login' && (
              <LoginPage
                embedded={true}
                onSwitchToSignup={() => {
                  setLoginSuccessMsg('');
                  setView('signup');
                  if (window.history.pushState) window.history.pushState({ tool: null, auth: 'signup' }, '', '/signup');
                }}
                onSwitchToForgotPassword={() => { setLoginSuccessMsg(''); setView('forgot'); }}
                onOpenBackendSettings={handleOpenConfigModal}
                initialSuccessMsg={loginSuccessMsg}
              />
            )}
            {view === 'signup' && (
              <SignupPage
                embedded={true}
                onSwitchToLogin={() => {
                  setView('login');
                  if (window.history.pushState) window.history.pushState({ tool: null, auth: 'login' }, '', '/login');
                }}
              />
            )}
            {view === 'forgot' && (
              <ForgotPasswordPage embedded={true} onSwitchToLogin={() => setView('login')} />
            )}
            {view === 'verify' && (
              <VerifyEmailPage
                token={urlToken}
                onVerified={() => handleCleanUrlAndLogin('Email verified successfully! You can now sign in.')}
              />
            )}
            {view === 'reset' && (
              <ResetPasswordPage
                embedded={true}
                token={urlToken}
                onPasswordResetSuccess={() => handleCleanUrlAndLogin('Password updated successfully! You can now sign in with your new password.')}
              />
            )}
          </div>

          {/* Right Column: Acoustic Studio Artwork Showcase */}
          <AuthSplitVisual activeView={view} />
        </div>
      </main>

      {/* Footer Branding */}
      <footer className="relative z-30 w-full text-center py-3 text-[11px] font-mono text-slate-500 shrink-0">
        Lower Third &copy; {new Date().getFullYear()} &middot; Verbatim Audio Intelligence
      </footer>



      {/* Backend Server Configuration Modal (Accessible Pre-Login) */}
      {backendModalOpen && (
        <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn ${
          isDark ? 'bg-black/70' : 'bg-slate-900/40'
        }`}>
          <div
            onClick={(e) => e.stopPropagation()}
            className={`w-full max-w-md rounded-2xl p-5 sm:p-6 shadow-2xl relative text-left border transition-all ${
              isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)]' : 'bg-white border-slate-200 shadow-2xl'
            }`}
          >
            <div className={`flex items-center justify-between pb-3 border-b ${isDark ? 'border-[var(--kt-s4)]' : 'border-slate-200'}`}>
              <div className="flex items-center gap-2">
                <div className={`p-2 rounded-xl border ${
                  isDark ? 'bg-[var(--kt-accent)]/10 border-[var(--kt-accent)]/20 text-[var(--kt-accent)]' : 'bg-blue-50 border-blue-200 text-blue-600'
                }`}>
                  <Server size={18} />
                </div>
                <div>
                  <h3 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Backend Server Setup</h3>
                  <p className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Configure where the app connects for API & Login OTP</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBackendModalOpen(false)}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                  isDark ? 'text-slate-400 hover:text-white hover:bg-[var(--kt-s3)]' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <X size={16} />
              </button>
            </div>

            <div className="my-4 space-y-3">
              <div>
                <label className={`block text-[11px] font-semibold uppercase tracking-wider mb-1.5 ${
                  isDark ? 'text-slate-300' : 'text-slate-800 font-bold'
                }`}>
                  Backend API URL
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    placeholder="e.g. http://localhost:8001 or https://api.myserver.com"
                    className={`flex-1 rounded-xl px-3 py-2 text-xs font-mono outline-none border transition-all ${
                      isDark 
                        ? 'bg-[var(--kt-s0)] border-[var(--kt-s4)] focus:border-[var(--kt-accent)] text-white placeholder-slate-600' 
                        : 'bg-white border-slate-300 focus:border-blue-600 focus:ring-1 focus:ring-blue-600/30 text-slate-900 placeholder-slate-400 font-medium'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={handleTestUrl}
                    disabled={isTesting}
                    className={`px-3 py-2 rounded-xl border text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 ${
                      isDark 
                        ? 'border-[var(--kt-s4)] bg-[var(--kt-s3)] hover:bg-[var(--kt-s3)] text-slate-300 hover:text-white' 
                        : 'border-slate-300 bg-slate-100 hover:bg-slate-200 text-slate-800 hover:text-slate-900 shadow-2xs font-semibold'
                    }`}
                  >
                    {isTesting ? <RotateCw size={12} className={isDark ? "animate-spin text-[var(--kt-accent)]" : "animate-spin text-blue-600"} /> : <Wifi size={12} className={isDark ? "text-slate-300" : "text-slate-700"} />}
                    <span>Test</span>
                  </button>
                </div>
              </div>

              {/* Quick Select Preset Buttons */}
              <div>
                <span className={`text-[10px] font-semibold uppercase tracking-wider block mb-1 ${
                  isDark ? 'text-slate-400' : 'text-slate-600 font-semibold'
                }`}>
                  Quick Port Switch
                </span>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setInputUrl('http://localhost:8001');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium border transition-colors cursor-pointer ${
                      inputUrl === 'http://localhost:8001'
                        ? (isDark ? 'border-[var(--kt-accent)]/50 bg-[var(--kt-accent)]/15 text-[var(--kt-accent)] font-bold' : 'border-blue-600 bg-blue-50 text-blue-700 font-bold shadow-xs')
                        : (isDark ? 'border-[var(--kt-s4)] bg-[var(--kt-s0)] text-slate-300 hover:text-[var(--kt-accent)]' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 font-medium')
                    }`}
                  >
                    Port 8001 (Active)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setInputUrl('http://localhost:8000');
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium border transition-colors cursor-pointer ${
                      inputUrl === 'http://localhost:8000'
                        ? (isDark ? 'border-[var(--kt-accent)]/50 bg-[var(--kt-accent)]/15 text-[var(--kt-accent)] font-bold' : 'border-blue-600 bg-blue-50 text-blue-700 font-bold shadow-xs')
                        : (isDark ? 'border-[var(--kt-s4)] bg-[var(--kt-s0)] text-slate-300 hover:text-[var(--kt-accent)]' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900 font-medium')
                    }`}
                  >
                    Port 8000
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      setIsTesting(true);
                      const detected = await detectAndSelectLiveBackend();
                      setInputUrl(detected);
                      const res = await testBackendHealth(detected);
                      setTestResult(res);
                      setIsTesting(false);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium border transition-colors cursor-pointer flex items-center gap-1 ${
                      isDark 
                        ? 'border-[var(--kt-accent)]/30 bg-[var(--kt-accent)]/10 text-[var(--kt-accent)] hover:bg-[var(--kt-accent)]/20' 
                        : 'border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100 font-semibold'
                    }`}
                  >
                    <RotateCw size={10} />
                    <span>Auto-Detect Port</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const envUrl = cleanUrl(import.meta.env.VITE_API_URL);
                      setInputUrl(envUrl || (isLocalhostHost() ? 'http://localhost:8001' : ''));
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-medium border transition-colors cursor-pointer ${
                      isDark 
                        ? 'border-[var(--kt-s4)] bg-[var(--kt-s0)] text-slate-400 hover:text-slate-200' 
                        : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900 font-semibold shadow-xs'
                    }`}
                  >
                    Reset Default
                  </button>
                </div>
              </div>

              {/* Live Test Feedback Banner */}
              {testResult && (
                <div
                  className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${testResult.ok
                      ? (isDark ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-300' : 'bg-emerald-50 border-emerald-300 text-emerald-800')
                      : (isDark ? 'bg-rose-950/30 border-rose-500/40 text-rose-300' : 'bg-rose-50 border-rose-300 text-rose-800')
                    }`}
                >
                  {testResult.ok ? (
                    <CheckCircle2 size={16} className={`${isDark ? 'text-emerald-400' : 'text-emerald-600'} shrink-0 mt-0.5`} />
                  ) : (
                    <AlertCircle size={16} className={`${isDark ? 'text-rose-400' : 'text-rose-600'} shrink-0 mt-0.5`} />
                  )}
                  <div className="space-y-0.5">
                    <p className="font-semibold">
                      {testResult.ok ? 'Connection Successful!' : 'Connection Failed'}
                    </p>
                    <p className="text-[11px] opacity-90">
                      {testResult.ok
                        ? `Backend responsive in ${testResult.latencyMs}ms. Version: ${testResult.data?.version || '1.0.0'}`
                        : `Could not reach ${inputUrl || '(relative URL)'}: ${testResult.error || 'Server not responding'}`}
                    </p>
                  </div>
                </div>
              )}
            </div>

            <div className={`pt-3 border-t flex items-center justify-end gap-2 ${isDark ? 'border-[var(--kt-s4)]' : 'border-slate-200'}`}>
              <button
                type="button"
                onClick={() => setBackendModalOpen(false)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
                  isDark ? 'text-slate-400 hover:text-white' : 'text-slate-700 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => handleApplyUrl(inputUrl)}
                className={`px-4 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  isDark 
                    ? 'bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black shadow-lg shadow-[var(--kt-accent)]/20' 
                    : 'bg-[#2563eb] hover:bg-[#1d4ed8] text-white shadow-md'
                }`}
              >
                <Check size={14} />
                <span>Save & Connect</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

