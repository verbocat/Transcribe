import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Bell, BellOff, Check, CheckCheck, MessageSquare, AlertTriangle,
  Info, AlertOctagon, X, Trash2, VolumeX, Volume2
} from 'lucide-react';
import { API_BASE } from '../config';
import { useAuth } from '../auth_views/AuthContext';
import { useTheme } from '../context/ThemeContext';

export default function NotificationBellDropdown() {
  const { token } = useAuth();
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isMuted, setIsMuted] = useState(() => {
    return localStorage.getItem('verbolabs_notifications_muted') === 'true';
  });
  const dropdownRef = useRef(null);

  const effectiveToken = token || localStorage.getItem('verbolabs_auth_token');

  const fetchNotifications = useCallback(async () => {
    if (!effectiveToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/me/notifications`, {
        headers: {
          'Authorization': `Bearer ${effectiveToken}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setNotifications(data.notifications || []);
          setUnreadCount(data.unread_count || 0);
        }
      }
    } catch (err) {
      console.error('Failed to fetch user notifications:', err);
    }
  }, [effectiveToken]);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 25000);
    const onFocus = () => fetchNotifications();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchNotifications]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const toggleMute = () => {
    setIsMuted((prev) => {
      const next = !prev;
      localStorage.setItem('verbolabs_notifications_muted', String(next));
      return next;
    });
  };

  const markAsRead = async (notifId, e) => {
    if (e) e.stopPropagation();
    if (!effectiveToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/me/notifications/${notifId}/read`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${effectiveToken}`
        }
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === notifId ? { ...n, is_read: true } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  const dismissNotification = async (notifId, e) => {
    if (e) e.stopPropagation();
    // Optimistic local dismiss (no delete endpoint — just mark read and hide)
    const target = notifications.find((n) => n.id === notifId);
    setNotifications((prev) => prev.filter((n) => n.id !== notifId));
    if (target && !target.is_read) {
      setUnreadCount((prev) => Math.max(0, prev - 1));
      await markAsRead(notifId);
    }
  };

  const clearAllNotifications = async () => {
    // Optimistic local clear
    setNotifications([]);
    setUnreadCount(0);
    if (!effectiveToken) return;
    try {
      await fetch(`${API_BASE}/api/admin/me/notifications/read-all`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${effectiveToken}` }
      });
    } catch (err) {
      console.error('Failed to clear notifications:', err);
    }
  };

  const markAllAsRead = async () => {
    if (!effectiveToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/me/notifications/read-all`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${effectiveToken}` }
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
        setUnreadCount(0);
      }
    } catch (err) {
      console.error('Failed to mark all as read:', err);
    }
  };

  const getTypeStyle = (type) => {
    switch (type) {
      case 'warning':
        return {
          icon: <AlertTriangle size={12} className="text-amber-400" />,
          badge: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
          border: 'border-l-amber-500',
          label: 'Warning'
        };
      case 'quota_limit':
        return {
          icon: <AlertOctagon size={12} className="text-rose-400" />,
          badge: 'bg-rose-500/10 text-rose-300 border-rose-500/30',
          border: 'border-l-rose-500',
          label: 'Quota Alert'
        };
      case 'system':
      case 'notice':
        return {
          icon: <Info size={12} className="text-blue-400" />,
          badge: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
          border: 'border-l-blue-500',
          label: 'Notice'
        };
      default:
        return {
          icon: <MessageSquare size={12} className="text-[var(--kt-accent)]" />,
          badge: 'bg-[var(--kt-accent)]/10 text-[var(--kt-accent)] border-[var(--kt-accent)]/30',
          border: 'border-l-[var(--kt-accent)]',
          label: 'System'
        };
    }
  };

  return (
    <div className="relative shrink-0" ref={dropdownRef}>
      {/* Bell Button */}
      <button
        type="button"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen) fetchNotifications();
        }}
        className={`relative w-8 h-8 rounded-lg border transition-all cursor-pointer flex items-center justify-center ${
          unreadCount > 0 && !isMuted
            ? isDark
              ? 'bg-[var(--kt-s2)] border-[var(--kt-accent)]/40 text-[var(--kt-accent)] hover:border-[var(--kt-accent)] shadow-[0_0_15px_rgba(var(--kt-accent-rgb),0.18)]'
              : 'bg-blue-50 border-blue-400 text-blue-700 hover:border-blue-600 shadow-xs'
            : isDark
              ? 'bg-[var(--kt-s1)] hover:bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-400 hover:text-white'
              : 'bg-white hover:bg-slate-100 border-slate-300 text-slate-500 hover:text-slate-900 shadow-2xs'
        }`}
        title={
          isMuted
            ? 'Notifications Muted'
            : unreadCount > 0
            ? `${unreadCount} unread administrative notices`
            : 'Notifications'
        }
      >
        {isMuted ? <BellOff size={16} className={isDark ? 'text-slate-500' : 'text-slate-400'} /> : <Bell size={16} />}
        {unreadCount > 0 && !isMuted && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-gradient-to-r from-rose-500 to-amber-500 px-1 text-[9px] font-mono font-bold text-white shadow-md">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <div className={`absolute right-0 mt-2.5 w-[420px] max-w-[calc(100vw-2rem)] rounded-2xl shadow-2xl border z-[200] overflow-hidden select-none animate-in fade-in zoom-in-95 duration-150 ${
          isDark
            ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)] shadow-[0_24px_60px_rgba(0,0,0,0.85),0_0_1px_1px_rgba(255,255,255,0.05)]'
            : 'bg-white border-slate-200 shadow-[0_20px_50px_rgba(15,23,42,0.18)]'
        }`}>
          {/* Header Top Row */}
          <div className={`p-3.5 px-4 border-b flex items-center justify-between ${
            isDark ? 'bg-[var(--kt-s2)] border-[var(--kt-s3)]' : 'bg-slate-50 border-slate-200'
          }`}>
            <div className="flex items-center gap-2.5">
              <div className={`w-7 h-7 rounded-lg border flex items-center justify-center ${
                isDark ? 'bg-[var(--kt-accent)]/10 border-[var(--kt-accent)]/25 text-[var(--kt-accent)]' : 'bg-blue-50 border-blue-200 text-blue-600'
              }`}>
                <Bell size={14} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className={`font-semibold text-xs tracking-wide ${
                    isDark ? 'text-white' : 'text-slate-900'
                  }`}>Notifications</span>
                  {unreadCount > 0 ? (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                      isDark ? 'bg-[var(--kt-accent)]/15 text-[var(--kt-accent)] border-[var(--kt-accent)]/30' : 'bg-blue-50 text-blue-700 border-blue-200'
                    }`}>
                      {unreadCount} unread
                    </span>
                  ) : (
                    <span className={`text-[10px] font-mono ${
                      isDark ? 'text-slate-500' : 'text-slate-400'
                    }`}>up to date</span>
                  )}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className={`p-1 rounded-lg transition-colors cursor-pointer ${
                isDark ? 'text-slate-400 hover:text-white hover:bg-[var(--kt-s3)]' : 'text-slate-400 hover:text-slate-900 hover:bg-slate-100'
              }`}
              title="Close"
            >
              <X size={15} />
            </button>
          </div>

          {/* Action Toolbar Row */}
          <div className={`px-4 py-2 border-b flex items-center justify-between gap-2 text-xs ${
            isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s3)]' : 'bg-slate-50 border-slate-200'
          }`}>
            {/* Mute Toggle */}
            <button
              type="button"
              onClick={toggleMute}
              className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                isMuted
                  ? 'text-amber-600 bg-amber-50 border border-amber-300'
                  : isDark
                    ? 'text-slate-400 hover:text-slate-200 hover:bg-[var(--kt-s3)] border border-transparent'
                    : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100 border border-transparent'
              }`}
              title={isMuted ? 'Unmute notification sounds & alerts' : 'Mute notification sounds & alerts'}
            >
              {isMuted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              <span>{isMuted ? 'Muted' : 'Mute'}</span>
            </button>

            <div className="flex items-center gap-2">
              {/* Mark All Read */}
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={markAllAsRead}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer flex items-center gap-1.5 ${
                    isDark
                      ? 'text-[var(--kt-accent)] hover:bg-[var(--kt-accent)]/10 border-[var(--kt-accent)]/20'
                      : 'text-blue-700 hover:bg-blue-50 border-blue-200'
                  }`}
                >
                  <CheckCheck size={13} />
                  <span>Mark all read</span>
                </button>
              )}

              {/* Clear All Button */}
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={clearAllNotifications}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border border-transparent transition-colors cursor-pointer flex items-center gap-1 ${
                    isDark
                      ? 'text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 hover:border-rose-500/20'
                      : 'text-slate-500 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200'
                  }`}
                  title="Clear all notices"
                >
                  <Trash2 size={12} />
                  <span>Clear All</span>
                </button>
              )}
            </div>
          </div>

          {/* List */}
          <div className={`max-h-[380px] overflow-y-auto divide-y ${
            isDark ? 'divide-[var(--kt-s2)]' : 'divide-slate-100'
          }`}>
            {notifications.length === 0 ? (
              <div className={`p-8 text-center text-xs flex flex-col items-center gap-2.5 ${
                isDark ? 'text-slate-400' : 'text-slate-500'
              }`}>
                <div className={`w-11 h-11 rounded-2xl border flex items-center justify-center shadow-inner ${
                  isDark ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-500' : 'bg-slate-100 border-slate-200 text-slate-400'
                }`}>
                  <Bell size={20} />
                </div>
                <div className={`font-semibold text-sm ${
                  isDark ? 'text-slate-200' : 'text-slate-800'
                }`}>All caught up!</div>
                <div className={`text-[11.5px] max-w-[260px] leading-relaxed ${
                  isDark ? 'text-slate-400' : 'text-slate-500'
                }`}>
                  No new administrative feedback, quota alerts, or workspace updates right now.
                </div>
              </div>
            ) : (
              notifications.map((notif) => {
                const style = getTypeStyle(notif.notification_type);
                const isUnread = !notif.is_read;
                return (
                  <div
                    key={notif.id}
                    className={`p-4 transition-all relative group border-l-2 ${
                      isUnread
                        ? `${style.border} bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)]`
                        : 'border-l-transparent bg-[var(--kt-s0)] hover:bg-[var(--kt-s1)] opacity-80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 mb-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wider border flex items-center gap-1.5 ${style.badge}`}>
                          {style.icon}
                          <span>{style.label}</span>
                        </span>
                        {isUnread && (
                          <span className="w-2 h-2 rounded-full bg-[var(--kt-accent)] shadow-[0_0_8px_var(--kt-accent)]" />
                        )}
                        <span className="text-[11px] font-mono text-slate-400">
                          {notif.created_at ? new Date(notif.created_at).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                        </span>
                      </div>

                      {/* Top Right Controls: Read & Dismiss Cross */}
                      <div className="flex items-center gap-1.5">
                        {isUnread && (
                          <button
                            type="button"
                            onClick={(e) => markAsRead(notif.id, e)}
                            className="text-[11px] text-slate-400 hover:text-[var(--kt-accent)] cursor-pointer flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] border border-[var(--kt-s4)] transition-colors"
                            title="Mark as read"
                          >
                            <Check size={12} />
                            <span>Read</span>
                          </button>
                        )}
                        {/* Dismiss Cross (X) */}
                        <button
                          type="button"
                          onClick={(e) => dismissNotification(notif.id, e)}
                          className="text-slate-400 hover:text-rose-400 p-1 rounded-md hover:bg-rose-500/10 transition-colors cursor-pointer"
                          title="Dismiss notification"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="font-semibold text-xs text-white mb-1.5 leading-snug">
                      {notif.title}
                    </div>
                    <div className="text-[12px] text-slate-300 whitespace-pre-wrap leading-relaxed">
                      {notif.message}
                    </div>
                    <div className="mt-2.5 pt-2 border-t border-[var(--kt-s3)] text-[10.5px] text-slate-400 flex items-center justify-between font-mono">
                      <span>Source: {notif.admin_email || 'Super Admin'}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
