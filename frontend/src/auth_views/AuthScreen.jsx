import React, { useState, useEffect } from 'react';
import { ArrowLeft, X } from 'lucide-react';
import LoginPage from './LoginPage';
import SignupPage from './SignupPage';
import VerifyEmailPage from './VerifyEmailPage';
import ForgotPasswordPage from './ForgotPasswordPage';
import ResetPasswordPage from './ResetPasswordPage';
import CursorTrail from '../components/CursorTrail';

/**
 * Authentication Screen Overlay.
 * Allows dismissing via ESC key, clicking outside the card, or clicking the close buttons.
 * Fully responsive and styled in 100% pure Tailwind CSS.
 */
export default function AuthScreen({ onBackToHome, initialView = 'login' }) {
  const [view, setView] = useState(initialView); // 'login', 'signup', 'verify', 'forgot', 'reset'
  const [loginSuccessMsg, setLoginSuccessMsg] = useState('');
  const [urlToken, setUrlToken] = useState('');

  const [isClosing, setIsClosing] = useState(false);

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
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isClosing, onBackToHome]);

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
      const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
    }
    setLoginSuccessMsg(successMessage);
    setView('login');
  };

  return (
    <div
      onClick={(e) => {
        // If clicking directly on the backdrop outside the card
        if (e.target === e.currentTarget) {
          handleDismiss();
        }
      }}
      className={`min-h-screen max-h-screen w-screen flex items-center justify-center bg-[#0e0f12] p-4 sm:p-6 relative overflow-hidden select-none transition-opacity duration-200 ${
        isClosing ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {/* 3D Cursor Trail */}
      <CursorTrail />

      {/* Ambient background glow effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[350px] bg-gradient-to-tr from-[#00e5be]/10 to-[#00b4d8]/5 blur-[120px] pointer-events-none rounded-full" />
      <div className="absolute bottom-10 right-10 w-[350px] h-[250px] bg-gradient-to-br from-[#00c9ff]/8 to-transparent blur-[100px] pointer-events-none rounded-full" />

      {/* Top Left Home Button */}
      {onBackToHome && (
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute top-4 left-4 sm:top-6 sm:left-6 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#262734] bg-[#14151a]/90 hover:bg-[#1c1e26] hover:border-[#00e5be]/40 text-xs font-semibold text-slate-300 hover:text-white transition-all shadow-lg backdrop-blur-md cursor-pointer"
          title="Return to Home Landing Page (Esc)"
        >
          <ArrowLeft size={14} className="text-[#00e5be]" />
          <span>Home</span>
        </button>
      )}

      {/* Top Right Quick Close (ESC) Button */}
      {onBackToHome && (
        <button
          type="button"
          onClick={handleDismiss}
          className="absolute top-4 right-4 sm:top-6 sm:right-6 z-30 flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#262734] bg-[#14151a]/90 hover:bg-[#1c1e26] hover:border-rose-500/40 text-xs font-semibold text-slate-400 hover:text-rose-300 transition-all shadow-lg backdrop-blur-md cursor-pointer"
          title="Dismiss to Landing Page (Esc)"
        >
          <span>Close</span>
          <X size={14} />
        </button>
      )}

      {/* Card Content with macOS Tab Genie Spring Animation */}
      <div className={`relative z-20 w-full flex justify-center ${isClosing ? 'animate-mac-squish-exit' : 'animate-mac-squish'}`}>
        {view === 'login' && (
          <LoginPage
            onSwitchToSignup={() => { setLoginSuccessMsg(''); setView('signup'); }}
            onSwitchToForgotPassword={() => { setLoginSuccessMsg(''); setView('forgot'); }}
            initialSuccessMsg={loginSuccessMsg}
          />
        )}
        {view === 'signup' && (
          <SignupPage onSwitchToLogin={() => setView('login')} />
        )}
        {view === 'forgot' && (
          <ForgotPasswordPage onSwitchToLogin={() => setView('login')} />
        )}
        {view === 'verify' && (
          <VerifyEmailPage
            token={urlToken}
            onVerified={() => handleCleanUrlAndLogin('Email verified successfully! You can now sign in.')}
          />
        )}
        {view === 'reset' && (
          <ResetPasswordPage
            token={urlToken}
            onPasswordResetSuccess={() => handleCleanUrlAndLogin('Password updated successfully! You can now sign in with your new password.')}
          />
        )}
      </div>
    </div>
  );
}
