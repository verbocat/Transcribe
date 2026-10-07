import React, { useState, useEffect, useRef } from 'react';
import {
  Upload, FileAudio, Film, CheckCircle2, RefreshCw, Sparkles, Package, Loader2, Save, Timer
} from 'lucide-react';

import Navbar from './components/Navbar';
import AudioWaveform from './components/AudioWaveform';
import SegmentEditor from './components/SegmentEditor';
import ExportModal from './components/subtitle/SubtitleExportModal';
import GuidelinesModal from './components/GuidelinesModal';
import ProjectsModal from './components/ProjectsModal';
import SrtPreviewModal from './components/SrtPreviewModal';
import StatsModal from './components/StatsModal';
import SpeakerCustomizerModal from './components/SpeakerCustomizerModal';
import TranscribeStudio from './components/transcribe/TranscribeStudio';
import DiffModal from './components/DiffModal';
import ProjectNotesModal from './components/ProjectNotesModal';
import LandingPage from './components/LandingPage';
import SubtitleApp from './components/subtitle/SubtitleApp';
import AdminDashboard from './components/admin/AdminDashboard';
import NotFoundPage from './components/NotFoundPage';
import LogoutConfirmModal from './components/LogoutConfirmModal';
import ReloadConfirmModal from './components/ReloadConfirmModal';
import { parseSubtitles } from './utils/subtitleParser';
import { API_BASE } from './config';
const BUILD_ID = typeof __APP_BUILD__ !== 'undefined' ? __APP_BUILD__ : 'dev';
if (typeof window !== 'undefined') window.__TRANSCRIBE_BUILD__ = BUILD_ID;
import { extractAudioFromMedia } from './utils/audioExtractor';
import { AuthProvider, useAuth } from './auth_views/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import AppearanceHost from './theme/AppearanceHost';
import AuthScreen from './auth_views/AuthScreen';
import Lenis from 'lenis';
import { xhrPostForm, formatBytes, formatSpeed, formatEta } from './utils/xhrUpload';

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
      <AppearanceHost />
    </ThemeProvider>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();

  // Helper to read initial tool from browser URL path or history state
  const getToolFromLocation = () => {
    if (typeof window === 'undefined') return null;
    const path = window.location.pathname.replace(/^\/+/, '').toLowerCase();
    if (path.startsWith('admin')) return 'admin';
    if (path.startsWith('subtitle')) return 'subtitle';
    if (path.startsWith('transcribe')) return 'transcribe';
    return window.history.state?.tool || null;
  };

  // Check if URL indicates a direct auth route (e.g. /login, /signup, /verify-email, ?token=...)
  const isDirectAuthRoute = () => {
    if (typeof window === 'undefined') return false;
    const path = window.location.pathname.toLowerCase();
    const search = window.location.search;
    return (
      path.includes('login') ||
      path.includes('signup') ||
      path.includes('verify') ||
      path.includes('reset') ||
      search.includes('token')
    );
  };

  const isAdminUser = Boolean(
    user?.is_admin ||
    (user?.email && (
      user.email.toLowerCase() === 'arpit.purohit@verbolabs.com' ||
      user.email.toLowerCase() === 'arpit.purohit@verbolab.com'
    ))
  );

  const [activeTool, setActiveTool] = useState(() => {
    const loc = getToolFromLocation();
    return loc;
  });
  const [isNotFound, setIsNotFound] = useState(false);
  const [showAuthScreen, setShowAuthScreen] = useState(() => {
    if (localStorage.getItem('verbolabs_auth_token')) return false;
    return isDirectAuthRoute();
  });
  const [authInitialView, setAuthInitialView] = useState('login');
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Smooth inertial momentum scroll for landing page
  useEffect(() => {
    if (activeTool || showAuthScreen || typeof window === 'undefined') return;

    let lenis;
    let animId;
    try {
      lenis = new Lenis({
        duration: 1.1,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        wheelMultiplier: 1.0,
        touchMultiplier: 1.5,
      });

      function raf(time) {
        lenis?.raf(time);
        animId = requestAnimationFrame(raf);
      }
      animId = requestAnimationFrame(raf);
    } catch (e) {
      console.warn('Lenis smooth scroll skipped:', e);
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
      lenis?.destroy();
    };
  }, [activeTool, showAuthScreen]);

  // Validate current URL route against authenticated permissions
  useEffect(() => {
    if (isLoading) return;
    const path = window.location.pathname.replace(/^\/+/, '').toLowerCase();

    // Direct Auth routes
    if (path.includes('login') || path.includes('signup') || path.includes('verify') || path.includes('reset')) {
      setIsNotFound(false);
      return;
    }

    // Root route
    if (path === '' || path === '/') {
      setIsNotFound(false);
      return;
    }

    // Admin route: strictly forbidden if not authenticated or not admin
    if (path.startsWith('admin')) {
      if (!isAuthenticated || !isAdminUser) {
        setIsNotFound(true);
        setActiveTool(null);
        setShowAuthScreen(false);
      } else {
        setIsNotFound(false);
      }
      return;
    }

    // Subtitle studio
    if (path.startsWith('subtitle')) {
      setIsNotFound(false);
      return;
    }

    // Transcribe studio
    if (path.startsWith('transcribe')) {
      setIsNotFound(false);
      return;
    }

    // Any other arbitrary unhandled URL shows 404
    setIsNotFound(true);
  }, [isAuthenticated, isLoading, isAdminUser]);

  // Cross-tab auto-login, cleanup URL and route admin directly to Command Center
  useEffect(() => {
    if (isAuthenticated) {
      setShowAuthScreen(false);
      const path = window.location.pathname.toLowerCase();

      if (path.includes('login') || path.includes('signup') || path.includes('verify')) {
        if (isAdminUser) {
          setActiveTool('admin');
          window.history.replaceState({ tool: 'admin' }, '', '/admin');
        } else {
          setActiveTool(null);
          window.history.replaceState({ tool: null }, '', '/');
        }
      } else if (isAdminUser && (!activeTool || activeTool === 'home')) {
        const currentLocTool = getToolFromLocation();
        if (currentLocTool === 'subtitle' || currentLocTool === 'transcribe') {
          setActiveTool(currentLocTool);
        } else {
          setActiveTool('admin');
          if (window.location.pathname !== '/admin') {
            window.history.replaceState({ tool: 'admin' }, '', '/admin');
          }
        }
      } else if (!isAdminUser && activeTool === 'admin') {
        setIsNotFound(true);
        setActiveTool(null);
      }
    }
  }, [isAuthenticated, isAdminUser, activeTool]);

  // Synchronize state with browser Back/Forward navigation (Chrome history)
  useEffect(() => {
    if (isLoading) return; // Wait until initial token check completes

    // If not authenticated and on a studio route, redirect cleanly to '/'
    if (!isAuthenticated) {
      const path = window.location.pathname.replace(/^\/+/, '').toLowerCase();
      if (path.startsWith('subtitle') || path.startsWith('transcribe') || path.startsWith('admin')) {
        window.history.replaceState({ tool: null }, '', '/');
        setActiveTool(null);
        setShowAuthScreen(false);
      }
    } else {
      // Record initial authenticated state in history
      if (!window.history.state || window.history.state.tool === undefined) {
        let initialTool = getToolFromLocation();
        if (isAdminUser && !initialTool) initialTool = 'admin';
        const targetUrl = initialTool ? `/${initialTool}` : '/';
        window.history.replaceState({ tool: initialTool }, '', targetUrl);
      }
    }

    const handlePopState = (e) => {
      const path = window.location.pathname.replace(/^\/+/, '').toLowerCase();

      // Popping to an auth route
      if (path.includes('login') || path.includes('signup') || path.includes('verify')) {
        if (isAuthenticated) {
          setShowAuthScreen(false);
          if (isAdminUser) {
            setActiveTool('admin');
          } else {
            setActiveTool(null);
          }
          return;
        }
        setShowAuthScreen(true);
        setActiveTool(null);
        return;
      }

      // Popping to root Landing Page
      if (path === '' || path === '/') {
        if (isAdminUser) {
          setActiveTool('admin');
          window.history.replaceState({ tool: 'admin' }, '', '/admin');
        } else {
          setShowAuthScreen(false);
          setActiveTool(null);
        }
        return;
      }

      // Popping to Admin Command Center
      if (path.startsWith('admin')) {
        if (!isAuthenticated || !isAdminUser) {
          setIsNotFound(true);
          setActiveTool(null);
          setShowAuthScreen(false);
        } else {
          setIsNotFound(false);
          setActiveTool('admin');
          setShowAuthScreen(false);
        }
        return;
      }

      // Popping to Subtitle Studio
      if (path.startsWith('subtitle')) {
        setIsNotFound(false);
        if (!isAuthenticated) {
          window.history.replaceState({ tool: null }, '', '/');
          setActiveTool(null);
          setShowAuthScreen(false);
        } else {
          setActiveTool('subtitle');
          setShowAuthScreen(false);
        }
        return;
      }

      // Popping to Transcribe Studio
      if (path.startsWith('transcribe')) {
        setIsNotFound(false);
        if (!isAuthenticated) {
          window.history.replaceState({ tool: null }, '', '/');
          setActiveTool(null);
          setShowAuthScreen(false);
        } else {
          setActiveTool('transcribe');
          setShowAuthScreen(false);
        }
        return;
      }

      // Any unrecognized URL on popstate
      if (path !== '' && path !== '/' && !path.startsWith('subtitle') && !path.startsWith('transcribe')) {
        setIsNotFound(true);
        setActiveTool(null);
        setShowAuthScreen(false);
        return;
      }

      setIsNotFound(false);
      setActiveTool(null);
      setShowAuthScreen(false);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isAuthenticated, isLoading, isAdminUser]);

  const handleSelectTool = (tool) => {
    setIsNotFound(false);
    if (!isAuthenticated) {
      setAuthInitialView('login');
      setShowAuthScreen(true);
      if (window.location.pathname !== '/login') {
        window.history.pushState({ tool: null, auth: 'login' }, '', '/login');
      }
      return;
    }
    if (tool === 'admin' && !isAdminUser) {
      setIsNotFound(true);
      return;
    }
    const targetUrl = tool ? `/${tool}` : '/';
    if (window.location.pathname !== targetUrl) {
      window.history.pushState({ tool }, '', targetUrl);
    }
    setActiveTool(tool);
    setShowAuthScreen(false);
  };

  const handleBackToHome = () => {
    setIsNotFound(false);
    if (window.location.pathname !== '/') {
      window.history.pushState({ tool: null }, '', '/');
    }
    setActiveTool(null);
    setShowAuthScreen(false);
  };

  const handleLogout = async () => {
    setIsNotFound(false);
    try {
      await logout();
    } catch (err) {
      console.warn('Logout error:', err);
    }
    setActiveTool(null);
    setShowAuthScreen(false);
    setShowLogoutModal(false);
    // Replace URL cleanly with '/' so no previous /subtitle remains in history
    if (window.history.replaceState) {
      window.history.replaceState({ tool: null }, '', '/');
    }
  };

  const handleOpenAuth = (initialView = 'login') => {
    setIsNotFound(false);
    const view = initialView === 'signup' ? 'signup' : 'login';
    setAuthInitialView(view);
    setShowAuthScreen(true);
    const targetUrl = `/${view}`;
    if (window.location.pathname !== targetUrl) {
      window.history.pushState({ tool: null, auth: view }, '', targetUrl);
    }
  };

  // If initial token validation is running
  if (isLoading) {
    return (
      <div style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'var(--kt-s0)',
        color: 'var(--kt-muted)',
        fontFamily: 'sans-serif',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <Loader2 className="animate-spin" size={36} color="var(--kt-accent)" />
        <span style={{ fontSize: '14px', color: 'var(--kt-text)' }}>Verifying VerboLabs session...</span>
      </div>
    );
  }

  // ── 404 Route for unrecognized paths or unauthorized /admin attempts ──
  if (isNotFound) {
    return (
      <>
        <NotFoundPage
          onNavigateHome={() => {
            setIsNotFound(false);
            setActiveTool(null);
            setShowAuthScreen(false);
            window.history.pushState({ tool: null }, '', '/');
          }}
          onNavigateStudio={() => {
            setIsNotFound(false);
            setActiveTool('subtitle');
            setShowAuthScreen(false);
            window.history.pushState({ tool: 'subtitle' }, '', '/subtitle');
          }}
          onOpenAuth={(view) => {
            setIsNotFound(false);
            setActiveTool(null);
            setAuthInitialView(view || 'login');
            setShowAuthScreen(true);
          }}
        />
      </>
    );
  }

  // If user requested AuthScreen (Login / Signup / Verify Email) while unauthenticated
  if (!isAuthenticated && showAuthScreen) {
    return (
      <>
        <AuthScreen
          initialView={authInitialView}
          onBackToHome={() => {
            setShowAuthScreen(false);
            if (window.history.replaceState) {
              window.history.replaceState({ tool: null }, '', '/');
            }
          }}
        />
      </>
    );
  }

  // ── Tool Routing for authenticated users ──
  if (isAuthenticated && activeTool === 'subtitle') {
    return (
      <>
        <SubtitleApp
          onBackToHome={handleBackToHome}
          user={user}
          onLogout={() => setShowLogoutModal(true)}
          onOpenLogoutModal={() => setShowLogoutModal(true)}
        />
        <LogoutConfirmModal
          isOpen={showLogoutModal}
          onClose={() => setShowLogoutModal(false)}
          onConfirm={handleLogout}
          user={user}
        />
      </>
    );
  }

  if (isAuthenticated && activeTool === 'transcribe') {
    return (
      <>
        <TranscribeApp
          onBackToHome={handleBackToHome}
          user={user}
          onLogout={() => setShowLogoutModal(true)}
          onOpenLogoutModal={() => setShowLogoutModal(true)}
        />
        <LogoutConfirmModal
          isOpen={showLogoutModal}
          onClose={() => setShowLogoutModal(false)}
          onConfirm={handleLogout}
          user={user}
        />
      </>
    );
  }

  if (isAuthenticated && activeTool === 'admin') {
    if (!isAdminUser) {
      return (
        <>
          <NotFoundPage
            onNavigateHome={() => {
              setActiveTool(null);
              window.history.replaceState({ tool: null }, '', '/');
            }}
            onNavigateStudio={() => {
              setActiveTool('subtitle');
              window.history.replaceState({ tool: 'subtitle' }, '', '/subtitle');
            }}
          />
        </>
      );
    }
    return (
      <>
        <AdminDashboard
          onBackToStudio={() => handleSelectTool('subtitle')}
          user={user}
          onLogout={() => setShowLogoutModal(true)}
        />
        <LogoutConfirmModal
          isOpen={showLogoutModal}
          onClose={() => setShowLogoutModal(false)}
          onConfirm={handleLogout}
          user={user}
        />
      </>
    );
  }

  // ── Public Home Landing Page (default route for all visitors & authenticated users at root) ──
  return (
    <>
      <LandingPage
        onSelect={handleSelectTool}
        user={user}
        onLogout={() => setShowLogoutModal(true)}
        onOpenAuth={handleOpenAuth}
      />
      <LogoutConfirmModal
        isOpen={showLogoutModal}
        onClose={() => setShowLogoutModal(false)}
        onConfirm={handleLogout}
        user={user}
      />
    </>
  );
}

