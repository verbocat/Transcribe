import React, { useState, useRef, useEffect } from 'react';
import {
  User, LogOut, ShieldCheck, ChevronDown, CheckCircle2, Clock,
  Sparkles, Settings, BookOpen, UserCog
} from 'lucide-react';
import UserProfileModal from './UserProfileModal';

/**
 * Floating Account Menu & Status Dropdown.
 * Used across both Transcribe Studio and Subtitle Studio.
 * Now includes direct access to Profile editing, Studio Settings, and User Manual.
 */
export default function AccountMenuDropdown({ user, onOpenLogoutModal, compact = false }) {
  const [isOpen, setIsOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [profileModalTab, setProfileModalTab] = useState('profile');
  const dropdownRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  if (!user) return null;

  const initial = user.name ? user.name.charAt(0).toUpperCase() : (user.email ? user.email.charAt(0).toUpperCase() : 'U');

  const openModalWithTab = (tab) => {
    setProfileModalTab(tab);
    setProfileModalOpen(true);
    setIsOpen(false);
  };

  return (
    <>
      <div className="relative shrink-0" ref={dropdownRef}>
        {/* Trigger Button */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className={`flex items-center gap-1.5 h-8 ${compact ? 'px-1.5' : 'px-2.5'} rounded-lg bg-[var(--kt-s1)] hover:bg-[var(--kt-s3)] border border-[var(--kt-s4)] hover:border-[var(--kt-accent)]/40 transition-all cursor-pointer shadow-xs text-slate-200`}
          title={compact ? `${user.name || user.email || 'Account'} · Account & Seat Status` : 'Account & Seat Status'}
          aria-label="Account menu"
        >
          <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-[var(--kt-accent)] to-[var(--kt-accent)] text-[var(--kt-accent-ink)] font-extrabold flex items-center justify-center text-[10px] shadow-xs">
            {initial}
          </div>
          {!compact && (
            <span className="text-xs font-semibold max-w-[90px] sm:max-w-[120px] truncate hidden sm:inline">
              {user.name || user.email?.split('@')[0]}
            </span>
          )}
          {!compact && <ChevronDown size={12} className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />}
        </button>

        {/* Floating Dropdown Menu */}
        {isOpen && (
          <div className="absolute right-0 mt-2 w-72 bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-2xl shadow-[0_24px_50px_-10px_rgba(0,0,0,0.95),0_0_20px_rgba(var(--kt-accent-rgb),0.08)] z-50 p-3 select-none animate-in fade-in zoom-in-95 duration-150">
            {/* User Profile Header */}
            <div className="flex items-start gap-3 pb-3 border-b border-[var(--kt-s3)]">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0284c7] to-[#2563eb] flex items-center justify-center text-white font-black text-sm shrink-0 shadow-md">
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-white truncate">{user.name || 'Studio Specialist'}</div>
                <div className="text-[11px] font-mono text-slate-400 truncate">{user.email}</div>
              </div>
            </div>

            {/* Account Status Indicator */}
            <div className="my-2.5 p-2.5 rounded-xl bg-[var(--kt-s0)] border border-[var(--kt-s3)]">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-slate-400 font-medium">Account Status</span>
                {user.is_verified === false ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-400 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    Pending Verification
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 font-mono">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Active Seat
                  </span>
                )}
              </div>
              <div className="text-[10px] text-slate-400 flex items-center justify-between">
                <span>{user.is_admin ? 'Super Administrator' : 'Production Member'}</span>
                <span className="font-mono text-[9px] text-slate-500">@{user.email?.split('@')[1] || 'domain'}</span>
              </div>
            </div>

            {/* Standard Profile Navigation Items */}
            <div className="space-y-0.5 py-1">
              <button
                type="button"
                onClick={() => openModalWithTab('profile')}
                className="w-full text-left px-2.5 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-[var(--kt-s3)] flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <UserCog size={14} className="text-[var(--kt-accent)]" />
                <span>Edit Profile</span>
              </button>

              <button
                type="button"
                onClick={() => openModalWithTab('settings')}
                className="w-full text-left px-2.5 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-[var(--kt-s3)] flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <Settings size={14} className="text-blue-400" />
                <span>Preferences & Settings</span>
              </button>

              <button
                type="button"
                onClick={() => openModalWithTab('manual')}
                className="w-full text-left px-2.5 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white hover:bg-[var(--kt-s3)] flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <BookOpen size={14} className="text-amber-400" />
                <span>User Manual & Shortcuts</span>
              </button>
            </div>

            {/* Admin Command Center Link - STRICTLY RESERVED FOR SUPER ADMIN */}
            {Boolean(
              user?.is_admin &&
              user?.email &&
              (user.email.toLowerCase() === 'arpit.purohit@verbolabs.com' ||
               user.email.toLowerCase() === 'arpit.purohit@verbolab.com')
            ) && (
              <div className="pt-1.5 pb-1 border-t border-[var(--kt-s3)] mt-1">
                <button
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    if (typeof window !== 'undefined') {
                      window.history.pushState({ tool: 'admin' }, '', '/admin');
                      window.dispatchEvent(new PopStateEvent('popstate'));
                    }
                  }}
                  className="w-full text-left px-2.5 py-2 rounded-xl text-xs font-semibold text-[var(--kt-accent)] bg-[var(--kt-accent)]/10 hover:bg-[var(--kt-accent)]/20 border border-[var(--kt-accent)]/30 flex items-center justify-between transition-all cursor-pointer shadow-xs"
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={14} className="text-[var(--kt-accent)]" />
                    <span>Admin Command Center</span>
                  </div>
                  <span className="text-[9px] font-bold font-mono px-1.5 py-0.2 rounded bg-[var(--kt-accent)]/20 text-[var(--kt-accent)]">
                    LIVE
                  </span>
                </button>
              </div>
            )}

            {/* Sign Out Button */}
            <div className="pt-2 border-t border-[var(--kt-s3)] mt-1">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  if (onOpenLogoutModal) onOpenLogoutModal();
                }}
                className="w-full text-left px-2.5 py-2 rounded-xl text-xs font-semibold text-rose-400 hover:text-rose-200 hover:bg-rose-500/10 transition-colors cursor-pointer flex items-center gap-2"
              >
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* User Profile, Settings, & Manual Modal */}
      <UserProfileModal
        isOpen={profileModalOpen}
        initialTab={profileModalTab}
        onClose={() => setProfileModalOpen(false)}
      />
    </>
  );
}
