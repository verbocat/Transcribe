import React, { useState } from 'react';
import {
  User, Settings, BookOpen, X, Check, CheckCircle2, Shield,
  Sliders, Keyboard, Sparkles, Volume2, Save, MapPin, Mail,
  FileText, Clock, HelpCircle, Layers, Cpu
} from 'lucide-react';
import { API_BASE } from '../config';
import { useAuth } from '../auth_views/AuthContext';

export default function UserProfileModal({ isOpen, onClose, initialTab = 'profile' }) {
  const { user, token, updateUser } = useAuth();
  const [activeTab, setActiveTab] = useState(initialTab);

  // Profile Form State
  const [name, setName] = useState(user?.name || '');
  const [location, setLocation] = useState(user?.operating_location || 'In Office');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState('');
  const [profileError, setProfileError] = useState('');

  // Preferences & Settings State (persisted in localStorage)
  const [preferences, setPreferences] = useState(() => {
    try {
      const saved = localStorage.getItem('verbolabs_studio_preferences');
      if (saved) return JSON.parse(saved);
    } catch (_) {}
    return {
      maxCps: 20,
      maxCpl: 42,
      audioWaveforms: true,
      autoSaveInterval: 30,
      soundAlerts: true,
      defaultFormat: 'srt'
    };
  });
  const [settingsSaved, setSettingsSaved] = useState(false);

  if (!isOpen || !user) return null;

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    setIsSavingProfile(true);
    setProfileMsg('');
    setProfileError('');
    try {
      const res = await fetch(`${API_BASE}/api/auth/profile`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || localStorage.getItem('verbolabs_auth_token')}`
        },
        body: JSON.stringify({
          name: name.trim(),
          operating_location: location
        })
      });
      const data = await res.json();
      if (data.success) {
        setProfileMsg('Profile updated successfully.');
        if (updateUser) {
          updateUser({ ...user, name: name.trim(), operating_location: location });
        }
        setTimeout(() => setProfileMsg(''), 3000);
      } else {
        setProfileError(data.detail || 'Failed to update profile.');
      }
    } catch (err) {
      setProfileError(err.message || 'Error updating profile.');
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleSavePreferences = (e) => {
    e.preventDefault();
    try {
      localStorage.setItem('verbolabs_studio_preferences', JSON.stringify(preferences));
      setSettingsSaved(true);
      setTimeout(() => setSettingsSaved(false), 2500);
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-2xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-[0_25px_60px_rgba(0,0,0,0.9)] overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="p-4 px-5 bg-[var(--kt-s2)] border-b border-[var(--kt-s4)] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-[var(--kt-accent)] to-[var(--kt-accent)] text-black font-extrabold flex items-center justify-center text-sm shadow-md">
              {user.name ? user.name.charAt(0).toUpperCase() : user.email?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div>
              <div className="text-sm font-bold text-white leading-tight">{user.name || 'Studio Specialist'}</div>
              <div className="text-xs font-mono text-slate-400">{user.email}</div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[var(--kt-s3)] transition-colors cursor-pointer"
            title="Close modal"
          >
            <X size={16} />
          </button>
        </div>

        {/* Modal Tabs Bar */}
        <div className="px-5 bg-[var(--kt-s1)] border-b border-[var(--kt-s3)] flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('profile')}
            className={`py-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'profile'
                ? 'border-[var(--kt-accent)] text-[var(--kt-accent)]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <User size={14} />
            <span>Profile & Account</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`py-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'settings'
                ? 'border-[var(--kt-accent)] text-[var(--kt-accent)]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Settings size={14} />
            <span>Settings & Preferences</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('manual')}
            className={`py-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-1.5 transition-colors cursor-pointer ${
              activeTab === 'manual'
                ? 'border-[var(--kt-accent)] text-[var(--kt-accent)]'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <BookOpen size={14} />
            <span>User Manual & Shortcuts</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs text-slate-300">
          {/* TAB 1: EDIT PROFILE */}
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-4">
              {profileMsg && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                  <span>{profileMsg}</span>
                </div>
              )}
              {profileError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                  {profileError}
                </div>
              )}

              <div>
                <label className="block text-slate-300 font-semibold mb-1 text-xs">Full Name</label>
                <div className="relative">
                  <User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your full name"
                    className="w-full pl-9 pr-3 py-2 bg-[var(--kt-s2)] border border-[var(--kt-s4)] rounded-xl text-white text-xs focus:outline-hidden focus:border-[var(--kt-accent)] transition-colors"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1 text-xs">Email Address</label>
                <div className="relative">
                  <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="email"
                    value={user.email}
                    disabled
                    className="w-full pl-9 pr-3 py-2 bg-[var(--kt-s0)] border border-[var(--kt-s3)] rounded-xl text-slate-400 text-xs font-mono cursor-not-allowed"
                  />
                </div>
                <div className="mt-1 flex items-center gap-2">
                  {user.is_verified ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 font-semibold">
                      <CheckCircle2 size={12} /> Verified Sovereign Account
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 font-semibold">
                      <Clock size={12} /> Verification Pending
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1 text-xs">Operating Workstation Location</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setLocation('In Office')}
                    className={`p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all cursor-pointer ${
                      location === 'In Office'
                        ? 'bg-[var(--kt-accent)]/10 border-[var(--kt-accent)]/40 text-white shadow-xs'
                        : 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-400 hover:text-white'
                    }`}
                  >
                    <span className="text-base">🏢</span>
                    <div>
                      <div className="font-semibold text-xs">In Office</div>
                      <div className="text-[10px] text-slate-400">VerboLabs Studio Facilities</div>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setLocation('Remote')}
                    className={`p-3 rounded-xl border text-left flex items-center gap-2.5 transition-all cursor-pointer ${
                      location === 'Remote'
                        ? 'bg-[var(--kt-accent)]/10 border-[var(--kt-accent)]/40 text-white shadow-xs'
                        : 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-400 hover:text-white'
                    }`}
                  >
                    <span className="text-base">🏠</span>
                    <div>
                      <div className="font-semibold text-xs">Remote Workstation</div>
                      <div className="text-[10px] text-slate-400">Secure Home Office / Field</div>
                    </div>
                  </button>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSavingProfile}
                  className="px-4 py-2 rounded-xl bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black font-bold text-xs transition-all cursor-pointer flex items-center gap-1.5 shadow-md disabled:opacity-50"
                >
                  <Save size={14} />
                  <span>{isSavingProfile ? 'Saving...' : 'Save Profile Changes'}</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 2: SETTINGS & PREFERENCES */}
          {activeTab === 'settings' && (
            <form onSubmit={handleSavePreferences} className="space-y-4">
              {settingsSaved && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-emerald-400 shrink-0" />
                  <span>Preferences updated and active in Subtitle Studio!</span>
                </div>
              )}

              <div className="p-3.5 rounded-xl bg-[var(--kt-s2)] border border-[var(--kt-s4)] space-y-3">
                <div className="font-semibold text-white text-xs flex items-center gap-2">
                  <Sliders size={14} className="text-[var(--kt-accent)]" />
                  <span>Subtitle Quality Control (QC) Standards</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-slate-400 text-[11px] mb-1">Max Characters Per Line (CPL)</label>
                    <input
                      type="number"
                      min="25"
                      max="60"
                      value={preferences.maxCpl}
                      onChange={(e) => setPreferences({ ...preferences, maxCpl: parseInt(e.target.value, 10) || 42 })}
                      className="w-full px-3 py-1.5 bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-lg text-white font-mono text-xs focus:outline-hidden focus:border-[var(--kt-accent)]"
                    />
                    <span className="text-[10px] text-slate-500">Netflix standard: 42 CPL</span>
                  </div>

                  <div>
                    <label className="block text-slate-400 text-[11px] mb-1">Max Reading Speed (CPS)</label>
                    <input
                      type="number"
                      min="10"
                      max="35"
                      value={preferences.maxCps}
                      onChange={(e) => setPreferences({ ...preferences, maxCps: parseInt(e.target.value, 10) || 20 })}
                      className="w-full px-3 py-1.5 bg-[var(--kt-s1)] border border-[var(--kt-s4)] rounded-lg text-white font-mono text-xs focus:outline-hidden focus:border-[var(--kt-accent)]"
                    />
                    <span className="text-[10px] text-slate-500">Standard dialog: 17–20 CPS</span>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-[var(--kt-s2)] border border-[var(--kt-s4)] space-y-3">
                <div className="font-semibold text-white text-xs flex items-center gap-2">
                  <Cpu size={14} className="text-blue-400" />
                  <span>Editor & Audio Features</span>
                </div>

                <div className="space-y-2 text-xs">
                  <label className="flex items-center justify-between cursor-pointer p-1">
                    <div>
                      <div className="text-slate-200 font-medium">Acoustic Waveform Rendering</div>
                      <div className="text-[10px] text-slate-500">Generate visual speech energy waveforms under video player</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={preferences.audioWaveforms}
                      onChange={(e) => setPreferences({ ...preferences, audioWaveforms: e.target.checked })}
                      className="w-4 h-4 accent-[var(--kt-accent)] rounded cursor-pointer"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer p-1">
                    <div>
                      <div className="text-slate-200 font-medium">Notification Audio Cues</div>
                      <div className="text-[10px] text-slate-500">Play subtle auditory tone upon job completion</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={preferences.soundAlerts}
                      onChange={(e) => setPreferences({ ...preferences, soundAlerts: e.target.checked })}
                      className="w-4 h-4 accent-[var(--kt-accent)] rounded cursor-pointer"
                    />
                  </label>
                </div>
              </div>

              <div>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-[var(--kt-accent)] hover:bg-[var(--kt-accent)] text-black font-bold text-xs transition-all cursor-pointer flex items-center gap-1.5 shadow-md"
                >
                  <Save size={14} />
                  <span>Apply Preferences</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: USER MANUAL & SHORTCUTS */}
          {activeTab === 'manual' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-[var(--kt-s2)] border border-[var(--kt-s4)] space-y-2">
                <div className="font-bold text-white text-xs flex items-center gap-2">
                  <Sparkles size={14} className="text-[var(--kt-accent)]" />
                  <span>Production Workflow Quick Guide</span>
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-300 leading-relaxed">
                  <li><strong className="text-white">Import Video/Audio:</strong> Drag and drop your master media file into Subtitle Studio.</li>
                  <li><strong className="text-white">Acoustic Transcription:</strong> Trigger Gemini Flash + Whisper batch pipeline for sub-millisecond diarization.</li>
                  <li><strong className="text-white">Timeline Linting:</strong> Real-time QC indicators alert you if speech exceeds 20 CPS or 42 CPL.</li>
                  <li><strong className="text-white">Export:</strong> Download broadcast-compliant SRT, WebVTT, or Plain Text transcripts.</li>
                </ol>
              </div>

              <div className="p-4 rounded-xl bg-[var(--kt-s2)] border border-[var(--kt-s4)] space-y-3">
                <div className="font-bold text-white text-xs flex items-center gap-2">
                  <Keyboard size={14} className="text-[var(--kt-accent)]" />
                  <span>Workstation Keyboard Shortcuts</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
                  <div className="p-2 rounded-lg bg-[var(--kt-s1)] border border-[var(--kt-s4)] flex items-center justify-between">
                    <span className="text-slate-400">Play / Pause</span>
                    <kbd className="px-2 py-0.5 rounded bg-[var(--kt-s3)] text-[var(--kt-accent)] font-bold">Space</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--kt-s1)] border border-[var(--kt-s4)] flex items-center justify-between">
                    <span className="text-slate-400">Replay Active Cue</span>
                    <kbd className="px-2 py-0.5 rounded bg-[var(--kt-s3)] text-[var(--kt-accent)] font-bold">Shift + Space</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--kt-s1)] border border-[var(--kt-s4)] flex items-center justify-between">
                    <span className="text-slate-400">Next Subtitle</span>
                    <kbd className="px-2 py-0.5 rounded bg-[var(--kt-s3)] text-[var(--kt-accent)] font-bold">Tab</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--kt-s1)] border border-[var(--kt-s4)] flex items-center justify-between">
                    <span className="text-slate-400">Previous Subtitle</span>
                    <kbd className="px-2 py-0.5 rounded bg-[var(--kt-s3)] text-[var(--kt-accent)] font-bold">Shift + Tab</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--kt-s1)] border border-[var(--kt-s4)] flex items-center justify-between">
                    <span className="text-slate-400">Nudge In-Time (-100ms)</span>
                    <kbd className="px-2 py-0.5 rounded bg-[var(--kt-s3)] text-[var(--kt-accent)] font-bold">[</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--kt-s1)] border border-[var(--kt-s4)] flex items-center justify-between">
                    <span className="text-slate-400">Nudge Out-Time (+100ms)</span>
                    <kbd className="px-2 py-0.5 rounded bg-[var(--kt-s3)] text-[var(--kt-accent)] font-bold">]</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--kt-s1)] border border-[var(--kt-s4)] flex items-center justify-between">
                    <span className="text-slate-400">Save Project</span>
                    <kbd className="px-2 py-0.5 rounded bg-[var(--kt-s3)] text-[var(--kt-accent)] font-bold">Ctrl + S</kbd>
                  </div>
                  <div className="p-2 rounded-lg bg-[var(--kt-s1)] border border-[var(--kt-s4)] flex items-center justify-between">
                    <span className="text-slate-400">Undo Action</span>
                    <kbd className="px-2 py-0.5 rounded bg-[var(--kt-s3)] text-[var(--kt-accent)] font-bold">Ctrl + Z</kbd>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
