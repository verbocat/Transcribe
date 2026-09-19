import React, { useState, useRef, useEffect } from 'react';
import { User, LogOut, ShieldCheck, ChevronDown, CheckCircle2, Clock, Sparkles } from 'lucide-react';

/**
 * Floating Account Menu & Status Dropdown.
 * Used across both Transcribe Studio and Subtitle Studio.
 * Styled in 100% pure Tailwind CSS.
 */
export default function AccountMenuDropdown({ user, onOpenLogoutModal }) {
  const [isOpen, setIsOpen] = useState(false);
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

  return (
    <div className="relative shrink-0" ref={dropdownRef}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 p-1 px-2 rounded-lg bg-[#14151a] hover:bg-[#1c1e26] border border-[#262734] hover:border-[#00e5be]/40 transition-all cursor-pointer shadow-xs text-slate-200"
        title="Account & Seat Status"
      >
        <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-[#00e5be] to-[#0099ff] text-black font-extrabold flex items-center justify-center text-[10px] shadow-xs">
          {initial}
        </div>
        <span className="text-xs font-semibold max-w-[90px] sm:max-w-[120px] truncate hidden sm:inline">
          {user.name || user.email?.split('@')[0]}
        </span>
        <ChevronDown size={12} className={`text-slate-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Floating Dropdown Menu */}
      {isOpen && (
        <div className="absolute right-0 mt-2 w-72 bg-[#14151a] border border-[#262734] rounded-xl shadow-[0_20px_45px_-10px_rgba(0,0,0,0.9),0_0_20px_rgba(0,229,190,0.08)] z-50 p-3 select-none animate-mac-squish">
          {/* User Profile Header */}
          <div className="flex items-start gap-3 pb-3 border-b border-[#22232c]">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0284c7] to-[#2563eb] flex items-center justify-center text-white font-black text-sm shrink-0 shadow-md">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-white truncate">{user.name || 'VerboLabs Specialist'}</div>
              <div className="text-[11px] font-mono text-slate-400 truncate">{user.email}</div>
              {user.operating_location && (
                <div className="mt-1 inline-flex items-center px-1.5 py-0.2 rounded text-[9px] font-medium bg-[#1e202a] text-[#00e5be] border border-[#262734]">
                  {user.operating_location === 'In Office' ? '🏢 In Office' : '🏠 Remote'}
                </div>
              )}
            </div>
          </div>

          {/* Account Status Indicator */}
          <div className="my-2.5 p-2.5 rounded-lg bg-[#0e0f12] border border-[#262734]">
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-slate-400 font-medium">Account Status</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-400 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Active Seat
              </span>
            </div>
            <div className="text-[10px] text-slate-500">
              Verified Enterprise @verbolabs.com
            </div>
          </div>

          {/* Placeholder for future Account Status features */}
          <div className="py-1">
            <button
              type="button"
              disabled
              className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 bg-transparent flex items-center justify-between opacity-70 cursor-not-allowed"
            >
              <div className="flex items-center gap-2">
                <ShieldCheck size={14} className="text-[#00e5be]" />
                <span>Account & Seat Settings</span>
              </div>
              <span className="text-[9px] font-bold font-mono px-1.5 py-0.2 rounded bg-[#1e202a] text-[#00c9ff] border border-[#262734]">
                Soon
              </span>
            </button>
          </div>

          {/* Sign Out Button */}
          <div className="pt-2 border-t border-[#22232c]">
            <button
              type="button"
              onClick={() => {
                setIsOpen(false);
                if (onOpenLogoutModal) onOpenLogoutModal();
              }}
              className="w-full text-left px-2.5 py-2 rounded-lg text-xs font-semibold text-rose-400 hover:text-rose-200 hover:bg-rose-500/10 transition-colors cursor-pointer flex items-center gap-2"
            >
              <LogOut size={14} />
              <span>Sign Out</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
