import React, { useState, useEffect, useRef } from 'react';
import {
  Upload, FileAudio, CheckCircle2, RefreshCw, Sparkles, Package, Loader2, Save, Timer
} from 'lucide-react';

import Navbar from './components/Navbar';
import AudioWaveform from './components/AudioWaveform';
import SegmentEditor from './components/SegmentEditor';
import ExportModal from './components/ExportModal';
import GuidelinesModal from './components/GuidelinesModal';
import ProjectsModal from './components/ProjectsModal';
import SrtPreviewModal from './components/SrtPreviewModal';
import StatsModal from './components/StatsModal';
import SpeakerCustomizerModal from './components/SpeakerCustomizerModal';
import DiffModal from './components/DiffModal';
import ProjectNotesModal from './components/ProjectNotesModal';
import LandingPage from './components/LandingPage';
import SubtitleApp from './components/subtitle/SubtitleApp';
import LogoutConfirmModal from './components/LogoutConfirmModal';
import ReloadConfirmModal from './components/ReloadConfirmModal';
import { parseSubtitles } from './utils/subtitleParser';
import { API_BASE } from './config';
import { AuthProvider, useAuth } from './auth_views/AuthContext';
import AuthScreen from './auth_views/AuthScreen';

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading, user, logout } = useAuth();

  // Helper to read initial tool from browser URL path or history state
  const getToolFromLocation = () => {
    if (typeof window === 'undefined') return null;
    const path = window.location.pathname.replace(/^\/+/, '').toLowerCase();
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

  const [activeTool, setActiveTool] = useState(getToolFromLocation);
  const [showAuthScreen, setShowAuthScreen] = useState(isDirectAuthRoute);
  const [authInitialView, setAuthInitialView] = useState('login');
  const [showLogoutModal, setShowLogoutModal] = useState(false);

  // Clean /login or /signup from address bar whenever authenticated
  useEffect(() => {
    if (isAuthenticated) {
      const path = window.location.pathname.toLowerCase();
      if (path.includes('login') || path.includes('signup')) {
        const targetUrl = activeTool ? `/${activeTool}` : '/';
        window.history.replaceState({ tool: activeTool }, '', targetUrl);
      }
    }
  }, [isAuthenticated, activeTool]);

  // Synchronize state with browser Back/Forward navigation (Chrome history)
  useEffect(() => {
    if (isLoading) return; // Wait until initial token check completes

    // If not authenticated and on a studio route, redirect cleanly to '/'
    if (!isAuthenticated) {
      const path = window.location.pathname.replace(/^\/+/, '').toLowerCase();
      if (path.startsWith('subtitle') || path.startsWith('transcribe')) {
        window.history.replaceState({ tool: null }, '', '/');
        setActiveTool(null);
        setShowAuthScreen(false);
      }
    } else {
      // Record initial authenticated state in history
      if (!window.history.state || window.history.state.tool === undefined) {
        const initialTool = getToolFromLocation();
        const targetUrl = initialTool ? `/${initialTool}` : '/';
        window.history.replaceState({ tool: initialTool }, '', targetUrl);
      }
    }

    const handlePopState = (e) => {
      const path = window.location.pathname.replace(/^\/+/, '').toLowerCase();

      // Popping to an auth route
      if (path.includes('login') || path.includes('signup') || path.includes('verify')) {
        setShowAuthScreen(true);
        setActiveTool(null);
        return;
      }

      // Popping to root Landing Page
      if (path === '' || path === '/') {
        setShowAuthScreen(false);
        setActiveTool(null);
        return;
      }

      // Popping to Subtitle Studio
      if (path.startsWith('subtitle')) {
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

      // Fallback
      setActiveTool(null);
      setShowAuthScreen(false);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isAuthenticated, isLoading]);

  const handleSelectTool = (tool) => {
    if (!isAuthenticated) {
      // Prompt sign in if not authenticated
      setAuthInitialView('login');
      setShowAuthScreen(true);
      if (window.location.pathname !== '/login') {
        window.history.pushState({ tool: null, auth: 'login' }, '', '/login');
      }
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
    if (window.location.pathname !== '/') {
      window.history.pushState({ tool: null }, '', '/');
    }
    setActiveTool(null);
    setShowAuthScreen(false);
  };

  const handleLogout = () => {
    logout();
    setActiveTool(null);
    setShowAuthScreen(false);
    setShowLogoutModal(false);
    // Replace URL cleanly with '/' so no previous /subtitle remains in history
    if (window.history.replaceState) {
      window.history.replaceState({ tool: null }, '', '/');
    }
  };

  const handleOpenAuth = (initialView = 'login') => {
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
        backgroundColor: '#0e0f12',
        color: '#94a3b8',
        fontFamily: 'sans-serif',
        flexDirection: 'column',
        gap: '12px'
      }}>
        <Loader2 className="animate-spin" size={36} color="#00e5be" />
        <span style={{ fontSize: '14px', color: '#f1f2f6' }}>Verifying VerboLabs session...</span>
      </div>
    );
  }

  // If user requested AuthScreen (Login / Signup / Verify Email) while unauthenticated
  if (!isAuthenticated && showAuthScreen) {
    return (
      <AuthScreen
        initialView={authInitialView}
        onBackToHome={() => {
          setShowAuthScreen(false);
          if (window.history.replaceState) {
            window.history.replaceState({ tool: null }, '', '/');
          }
        }}
      />
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
  const [targetLanguage, setTargetLanguage] = useState('Auto-Detect');
  const [targetScript, setTargetScript] = useState('Auto-Detect');
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedExportFormats, setSelectedExportFormats] = useState(['csv', 'docx', 'xlsx', 'srt', 'json']);

  // Detailed Progress Bar State with Live Elapsed Time
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStage, setProgressStage] = useState('');
  const [progressDetail, setProgressDetail] = useState('');
  const [progressStepIndex, setProgressStepIndex] = useState(1);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
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
        setHasApiKey(data.has_gemini_api_key);
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

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setAudioUrl(url);
      setTranscriptionResult(null);
      setSegments([]);
      setComplianceScore(100.0);
      setTotalErrors(0);
      setTotalWarnings(0);
      setProgressPercent(0);
    }
  };

  const startProgressSimulation = () => {
    setProgressPercent(5);
    setProgressStage('1. Ingesting & Audio Waveform Inspection');
    setProgressDetail('Reading audio headers, RMS loudness and channel properties...');
    setProgressStepIndex(1);
    setElapsedSeconds(0);

    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);

    const startTime = Date.now();
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(parseFloat(((Date.now() - startTime) / 1000).toFixed(1)));
    }, 100);

    progressTimerRef.current = setInterval(() => {
      setProgressPercent((prev) => {
        if (prev < 18) {
          setProgressStage('1. Ingesting Audio & Header Analysis');
          setProgressDetail('Analyzing audio acoustic envelope & format headers...');
          setProgressStepIndex(1);
          return prev + 3;
        } else if (prev < 38) {
          setProgressStage('2. Uploading Stream to Multimodal AI Engine');
          setProgressDetail('Establishing low-latency stream to Gemini multimodal pipeline...');
          setProgressStepIndex(2);
          return prev + 2.5;
        } else if (prev < 65) {
          setProgressStage('3. Acoustic Diarization & Verbatim Transcription');
          setProgressDetail('Distinguishing Speaker 1 vs Speaker 2 & recognizing verbatim phonemes...');
          setProgressStepIndex(3);
          return prev + 1.2;
        } else if (prev < 82) {
          setProgressStage('4. Acoustic Onset / Offset Waveform Calibration');
          setProgressDetail('Snapping segment boundaries to physical RMS energy onset & decay...');
          setProgressStepIndex(4);
          return prev + 0.8;
        } else if (prev < 92) {
          setProgressStage('5. Word-Level Confidence Heatmap Computation');
          setProgressDetail('Evaluating acoustic clarity scores for each transcribed token...');
          setProgressStepIndex(5);
          return prev + 0.5;
        } else if (prev < 98) {
          setProgressStage('6. Karya QA Linter & Final Verification');
          setProgressDetail('Linting script compliance, numbers in words, and punctuation rules...');
          setProgressStepIndex(6);
          return prev + 0.3;
        }
        return prev;
      });
    }, 400);
  };

  const stopProgressSimulation = (success = true) => {
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
    if (success) {
      setProgressPercent(100);
      setProgressStage('✓ Completed Successfully!');
      setProgressDetail('All segments, confidence heatmap & Karya QA linting ready.');
      setProgressStepIndex(6);
      setTimeout(() => {
        setProgressPercent(0);
      }, 1000);
    } else {
      setProgressPercent(0);
    }
  };

  const handleStartTranscribe = async () => {
    if (!selectedFile) return;
    setIsTranscribing(true);
    startProgressSimulation();

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('language', targetLanguage);
    formData.append('script', targetScript);

    try {
      const res = await fetch(`${API_BASE}/api/transcribe`, {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        const data = await res.json();
        setTranscriptionResult(data);
        const segs = data.segments || [];
        setSegments(segs);
        setOriginalSegments(JSON.parse(JSON.stringify(segs)));
        setHistory([segs]);
        setHistoryIndex(0);
        setComplianceScore(data.compliance_score || 100.0);
        setTotalErrors(data.total_errors || 0);
        setTotalWarnings(data.total_warnings || 0);
        if (segs.length > 0) {
          setActiveSegmentId(segs[0].segment_id);
        }
        stopProgressSimulation(true);
      } else {
        stopProgressSimulation(false);
        let errorMsg = 'Failed to process audio';
        try {
          const errData = await res.json();
          errorMsg = errData.detail || errorMsg;
        } catch (e) {
          try {
            const errText = await res.text();
            if (errText) errorMsg = errText;
          } catch (textErr) {}
        }
        alert(`Transcription error: ${errorMsg}`);
      }
    } catch (err) {
      stopProgressSimulation(false);
      console.error("Transcribe failed:", err);
      alert(`Transcription request failed: ${err.message || err}`);
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

      if (res.ok) {
        setDbSaveToast('Saved to Neon PostgreSQL DB!');
        setTimeout(() => setDbSaveToast(''), 3500);
      }
    } catch (err) {
      console.error("Save to Neon DB failed:", err);
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
  }, [history, historyIndex, segments, transcriptionResult]);

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
    <div className="min-h-screen bg-[#0e0f12] text-[#f1f2f6] flex flex-col font-sans select-none animate-studio-entrance">
      {/* Top Navbar (Ultra Compact) */}
      <Navbar
        hasApiKey={hasApiKey}
        setShowGuidelines={setShowGuidelines}
        onOpenProjects={handleOpenProjects}
        onOpenStats={() => setShowStatsModal(true)}
        onOpenSpeakers={() => setShowSpeakerModal(true)}
        onOpenDiff={() => setShowDiffModal(true)}
        onOpenNotes={() => setShowNotesModal(true)}
        onImportSubtitles={handleImportSubtitles}
        canUndo={historyIndex > 0}
        canRedo={historyIndex < history.length - 1}
        onUndo={handleUndo}
        onRedo={handleRedo}
        currentFilename={selectedFile ? selectedFile.name : null}
        segmentCount={segments.length}
        complianceScore={segments.length > 0 ? complianceScore : null}
        totalErrors={totalErrors}
        totalWarnings={totalWarnings}
        user={user}
        onOpenLogoutModal={onOpenLogoutModal}
      />

      {/* Main Studio Area (Maximized Screen Height & Space) */}
      <main className="flex-1 w-full px-2 sm:px-3 py-1.5 space-y-1.5 flex flex-col min-h-0">
        {/* Unified Top Control Toolbar (Single Line, Ultra Compact NLE Style) */}
        <div className="bg-[#14151a] border border-[#262734] rounded-lg p-2 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            
            {/* Group 1: Ingestion & Transcribe */}
            <div className="flex flex-wrap items-center gap-1.5">
              <input
                type="file"
                id="main-file-input"
                accept="audio/*,.wav,.mp3,.m4a,.flac,.ogg,.aac"
                onChange={handleFileSelect}
                className="hidden"
              />
              <label
                htmlFor="main-file-input"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-[#22232c] hover:bg-[#2c2d38] border border-[#323444] text-[#f1f2f6] rounded text-xs font-semibold cursor-pointer transition-all active:scale-95 whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5 text-[#00e5be]" />
                <span>{selectedFile ? 'Change Audio' : 'Import Audio'}</span>
              </label>

              {selectedFile && (
                <div className="inline-flex items-center gap-1 bg-[#181920] px-2 py-0.5 rounded border border-[#262734] text-[11px] font-medium text-slate-300 max-w-[180px] truncate">
                  <FileAudio className="w-3 h-3 text-[#00e5be] shrink-0" />
                  <span className="truncate">{selectedFile.name}</span>
                </div>
              )}

              {/* Language Selector */}
              <div className="inline-flex items-center gap-1 text-[11px] text-[#7d8190]">
                <span className="font-semibold text-slate-400">Lang:</span>
                <select
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="bg-[#181920] border border-[#262734] text-[#f1f2f6] px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer focus:border-[#00e5be] focus:outline-none"
                >
                  <option value="Auto-Detect">⚡ Auto-Detect</option>
                  <option value="Hindi">Hindi (हिन्दी)</option>
                  <option value="English">English</option>
                  <option value="Marathi">Marathi (मराठी)</option>
                  <option value="Bengali">Bengali (বাংলা)</option>
                  <option value="Tamil">Tamil (தமிழ்)</option>
                  <option value="Telugu">Telugu (తెలుగు)</option>
                  <option value="Gujarati">Gujarati (ગુજરાતી)</option>
                  <option value="Kannada">Kannada (ಕನ್ನಡ)</option>
                </select>
              </div>

              {/* Script Selector */}
              <div className="inline-flex items-center gap-1 text-[11px] text-[#7d8190]">
                <span className="font-semibold text-slate-400">Script:</span>
                <select
                  value={targetScript}
                  onChange={(e) => setTargetScript(e.target.value)}
                  className="bg-[#181920] border border-[#262734] text-[#f1f2f6] px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer focus:border-[#00e5be] focus:outline-none"
                >
                  <option value="Auto-Detect">⚡ Auto-Detect</option>
                  <option value="Devanagari">Devanagari</option>
                  <option value="Latin">Latin / English</option>
                  <option value="Bengali">Bengali</option>
                  <option value="Tamil">Tamil</option>
                  <option value="Telugu">Telugu</option>
                  <option value="Gujarati">Gujarati</option>
                  <option value="Kannada">Kannada</option>
                </select>
              </div>

              {/* Transcribe Button (CapCut Signature Neon Turquoise Action) */}
              <button
                onClick={handleStartTranscribe}
                disabled={!selectedFile || isTranscribing}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-[#00e5be] hover:bg-[#00c9a7] text-black rounded text-xs font-bold shadow-[0_0_12px_rgba(0,229,190,0.25)] transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
              >
                {isTranscribing ? (
                  <>
                    <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
                    <span>Transcribing ({progressPercent.toFixed(0)}%)...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3 h-3 shrink-0" />
                    <span>Auto-Transcribe</span>
                  </>
                )}
              </button>
            </div>

            {/* Group 2: Export & Save */}
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] uppercase font-bold text-slate-500 hidden sm:inline mr-0.5">Export:</span>

              {[
                { id: 'csv', label: 'CSV' },
                { id: 'docx', label: 'DOCX' },
                { id: 'xlsx', label: 'XLSX' },
                { id: 'srt', label: 'SRT' },
                { id: 'json', label: 'JSON' }
              ].map((fmt) => {
                const isSelected = selectedExportFormats.includes(fmt.id);
                return (
                  <button
                    key={fmt.id}
                    onClick={() => toggleExportFormat(fmt.id)}
                    className={`px-2 py-0.5 rounded text-[11px] font-bold transition-all cursor-pointer border ${
                      isSelected
                        ? 'bg-[#00e5be]/15 border-[#00e5be]/50 text-[#00e5be]'
                        : 'bg-[#181920] border-[#262734] text-slate-400 hover:text-slate-200 hover:bg-[#22232c]'
                    }`}
                  >
                    {fmt.label}
                  </button>
                );
              })}

              {/* Download Selected Button */}
              <button
                onClick={handleMultiExport}
                disabled={segments.length === 0 || isExporting}
                className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#00e5be] hover:bg-[#00c9a7] text-black rounded text-xs font-bold shadow-[0_0_10px_rgba(0,229,190,0.2)] transition-transform active:scale-95 disabled:opacity-40 cursor-pointer ml-1 whitespace-nowrap"
              >
                {isExporting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Package className="w-3 h-3" />}
                <span>Download ({selectedExportFormats.length})</span>
              </button>

              {/* Save to Neon DB Button */}
              {segments.length > 0 && (
                <button
                  onClick={handleSaveToNeonDb}
                  disabled={isSavingToDb}
                  className="inline-flex items-center gap-1 px-2.5 py-1 bg-[#181920] hover:bg-[#22232c] text-slate-200 border border-[#262734] rounded text-xs font-semibold shadow-xs transition-transform active:scale-95 cursor-pointer ml-1 whitespace-nowrap"
                  title="Save current edits to Neon PostgreSQL Cloud DB"
                >
                  {isSavingToDb ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3 text-[#00e5be]" />}
                  <span>Save to Neon</span>
                </button>
              )}
            </div>
          </div>

          {/* High-Detail Realistic Live Telemetry Progress Bar */}
          {isTranscribing && (
            <div className="mt-2 pt-2 border-t border-[#262734] space-y-1.5 animate-in fade-in">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 text-[#00e5be] animate-spin" />
                  <span className="font-bold text-[#f1f2f6]">{progressStage}</span>
                  <span className="text-[11px] text-[#7d8190] hidden md:inline">— {progressDetail}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] bg-[#181920] px-2 py-0.5 rounded text-slate-300 border border-[#262734]">
                    <Timer className="w-3 h-3 text-[#00e5be]" />
                    <span>Elapsed: {elapsedSeconds.toFixed(1)}s</span>
                  </span>
                  <span className="font-mono font-bold text-[#00e5be] text-xs bg-[#00e5be]/10 px-2 py-0.5 rounded border border-[#00e5be]/30">
                    {progressPercent.toFixed(0)}%
                  </span>
                </div>
              </div>

              {/* Progress Track */}
              <div className="w-full h-2 bg-[#181920] rounded-full overflow-hidden border border-[#262734] p-0.5">
                <div
                  className="h-full bg-gradient-to-r from-[#00e5be] via-[#00c9a7] to-[#00b4d8] rounded-full transition-all duration-300 ease-out shadow-[0_0_8px_rgba(0,229,190,0.5)]"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>

              {/* 6-Step Pipeline Badges */}
              <div className="grid grid-cols-6 gap-1 pt-0.5 text-[10px] text-center font-medium">
                {[
                  { step: 1, label: '1. Ingest' },
                  { step: 2, label: '2. Upload' },
                  { step: 3, label: '3. Diarize' },
                  { step: 4, label: '4. Onset Align' },
                  { step: 5, label: '5. Heatmap' },
                  { step: 6, label: '6. QC Lint' }
                ].map((s) => (
                  <div
                    key={s.step}
                    className={`py-0.5 rounded transition-all truncate px-0.5 border ${
                      progressStepIndex >= s.step
                        ? 'bg-[#00e5be]/15 text-[#00e5be] font-bold border-[#00e5be]/40'
                        : 'bg-[#181920] text-slate-500 border-[#262734]'
                    }`}
                  >
                    {s.label}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Persistent Sticky Waveform Player Bar */}
        <div className="sticky top-[42px] z-30">
          {audioUrl ? (
            <AudioWaveform
              audioUrl={audioUrl}
              segments={segments}
              currentSegmentId={activeSegmentId}
              setActiveSegmentId={setActiveSegmentId}
              onSegmentClick={(seg) => setActiveSegmentId(seg.segment_id)}
              onSegmentTimeChange={handleSegmentTimeChange}
              onSplitSegment={handleSplitSegmentAtTime}
              onMergeSegment={handleMergeSegmentWithNext}
              onAddSegmentAtTime={handleAddSegmentAtTime}
              playTargetTime={playTargetTime}
            />
          ) : (
            <div className="bg-[#14151a] border border-dashed border-[#262734] rounded-lg p-3 text-center text-slate-400 shadow-sm">
              <p className="text-xs font-medium">
                Import an audio file above to load the interactive waveform and player.
              </p>
            </div>
          )}
        </div>

        {/* Full-Width Spacious Conversational Segments Workspace */}
        <div className="flex-1 flex flex-col min-h-0">
          <SegmentEditor
            segments={segments}
            setSegments={setSegments}
            activeSegmentId={activeSegmentId}
            setActiveSegmentId={setActiveSegmentId}
            onPlaySegment={(start, end) => {
              setPlayTargetTime({ time: start, endTime: end, loop: true, ts: Date.now() });
            }}
            onStopSegment={(start) => {
              setPlayTargetTime({ time: start, endTime: start, loop: false, pause: true, ts: Date.now() });
            }}
            onLintTrigger={handleLint}
            onStartTranscribe={handleStartTranscribe}
            audioLoaded={!!selectedFile}
            onOpenSrtPreview={() => setShowSrtPreview(true)}
          />
        </div>
      </main>

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

      {/* Floating Save / Action Toast */}
      {(dbSaveToast || autoSaveStatus) && (
        <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 bg-[#181920] text-[#f1f2f6] px-3.5 py-2 rounded-lg shadow-xl border border-[#262734] text-xs font-bold animate-in fade-in slide-in-from-bottom-2">
          <CheckCircle2 className="w-4 h-4 text-[#00e5be] shrink-0" />
          <span>{dbSaveToast || autoSaveStatus}</span>
        </div>
      )}

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
