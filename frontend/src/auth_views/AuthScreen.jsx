import React, { useState, useEffect } from 'react';
import { ArrowLeft, X, Server, Settings, Check, RotateCw, AlertCircle, CheckCircle2, Wifi, WifiOff } from 'lucide-react';
import LoginPage from './LoginPage';
import BrandLogo from '../components/BrandLogo';
import SignupPage from './SignupPage';
import VerifyEmailPage from './VerifyEmailPage';
import ForgotPasswordPage from './ForgotPasswordPage';
import ResetPasswordPage from './ResetPasswordPage';
import AuthSplitVisual from './AuthSplitVisual';
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

  const switchTo = (next) => {
    setLoginSuccessMsg('');
    setView(next);
    if (window.history.pushState && window.location.pathname !== `/${next}`) {
      window.history.pushState({ tool: null, auth: next }, '', `/${next}`);
    }
  };

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !backendModalOpen) {
          handleDismiss();
        }
      }}
      className={`min-h-screen w-screen grid lg:grid-cols-[minmax(480px,1fr)_minmax(0,1.1fr)] bg-[var(--kt-s0)] text-[var(--kt-text)] transition-opacity duration-200 ${isClosing ? 'opacity-0' : 'opacity-100'}`}
      style={{ fontFamily: 'var(--kt-font-ui)' }}
    >
      {/* Form column */}
      <div className="relative flex flex-col min-h-screen overflow-y-auto">
        <header className="flex items-center justify-between gap-3 px-5 sm:px-10 pt-5">
          {onBackToHome ? (
            <button
              type="button"
              onClick={handleDismiss}
              className="group flex items-center gap-2 h-9 pl-2 pr-3 -ml-2 rounded-lg text-[13px] font-semibold text-[var(--kt-muted)] hover:text-white hover:bg-[var(--kt-s2)] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--kt-accent-soft)]"
              title="Back to home (Esc)"
            >
              <ArrowLeft size={15} className="group-hover:-translate-x-0.5 transition-transform" />
              <span>Home</span>
            </button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenConfigModal}
              className="flex items-center gap-2 h-9 px-3 rounded-full text-xs font-medium text-[var(--kt-muted)] hover:bg-[var(--kt-s2)] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--kt-accent-soft)]"
              title="Server connection settings"
              aria-label={backendStatus === 'connected' ? 'Server connected. Open connection settings' : backendStatus === 'checking' ? 'Checking server. Open connection settings' : 'Server offline. Open connection settings'}
            >
              {backendStatus === 'checking' ? (
                <RotateCw size={12} className="animate-spin text-amber-400" />
              ) : (
                <span className={`h-2 w-2 rounded-full ${backendStatus === 'connected' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.9)]' : 'bg-rose-400 animate-pulse'}`} />
              )}
              <span className="hidden sm:inline">{backendStatus === 'connected' ? `Server live${backendLatency ? `, ${backendLatency} ms` : ''}` : backendStatus === 'checking' ? 'Checking server' : 'Server offline'}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 flex items-center justify-center px-5 sm:px-10 py-8">
          <div className={`w-full max-w-[400px] ${isClosing ? 'animate-mac-squish-exit' : ''}`}>
            <div className="lg:hidden mb-7"><BrandLogo variant="wordmark" size={32} /></div>

            {(view === 'login' || view === 'signup') && (
              <div className="nx-seg mb-7" role="tablist" aria-label="Sign in or create account">
                <button type="button" role="tab" aria-selected={view === 'login'} onClick={() => switchTo('login')}>Sign in</button>
                <button type="button" role="tab" aria-selected={view === 'signup'} onClick={() => switchTo('signup')}>Create account</button>
              </div>
            )}

            {view === 'login' && (
              <LoginPage
                embedded={true}
                onSwitchToSignup={() => switchTo('signup')}
                onSwitchToForgotPassword={() => { setLoginSuccessMsg(''); setView('forgot'); }}
                onOpenBackendSettings={handleOpenConfigModal}
                initialSuccessMsg={loginSuccessMsg}
              />
            )}
            {view === 'signup' && (
              <SignupPage embedded={true} onSwitchToLogin={() => switchTo('login')} />
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
        </main>

        <footer className="px-5 sm:px-10 pb-5 text-xs text-[var(--kt-faint)]">
          Noun &copy; {new Date().getFullYear()} VerboLabs
        </footer>
      </div>

      {/* Brand panel */}
      <AuthSplitVisual activeView={view} />

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

