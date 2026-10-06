import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Activity, Users, Film, PlayCircle, DollarSign, Cpu, HardDrive, RefreshCw,
  Search, Shield, ShieldAlert, ShieldCheck, CheckCircle2, XCircle, AlertTriangle,
  Clock, ArrowLeft, ArrowUpRight, Ban, UserCheck, LogOut, Terminal, Eye, Layers, Sparkles,
  Sliders, MessageSquare, Send, Volume2, FileDown, Settings, Check, Mail, Bell, X,
  ChevronLeft, ChevronRight, ArrowUpDown, ChevronDown, Filter
} from 'lucide-react';
import { API_BASE } from '../../config';
import { useAuth } from '../../auth_views/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import ThemeToggle from '../ThemeToggle';

export default function AdminDashboard({ onBackToStudio, user: currentUser, onLogout }) {
  const { user: authUser, token } = useAuth();
  const { isDark } = useTheme();
  const user = currentUser || authUser;
  const [activeTab, setActiveTab] = useState('overview'); // overview, users, hardware
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [overview, setOverview] = useState(null);
  const [hardwareLive, setHardwareLive] = useState(null);
  const [hardwareHistory, setHardwareHistory] = useState([]);
  
  // Users state
  const [usersList, setUsersList] = useState([]);
  const [userSearch, setUserSearch] = useState('');
  const [userFilterTab, setUserFilterTab] = useState('active'); // 'active' | 'pending' | 'restricted' | 'all'
  const [selectedUserDossier, setSelectedUserDossier] = useState(null);
  const [isDossierLoading, setIsDossierLoading] = useState(false);

  // Outer Sorting & Pagination state
  const [outerSortBy, setOuterSortBy] = useState('name_asc'); // name_asc, name_desc, tokens_desc, tokens_asc, duration_desc, duration_asc, uploads_desc, uploads_asc, cost_desc, cost_asc
  const [pageSize, setPageSize] = useState(10); // 10, 20, 50, 100 users per page
  const [currentPage, setCurrentPage] = useState(1);

  // Inner Dossier Modal state
  const [innerTab, setInnerTab] = useState('productions'); // 'productions' | 'sessions' | 'logins'
  const [innerSortBy, setInnerSortBy] = useState('rerun_desc'); // rerun_desc, video_length_desc, video_length_asc, tokens_desc, tokens_asc, title_asc, cost_desc, date_desc
  const [innerSearch, setInnerSearch] = useState('');
  const [innerStatusFilter, setInnerStatusFilter] = useState('all');

  // Quota & Permissions Modal state
  const [editingLimitsUser, setEditingLimitsUser] = useState(null);
  const [limitsQuota, setLimitsQuota] = useState(-1);
  const [limitsBudget, setLimitsBudget] = useState(50.0);
  const [limitsCanExport, setLimitsCanExport] = useState(true);
  const [limitsCanAiOptimize, setLimitsCanAiOptimize] = useState(true);
  const [limitsCanAudioPeaks, setLimitsCanAudioPeaks] = useState(true);
  const [isSavingLimits, setIsSavingLimits] = useState(false);

  // In-App Feedback & Notice Modal state
  const [feedbackUser, setFeedbackUser] = useState(null);
  const [feedbackTitle, setFeedbackTitle] = useState('');
  const [feedbackMessage, setFeedbackMessage] = useState('');
  const [feedbackType, setFeedbackType] = useState('feedback');
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);
  const [feedbackSuccessMsg, setFeedbackSuccessMsg] = useState('');

  // Uploads state
  const [uploadsList, setUploadsList] = useState([]);
  const [uploadSearch, setUploadSearch] = useState('');

  // Generations state
  const [runsList, setRunsList] = useState([]);
  const [runStatusFilter, setRunStatusFilter] = useState('');

  // Auto-refresh timer
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRefreshedAt, setLastRefreshedAt] = useState(new Date());

  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  };

  // ── User Management Actions ──
  const handleApproveWorkflow = async (targetUser) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${targetUser.id}/approve-workflow`, {
        method: 'POST',
        headers: authHeaders
      });
      const data = await res.json();
      if (data.success) {
        fetchUsers();
        if (selectedUserDossier && selectedUserDossier.user.id === targetUser.id) {
          openUserDossier(targetUser.id);
        }
      } else {
        alert(data.detail || 'Failed to approve user into active workflow');
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const handlePermitUser = async (targetUser) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${targetUser.id}/status`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ is_blocked: false, is_verified: true })
      });
      const data = await res.json();
      if (data.success) {
        fetchUsers();
        if (selectedUserDossier && selectedUserDossier.user.id === targetUser.id) {
          openUserDossier(targetUser.id);
        }
      } else {
        alert(data.detail || 'Failed to permit user access');
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const handleRestrictUser = async (targetUser) => {
    if (!confirm(`Are you sure you want to restrict account access for ${targetUser.name || targetUser.email}?`)) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${targetUser.id}/status`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ is_blocked: true })
      });
      const data = await res.json();
      if (data.success) {
        fetchUsers();
        if (selectedUserDossier && selectedUserDossier.user.id === targetUser.id) {
          openUserDossier(targetUser.id);
        }
      } else {
        alert(data.detail || 'Failed to restrict user access');
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  // ── Fetch Overview & Live Hardware ──
  const fetchOverview = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/overview`, { headers: authHeaders });
      if (!res.ok) {
        if (res.status === 403) {
          setError('Access restricted: Enterprise Admin Command Center is reserved exclusively for the Super Administrator (Arpit Purohit).');
        } else {
          setError(`Server responded with status ${res.status}`);
        }
        return;
      }
      const data = await res.json();
      if (data.success) {
        setOverview(data.stats);
        setHardwareLive(data.stats.hardware);
        setError(null);
      }
    } catch (err) {
      setError(err.message || 'Failed to fetch admin overview');
    } finally {
      setIsLoading(false);
      setLastRefreshedAt(new Date());
    }
  }, [token]);

  // ── Fetch Users ──
  const fetchUsers = useCallback(async () => {
    try {
      const q = userSearch ? `?query=${encodeURIComponent(userSearch)}` : '';
      const res = await fetch(`${API_BASE}/api/admin/users${q}`, { headers: authHeaders });
      const data = await res.json();
      if (data.success) setUsersList(data.users || []);
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
  }, [token, userSearch]);

  // ── Fetch Uploads ──
  const fetchUploads = useCallback(async () => {
    try {
      const q = uploadSearch ? `?query=${encodeURIComponent(uploadSearch)}` : '';
      const res = await fetch(`${API_BASE}/api/admin/uploads${q}`, { headers: authHeaders });
      const data = await res.json();
      if (data.success) setUploadsList(data.uploads || []);
    } catch (err) {
      console.error('Failed to fetch uploads:', err);
    }
  }, [token, uploadSearch]);

  // ── Fetch Generation Runs ──
  const fetchRuns = useCallback(async () => {
    try {
      const q = runStatusFilter ? `?status_filter=${encodeURIComponent(runStatusFilter)}` : '';
      const res = await fetch(`${API_BASE}/api/admin/generations${q}`, { headers: authHeaders });
      const data = await res.json();
      if (data.success) setRunsList(data.runs || []);
    } catch (err) {
      console.error('Failed to fetch runs:', err);
    }
  }, [token, runStatusFilter]);

  // ── Fetch Hardware History ──
  const fetchHardwareHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/hardware/history?limit=30`, { headers: authHeaders });
      const data = await res.json();
      if (data.success) setHardwareHistory(data.history || []);
    } catch (err) {
      console.error('Failed to fetch hardware history:', err);
    }
  }, [token]);

  // Master refresh based on current tab
  const refreshCurrentView = useCallback(() => {
    fetchOverview();
    if (activeTab === 'users') fetchUsers();
    else if (activeTab === 'uploads') fetchUploads();
    else if (activeTab === 'generations') fetchRuns();
    else if (activeTab === 'hardware') fetchHardwareHistory();
  }, [activeTab, fetchOverview, fetchUsers, fetchUploads, fetchRuns, fetchHardwareHistory]);

  // Auto-refresh polling interval (every 8 seconds)
  useEffect(() => {
    refreshCurrentView();
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      refreshCurrentView();
    }, 8000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshCurrentView]);

  // ── User Management Actions ──
  const handleToggleBlock = async (targetUser) => {
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${targetUser.id}/status`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ is_blocked: !targetUser.is_blocked })
      });
      const data = await res.json();
      if (data.success) {
        fetchUsers();
        if (selectedUserDossier && selectedUserDossier.user.id === targetUser.id) {
          openUserDossier(targetUser.id);
        }
      } else {
        alert(data.detail || 'Failed to update user status');
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const handleKickSessions = async (targetUserId) => {
    if (!confirm('Terminate all active sessions for this user immediately?')) return;
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${targetUserId}/kick`, {
        method: 'POST',
        headers: authHeaders
      });
      const data = await res.json();
      alert(data.message || 'Sessions terminated.');
      fetchUsers();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  };

  const openUserDossier = async (userId) => {
    setIsDossierLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${userId}`, { headers: authHeaders });
      const data = await res.json();
      if (data.success) setSelectedUserDossier(data);
    } catch (e) {
      alert('Failed to load user dossier: ' + e.message);
    } finally {
      setIsDossierLoading(false);
    }
  };

  // ── Limits & Permissions Modal Handlers ──
  const handleOpenLimitsModal = (u) => {
    setEditingLimitsUser(u);
    setLimitsQuota(u.max_videos_quota !== undefined ? u.max_videos_quota : -1);
    setLimitsBudget(u.monthly_budget_usd !== undefined ? u.monthly_budget_usd : 50.0);
    setLimitsCanExport(u.can_export !== false);
    setLimitsCanAiOptimize(u.can_ai_optimize !== false);
    setLimitsCanAudioPeaks(u.can_audio_peaks !== false);
  };

  const handleSaveLimits = async (e) => {
    e.preventDefault();
    if (!editingLimitsUser) return;
    setIsSavingLimits(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${editingLimitsUser.id}/limits`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          max_videos_quota: parseInt(limitsQuota, 10),
          monthly_budget_usd: parseFloat(limitsBudget),
          can_export: limitsCanExport,
          can_ai_optimize: limitsCanAiOptimize,
          can_audio_peaks: limitsCanAudioPeaks
        })
      });
      const data = await res.json();
      if (data.success) {
        setEditingLimitsUser(null);
        fetchUsers();
        if (selectedUserDossier && selectedUserDossier.user.id === editingLimitsUser.id) {
          openUserDossier(editingLimitsUser.id);
        }
      } else {
        alert(data.detail || 'Failed to update user limits');
      }
    } catch (err) {
      alert('Error updating user limits: ' + err.message);
    } finally {
      setIsSavingLimits(false);
    }
  };

  // ── Feedback & In-App Notices Modal Handlers ──
  const handleOpenFeedbackModal = (u) => {
    setFeedbackUser(u);
    setFeedbackTitle('');
    setFeedbackMessage('');
    setFeedbackType('feedback');
    setFeedbackSuccessMsg('');
  };

  const handleSendFeedback = async (e) => {
    e.preventDefault();
    if (!feedbackUser || !feedbackTitle.trim() || !feedbackMessage.trim()) return;
    setIsSendingFeedback(true);
    try {
      const res = await fetch(`${API_BASE}/api/admin/users/${feedbackUser.id}/feedback`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          title: feedbackTitle.trim(),
          message: feedbackMessage.trim(),
          notification_type: feedbackType
        })
      });
      const data = await res.json();
      if (data.success) {
        setFeedbackSuccessMsg(`Notification successfully sent to ${feedbackUser.name || feedbackUser.email}!`);
        setTimeout(() => {
          setFeedbackUser(null);
          setFeedbackSuccessMsg('');
        }, 1200);
      } else {
        alert(data.detail || 'Failed to send feedback');
      }
    } catch (err) {
      alert('Error sending feedback: ' + err.message);
    } finally {
      setIsSendingFeedback(false);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col font-sans select-none transition-colors ${
      isDark ? 'bg-[var(--kt-s0)] text-slate-100' : 'bg-[#f8fafc] text-slate-900'
    }`} style={{ fontFamily: "'Segoe UI', 'Inter', -apple-system, BlinkMacSystemFont, Roboto, 'Google Sans', sans-serif" }}>
      {/* ── Top Bar ── */}
      <header className={`h-16 border-b px-5 flex items-center justify-between sticky top-0 z-40 backdrop-blur transition-colors ${
        isDark ? 'border-[var(--kt-s3)] bg-[var(--kt-s1)]/95 text-white' : 'border-slate-200 bg-white/95 text-slate-900 shadow-2xs'
      }`}>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black shrink-0 ${
              isDark 
                ? 'bg-gradient-to-tr from-[var(--kt-accent)] via-[var(--kt-info)] to-[#6366f1] text-black shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.35)]' 
                : 'bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-sm'
            }`}>
              <Shield size={18} />
            </div>
            <div>
              <div className={`text-xs font-black tracking-wider flex items-center gap-2 ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}>
                VERBOLABS ENTERPRISE
                <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold ${
                  isDark 
                    ? 'bg-[var(--kt-accent)]/15 text-[var(--kt-accent)] border border-[var(--kt-accent)]/30 shadow-xs' 
                    : 'bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs'
                }`}>
                  SUPER ADMIN COMMAND CENTER
                </span>
              </div>
              <div className={`text-[11px] font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Authenticated: <span className={`font-bold ${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'}`}>{user?.name || 'Arpit Purohit'}</span> ({user?.email || 'arpit.purohit@verbolabs.com'})
              </div>
            </div>
          </div>
        </div>

        {/* Live Hardware Status Pills & Controls in Header */}
        <div className="flex items-center gap-2.5">
          {hardwareLive && (
            <div className="hidden lg:flex items-center gap-2 text-[11px] font-mono">
              {/* Active SSE streams */}
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${
                isDark ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'
              }`}>
                <span className={`w-2 h-2 rounded-full ${hardwareLive.active_sse_streams > 0 ? (isDark ? 'bg-emerald-400 animate-pulse' : 'bg-emerald-500 animate-pulse') : 'bg-slate-400'}`} />
                <span>Active Streams:</span>
                <span className={`font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{hardwareLive.active_sse_streams}</span>
              </div>

              {/* CPU */}
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${
                isDark ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'
              }`}>
                <Cpu size={12} className={isDark ? "text-[var(--kt-accent)]" : "text-blue-600"} />
                <span>CPU:</span>
                <span className={`font-bold ${hardwareLive.cpu_percent > 80 ? 'text-rose-500' : (isDark ? 'text-slate-100' : 'text-slate-900')}`}>
                  {hardwareLive.cpu_percent}%
                </span>
              </div>

              {/* RAM */}
              <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${
                isDark ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-300' : 'bg-slate-100 border-slate-200 text-slate-700'
              }`}>
                <HardDrive size={12} className={isDark ? "text-[#0088ff]" : "text-indigo-600"} />
                <span>RAM:</span>
                <span className={`font-bold ${hardwareLive.memory_percent > 85 ? 'text-amber-500' : (isDark ? 'text-slate-100' : 'text-slate-900')}`}>
                  {hardwareLive.memory_percent}%
                </span>
              </div>
            </div>
          )}

          {/* Quick Studio Switcher Button */}
          <button
            onClick={onBackToStudio}
            className={`p-1.5 px-3 rounded-lg flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer active:scale-95 ${
              isDark 
                ? 'bg-[var(--kt-accent)]/15 hover:bg-[var(--kt-accent)]/25 text-[var(--kt-accent)] border border-[var(--kt-accent)]/40 shadow-[0_0_12px_rgba(var(--kt-accent-rgb),0.15)]' 
                : 'bg-blue-600 hover:bg-blue-700 text-white shadow-xs'
            }`}
            title="Launch Subtitle Studio workspace to test subtitle pipelines"
          >
            <Film size={14} />
            <span>Launch Subtitle Studio</span>
          </button>

          {/* Theme Toggle Button */}
          <ThemeToggle />

          {/* Refresh Controls */}
          <button
            onClick={refreshCurrentView}
            className={`p-1.5 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold border transition-all cursor-pointer shadow-xs ${
              isDark 
                ? 'bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] text-slate-300 hover:text-white border-[var(--kt-s4)]' 
                : 'bg-white hover:bg-slate-100 text-slate-700 hover:text-slate-900 border-slate-200'
            }`}
            title="Refresh Data"
          >
            <RefreshCw size={13} className={isLoading ? (isDark ? 'animate-spin text-[var(--kt-accent)]' : 'animate-spin text-blue-600') : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>

          {/* Logout button */}
          {onLogout && (
            <button
              onClick={onLogout}
              className={`p-1.5 px-2.5 rounded-lg border flex items-center gap-1.5 text-xs font-semibold transition-all cursor-pointer ${
                isDark 
                  ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30' 
                  : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
              }`}
              title="Sign Out"
            >
              <LogOut size={13} />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          )}
        </div>
      </header>

      {/* ── Sub-Nav Tabs ── */}
      <div className={`border-b px-4 flex items-center justify-between transition-colors ${
        isDark ? 'border-[var(--kt-s3)] bg-[var(--kt-s1)]' : 'border-slate-200 bg-white shadow-2xs'
      }`}>
        <div className="flex items-center gap-1 overflow-x-auto py-2">
          {[
            { id: 'overview', label: 'Command Center', icon: Activity },
            { id: 'users', label: 'User Production & Intelligence Directory', icon: Users, badge: overview?.users?.total },
            { id: 'hardware', label: 'Server Hardware & Health', icon: Cpu },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => { setActiveTab(tab.id); }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  isActive
                    ? (isDark ? 'bg-[var(--kt-accent)]/15 text-[var(--kt-accent)] border border-[var(--kt-accent)]/30 shadow-xs' : 'bg-blue-50 text-blue-700 border border-blue-200 shadow-2xs font-bold')
                    : (isDark ? 'text-slate-400 hover:text-slate-200 hover:bg-[var(--kt-s2)] border border-transparent' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-transparent')
                }`}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    isActive 
                      ? (isDark ? 'bg-[var(--kt-accent)]/20 text-[var(--kt-accent)]' : 'bg-blue-100 text-blue-700 font-bold') 
                      : (isDark ? 'bg-[var(--kt-s3)] text-slate-400' : 'bg-slate-100 text-slate-600')
                  }`}>
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className={`text-[10px] font-mono hidden sm:block ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
          Last sync: {lastRefreshedAt.toLocaleTimeString()}
        </div>
      </div>

      {/* ── Error Banner (e.g. Forbidden) ── */}
      {error && (
        <div className="m-4 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AlertTriangle className="text-rose-400 shrink-0" size={20} />
            <div>
              <div className="text-xs font-bold text-rose-300">Authorization / Access Notice</div>
              <div className="text-xs text-rose-200/80">{error}</div>
            </div>
          </div>
          <button
            onClick={handleClaimAdmin}
            className="px-3 py-1.5 rounded-lg bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold transition-all cursor-pointer shadow-md"
          >
            Claim Administrator Status
          </button>
        </div>
      )}

      {/* ── Main Content Area ── */}
      <main className="flex-1 p-4 max-w-7xl w-full mx-auto space-y-6">
        {/* ============================================================== */}
        {/* TAB 1: COMMAND CENTER OVERVIEW                                  */}
        {/* ============================================================== */}
        {activeTab === 'overview' && overview && (
          <div className="space-y-6">
            {/* Top KPI Cards Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
              {/* Active Users */}
              <div className={`p-4 rounded-xl border transition-colors ${
                isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s3)] shadow-xs' : 'bg-white border-slate-200 shadow-sm'
              }`}>
                <div className={`flex items-center justify-between text-xs mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  <span>Users & Active Seats</span>
                  <Users size={16} className={isDark ? "text-[var(--kt-accent)]" : "text-blue-600"} />
                </div>
                <div className={`text-2xl font-black font-mono flex items-baseline gap-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  {overview.users.total}
                  <span className="text-xs font-semibold text-emerald-500 flex items-center gap-1 font-sans">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    {overview.users.active_now} online now
                  </span>
                </div>
                <div className={`text-[11px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Total registered accounts</div>
              </div>

              {/* Video Media Processed */}
              <div className={`p-4 rounded-xl border transition-colors ${
                isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s3)] shadow-xs' : 'bg-white border-slate-200 shadow-sm'
              }`}>
                <div className={`flex items-center justify-between text-xs mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  <span>Media Uploads</span>
                  <Film size={16} className={isDark ? "text-[#0088ff]" : "text-indigo-600"} />
                </div>
                <div className={`text-2xl font-black font-mono flex items-baseline gap-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  {overview.media.total_uploads}
                  <span className={`text-xs font-medium font-sans ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    {overview.media.total_duration_hours} hrs
                  </span>
                </div>
                <div className={`text-[11px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>Across all users & projects</div>
              </div>

              {/* Generation Runs & Re-runs */}
              <div className={`p-4 rounded-xl border transition-colors ${
                isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s3)] shadow-xs' : 'bg-white border-slate-200 shadow-sm'
              }`}>
                <div className={`flex items-center justify-between text-xs mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  <span>Subtitle Jobs Run</span>
                  <PlayCircle size={16} className="text-amber-500" />
                </div>
                <div className={`text-2xl font-black font-mono flex items-baseline gap-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                  {overview.generations.total_runs}
                  <span className="text-xs font-medium text-amber-600 font-sans">
                    {overview.generations.re_runs_count} re-runs
                  </span>
                </div>
                <div className={`text-[11px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                  Re-run rate: {overview.generations.re_run_rate_percent}%
                </div>
              </div>

              {/* API Spend Total */}
              <div className={`p-4 rounded-xl border transition-colors ${
                isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s3)] shadow-xs' : 'bg-white border-slate-200 shadow-sm'
              }`}>
                <div className={`flex items-center justify-between text-xs mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  <span>Estimated Total API Spend</span>
                  <DollarSign size={16} className="text-emerald-500" />
                </div>
                <div className="text-2xl font-black text-emerald-500 font-mono flex items-baseline gap-2">
                  ${overview.financials.total_spend_usd}
                  <span className={`text-xs font-semibold font-sans ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    (₹{overview.financials.total_spend_inr})
                  </span>
                </div>
                <div className={`text-[11px] mt-1 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                  Gemini: ${overview.financials.gemini_spend_usd} | Whisper: ${overview.financials.whisper_spend_usd}
                </div>
              </div>
            </div>

            {/* Quick Live Health Meter Row */}
            {hardwareLive && (
              <div className={`p-5 rounded-2xl border space-y-4 transition-colors ${
                isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s3)]' : 'bg-white border-slate-200 shadow-sm'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity size={16} className={isDark ? "text-[var(--kt-accent)]" : "text-blue-600"} />
                    <span className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Live Server Infrastructure Health</span>
                  </div>
                  <span className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Uploads directory size: {hardwareLive.upload_folder_mb} MB
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* CPU Meter */}
                  <div className={`p-3.5 rounded-xl border transition-colors ${
                    isDark ? 'bg-[var(--kt-s0)] border-[var(--kt-s3)]' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex justify-between text-xs mb-1.5 font-medium">
                      <span className={isDark ? "text-slate-400" : "text-slate-600"}>Processor (CPU) Load</span>
                      <span className={`font-mono font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>{hardwareLive.cpu_percent}%</span>
                    </div>
                    <div className={`w-full h-2 rounded-full overflow-hidden ${isDark ? 'bg-[var(--kt-s3)]' : 'bg-slate-200'}`}>
                      <div
                        className={`h-full transition-all duration-500 rounded-full ${
                          hardwareLive.cpu_percent > 80 ? 'bg-rose-500' : hardwareLive.cpu_percent > 50 ? 'bg-amber-400' : (isDark ? 'bg-[var(--kt-accent)]' : 'bg-blue-600')
                        }`}
                        style={{ width: `${Math.min(100, hardwareLive.cpu_percent)}%` }}
                      />
                    </div>
                  </div>

                  {/* RAM Meter */}
                  <div className={`p-3.5 rounded-xl border transition-colors ${
                    isDark ? 'bg-[var(--kt-s0)] border-[var(--kt-s3)]' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex justify-between text-xs mb-1.5 font-medium">
                      <span className={isDark ? "text-slate-400" : "text-slate-600"}>Memory (RAM) Usage</span>
                      <span className={`font-mono font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                        {hardwareLive.memory_used_mb} / {hardwareLive.memory_total_mb} MB ({hardwareLive.memory_percent}%)
                      </span>
                    </div>
                    <div className={`w-full h-2 rounded-full overflow-hidden ${isDark ? 'bg-[var(--kt-s3)]' : 'bg-slate-200'}`}>
                      <div
                        className={`h-full transition-all duration-500 rounded-full ${
                          hardwareLive.memory_percent > 85 ? 'bg-rose-500' : hardwareLive.memory_percent > 65 ? 'bg-amber-400' : (isDark ? 'bg-[#0088ff]' : 'bg-indigo-600')
                        }`}
                        style={{ width: `${Math.min(100, hardwareLive.memory_percent)}%` }}
                      />
                    </div>
                  </div>

                  {/* Disk Meter */}
                  <div className={`p-3.5 rounded-xl border transition-colors ${
                    isDark ? 'bg-[var(--kt-s0)] border-[var(--kt-s3)]' : 'bg-slate-50 border-slate-200'
                  }`}>
                    <div className="flex justify-between text-xs mb-1.5 font-medium">
                      <span className={isDark ? "text-slate-400" : "text-slate-600"}>Disk Space</span>
                      <span className={`font-mono font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                        {hardwareLive.disk_used_gb} / {hardwareLive.disk_total_gb} GB ({hardwareLive.disk_percent}%)
                      </span>
                    </div>
                    <div className={`w-full h-2 rounded-full overflow-hidden ${isDark ? 'bg-[var(--kt-s3)]' : 'bg-slate-200'}`}>
                      <div
                        className={`h-full transition-all duration-500 rounded-full ${
                          hardwareLive.disk_percent > 85 ? 'bg-rose-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.min(100, hardwareLive.disk_percent)}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 2: USER PRODUCTION DIRECTORY & INTELLIGENCE (MERGED)        */}
        {/* ============================================================== */}
        {activeTab === 'users' && (() => {
          const activeTeamCount = usersList.filter(u => u.is_verified && !u.is_blocked).length;
          const pendingUsersCount = usersList.filter(u => !u.is_verified && !u.is_blocked).length;
          const restrictedUsersCount = usersList.filter(u => Boolean(u.is_blocked)).length;

          // 1. Filtering
          const filteredUsers = usersList.filter((u) => {
            if (userSearch.trim()) {
              const q = userSearch.toLowerCase();
              const match = (u.name && u.name.toLowerCase().includes(q)) || (u.email && u.email.toLowerCase().includes(q));
              if (!match) return false;
            }
            if (userFilterTab === 'active') return u.is_verified && !u.is_blocked;
            if (userFilterTab === 'pending') return !u.is_verified && !u.is_blocked;
            if (userFilterTab === 'restricted') return Boolean(u.is_blocked);
            return true;
          });

          // 2. Sorting
          const sortedUsers = [...filteredUsers].sort((a, b) => {
            switch (outerSortBy) {
              case 'name_asc':
                return (a.name || a.email || '').localeCompare(b.name || b.email || '');
              case 'name_desc':
                return (b.name || b.email || '').localeCompare(a.name || a.email || '');
              case 'tokens_desc':
                return (b.total_tokens || 0) - (a.total_tokens || 0);
              case 'tokens_asc':
                return (a.total_tokens || 0) - (b.total_tokens || 0);
              case 'duration_desc':
                return (b.total_duration_minutes || b.total_duration_seconds || 0) - (a.total_duration_minutes || a.total_duration_seconds || 0);
              case 'duration_asc':
                return (a.total_duration_minutes || a.total_duration_seconds || 0) - (b.total_duration_minutes || b.total_duration_seconds || 0);
              case 'uploads_desc':
                return (b.total_uploads || 0) - (a.total_uploads || 0);
              case 'uploads_asc':
                return (a.total_uploads || 0) - (b.total_uploads || 0);
              case 'cost_desc':
                return (b.total_spend_usd || 0) - (a.total_spend_usd || 0);
              case 'cost_asc':
                return (a.total_spend_usd || 0) - (b.total_spend_usd || 0);
              default:
                return 0;
            }
          });

          // 3. Deterministic Pagination (no infinite scroll)
          const totalUsersCount = sortedUsers.length;
          const totalPages = Math.max(1, Math.ceil(totalUsersCount / pageSize));
          const safePage = Math.min(currentPage, totalPages);
          const startIndex = (safePage - 1) * pageSize;
          const paginatedUsers = sortedUsers.slice(startIndex, startIndex + pageSize);

          const formatMins = (mins, sec) => {
            const totalM = mins !== undefined && mins !== null ? mins : (sec ? sec / 60 : 0);
            if (totalM >= 60) {
              const h = Math.floor(totalM / 60);
              const m = Math.round(totalM % 60);
              return `${h}h ${m}m`;
            }
            return `${Number(totalM).toFixed(1)}m`;
          };

          return (
            <div className="space-y-4">
              {/* Directory Filter Tabs */}
              <div className={`flex flex-wrap items-center justify-between gap-3 border-b pb-3 text-xs ${
                isDark ? 'border-[var(--kt-s3)]' : 'border-slate-200'
              }`}>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { setUserFilterTab('active'); setCurrentPage(1); }}
                    className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                      userFilterTab === 'active'
                        ? (isDark ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-xs font-semibold' : 'bg-emerald-50 text-emerald-800 border border-emerald-300 shadow-xs font-semibold')
                        : (isDark ? 'text-slate-400 hover:text-emerald-300' : 'text-slate-600 hover:text-emerald-700 hover:bg-emerald-50/50')
                    }`}
                  >
                    <UserCheck size={13} className={isDark ? "text-emerald-400" : "text-emerald-600"} />
                    <span>Active Workflow</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold ${
                      isDark ? 'bg-emerald-500/20 text-emerald-300' : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {activeTeamCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setUserFilterTab('pending'); setCurrentPage(1); }}
                    className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                      userFilterTab === 'pending'
                        ? (isDark ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-xs font-semibold' : 'bg-amber-50 text-amber-800 border border-amber-300 shadow-xs font-semibold')
                        : (isDark ? 'text-slate-400 hover:text-amber-300' : 'text-slate-600 hover:text-amber-700 hover:bg-amber-50/50')
                    }`}
                    title="Newly registered users can login immediately, but remain in review until verified"
                  >
                    <Clock size={13} className={isDark ? "text-amber-400" : "text-amber-600"} />
                    <span>New Signups & Pending</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold ${
                      isDark ? 'bg-amber-500/20 text-amber-300' : 'bg-amber-100 text-amber-800'
                    }`}>
                      {pendingUsersCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setUserFilterTab('restricted'); setCurrentPage(1); }}
                    className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                      userFilterTab === 'restricted'
                        ? (isDark ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-xs font-semibold' : 'bg-rose-50 text-rose-800 border border-rose-300 shadow-xs font-semibold')
                        : (isDark ? 'text-slate-400 hover:text-rose-300' : 'text-slate-600 hover:text-rose-700 hover:bg-rose-50/50')
                    }`}
                  >
                    <Ban size={13} className={isDark ? "text-rose-400" : "text-rose-600"} />
                    <span>Restricted Directory</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold ${
                      isDark ? 'bg-rose-500/20 text-rose-300' : 'bg-rose-100 text-rose-800'
                    }`}>
                      {restrictedUsersCount}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => { setUserFilterTab('all'); setCurrentPage(1); }}
                    className={`px-3 py-1.5 rounded-lg font-medium cursor-pointer transition-all flex items-center gap-1.5 ${
                      userFilterTab === 'all'
                        ? (isDark ? 'bg-[var(--kt-s3)] text-white border border-[var(--kt-s5)] shadow-xs font-semibold' : 'bg-blue-50 text-blue-700 border border-blue-300 shadow-xs font-semibold')
                        : (isDark ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100')
                    }`}
                  >
                    <span>All Accounts</span>
                    <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded font-bold ${
                      isDark ? 'bg-[var(--kt-s4)] text-slate-300' : 'bg-slate-200 text-slate-700'
                    }`}>
                      {usersList.length}
                    </span>
                  </button>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <span className={`font-mono text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    Total: <strong className={isDark ? 'text-white' : 'text-slate-900'}>{usersList.length}</strong> generators
                  </span>
                </div>
              </div>

              {/* Search, Outer Sorting & Rows-Per-Page Controls */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search size={14} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-slate-400' : 'text-slate-400'}`} />
                  <input
                    type="text"
                    placeholder="Search by generator name or email..."
                    value={userSearch}
                    onChange={(e) => { setUserSearch(e.target.value); setCurrentPage(1); }}
                    className={`w-full pl-9 pr-3 py-1.5 rounded-lg border text-xs focus:outline-hidden transition-all ${
                      isDark
                        ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-white placeholder-slate-500 focus:border-[var(--kt-accent)]'
                        : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-600 focus:ring-1 focus:ring-blue-600/30 shadow-2xs'
                    }`}
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Outer Sort Selector */}
                  <div className="flex items-center gap-1.5">
                    <ArrowUpDown size={13} className={isDark ? "text-slate-400" : "text-slate-500"} />
                    <span className={`text-xs font-medium hidden sm:inline ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Sort:</span>
                    <select
                      value={outerSortBy}
                      onChange={(e) => { setOuterSortBy(e.target.value); setCurrentPage(1); }}
                      className={`px-2.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer focus:outline-hidden transition-all ${
                        isDark
                          ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-white focus:border-[var(--kt-accent)]'
                          : 'bg-white border-slate-300 text-slate-800 focus:border-blue-600 shadow-2xs'
                      }`}
                    >
                      <option value="name_asc">Name (A → Z)</option>
                      <option value="name_desc">Name (Z → A)</option>
                      <option value="tokens_desc">Tokens Consumed (High to Low)</option>
                      <option value="tokens_asc">Tokens Consumed (Low to High)</option>
                      <option value="duration_desc">Subtitle Length (Longest First)</option>
                      <option value="duration_asc">Subtitle Length (Shortest First)</option>
                      <option value="uploads_desc">Videos Uploaded (High to Low)</option>
                      <option value="uploads_asc">Videos Uploaded (Low to High)</option>
                      <option value="cost_desc">Cost Consumed ($ High to Low)</option>
                      <option value="cost_asc">Cost Consumed ($ Low to High)</option>
                    </select>
                  </div>

                  {/* Rows per page selector */}
                  <div className="flex items-center gap-1.5">
                    <span className={`text-xs font-medium hidden sm:inline ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>Page size:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
                      className={`px-2 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer focus:outline-hidden transition-all ${
                        isDark
                          ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-white focus:border-[var(--kt-accent)]'
                          : 'bg-white border-slate-300 text-slate-800 focus:border-blue-600 shadow-2xs'
                      }`}
                    >
                      <option value={10}>10 / page</option>
                      <option value={20}>20 / page</option>
                      <option value={50}>50 / page</option>
                      <option value={100}>100 / page</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Outer Table: Users Production Directory */}
              <div className={`rounded-xl border overflow-hidden transition-colors ${
                isDark ? 'border-[var(--kt-s3)] bg-[var(--kt-s1)]' : 'border-slate-200 bg-white shadow-xs'
              }`}>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className={`font-semibold border-b ${
                      isDark ? 'bg-[var(--kt-s2)] text-slate-400 border-[var(--kt-s3)]' : 'bg-slate-50 text-slate-700 border-slate-200'
                    }`}>
                      <tr>
                        <th className="p-3">Generator Name & Email</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Videos Uploaded</th>
                        <th className="p-3">Subtitle Generation Length</th>
                        <th className="p-3">Tokens Consumed</th>
                        <th className="p-3">Cost Consumed</th>
                        <th className="p-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className={`divide-y ${isDark ? 'divide-[var(--kt-s3)]' : 'divide-slate-100'}`}>
                      {paginatedUsers.length === 0 ? (
                        <tr>
                          <td colSpan={7} className={`p-10 text-center text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                            No users found matching your search or filters.
                          </td>
                        </tr>
                      ) : (
                        paginatedUsers.map((u) => (
                          <tr
                            key={u.id}
                            onClick={() => openUserDossier(u.id)}
                            className={`transition-colors cursor-pointer group ${
                              isDark ? 'hover:bg-[var(--kt-s2)]' : 'hover:bg-blue-50/40'
                            }`}
                            title="Click row to inspect user's videos, subtitle runs, tokens & costs"
                          >
                            {/* Generator Name & Email */}
                            <td className="p-3">
                              <div className={`font-bold flex items-center gap-1.5 transition-colors ${
                                isDark ? 'text-white group-hover:text-[var(--kt-accent)]' : 'text-slate-900 group-hover:text-blue-600'
                              }`}>
                                <span>{u.name || 'Unnamed Generator'}</span>
                                {u.is_online && (
                                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="Active in Studio now" />
                                )}
                              </div>
                              <div className={`text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{u.email}</div>
                              {u.last_login_location && (
                                <div className={`text-[10px] mt-0.5 ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                                  {u.last_login_location === 'In Office' ? '🏢 In Office' : '🏠 Remote'}
                                </div>
                              )}
                            </td>

                            {/* Status */}
                            <td className="p-3">
                              <div className="flex flex-col gap-1 items-start">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${
                                  u.is_admin 
                                    ? (isDark ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-purple-50 text-purple-700 border border-purple-200')
                                    : (isDark ? 'bg-slate-700/30 text-slate-300' : 'bg-slate-100 text-slate-700 border border-slate-200')
                                }`}>
                                  {u.role || 'editor'}
                                </span>
                                {u.is_blocked ? (
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    isDark ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-rose-50 text-rose-700 border border-rose-200'
                                  }`}>
                                    RESTRICTED
                                  </span>
                                ) : u.is_verified ? (
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    isDark ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  }`}>
                                    ACTIVE WORKFLOW
                                  </span>
                                ) : (
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    isDark ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'bg-amber-50 text-amber-800 border border-amber-200'
                                  }`} title="User can login and use studio; pending admin overview verification">
                                    NEW SIGNUP
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Videos Uploaded */}
                            <td className="p-3">
                              <div className="flex items-center gap-1.5 font-mono">
                                <Film size={13} className={isDark ? "text-slate-400" : "text-blue-600"} />
                                <span className={`font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                                  {u.total_uploads || 0}
                                </span>
                                <span className="text-[10px] text-slate-500">videos</span>
                              </div>
                            </td>

                            {/* Subtitle Generation Length (Total Minutes/Hours) */}
                            <td className="p-3 font-mono">
                              <div className="flex items-center gap-1.5">
                                <Clock size={13} className={isDark ? "text-[var(--kt-accent)]" : "text-emerald-600"} />
                                <span className={`font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                                  {formatMins(u.total_duration_minutes, u.total_duration_seconds)}
                                </span>
                              </div>
                              {u.total_runs > 0 && (
                                <div className="text-[10px] text-slate-500 mt-0.5">
                                  {u.total_runs} runs {u.re_runs_count > 0 ? `(${u.re_runs_count} re-runs)` : ''}
                                </div>
                              )}
                            </td>

                            {/* Tokens Consumed */}
                            <td className="p-3 font-mono">
                              <div className="flex items-center gap-1.5">
                                <Sparkles size={13} className={isDark ? "text-[var(--kt-info)]" : "text-indigo-600"} />
                                <span className={`font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                                  {(u.total_tokens || 0).toLocaleString()}
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500">Gemini tokens</div>
                            </td>

                            {/* Cost Consumed */}
                            <td className="p-3 font-mono">
                              <div className={`font-bold text-sm ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
                                ${(u.total_spend_usd || 0).toFixed(4)}
                              </div>
                              <div className="text-[10px] text-slate-500">
                                of ${(u.monthly_budget_usd || 50.0).toFixed(2)} cap
                              </div>
                            </td>

                            {/* Administrative Actions */}
                            <td className="p-3 text-right" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center justify-end gap-1.5">
                                {/* Verify / Approve into Active Workflow */}
                                {!u.is_verified && !u.is_blocked && (
                                  <button
                                    onClick={() => handleApproveWorkflow(u)}
                                    className={`p-1 px-2.5 rounded-md text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 shadow-xs border ${
                                      isDark
                                        ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40'
                                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-300'
                                    }`}
                                    title="Verify and move into Active Workflow directory"
                                  >
                                    <UserCheck size={12} />
                                    <span>Verify & Approve</span>
                                  </button>
                                )}

                                {/* Limits & Quotas */}
                                <button
                                  onClick={() => handleOpenLimitsModal(u)}
                                  className={`p-1 px-2 rounded-md text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 shadow-xs border ${
                                    isDark
                                      ? 'bg-[var(--kt-accent)]/15 hover:bg-[var(--kt-accent)]/25 text-[var(--kt-accent)] border-[var(--kt-accent)]/30'
                                      : 'bg-blue-50 hover:bg-blue-100 text-blue-700 border-blue-200'
                                  }`}
                                  title="Configure quotas & feature permissions"
                                >
                                  <Sliders size={12} />
                                  <span className="hidden md:inline">Limits</span>
                                </button>

                                {/* Notice */}
                                <button
                                  onClick={() => handleOpenFeedbackModal(u)}
                                  className={`p-1 px-2 rounded-md text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 shadow-xs border ${
                                    isDark
                                      ? 'bg-[#0088ff]/15 hover:bg-[#0088ff]/25 text-[var(--kt-info)] border-[#0088ff]/30'
                                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-300'
                                  }`}
                                  title="Dispatch in-app notice to user studio"
                                >
                                  <MessageSquare size={12} />
                                  <span className="hidden md:inline">Notice</span>
                                </button>

                                {/* Restrict or Restore Account */}
                                {u.is_blocked ? (
                                  <button
                                    onClick={() => handlePermitUser(u)}
                                    className={`p-1 px-2 rounded-md text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 shadow-xs border ${
                                      isDark
                                        ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40'
                                        : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border-emerald-300'
                                    }`}
                                    title="Restore account access"
                                  >
                                    <UserCheck size={12} />
                                    <span>Restore</span>
                                  </button>
                                ) : (
                                  <button
                                    onClick={() => handleRestrictUser(u)}
                                    className={`p-1 px-2 rounded-md text-[11px] font-medium transition-all cursor-pointer flex items-center gap-1 border ${
                                      isDark
                                        ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/30'
                                        : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                                    }`}
                                    title="Restrict user access immediately"
                                  >
                                    <Ban size={12} />
                                    <span>Restrict</span>
                                  </button>
                                )}

                                {/* Inspect Content */}
                                <button
                                  onClick={() => openUserDossier(u.id)}
                                  className={`p-1 px-2 rounded-md text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1 border ${
                                    isDark
                                      ? 'bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-slate-200 border-[var(--kt-s4)]'
                                      : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200 shadow-2xs'
                                  }`}
                                  title="View User Production Dossier"
                                >
                                  <Eye size={12} />
                                  <span className="hidden lg:inline">Inspect</span>
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Deterministic Pagination Bar (No Infinite Scroll) */}
                <div className={`p-3 border-t flex flex-col sm:flex-row items-center justify-between gap-3 text-xs ${
                  isDark ? 'border-[var(--kt-s3)] bg-[var(--kt-s2)]' : 'border-slate-200 bg-slate-50/70'
                }`}>
                  <div className={`font-mono text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                    Showing <span className="font-bold">{totalUsersCount > 0 ? startIndex + 1 : 0}</span> to{' '}
                    <span className="font-bold">{Math.min(startIndex + pageSize, totalUsersCount)}</span> of{' '}
                    <span className="font-bold">{totalUsersCount}</span> users
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={safePage <= 1}
                      className={`p-1.5 px-2.5 rounded-lg border flex items-center gap-1 text-xs font-semibold transition-all cursor-pointer ${
                        safePage <= 1
                          ? 'opacity-40 cursor-not-allowed border-transparent text-slate-400'
                          : (isDark ? 'bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-slate-200 border-[var(--kt-s4)]' : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200 shadow-2xs')
                      }`}
                    >
                      <ChevronLeft size={14} />
                      <span>Prev</span>
                    </button>

                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 1)
                      .map((p, idx, arr) => {
                        const prev = arr[idx - 1];
                        return (
                          <React.Fragment key={p}>
                            {prev && p - prev > 1 && (
                              <span className={`px-1 text-xs ${isDark ? 'text-slate-600' : 'text-slate-400'}`}>...</span>
                            )}
                            <button
                              onClick={() => setCurrentPage(p)}
                              className={`min-w-[28px] h-7 px-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                safePage === p
                                  ? (isDark ? 'bg-[var(--kt-accent)]/20 text-[var(--kt-accent)] border border-[var(--kt-accent)]/40 shadow-xs' : 'bg-blue-600 text-white shadow-2xs font-bold')
                                  : (isDark ? 'bg-[var(--kt-s2)] text-slate-300 hover:bg-[var(--kt-s4)] border border-transparent' : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-200 shadow-2xs')
                              }`}
                            >
                              {p}
                            </button>
                          </React.Fragment>
                        );
                      })}

                    <button
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safePage >= totalPages}
                      className={`p-1.5 px-2.5 rounded-lg border flex items-center gap-1 text-xs font-semibold transition-all cursor-pointer ${
                        safePage >= totalPages
                          ? 'opacity-40 cursor-not-allowed border-transparent text-slate-400'
                          : (isDark ? 'bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-slate-200 border-[var(--kt-s4)]' : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-200 shadow-2xs')
                      }`}
                    >
                      <span>Next</span>
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* ============================================================== */}
        {/* TAB 3: SERVER HARDWARE MONITORING                              */}
        {/* ============================================================== */}
        {activeTab === 'hardware' && hardwareLive && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Detailed CPU Card */}
              <div className={`p-5 rounded-2xl border space-y-4 transition-colors ${
                isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s3)]' : 'bg-white border-slate-200 shadow-sm'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Cpu size={16} className={isDark ? "text-[var(--kt-accent)]" : "text-blue-600"} />
                    <span className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Central Processing Unit (CPU)</span>
                  </div>
                  <span className={`text-lg font-bold font-mono ${isDark ? 'text-white' : 'text-slate-900'}`}>{hardwareLive.cpu_percent}%</span>
                </div>
                <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Shared across FastAPI server, Whisper alignment models, and audio VAD processing.
                </div>
              </div>

              {/* Detailed RAM Card */}
              <div className={`p-5 rounded-2xl border space-y-4 transition-colors ${
                isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s3)]' : 'bg-white border-slate-200 shadow-sm'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HardDrive size={16} className={isDark ? "text-[#0088ff]" : "text-indigo-600"} />
                    <span className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>System Memory (RAM)</span>
                  </div>
                  <span className={`text-lg font-bold font-mono ${isDark ? 'text-white' : 'text-slate-900'}`}>
                    {hardwareLive.memory_used_mb} MB ({hardwareLive.memory_percent}%)
                  </span>
                </div>
                <div className={`text-xs ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                  Total installed capacity: {hardwareLive.memory_total_mb} MB
                </div>
              </div>
            </div>

            {/* Time-Series Snapshots Table */}
            <div className={`p-5 rounded-2xl border space-y-3 transition-colors ${
              isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s3)]' : 'bg-white border-slate-200 shadow-sm'
            }`}>
              <div className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Recent Hardware Metric Snapshots (Last 30 Minutes)</div>
              <div className={`rounded-xl border overflow-hidden ${
                isDark ? 'border-[var(--kt-s3)]' : 'border-slate-200'
              }`}>
                <table className="w-full text-left text-xs font-mono">
                  <thead className={`border-b ${
                    isDark ? 'bg-[var(--kt-s2)] text-slate-400 border-[var(--kt-s3)]' : 'bg-slate-50 text-slate-700 border-slate-200'
                  }`}>
                    <tr>
                      <th className="p-2.5">Time (UTC)</th>
                      <th className="p-2.5">CPU %</th>
                      <th className="p-2.5">RAM %</th>
                      <th className="p-2.5">RAM Used</th>
                      <th className="p-2.5">Active Streams</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y ${isDark ? 'divide-[var(--kt-s3)]' : 'divide-slate-100'}`}>
                    {hardwareHistory.map((h, i) => (
                      <tr key={i} className={`transition-colors ${isDark ? 'hover:bg-[var(--kt-s2)]' : 'hover:bg-blue-50/40'}`}>
                        <td className={`p-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{h.time}</td>
                        <td className={`p-2 font-bold ${isDark ? 'text-slate-200' : 'text-slate-900'}`}>{h.cpu_percent}%</td>
                        <td className={`p-2 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{h.memory_percent}%</td>
                        <td className={`p-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{h.memory_used_mb} MB</td>
                        <td className={`p-2 font-bold ${isDark ? 'text-[var(--kt-accent)]' : 'text-blue-600'}`}>{h.active_streams}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ── User Dossier & Production Content Modal ── */}
      {selectedUserDossier && (() => {
        const u = selectedUserDossier.user;
        let items = selectedUserDossier.production_items ? [...selectedUserDossier.production_items] : [];
        if (items.length === 0 && selectedUserDossier.runs) {
          items = selectedUserDossier.runs.map(r => ({
            video_id: r.video_id,
            title: r.video_title || r.filename || `Video ${r.video_id.slice(0, 8)}`,
            filename: r.video_title || r.filename,
            duration_seconds: r.video_duration_seconds || r.whisper_seconds || r.duration_seconds || 0,
            total_tokens: r.tokens || 0,
            total_cost_usd: r.cost_usd || 0,
            rerun_count: r.run_index || 1,
            status: r.status || 'completed',
            target_language: r.target_language || 'en',
            created_at: r.started_at,
            runs: [r]
          }));
        }

        // Inner Search
        if (innerSearch.trim()) {
          const q = innerSearch.toLowerCase();
          items = items.filter(it => 
            (it.title && it.title.toLowerCase().includes(q)) ||
            (it.video_id && it.video_id.toLowerCase().includes(q))
          );
        }

        // Inner Status Filter
        if (innerStatusFilter !== 'all') {
          items = items.filter(it => it.status === innerStatusFilter);
        }

        // Inner Sort
        items.sort((a, b) => {
          switch (innerSortBy) {
            case 'rerun_desc':
              return (b.rerun_count || 1) - (a.rerun_count || 1);
            case 'video_length_desc':
              return (b.duration_seconds || 0) - (a.duration_seconds || 0);
            case 'video_length_asc':
              return (a.duration_seconds || 0) - (b.duration_seconds || 0);
            case 'tokens_desc':
              return (b.total_tokens || 0) - (a.total_tokens || 0);
            case 'tokens_asc':
              return (a.total_tokens || 0) - (b.total_tokens || 0);
            case 'title_asc':
              return (a.title || '').localeCompare(b.title || '');
            case 'cost_desc':
              return (b.total_cost_usd || 0) - (a.total_cost_usd || 0);
            case 'date_desc':
              return new Date(b.created_at || 0) - new Date(a.created_at || 0);
            default:
              return 0;
          }
        });

        const formatDurationSecs = (sec) => {
          if (!sec || sec <= 0) return '00:00';
          const mins = Math.floor(sec / 60);
          const remSec = Math.floor(sec % 60);
          return `${mins.toString().padStart(2, '0')}:${remSec.toString().padStart(2, '0')}`;
        };

        const formatMinsStr = (mins, sec) => {
          const totalM = mins !== undefined && mins !== null ? mins : (sec ? sec / 60 : 0);
          if (totalM >= 60) {
            const h = Math.floor(totalM / 60);
            const m = Math.round(totalM % 60);
            return `${h}h ${m}m`;
          }
          return `${Number(totalM).toFixed(1)} mins`;
        };

        return (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5">
            <div className={`border rounded-2xl max-w-5xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${
              isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)]' : 'bg-white border-slate-200 shadow-2xl'
            }`}>
              {/* Modal Header */}
              <div className={`p-4 border-b flex flex-wrap items-center justify-between gap-3 ${
                isDark ? 'border-[var(--kt-s3)] bg-[var(--kt-s2)]' : 'border-slate-200 bg-slate-50'
              }`}>
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold shrink-0 ${
                    isDark ? 'bg-[var(--kt-accent)]/15 text-[var(--kt-accent)] border border-[var(--kt-accent)]/30' : 'bg-blue-100 text-blue-700 border border-blue-200'
                  }`}>
                    <Users size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                        {u.name || 'Unnamed Generator'}
                      </h3>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase font-mono ${
                        u.is_admin 
                          ? (isDark ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-purple-50 text-purple-700 border border-purple-200')
                          : (isDark ? 'bg-slate-700/30 text-slate-300' : 'bg-slate-100 text-slate-700 border border-slate-200')
                      }`}>
                        {u.role || 'editor'}
                      </span>
                      {u.is_blocked ? (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isDark ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-rose-50 text-rose-700 border border-rose-200'
                        }`}>
                          RESTRICTED
                        </span>
                      ) : u.is_verified ? (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isDark ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        }`}>
                          ACTIVE WORKFLOW
                        </span>
                      ) : (
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          isDark ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30' : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}>
                          PENDING APPROVAL
                        </span>
                      )}
                    </div>
                    <div className={`text-xs font-mono mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                      {u.email} {u.employee_id ? `• EMP ID: ${u.employee_id}` : ''}
                    </div>
                  </div>
                </div>

                {/* Quick Action Buttons in Modal Header */}
                <div className="flex items-center gap-2">
                  {!u.is_verified && !u.is_blocked && (
                    <button
                      onClick={() => handleApproveWorkflow(u)}
                      className={`p-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 shadow-xs border ${
                        isDark ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40' : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                      }`}
                      title="Verify and move into Active Workflow directory"
                    >
                      <UserCheck size={13} />
                      <span>Verify & Approve</span>
                    </button>
                  )}

                  <button
                    onClick={() => handleOpenLimitsModal(u)}
                    className={`p-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border ${
                      isDark ? 'bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-[var(--kt-accent)] border-[var(--kt-accent)]/30' : 'bg-white hover:bg-slate-100 text-blue-700 border-slate-300'
                    }`}
                  >
                    <Sliders size={13} />
                    <span>Limits</span>
                  </button>

                  <button
                    onClick={() => handleOpenFeedbackModal(u)}
                    className={`p-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border ${
                      isDark ? 'bg-[var(--kt-s3)] hover:bg-[var(--kt-s4)] text-[var(--kt-info)] border-[#0088ff]/30' : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                    }`}
                  >
                    <MessageSquare size={13} />
                    <span>Notice</span>
                  </button>

                  {u.is_blocked ? (
                    <button
                      onClick={() => handlePermitUser(u)}
                      className={`p-1.5 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border ${
                        isDark ? 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/40' : 'bg-emerald-50 text-emerald-700 border-emerald-300'
                      }`}
                    >
                      <UserCheck size={13} />
                      <span>Restore</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleRestrictUser(u)}
                      className={`p-1.5 px-3 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5 border ${
                        isDark ? 'bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border-rose-500/30' : 'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200'
                      }`}
                    >
                      <Ban size={13} />
                      <span>Restrict</span>
                    </button>
                  )}

                  <button
                    onClick={() => setSelectedUserDossier(null)}
                    className={`p-1.5 px-2.5 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                      isDark ? 'bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] text-slate-300 border-[var(--kt-s4)]' : 'bg-white hover:bg-slate-100 text-slate-700 border-slate-300'
                    }`}
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* User KPI Cards Row */}
              <div className={`p-4 border-b grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs ${
                isDark ? 'border-[var(--kt-s3)] bg-[var(--kt-s0)]' : 'border-slate-200 bg-slate-50/50'
              }`}>
                <div className={`p-3 rounded-xl border ${isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)]' : 'bg-white border-slate-200 shadow-2xs'}`}>
                  <div className={`flex items-center gap-1.5 text-[11px] mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    <Film size={13} className={isDark ? "text-[#0088ff]" : "text-blue-600"} />
                    <span>Videos Uploaded</span>
                  </div>
                  <div className={`text-base font-mono font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                    {selectedUserDossier.uploads?.length || 0}
                  </div>
                </div>

                <div className={`p-3 rounded-xl border ${isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)]' : 'bg-white border-slate-200 shadow-2xs'}`}>
                  <div className={`flex items-center gap-1.5 text-[11px] mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    <Clock size={13} className={isDark ? "text-[var(--kt-accent)]" : "text-emerald-600"} />
                    <span>Subtitle Duration</span>
                  </div>
                  <div className={`text-base font-mono font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                    {formatMinsStr(u.total_duration_minutes, u.total_duration_seconds)}
                  </div>
                </div>

                <div className={`p-3 rounded-xl border ${isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)]' : 'bg-white border-slate-200 shadow-2xs'}`}>
                  <div className={`flex items-center gap-1.5 text-[11px] mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    <Sparkles size={13} className={isDark ? "text-[var(--kt-info)]" : "text-indigo-600"} />
                    <span>Tokens Consumed</span>
                  </div>
                  <div className={`text-base font-mono font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                    {(u.total_tokens || 0).toLocaleString()}
                  </div>
                </div>

                <div className={`p-3 rounded-xl border ${isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)]' : 'bg-white border-slate-200 shadow-2xs'}`}>
                  <div className={`flex items-center gap-1.5 text-[11px] mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    <DollarSign size={13} className={isDark ? "text-emerald-400" : "text-emerald-600"} />
                    <span>Cost Consumed</span>
                  </div>
                  <div className={`text-base font-mono font-bold ${isDark ? 'text-emerald-400' : 'text-emerald-700'}`}>
                    ${(u.total_spend_usd || 0).toFixed(4)}
                  </div>
                </div>

                <div className={`p-3 rounded-xl border ${isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)]' : 'bg-white border-slate-200 shadow-2xs'}`}>
                  <div className={`flex items-center gap-1.5 text-[11px] mb-1 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                    <Sliders size={13} className={isDark ? "text-amber-400" : "text-amber-600"} />
                    <span>Monthly Budget Cap</span>
                  </div>
                  <div className={`text-base font-mono font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>
                    ${(u.monthly_budget_usd || 50.0).toFixed(2)}
                  </div>
                </div>
              </div>

              {/* Sub-Nav Tabs inside Dossier */}
              <div className={`px-4 pt-3 border-b flex items-center gap-2 ${
                isDark ? 'border-[var(--kt-s3)] bg-[var(--kt-s1)]' : 'border-slate-200 bg-white'
              }`}>
                <button
                  onClick={() => setInnerTab('productions')}
                  className={`pb-2 px-3 text-xs font-bold border-b-2 cursor-pointer transition-all flex items-center gap-1.5 ${
                    innerTab === 'productions'
                      ? (isDark ? 'border-[var(--kt-accent)] text-[var(--kt-accent)]' : 'border-blue-600 text-blue-700')
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Film size={14} />
                  <span>Video Content & Generations</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    innerTab === 'productions' 
                      ? (isDark ? 'bg-[var(--kt-accent)]/20 text-[var(--kt-accent)]' : 'bg-blue-100 text-blue-700')
                      : (isDark ? 'bg-[var(--kt-s3)] text-slate-400' : 'bg-slate-100 text-slate-600')
                  }`}>
                    {items.length}
                  </span>
                </button>

                <button
                  onClick={() => setInnerTab('sessions')}
                  className={`pb-2 px-3 text-xs font-bold border-b-2 cursor-pointer transition-all flex items-center gap-1.5 ${
                    innerTab === 'sessions'
                      ? (isDark ? 'border-[var(--kt-accent)] text-[var(--kt-accent)]' : 'border-blue-600 text-blue-700')
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Clock size={14} />
                  <span>Active Workstations</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    innerTab === 'sessions' 
                      ? (isDark ? 'bg-[var(--kt-accent)]/20 text-[var(--kt-accent)]' : 'bg-blue-100 text-blue-700')
                      : (isDark ? 'bg-[var(--kt-s3)] text-slate-400' : 'bg-slate-100 text-slate-600')
                  }`}>
                    {selectedUserDossier.sessions?.length || 0}
                  </span>
                </button>

                <button
                  onClick={() => setInnerTab('logins')}
                  className={`pb-2 px-3 text-xs font-bold border-b-2 cursor-pointer transition-all flex items-center gap-1.5 ${
                    innerTab === 'logins'
                      ? (isDark ? 'border-[var(--kt-accent)] text-[var(--kt-accent)]' : 'border-blue-600 text-blue-700')
                      : 'border-transparent text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <ShieldCheck size={14} />
                  <span>Login Geography</span>
                  <span className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono ${
                    innerTab === 'logins' 
                      ? (isDark ? 'bg-[var(--kt-accent)]/20 text-[var(--kt-accent)]' : 'bg-blue-100 text-blue-700')
                      : (isDark ? 'bg-[var(--kt-s3)] text-slate-400' : 'bg-slate-100 text-slate-600')
                  }`}>
                    {selectedUserDossier.logins?.length || 0}
                  </span>
                </button>
              </div>

              {/* Modal Body Content */}
              <div className="p-4 overflow-y-auto flex-1 space-y-4 text-xs">
                {/* ── TAB 1: VIDEO PRODUCTIONS & SUBTITLE RUNS ── */}
                {innerTab === 'productions' && (
                  <div className="space-y-3">
                    {/* Inner Search & Inner Sort Toolbar */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5">
                      <div className="relative flex-1 max-w-sm">
                        <Search size={13} className={`absolute left-3 top-1/2 -translate-y-1/2 ${isDark ? 'text-slate-400' : 'text-slate-400'}`} />
                        <input
                          type="text"
                          placeholder="Search videos by title or ID..."
                          value={innerSearch}
                          onChange={(e) => setInnerSearch(e.target.value)}
                          className={`w-full pl-8 pr-3 py-1.5 rounded-lg border text-xs focus:outline-hidden transition-all ${
                            isDark
                              ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-white placeholder-slate-500 focus:border-[var(--kt-accent)]'
                              : 'bg-white border-slate-300 text-slate-900 placeholder-slate-400 focus:border-blue-600 shadow-2xs'
                          }`}
                        />
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {/* Status Filter */}
                        <div className="flex items-center gap-1">
                          {['all', 'completed', 'in_progress', 'failed'].map((st) => (
                            <button
                              key={st}
                              onClick={() => setInnerStatusFilter(st)}
                              className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase transition-all cursor-pointer ${
                                innerStatusFilter === st
                                  ? (isDark ? 'bg-[var(--kt-accent)]/20 text-[var(--kt-accent)] border border-[var(--kt-accent)]/40' : 'bg-blue-50 text-blue-700 border border-blue-200 font-bold')
                                  : (isDark ? 'bg-[var(--kt-s2)] text-slate-400 hover:text-white border border-[var(--kt-s4)]' : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200')
                              }`}
                            >
                              {st}
                            </button>
                          ))}
                        </div>

                        {/* Inner Sort Dropdown */}
                        <div className="flex items-center gap-1">
                          <ArrowUpDown size={12} className={isDark ? "text-slate-400" : "text-slate-500"} />
                          <select
                            value={innerSortBy}
                            onChange={(e) => setInnerSortBy(e.target.value)}
                            className={`px-2.5 py-1 rounded-lg border text-xs font-semibold cursor-pointer focus:outline-hidden transition-all ${
                              isDark
                                ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-white focus:border-[var(--kt-accent)]'
                                : 'bg-white border-slate-300 text-slate-800 focus:border-blue-600 shadow-2xs'
                            }`}
                          >
                            <option value="rerun_desc">Most Auto-Generates / Continues (3x+ on top)</option>
                            <option value="video_length_desc">Longest Video Length</option>
                            <option value="video_length_asc">Shortest Video Length</option>
                            <option value="tokens_desc">Highest Tokens Consumed</option>
                            <option value="tokens_asc">Lowest Tokens Consumed</option>
                            <option value="title_asc">Video Title (A → Z)</option>
                            <option value="cost_desc">Cost Consumed ($ High to Low)</option>
                            <option value="date_desc">Most Recent</option>
                          </select>
                        </div>
                      </div>
                    </div>

                    {/* Video Projects Table */}
                    <div className={`rounded-xl border overflow-hidden ${
                      isDark ? 'border-[var(--kt-s3)] bg-[var(--kt-s0)]' : 'border-slate-200 bg-white'
                    }`}>
                      <table className="w-full text-left text-xs">
                        <thead className={`font-semibold border-b ${
                          isDark ? 'bg-[var(--kt-s2)] text-slate-400 border-[var(--kt-s3)]' : 'bg-slate-50 text-slate-700 border-slate-200'
                        }`}>
                          <tr>
                            <th className="p-3">Video Title & ID</th>
                            <th className="p-3">Length</th>
                            <th className="p-3">Tokens Consumed</th>
                            <th className="p-3">Cost ($)</th>
                            <th className="p-3">Auto-Generate / Continues</th>
                            <th className="p-3">Status</th>
                            <th className="p-3 text-right">Timestamp</th>
                          </tr>
                        </thead>
                        <tbody className={`divide-y ${isDark ? 'divide-[var(--kt-s3)]' : 'divide-slate-100'}`}>
                          {items.length === 0 ? (
                            <tr>
                              <td colSpan={7} className={`p-8 text-center text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                                No video projects or generation records found for this user.
                              </td>
                            </tr>
                          ) : (
                            items.map((it, idx) => (
                              <tr key={it.video_id || idx} className={`transition-colors ${isDark ? 'hover:bg-[var(--kt-s2)]' : 'hover:bg-slate-50'}`}>
                                {/* Video Title & ID */}
                                <td className="p-3 max-w-[260px]">
                                  <div className="flex items-center gap-2">
                                    <Film size={14} className={`shrink-0 ${isDark ? 'text-[#0088ff]' : 'text-blue-600'}`} />
                                    <span className={`font-bold truncate ${isDark ? 'text-white' : 'text-slate-900'}`} title={it.title}>
                                      {it.title || `Video ${it.video_id}`}
                                    </span>
                                  </div>
                                  <div className="text-[10px] font-mono text-slate-500 truncate pl-5">
                                    ID: {it.video_id} {it.resolution ? `• ${it.resolution}` : ''} {it.size_mb > 0 ? `• ${it.size_mb} MB` : ''}
                                  </div>
                                </td>

                                {/* Length */}
                                <td className={`p-3 font-mono font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                                  {formatDurationSecs(it.duration_seconds)}
                                </td>

                                {/* Tokens */}
                                <td className="p-3 font-mono">
                                  <div className={`font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                                    {(it.total_tokens || 0).toLocaleString()}
                                  </div>
                                  <div className="text-[10px] text-slate-500">Gemini</div>
                                </td>

                                {/* Cost */}
                                <td className="p-3 font-mono font-bold text-emerald-500">
                                  ${(it.total_cost_usd || 0).toFixed(4)}
                                </td>

                                {/* Auto-Generate / Continue Re-run Frequency Badge */}
                                <td className="p-3">
                                  {it.rerun_count > 1 ? (
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono inline-flex items-center gap-1 ${
                                      it.rerun_count >= 3
                                        ? (isDark ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40 shadow-xs' : 'bg-amber-100 text-amber-900 border border-amber-300 font-bold')
                                        : (isDark ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30' : 'bg-amber-50 text-amber-800 border border-amber-200')
                                    }`}>
                                      <span>🔥</span>
                                      <span>Re-run #{it.rerun_count} ({it.rerun_count}x Continued)</span>
                                    </span>
                                  ) : (
                                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono ${
                                      isDark ? 'bg-[var(--kt-s2)] text-slate-400 border border-[var(--kt-s4)]' : 'bg-slate-100 text-slate-600 border border-slate-200'
                                    }`}>
                                      Run #1 (Initial)
                                    </span>
                                  )}
                                </td>

                                {/* Status */}
                                <td className="p-3">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase ${
                                    it.status === 'completed'
                                      ? (isDark ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')
                                      : it.status === 'failed'
                                      ? (isDark ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-rose-50 text-rose-700 border border-rose-200')
                                      : (isDark ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30 animate-pulse' : 'bg-blue-50 text-blue-700 border border-blue-200 animate-pulse')
                                  }`}>
                                    {it.status}
                                  </span>
                                </td>

                                {/* Timestamp */}
                                <td className={`p-3 text-right text-[11px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                  {it.created_at ? new Date(it.created_at).toLocaleString() : 'N/A'}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ── TAB 2: ACTIVE SESSIONS ── */}
                {innerTab === 'sessions' && (
                  <div className="space-y-3">
                    <div className={`font-bold flex items-center justify-between ${isDark ? 'text-white' : 'text-slate-900'}`}>
                      <div className="flex items-center gap-1.5">
                        <Clock size={14} className={isDark ? "text-[var(--kt-accent)]" : "text-blue-600"} />
                        <span>Workstations & Active Token Sessions ({selectedUserDossier.sessions?.length || 0})</span>
                      </div>
                      <span className={`text-[10px] font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>4-hour sliding activity window</span>
                    </div>

                    <div className={`rounded-xl border overflow-hidden font-mono text-[11px] divide-y ${
                      isDark ? 'border-[var(--kt-s3)] bg-[var(--kt-s0)] divide-[var(--kt-s3)]' : 'border-slate-200 bg-white divide-slate-100'
                    }`}>
                      {selectedUserDossier.sessions && selectedUserDossier.sessions.length > 0 ? (
                        selectedUserDossier.sessions.map((sess) => {
                          const isActive = sess.is_active && !sess.is_expired;
                          return (
                            <div key={sess.id} className={`p-3 flex flex-col gap-1.5 transition-colors ${
                              isDark ? 'hover:bg-[var(--kt-s2)]' : 'hover:bg-slate-50'
                            }`}>
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                                  <span className={`font-bold text-xs ${isDark ? 'text-white' : 'text-slate-900'}`}>{sess.device_info}</span>
                                  <span className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>({sess.location} • {sess.ip_address})</span>
                                </div>
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                                  isActive 
                                    ? (isDark ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-emerald-50 text-emerald-700 border border-emerald-200')
                                    : (isDark ? 'bg-slate-800 text-slate-400 border border-slate-700' : 'bg-slate-100 text-slate-600 border border-slate-200')
                                }`}>
                                  {isActive ? 'Active Live Session' : 'Logged Out / Expired'}
                                </span>
                              </div>
                              <div className={`flex items-center justify-between text-[10px] pl-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                                <div>
                                  <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>Session Initiated: </span>
                                  <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>{sess.login_time ? new Date(sess.login_time).toLocaleString() : 'N/A'}</span>
                                </div>
                                <div>
                                  <span className={isDark ? 'text-slate-500' : 'text-slate-400'}>Expires At: </span>
                                  <span className={isDark ? 'text-slate-300' : 'text-slate-700'}>
                                    {sess.expires_at ? new Date(sess.expires_at).toLocaleString() : 'Closed'}
                                  </span>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      ) : (
                        <div className={`p-6 text-center text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                          No session records registered for this account.
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── TAB 3: LOGIN GEOGRAPHY ── */}
                {innerTab === 'logins' && (
                  <div className="space-y-3">
                    <div className={`font-bold flex items-center gap-1.5 ${isDark ? 'text-white' : 'text-slate-900'}`}>
                      <ShieldCheck size={14} className={isDark ? "text-[var(--kt-accent)]" : "text-blue-600"} />
                      <span>Historical Login Audits & Locations ({selectedUserDossier.logins?.length || 0})</span>
                    </div>

                    <div className={`rounded-xl border overflow-hidden font-mono text-[11px] divide-y ${
                      isDark ? 'border-[var(--kt-s3)] bg-[var(--kt-s0)] divide-[var(--kt-s3)]' : 'border-slate-200 bg-white divide-slate-100'
                    }`}>
                      {selectedUserDossier.logins && selectedUserDossier.logins.length > 0 ? (
                        selectedUserDossier.logins.map((lg) => (
                          <div key={lg.id} className={`p-2.5 flex items-center justify-between ${
                            isDark ? 'hover:bg-[var(--kt-s2)]' : 'hover:bg-slate-50'
                          }`}>
                            <div className="flex items-center gap-2">
                              <span>{lg.location === 'In Office' ? '🏢' : '🏠'}</span>
                              <span className={`font-semibold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{lg.location}</span>
                              <span className={`text-[10px] ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>({lg.ip_address})</span>
                            </div>
                            <span className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                              {lg.time ? new Date(lg.time).toLocaleString() : ''}
                            </span>
                          </div>
                        ))
                      ) : (
                        <div className={`p-6 text-center text-xs ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                          No historical login records found.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── User Limits & Feature Permissions Modal ── */}
      {editingLimitsUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className={`border rounded-2xl max-w-lg w-full flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${
            isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)]' : 'bg-white border-slate-200 shadow-2xl'
          }`}>
            <div className={`p-4 border-b flex items-center justify-between ${
              isDark ? 'border-[var(--kt-s3)]' : 'border-slate-200'
            }`}>
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
                  isDark ? 'bg-[var(--kt-accent)]/10 border-[var(--kt-accent)]/30 text-[var(--kt-accent)]' : 'bg-blue-50 border-blue-200 text-blue-600'
                }`}>
                  <Sliders size={16} />
                </div>
                <div>
                  <h3 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Quotas & Permissions</h3>
                  <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{editingLimitsUser.name} ({editingLimitsUser.email})</p>
                </div>
              </div>
              <button
                onClick={() => setEditingLimitsUser(null)}
                className={`p-1 rounded-lg transition-colors cursor-pointer ${
                  isDark ? 'text-slate-400 hover:text-white hover:bg-[var(--kt-s3)]' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                }`}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSaveLimits} className="p-5 space-y-4 text-xs">
              {/* Video Generation Quota */}
              <div>
                <label className={`block font-semibold mb-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  Video Generation Quota (Max Allowed)
                </label>
                <div className="flex items-center gap-2 mb-2">
                  {[-1, 5, 10, 25, 50, 100].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setLimitsQuota(preset)}
                      className={`px-2.5 py-1 rounded-md font-mono text-[11px] font-bold cursor-pointer transition-all ${
                        limitsQuota === preset
                          ? (isDark ? 'bg-[var(--kt-accent)] text-black shadow-xs' : 'bg-blue-600 text-white shadow-xs font-bold')
                          : (isDark ? 'bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] text-slate-300 border border-[var(--kt-s4)]' : 'bg-white hover:bg-slate-100 text-slate-700 border border-slate-300')
                      }`}
                    >
                      {preset === -1 ? 'Unlimited' : `${preset}`}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min="-1"
                    value={limitsQuota}
                    onChange={(e) => setLimitsQuota(parseInt(e.target.value, 10) || -1)}
                    className={`w-full px-3 py-2 rounded-lg border font-mono text-xs focus:outline-hidden transition-all ${
                      isDark 
                        ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-white focus:border-[var(--kt-accent)]' 
                        : 'bg-white border-slate-300 text-slate-900 focus:border-blue-600 focus:ring-1 focus:ring-blue-600/30 font-medium'
                    }`}
                    placeholder="-1 for unlimited, or specific number"
                  />
                  <span className={`text-[11px] whitespace-nowrap ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>(-1 = unlimited)</span>
                </div>
              </div>

              {/* Monthly USD Budget */}
              <div>
                <label className={`block font-semibold mb-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>
                  Monthly Budget Cap (USD)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono">$</span>
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    value={limitsBudget}
                    onChange={(e) => setLimitsBudget(parseFloat(e.target.value) || 0)}
                    className={`w-full pl-7 pr-3 py-2 rounded-lg border font-mono text-xs focus:outline-hidden transition-all ${
                      isDark
                        ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-white focus:border-[var(--kt-accent)]'
                        : 'bg-white border-slate-300 text-slate-900 focus:border-blue-600 focus:ring-1 focus:ring-blue-600/30 font-medium'
                    }`}
                  />
                </div>
              </div>

              {/* Feature Toggles */}
              <div className={`pt-2 border-t space-y-3 ${isDark ? 'border-[var(--kt-s3)]' : 'border-slate-200'}`}>
                <div className={`font-semibold text-[11px] uppercase tracking-wider ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                  Feature Permissions For This User
                </div>

                <div className={`flex items-center justify-between p-3 rounded-xl border ${
                  isDark ? 'bg-[var(--kt-s0)] border-[var(--kt-s3)]' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div>
                    <div className={`font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>Subtitle Exporting</div>
                    <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Allow downloading SRT, VTT, and formatted subtitle text</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={limitsCanExport}
                    onChange={(e) => setLimitsCanExport(e.target.checked)}
                    className={`w-4 h-4 rounded cursor-pointer ${isDark ? 'accent-[var(--kt-accent)]' : 'accent-blue-600'}`}
                  />
                </div>

                <div className={`flex items-center justify-between p-3 rounded-xl border ${
                  isDark ? 'bg-[var(--kt-s0)] border-[var(--kt-s3)]' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div>
                    <div className={`font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>Gemini AI Rebreak & Optimize</div>
                    <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Allow invoking Gemini AI sentence break and optimization pipelines</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={limitsCanAiOptimize}
                    onChange={(e) => setLimitsCanAiOptimize(e.target.checked)}
                    className={`w-4 h-4 rounded cursor-pointer ${isDark ? 'accent-[var(--kt-accent)]' : 'accent-blue-600'}`}
                  />
                </div>

                <div className={`flex items-center justify-between p-3 rounded-xl border ${
                  isDark ? 'bg-[var(--kt-s0)] border-[var(--kt-s3)]' : 'bg-slate-50 border-slate-200'
                }`}>
                  <div>
                    <div className={`font-bold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>Audio Waveform Generation</div>
                    <div className={`text-[11px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Calculate audio peaks for visual timeline waveforms</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={limitsCanAudioPeaks}
                    onChange={(e) => setLimitsCanAudioPeaks(e.target.checked)}
                    className={`w-4 h-4 rounded cursor-pointer ${isDark ? 'accent-[var(--kt-accent)]' : 'accent-blue-600'}`}
                  />
                </div>
              </div>

              {/* Action buttons */}
              <div className={`pt-4 flex items-center justify-end gap-2 border-t ${isDark ? 'border-[var(--kt-s3)]' : 'border-slate-200'}`}>
                <button
                  type="button"
                  onClick={() => setEditingLimitsUser(null)}
                  className={`px-4 py-2 rounded-lg font-medium cursor-pointer transition-colors ${
                    isDark ? 'bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingLimits}
                  className={`px-4 py-2 rounded-lg font-bold cursor-pointer transition-all shadow-md disabled:opacity-50 ${
                    isDark 
                      ? 'bg-[var(--kt-accent)] hover:bg-[var(--kt-accent-strong)] text-black shadow-[var(--kt-accent)]/20' 
                      : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/20'
                  }`}
                >
                  {isSavingLimits ? 'Saving...' : 'Save & Enforce Limits'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── In-App Direct Feedback / Notice Modal ── */}
      {feedbackUser && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className={`border rounded-2xl max-w-lg w-full flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 ${
            isDark ? 'bg-[var(--kt-s1)] border-[var(--kt-s4)]' : 'bg-white border-slate-200 shadow-2xl'
          }`}>
            <div className={`p-4 border-b flex items-center justify-between ${
              isDark ? 'border-[var(--kt-s3)]' : 'border-slate-200'
            }`}>
              <div className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-lg border flex items-center justify-center ${
                  isDark ? 'bg-[#0088ff]/10 border-[#0088ff]/30 text-[#0088ff]' : 'bg-blue-50 border-blue-200 text-blue-600'
                }`}>
                  <MessageSquare size={16} />
                </div>
                <div>
                  <h3 className={`text-sm font-bold ${isDark ? 'text-white' : 'text-slate-900'}`}>Send In-App Studio Notice</h3>
                  <p className={`text-xs font-mono ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>Recipient: {feedbackUser.name} ({feedbackUser.email})</p>
                </div>
              </div>
              <button
                onClick={() => setFeedbackUser(null)}
                className={`p-1 rounded-lg transition-colors cursor-pointer ${
                  isDark ? 'text-slate-400 hover:text-white hover:bg-[var(--kt-s3)]' : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                }`}
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleSendFeedback} className="p-5 space-y-4 text-xs">
              {feedbackSuccessMsg && (
                <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-600 font-medium">
                  {feedbackSuccessMsg}
                </div>
              )}

              {/* Notification Type */}
              <div>
                <label className={`block font-semibold mb-1.5 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Notice Urgency / Category</label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { id: 'feedback', label: '💬 Feedback', borderDark: 'border-blue-500/40', borderLight: 'border-blue-500' },
                    { id: 'notice', label: 'ℹ️ Notice', borderDark: 'border-blue-500/40', borderLight: 'border-blue-500' },
                    { id: 'warning', label: '⚠️ Warning', borderDark: 'border-amber-500/40', borderLight: 'border-amber-500' },
                    { id: 'quota_limit', label: '🛑 Quota Limit', borderDark: 'border-rose-500/40', borderLight: 'border-rose-500' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setFeedbackType(t.id)}
                      className={`p-2 rounded-lg text-center font-bold transition-all cursor-pointer border ${
                        feedbackType === t.id
                          ? (isDark 
                              ? `bg-[var(--kt-s3)] text-white ${t.borderDark} ring-1 ring-white/20` 
                              : `bg-blue-50 text-blue-900 border-blue-400 ring-1 ring-blue-400/40 font-bold`)
                          : (isDark 
                              ? 'bg-[var(--kt-s1)] text-slate-400 border-transparent hover:border-[var(--kt-s4)]' 
                              : 'bg-slate-100 text-slate-600 border-transparent hover:bg-slate-200 font-medium')
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Title */}
              <div>
                <label className={`block font-semibold mb-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Subject / Header</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Video Quality Feedback or Approaching Monthly Limit"
                  value={feedbackTitle}
                  onChange={(e) => setFeedbackTitle(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border text-xs focus:outline-hidden transition-all ${
                    isDark
                      ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-white focus:border-[#0088ff] placeholder-slate-500'
                      : 'bg-white border-slate-300 text-slate-900 focus:border-blue-600 focus:ring-1 focus:ring-blue-600/30 placeholder-slate-400 font-medium'
                  }`}
                />
              </div>

              {/* Message */}
              <div>
                <label className={`block font-semibold mb-1 ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>Notice Message</label>
                <textarea
                  required
                  rows={4}
                  placeholder="Type clear instructions, feedback on subtitle files, or policy notices. This will show up in the user's notification drawer in their studio."
                  value={feedbackMessage}
                  onChange={(e) => setFeedbackMessage(e.target.value)}
                  className={`w-full px-3 py-2 rounded-lg border text-xs focus:outline-hidden resize-none transition-all ${
                    isDark
                      ? 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-white focus:border-[#0088ff] placeholder-slate-500'
                      : 'bg-white border-slate-300 text-slate-900 focus:border-blue-600 focus:ring-1 focus:ring-blue-600/30 placeholder-slate-400 font-medium'
                  }`}
                />
              </div>

              {/* Action buttons */}
              <div className={`pt-3 flex items-center justify-end gap-2 border-t ${isDark ? 'border-[var(--kt-s3)]' : 'border-slate-200'}`}>
                <button
                  type="button"
                  onClick={() => setFeedbackUser(null)}
                  className={`px-4 py-2 rounded-lg font-medium cursor-pointer transition-colors ${
                    isDark ? 'bg-[var(--kt-s2)] hover:bg-[var(--kt-s4)] text-slate-300' : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isSendingFeedback || !feedbackTitle.trim() || !feedbackMessage.trim()}
                  className={`px-4 py-2 rounded-lg font-bold cursor-pointer transition-all shadow-md disabled:opacity-50 flex items-center gap-1.5 ${
                    isDark
                      ? 'bg-[#0088ff] hover:bg-[#0077ee] text-white shadow-[#0088ff]/20'
                      : 'bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/20'
                  }`}
                >
                  <Send size={13} />
                  <span>{isSendingFeedback ? 'Dispatching...' : 'Dispatch In-App Notice'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