function TranscribeApp({ onBackToHome, user, onLogout, onOpenLogoutModal }) {
  const [showGuidelines, setShowGuidelines] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showSrtPreview, setShowSrtPreview] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showSpeakerModal, setShowSpeakerModal] = useState(false);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [originalSegments, setOriginalSegments] = useState([]);
  const [autoSaveStatus, setAutoSaveStatus] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);

  // Undo / Redo History Stack
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const [showProjectsModal, setShowProjectsModal] = useState(false);
  const [showReloadConfirmModal, setShowReloadConfirmModal] = useState(false);
  const [savedProjects, setSavedProjects] = useState([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isSavingToDb, setIsSavingToDb] = useState(false);
  const [dbSaveToast, setDbSaveToast] = useState('');

  const [selectedFile, setSelectedFile] = useState(null);
  const [audioUrl, setAudioUrl] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [targetLanguage, setTargetLanguage] = useState('Auto-Detect');
  const [targetScript, setTargetScript] = useState('Auto-Detect');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedExportFormats, setSelectedExportFormats] = useState(['csv', 'docx', 'xlsx', 'srt', 'json']);
  const [isExtractingAudio, setIsExtractingAudio] = useState(false);
  const [extractionNotice, setExtractionNotice] = useState('');

  // Detailed Progress Bar State with Live Elapsed Time
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStage, setProgressStage] = useState('');
  const [progressDetail, setProgressDetail] = useState('');
  const [progressStepIndex, setProgressStepIndex] = useState(1);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [progressEstimated, setProgressEstimated] = useState(false);
  const [progressStepCount, setProgressStepCount] = useState(3);
  const [extractedAudioName, setExtractedAudioName] = useState('');
  const [extractedForFile, setExtractedForFile] = useState('');
  const [progressMeta, setProgressMeta] = useState('');
  const extractedAudioFileRef = useRef(null); // small WAV made on this computer; uploaded instead of the video
  const progressTimerRef = useRef(null);
  const elapsedTimerRef = useRef(null);

  const [transcriptionResult, setTranscriptionResult] = useState(null);
  const [segments, setSegments] = useState([]);
  const [activeSegmentId, setActiveSegmentId] = useState(null);
  const [playTargetTime, setPlayTargetTime] = useState(null);
  const [complianceScore, setComplianceScore] = useState(100.0);
  const [totalErrors, setTotalErrors] = useState(0);
  const [totalWarnings, setTotalWarnings] = useState(0);

  // Intercept reload shortcuts (F5, Ctrl+R, Cmd+R), ESC key for all modals & beforeunload in Transcribe Studio
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showReloadConfirmModal) { setShowReloadConfirmModal(false); return; }
        if (showGuidelines) { setShowGuidelines(false); return; }
        if (showExportModal) { setShowExportModal(false); return; }
        if (showSrtPreview) { setShowSrtPreview(false); return; }
        if (showStatsModal) { setShowStatsModal(false); return; }
        if (showSpeakerModal) { setShowSpeakerModal(false); return; }
        if (showDiffModal) { setShowDiffModal(false); return; }
        if (showNotesModal) { setShowNotesModal(false); return; }
        if (showProjectsModal) { setShowProjectsModal(false); return; }
      }
      if (
        e.key === 'F5' ||
        ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))
      ) {
        e.preventDefault();
        setShowReloadConfirmModal(true);
      }
    };

    const handleBeforeUnload = (e) => {
      if (selectedFile || (segments && segments.length > 0) || isTranscribing) {
        e.preventDefault();
        e.returnValue = 'Are you sure you want to reload? Any unsaved edits will be lost.';
        return e.returnValue;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [
    selectedFile,
    segments,
    isTranscribing,
    showReloadConfirmModal,
    showGuidelines,
    showExportModal,
    showSrtPreview,
    showStatsModal,
    showSpeakerModal,
    showDiffModal,
    showNotesModal,
    showProjectsModal
  ]);

  useEffect(() => {
    fetchHealth();
  }, []);

  const fetchHealth = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/health`);
      if (res.ok) {
        const data = await res.json();
        let storedElevenLabsKey = '';
        try { storedElevenLabsKey = (localStorage.getItem('elevenlabs_api_key') || '').trim(); } catch {}
        setHasApiKey(!!data.has_elevenlabs_api_key || !!storedElevenLabsKey);
        setTargetLanguage('Auto-Detect');
        setTargetScript('Auto-Detect');
      }
    } catch (err) {
      console.error("Backend connection error:", err);
    }
  };

  // FEAT-06: 30-second debounced auto-save to localStorage
  useEffect(() => {
    if (!segments || segments.length === 0) return;
    const fileId = selectedFile?.name || transcriptionResult?.filename || 'draft_audio';
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(`karya_autosave_${fileId}`, JSON.stringify({
          segments,
          complianceScore,
          totalErrors,
          totalWarnings,
          timestamp: new Date().toISOString()
        }));
        setAutoSaveStatus('Draft auto-saved ✓');
        setTimeout(() => setAutoSaveStatus(''), 2500);
      } catch (e) {
        console.warn('Auto-save storage quota exceeded', e);
      }
    }, 30000);

    return () => clearTimeout(timer);
  }, [segments, complianceScore, totalErrors, totalWarnings, selectedFile, transcriptionResult]);

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setTranscriptionResult(null);
      setSegments([]);
      setComplianceScore(100.0);
      setTotalErrors(0);
      setTotalWarnings(0);
      setProgressPercent(0);
      setExtractedAudioName('');

      const isVideo = Boolean(
        file.type?.startsWith('video/') ||
        /\.(mp4|mkv|mov|webm|avi|flv|wmv|m4v|ts)$/i.test(file.name || '')
      );
      // Browsers cannot decode WMA, so the server converts it to WAV for the waveform player
      const needsServerDecode = /\.wma$/i.test(file.name || '');

      setVideoUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return isVideo ? URL.createObjectURL(file) : null; });

      extractedAudioFileRef.current = null;
      if (isVideo || needsServerDecode) {
        setIsExtractingAudio(true);
        setExtractionNotice(isVideo ? 'Extracting audio track from video...' : 'Converting WMA audio for playback...');
        try {
          // Audio is extracted ON THIS COMPUTER (WebAssembly FFmpeg), so only ~2 MB per minute of audio is ever
          // uploaded instead of the whole video. Falls back to the server (with live progress) on any problem.
          const extracted = await extractAudioFromMedia(file, (p) => {
            const pct = typeof p.percent === 'number' && Number.isFinite(p.percent) ? ` ${Math.round(p.percent)}%` : '';
            setExtractionNotice(`${p.detail || 'Preparing audio'}${pct}`);
          }, API_BASE);
          const isBlob = !extracted.audioUrl || extracted.audioUrl.startsWith('blob:');
          setAudioUrl(extracted.audioUrl || URL.createObjectURL(extracted.audioBlob));
          extractedAudioFileRef.current = extracted.audioFile || null;
          // A server-made WAV already sits on the server: reuse it by name instead of uploading it again
          setExtractedAudioName(isBlob ? '' : (extracted.audioFile?.name || ''));
          setExtractedForFile(file.name);
          setExtractionNotice('Audio extracted successfully ✓');
          setTimeout(() => setExtractionNotice(''), 3000);
        } catch (err) {
          console.warn("Video audio extraction fallback:", err);
          setAudioUrl(URL.createObjectURL(file));
        } finally {
          setIsExtractingAudio(false);
        }
      } else {
        const url = URL.createObjectURL(file);
        setAudioUrl(url);
      }
    }
  };

  // Transcription progress. Upload bytes are measured (XMLHttpRequest). The server then runs one long request, so the
  // wait is an estimate from the audio length and this server's own measured speed (learned from earlier runs), shown
  // as "≈" and never reaching 100% before the result arrives.
  // Audio length from the media's own metadata (used to estimate the server wait)
  const probeDuration = (url) => new Promise((resolve) => {
    if (!url) return resolve(0);
    const a = new Audio();
    const done = (v) => { a.src = ''; resolve(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 4000);
    a.src = url;
  });

  const SPEED_KEY = 'transcribe_speed_ratio'; // seconds of processing per second of audio

  const stopProgressTimers = () => {
    if (progressTimerRef.current) { clearInterval(progressTimerRef.current); progressTimerRef.current = null; }
    if (elapsedTimerRef.current) { clearInterval(elapsedTimerRef.current); elapsedTimerRef.current = null; }
  };

  const startElapsedTimer = (startTime) => {
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => setElapsedSeconds((Date.now() - startTime) / 1000), 250);
  };

  const beginUploadProgress = () => {
    stopProgressTimers();
    setProgressStepIndex(1);
    setProgressStepCount(3);
    setProgressStage('Uploading audio');
    setProgressDetail(selectedFile?.name || '');
    setProgressPercent(0);
    setProgressEstimated(false);
    setProgressMeta('');
    setElapsedSeconds(0);
    startElapsedTimer(Date.now());
  };

  const onUploadProgress = ({ percent, loaded, total, speed, eta }) => {
    setProgressPercent(percent);
    setProgressMeta([`${formatBytes(loaded)} of ${formatBytes(total)}`, formatSpeed(speed), formatEta(eta)].filter(Boolean).join(' · '));
  };

  const beginServerProgress = (audioSeconds) => {
    const startedAt = Date.now();
    let ratio = 0.15;
    try { ratio = parseFloat(localStorage.getItem(SPEED_KEY)) || ratio; } catch {}
    const expected = Math.max(8, (audioSeconds || 60) * ratio);
    setProgressStepIndex(2);
    setProgressStage('Transcribing');
    setProgressDetail('Speech recognition, speakers, gender and Karya checks on the server');
    setProgressEstimated(true);
    setProgressPercent(0);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = setInterval(() => {
      const t = (Date.now() - startedAt) / 1000;
      // Approaches 95% as time passes the expected duration, never reaches it
      const pct = 95 * (1 - Math.exp(-1.6 * t / expected));
      setProgressPercent(pct);
      const left = Math.max(0, Math.round(expected - t));
      setProgressMeta(t < expected ? `about ${left >= 60 ? `${Math.floor(left / 60)} min ${left % 60} s` : `${left} s`} left` : 'taking longer than usual');
    }, 400);
    return startedAt;
  };

  const finishProgress = (success, startedAt, audioSeconds) => {
    stopProgressTimers();
    if (success) {
      if (startedAt && audioSeconds > 5) {
        try { localStorage.setItem(SPEED_KEY, String(((Date.now() - startedAt) / 1000 / audioSeconds).toFixed(4))); } catch {}
      }
      setProgressStepIndex(3);
      setProgressEstimated(false);
      setProgressPercent(100);
    } else {
      setProgressPercent(0);
    }
  };

  const applyTranscriptionResult = (data) => {
    setTranscriptionResult(data);
    const segs = data.segments || [];
    setSegments(segs);
    setOriginalSegments(JSON.parse(JSON.stringify(segs)));
    setHistory([segs]);
    setHistoryIndex(0);
    setComplianceScore(data.compliance_score || 100.0);
    setTotalErrors(data.total_errors || 0);
    setTotalWarnings(data.total_warnings || 0);
    if (segs.length > 0) setActiveSegmentId(segs[0].segment_id);
  };

  // Poll a /api/transcribe_async job: the strip shows the server's own stage, step and percent
  const pollTranscribeJob = async (jobId) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (;;) {
      const res = await fetch(`${API_BASE}/api/transcribe_status/${jobId}`);
      if (!res.ok) throw new Error(res.status === 404 ? 'The transcription job expired or the server restarted.' : `Status check failed (${res.status}).`);
      const job = await res.json();
      if (job.stage === 'error') throw new Error(job.error || 'Transcription failed.');
      if (job.stage === 'done') return job.result;
      const active = (job.stages || []).find((x) => x.status === 'active');
      setProgressStage(active?.label || 'Preparing');
      setProgressDetail(job.detail || '');
      setProgressStepIndex(job.step || 1);
      setProgressStepCount(job.step_count || 0);
      setProgressPercent(typeof job.percent === 'number' ? job.percent : null);
      // The speech engine answers once, so its share of the bar is the server's estimate
      setProgressEstimated(job.stage === 'transcribing');
      setProgressMeta(job.stage_percent != null && job.stage !== 'transcribing' ? `${Math.round(job.stage_percent)}% of this step` : '');
      await sleep(700);
    }
  };

  const handleStartTranscribe = async () => {
    if (!selectedFile) return;
    setIsTranscribing(true);
    beginUploadProgress();
    let serverStartedAt = 0;
    let localWav = null;
    let audioSeconds = 0;
    try { audioSeconds = await probeDuration(audioUrl || videoUrl); } catch {}

    const build = (fileToSend) => {
      const fd = new FormData();
      if (fileToSend) fd.append('file', fileToSend);
      fd.append('language', targetLanguage);
      fd.append('script', targetScript);
      try {
        const storedElevenLabsKey = (localStorage.getItem('elevenlabs_api_key') || '').trim();
        if (storedElevenLabsKey) fd.append('elevenlabs_api_key', storedElevenLabsKey);
      } catch {}
      return fd;
    };

    try {
      let data = null;
      // Preferred: background job with real stages. Reuse the audio already extracted for the waveform when we have it.
      const sameFile = selectedFile.name === extractedForFile;
      const reuse = sameFile && extractedAudioName;
      localWav = sameFile && !reuse ? extractedAudioFileRef.current : null;
      const fd = build(reuse ? null : (localWav || selectedFile));
      if (reuse) fd.append('audio_filename', extractedAudioName);
      else setProgressStepCount(0);
      console.info('[transcribe] POST /api/transcribe_async', { build: BUILD_ID, uploading: reuse ? 'nothing (audio already on server)' : localWav ? `audio ${formatBytes(localWav.size)}` : `original file ${formatBytes(selectedFile.size)}` });
      const start = await xhrPostForm(`${API_BASE}/api/transcribe_async`, fd, {
        onProgress: onUploadProgress,
        onSent: () => { setProgressStepCount(0); setProgressStage('Starting'); setProgressDetail(''); setProgressMeta(''); setProgressPercent(null); },
      });
      if (start.ok && start.data?.job_id) {
        setProgressStepCount(0);
        data = await pollTranscribeJob(start.data.job_id);
        finishProgress(true);
      } else if (start.status === 404 || start.status === 405) {
        // Older backend without the job API: the blocking endpoint, with an estimated wait
        console.warn('[transcribe] /api/transcribe_async returned', start.status, '- falling back to the old blocking endpoint (no real-time progress). The backend is not running the new code.');
        beginUploadProgress();
        const res = await xhrPostForm(`${API_BASE}/api/transcribe`, build(localWav || selectedFile), {
          onProgress: onUploadProgress,
          onSent: () => { serverStartedAt = beginServerProgress(audioSeconds); },
        });
        if (!res.ok) throw new Error(res.data?.detail || res.text || 'Failed to process audio');
        data = res.data || {};
        finishProgress(true, serverStartedAt, audioSeconds);
      } else {
        throw new Error(start.data?.detail || start.text || 'Failed to start transcription');
      }
      applyTranscriptionResult(data);
    } catch (err) {
      finishProgress(false);
      console.error("Transcribe failed:", err);
      alert(`Transcription error: ${err.message || err}`);
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleLint = async (updatedSegments) => {
    try {
      const res = await fetch(`${API_BASE}/api/lint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments: updatedSegments,
          language: transcriptionResult?.language || targetLanguage || 'Hindi',
          script: transcriptionResult?.script || targetScript || 'Devanagari'
        })
      });

      if (res.ok) {
        const data = await res.json();
        setSegments(data.segments);
        setComplianceScore(data.compliance_score);
        setTotalErrors(data.total_errors);
        setTotalWarnings(data.total_warnings);

        if (transcriptionResult) {
          setTranscriptionResult({
            ...transcriptionResult,
            segments: data.segments,
            compliance_score: data.compliance_score,
            total_errors: data.total_errors,
            total_warnings: data.total_warnings
          });
        }
      }
    } catch (err) {
      console.error("Lint failed:", err);
    }
  };

  const toggleExportFormat = (fmtId) => {
    if (selectedExportFormats.includes(fmtId)) {
      if (selectedExportFormats.length > 1) {
        setSelectedExportFormats(selectedExportFormats.filter((f) => f !== fmtId));
      }
    } else {
      setSelectedExportFormats([...selectedExportFormats, fmtId]);
    }
  };

  const handleDubbingExport = async () => {
    if (segments.length === 0) return;
    setIsExporting(true);
    try {
      const filename = selectedFile ? selectedFile.name : (transcriptionResult?.filename || 'audio_transcript.wav');
      const res = await fetch(`${API_BASE}/api/export/dubbing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          result: {
            filename,
            language: transcriptionResult?.language || targetLanguage,
            script: transcriptionResult?.script || targetScript,
            segments
          }
        })
      });
      if (!res.ok) {
        alert("Failed to export dubbing script.");
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename.replace(/\.[^/.]+$/, "")}_dubbing_script.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Dubbing export failed:", err);
      alert("Export failed: " + err);
    } finally {
      setIsExporting(false);
    }
  };

  const handleMultiExport = async () => {
    if (segments.length === 0) return;
    setIsExporting(true);

    try {
      const payloadResult = {
        audio_id: transcriptionResult?.audio_id || 'audio_001',
        filename: selectedFile ? selectedFile.name : (transcriptionResult?.filename || 'audio_transcript.wav'),
        language: transcriptionResult?.language || targetLanguage || 'Hindi',
        script: transcriptionResult?.script || targetScript || 'Devanagari',
        segments: segments,
        compliance_score: complianceScore,
        total_errors: totalErrors,
        total_warnings: totalWarnings,
        audio_info: transcriptionResult?.audio_info || {
          filename: selectedFile ? selectedFile.name : 'audio.wav',
          duration: segments.length > 0 ? segments[segments.length - 1].end_time : 0,
          sample_rate: 16000,
          channels: 1,
          rms_db: -20.0,
          snr_db: 25.0
        }
      };

      const res = await fetch(`${API_BASE}/api/export/multi`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          result: payloadResult,
          formats: selectedExportFormats
        })
      });

      if (res.ok) {
        const blob = await res.blob();
        const baseName = payloadResult.filename.replace(/\.[^/.]+$/, "");
        const disposition = res.headers.get('Content-Disposition') || '';
        let filename = `${baseName}_deliverables.zip`;
        const match = disposition.match(/filename="?([^"]+)"?/);
        if (match && match[1]) filename = match[1];

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        alert("Failed to export deliverables.");
      }
    } catch (err) {
      console.error("Multi export failed:", err);
      alert("Export failed: " + err);
    } finally {
      setIsExporting(false);
    }
  };

  const fetchProjects = async () => {
    setIsLoadingProjects(true);
    try {
      const res = await fetch(`${API_BASE}/api/projects`);
      if (res.ok) {
        const data = await res.json();
        setSavedProjects(data.projects || []);
      }
    } catch (err) {
      console.error("Failed to fetch Neon DB projects:", err);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  const handleOpenProjects = () => {
    fetchProjects();
    setShowProjectsModal(true);
  };

  const handleSaveToNeonDb = async () => {
    if (segments.length === 0) return;
    setIsSavingToDb(true);
    try {
      const payloadResult = {
        audio_id: transcriptionResult?.audio_id || 'audio_001',
        filename: selectedFile ? selectedFile.name : (transcriptionResult?.filename || 'audio_transcript.wav'),
        language: transcriptionResult?.language || targetLanguage || 'Hindi',
        script: transcriptionResult?.script || targetScript || 'Devanagari',
        segments: segments,
        compliance_score: complianceScore,
        total_errors: totalErrors,
        total_warnings: totalWarnings,
        audio_info: transcriptionResult?.audio_info || {
          filename: selectedFile ? selectedFile.name : 'audio.wav',
          duration: segments.length > 0 ? segments[segments.length - 1].end_time : 0,
          sample_rate: 16000,
          channels: 1,
          rms_db: -20.0,
          snr_db: 25.0
        }
      };

      const res = await fetch(`${API_BASE}/api/projects/save`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ result: payloadResult })
      });

      // The backend replies 200 with {status: "error"} when the DB write fails
      const data = res.ok ? await res.json().catch(() => ({})) : {};
      if (res.ok && data.status === 'success') {
        setDbSaveToast('Saved to Neon PostgreSQL DB!');
      } else {
        setDbSaveToast(`Save failed: ${data.message || `HTTP ${res.status}`}`);
      }
      setTimeout(() => setDbSaveToast(''), 3500);
    } catch (err) {
      console.error("Save to Neon DB failed:", err);
      setDbSaveToast(`Save failed: ${err.message || err}`);
      setTimeout(() => setDbSaveToast(''), 3500);
    } finally {
      setIsSavingToDb(false);
    }
  };

  const pushToHistory = (newSegments) => {
    setHistory((prev) => {
      const next = prev.slice(0, historyIndex + 1);
      return [...next, newSegments];
    });
    setHistoryIndex((prev) => prev + 1);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const targetIdx = historyIndex - 1;
      const targetSegs = history[targetIdx];
      setHistoryIndex(targetIdx);
      setSegments(targetSegs);
      handleLint(targetSegs);
      setDbSaveToast('Undo applied (Ctrl+Z)');
      setTimeout(() => setDbSaveToast(''), 1500);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const targetIdx = historyIndex + 1;
      const targetSegs = history[targetIdx];
      setHistoryIndex(targetIdx);
      setSegments(targetSegs);
      handleLint(targetSegs);
      setDbSaveToast('Redo applied (Ctrl+Y)');
      setTimeout(() => setDbSaveToast(''), 1500);
    }
  };

  const handleImportSubtitles = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result;
        const parsed = parseSubtitles(text);
        if (parsed && parsed.length > 0) {
          setSegments(parsed);
          setOriginalSegments(JSON.parse(JSON.stringify(parsed)));
          setHistory([parsed]);
          setHistoryIndex(0);
          handleLint(parsed);
          setDbSaveToast(`Imported ${parsed.length} subtitles from ${file.name} ✓`);
          setTimeout(() => setDbSaveToast(''), 3000);
        } else {
          alert('Could not parse subtitles from this file.');
        }
      } catch (err) {
        alert('Failed to parse subtitle file: ' + err);
      }
    };
    reader.readAsText(file);
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (!isInput) {
          e.preventDefault();
          handleUndo();
        }
      } else if (
        ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') ||
        ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z')
      ) {
        if (!isInput) {
          e.preventDefault();
          handleRedo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveToNeonDb();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history, historyIndex, segments, transcriptionResult, complianceScore, totalErrors, totalWarnings, selectedFile, targetLanguage, targetScript]);

  const handleLoadProject = async (projectId) => {
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setTranscriptionResult(data);
        const segs = data.segments || [];
        setSegments(segs);
        setOriginalSegments(JSON.parse(JSON.stringify(segs)));
        setHistory([segs]);
        setHistoryIndex(0);
        setTargetLanguage(data.language || 'Auto-Detect');
        setTargetScript(data.script || 'Auto-Detect');
        setComplianceScore(data.compliance_score || 100.0);
        setTotalErrors(data.total_errors || 0);
        setTotalWarnings(data.total_warnings || 0);
        if (segs.length > 0) {
          setActiveSegmentId(segs[0].segment_id);
        }
        setVideoUrl(null);
        if (data.filename) {
          setAudioUrl(`${API_BASE}/api/audio/${data.filename}`);
        }
        setDbSaveToast(`Loaded: ${data.filename}`);
        setTimeout(() => setDbSaveToast(''), 3500);
      }
    } catch (err) {
      console.error("Failed to load project:", err);
    }
  };

  const handleDeleteProject = async (projectId) => {
    if (!window.confirm("Are you sure you want to delete this project from Neon DB?")) return;
    try {
      const res = await fetch(`${API_BASE}/api/projects/${projectId}`, { method: 'DELETE' });
      if (res.ok) {
        setSavedProjects((prev) => prev.filter((p) => p.id !== projectId));
      }
    } catch (err) {
      console.error("Failed to delete project:", err);
    }
  };

  const handleSegmentTimeChange = (segId, newStart, newEnd) => {
    const formatTimeStr = (secs) => {
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      const ms = Math.floor((secs % 1) * 1000);
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    };

    setSegments((prevSegments) => {
      const updated = prevSegments.map((s) => {
        if (s.segment_id === segId) {
          const s_time = Math.max(0, Math.round(newStart * 1000) / 1000);
          const e_time = Math.max(s_time + 0.1, Math.round(newEnd * 1000) / 1000);
          return {
            ...s,
            start_time: s_time,
            end_time: e_time,
            duration: Math.round((e_time - s_time) * 1000) / 1000,
            start_time_str: formatTimeStr(s_time),
            end_time_str: formatTimeStr(e_time)
          };
        }
        return s;
      });

      if (transcriptionResult) {
        setTranscriptionResult((prevRes) => ({
          ...prevRes,
          segments: updated
        }));
      }

      return updated;
    });
  };

  const handleSplitSegmentAtTime = (segId, splitTime) => {
    const formatTimeStr = (secs) => {
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      const ms = Math.floor((secs % 1) * 1000);
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    };

    setSegments((prev) => {
      const targetSeg = prev.find((s) => s.segment_id === segId);
      if (!targetSeg) return prev;

      const split = Math.max(
        targetSeg.start_time + 0.1,
        Math.min(targetSeg.end_time - 0.1, splitTime || (targetSeg.start_time + targetSeg.end_time) / 2)
      );
      const words = (targetSeg.transcript || '').trim().split(/\s+/);
      const half = Math.ceil(words.length / 2);
      const text1 = words.slice(0, half).join(' ');
      const text2 = words.slice(half).join(' ');

      const newSegments = [];
      prev.forEach((s) => {
        if (s.segment_id === segId) {
          newSegments.push({
            ...s,
            end_time: split,
            duration: parseFloat((split - s.start_time).toFixed(3)),
            start_time_str: formatTimeStr(s.start_time),
            end_time_str: formatTimeStr(split),
            transcript: text1,
            words: []
          });
          newSegments.push({
            ...s,
            segment_id: s.segment_id + 0.5,
            start_time: parseFloat((split + 0.05).toFixed(3)),
            end_time: s.end_time,
            duration: parseFloat((s.end_time - split - 0.05).toFixed(3)),
            start_time_str: formatTimeStr(split + 0.05),
            end_time_str: formatTimeStr(s.end_time),
            transcript: text2,
            words: []
          });
        } else {
          newSegments.push(s);
        }
      });

      const reindexed = newSegments.map((s, idx) => ({ ...s, segment_id: idx + 1 }));
      if (transcriptionResult) {
        setTranscriptionResult((prevRes) => ({ ...prevRes, segments: reindexed }));
      }
      handleLint(reindexed);
      return reindexed;
    });
  };

  const handleMergeSegmentWithNext = (segId) => {
    const formatTimeStr = (secs) => {
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      const ms = Math.floor((secs % 1) * 1000);
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    };

    setSegments((prev) => {
      const index = prev.findIndex((s) => s.segment_id === segId);
      if (index === -1 || index >= prev.length - 1) return prev;

      const current = prev[index];
      const next = prev[index + 1];

      const merged = {
        ...current,
        end_time: next.end_time,
        duration: parseFloat((next.end_time - current.start_time).toFixed(3)),
        start_time_str: formatTimeStr(current.start_time),
        end_time_str: formatTimeStr(next.end_time),
        transcript: `${current.transcript || ''} ${next.transcript || ''}`.trim(),
        words: [...(current.words || []), ...(next.words || [])]
      };

      const newSegments = [...prev];
      newSegments.splice(index, 2, merged);
      const reindexed = newSegments.map((s, idx) => ({ ...s, segment_id: idx + 1 }));
      if (transcriptionResult) {
        setTranscriptionResult((prevRes) => ({ ...prevRes, segments: reindexed }));
      }
      handleLint(reindexed);
      return reindexed;
    });
  };

  const handleAddSegmentAtTime = (startTime) => {
    const formatTimeStr = (secs) => {
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      const ms = Math.floor((secs % 1) * 1000);
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    };

    const sTime = parseFloat(startTime.toFixed(3));
    const eTime = parseFloat((sTime + 2.0).toFixed(3));

    const newSeg = {
      segment_id: segments.length + 1,
      speaker: 'Speaker 1',
      gender: 'Male',
      start_time: sTime,
      end_time: eTime,
      start_time_str: formatTimeStr(sTime),
      end_time_str: formatTimeStr(eTime),
      duration: 2.0,
      transcript: '',
      confidence: 1.0,
      words: [],
      qc_errors: [],
      is_valid: true
    };

    const updated = [...segments, newSeg].sort((a, b) => a.start_time - b.start_time).map((s, idx) => ({ ...s, segment_id: idx + 1 }));
    setSegments(updated);
    pushToHistory(updated);
    setActiveSegmentId(newSeg.segment_id);
    handleLint(updated);
    setDbSaveToast(`Added new segment at ${sTime.toFixed(2)}s ✓`);
    setTimeout(() => setDbSaveToast(''), 2000);
  };

  return (
    <div>
      <TranscribeStudio
        user={user}
        onOpenLogoutModal={onOpenLogoutModal}
        onBackToHome={onBackToHome}
        filename={selectedFile ? selectedFile.name : (transcriptionResult?.filename || null)}
        canTranscribe={!!selectedFile}
        language={targetLanguage}
        setLanguage={setTargetLanguage}
        script={targetScript}
        setScript={setTargetScript}
        isTranscribing={isTranscribing}
        isExtractingAudio={isExtractingAudio}
        extractionNotice={extractionNotice}
        progressPercent={progressPercent}
        progressEstimated={progressEstimated}
        progressStepCount={progressStepCount}
        detectedLanguage={transcriptionResult?.language || ''}
        progressMeta={progressMeta}
        progressStage={progressStage}
        progressDetail={progressDetail}
        progressStepIndex={progressStepIndex}
        elapsedSeconds={elapsedSeconds}
        onFileSelect={handleFileSelect}
        onTranscribe={handleStartTranscribe}
        segments={segments}
        setSegments={setSegments}
        pushToHistory={pushToHistory}
        onLint={handleLint}
        complianceScore={complianceScore}
        totalErrors={totalErrors}
        totalWarnings={totalWarnings}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        onUndo={handleUndo}
        onRedo={handleRedo}
        isSaving={isSavingToDb}
        onSave={handleSaveToNeonDb}
        exportFormats={selectedExportFormats}
        onToggleFormat={toggleExportFormat}
        onDownload={handleMultiExport}
        onDubbing={handleDubbingExport}
        isExporting={isExporting}
        onOpenProjects={handleOpenProjects}
        onOpenStats={() => setShowStatsModal(true)}
        onOpenDiff={() => setShowDiffModal(true)}
        onOpenNotes={() => setShowNotesModal(true)}
        onOpenGuidelines={() => setShowGuidelines(true)}
        onOpenSpeakerSwap={() => setShowSpeakerModal(true)}
        onOpenSrtPreview={() => setShowSrtPreview(true)}
        onImportSubtitles={handleImportSubtitles}
        activeSegmentId={activeSegmentId}
        setActiveSegmentId={setActiveSegmentId}
        onPlaySegment={(start, end) => setPlayTargetTime({ time: start, endTime: end, loop: true, ts: Date.now() })}
        onStopSegment={(start) => setPlayTargetTime({ time: start, endTime: start, loop: false, pause: true, ts: Date.now() })}
        onSplit={handleSplitSegmentAtTime}
        onMerge={handleMergeSegmentWithNext}
        onAdd={handleAddSegmentAtTime}
        onSegmentTimeChange={handleSegmentTimeChange}
        audioUrl={audioUrl}
        videoUrl={videoUrl}
        playTargetTime={playTargetTime}
        notes={transcriptionResult?.processing_notes || []}
        toast={dbSaveToast || autoSaveStatus}
      />

      {/* Modals */}
      <SrtPreviewModal
        isOpen={showSrtPreview}
        onClose={() => setShowSrtPreview(false)}
        segments={segments}
        filename={selectedFile ? selectedFile.name : 'audio_transcript'}
      />

      <StatsModal
        isOpen={showStatsModal}
        onClose={() => setShowStatsModal(false)}
        segments={segments}
        audioInfo={transcriptionResult?.audio_info}
        filename={selectedFile ? selectedFile.name : 'audio_transcript'}
        complianceScore={complianceScore}
      />

      <SpeakerCustomizerModal
        isOpen={showSpeakerModal}
        onClose={() => setShowSpeakerModal(false)}
        segments={segments}
        onUpdateSegments={(updated) => {
          setSegments(updated);
          pushToHistory(updated);
          handleLint(updated);
        }}
      />

      <ExportModal
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        transcriptionResult={transcriptionResult || {
          filename: selectedFile ? selectedFile.name : 'audio_transcript',
          language: targetLanguage,
          script: targetScript,
          segments: segments,
          compliance_score: complianceScore,
          total_errors: totalErrors,
          total_warnings: totalWarnings,
          audio_info: { duration: 0, sample_rate: 16000, channels: 1, rms_db: -20, snr_db: 25 }
        }}
      />

      <GuidelinesModal
        isOpen={showGuidelines}
        onClose={() => setShowGuidelines(false)}
      />

      <DiffModal
        isOpen={showDiffModal}
        onClose={() => setShowDiffModal(false)}
        originalSegments={originalSegments}
        currentSegments={segments}
      />

      <ProjectNotesModal
        isOpen={showNotesModal}
        onClose={() => setShowNotesModal(false)}
        filename={selectedFile ? selectedFile.name : (transcriptionResult?.filename || 'Current Project')}
      />

      <ProjectsModal
        isOpen={showProjectsModal}
        onClose={() => setShowProjectsModal(false)}
        projects={savedProjects}
        isLoading={isLoadingProjects}
        onRefresh={fetchProjects}
        onLoadProject={handleLoadProject}
        onDeleteProject={handleDeleteProject}
      />

      {/* ── Transcribe Studio Reload Confirmation Modal ── */}
      <ReloadConfirmModal
        isOpen={showReloadConfirmModal}
        onClose={() => setShowReloadConfirmModal(false)}
        onConfirm={() => {
          setShowReloadConfirmModal(false);
          window.location.reload();
        }}
        title="Reload Transcribe Studio?"
        description="Are you sure you want to reload? Any active audio transcription, waveform alignments, or unsaved segment edits will be interrupted."
      />
    </div>
  );
}
