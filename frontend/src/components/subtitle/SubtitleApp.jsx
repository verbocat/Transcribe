import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft, Upload, CheckCircle2, AlertCircle, Sparkles, RefreshCw,
  FileDown, Sliders, ShieldCheck, Film, Undo2, Redo2,
  SlidersHorizontal, Search, Split, Merge, Scissors, Trash2, Plus,
  ChevronDown, X, Play, Clock, Activity, FileText, Check, Settings,
  Menu, Download, Eye, AlertTriangle, Layers, Type, Sun, Moon, Loader2, Globe, Volume2,
  MessageSquare, ChevronRight, Music,
  Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight,
  Highlighter, Palette, RotateCcw, User, Wand2, Languages, LayoutDashboard,
  Command, Keyboard, FolderOpen, Save, Replace, ListOrdered, ArrowRightLeft, CaseSensitive,
  Eraser, SkipBack, SkipForward, Maximize, Users, BookText, StepBack, StepForward, AlignJustify, BadgeCheck
} from 'lucide-react';
import { API_BASE } from '../../config';
import { publishPlayhead, getPlayhead, subscribePlayhead } from '../../utils/playheadBus';
import Sidebar from './Sidebar';
import SubtitleTablePanel from './SubtitleTablePanel';
import './studio.css';
import VideoPlayer from './VideoPlayer';
import AudioWaveformTimeline from './AudioWaveformTimeline';
import SubtitleGridView from './SubtitleGridView';
import NetflixQCPanel from './NetflixQCPanel';
import SubtitleExportModal from './SubtitleExportModal';
import CentroidModal from './CentroidModal';
import SubtitleDiffModal from './SubtitleDiffModal';
import SubtitleSettingsModal from './SubtitleSettingsModal';
import StudioStage from './layout/StudioStage';
import { useStudioLayout, BUILTIN_PRESETS } from './layout/layoutModel';
import StudioMenuBar from './StudioMenuBar';
import CommandPalette from './CommandPalette';
import LanguageTracks from './LanguageTracks';
import { langName } from './languages';
import { ShiftTimingsDialog, GoToDialog, FindReplaceDialog } from './ToolDialogs';
import { Button, IconButton, Kbd, Segmented } from './ui/controls';
import BrandLogo from '../BrandLogo';
import { useStudioPrefs, formatTimecode, loadPrefs } from './prefs';
import { SETTINGS_GROUPS } from './SubtitleSettingsModal';
import * as tools from './subtitleTools';
import SpeakerCustomizerModal from '../SpeakerCustomizerModal';
import ElevenLabsApiKeyModal from './ElevenLabsApiKeyModal';
import AccountMenuDropdown from '../AccountMenuDropdown';
import ReloadConfirmModal from '../ReloadConfirmModal';

import NotificationBellDropdown from '../NotificationBellDropdown';
import { useTheme } from '../../context/ThemeContext';
import { extractAudioFromMedia, computeWaveformPeaks } from '../../utils/audioExtractor';
import { xhrPostForm, createRateMeter } from '../../utils/xhrUpload';
import { takeLaunchIntent } from '../../utils/launchIntent';
import MediaProgress, { GenerateProgress, TaskStrip } from './MediaProgress';
import { startJob, jobHeaders, isCancelError, CancelledError, sleepCancellable, useTaskRunner, abortable } from '../../utils/cancellable';
import ContextPanel, { loadContext, saveContext, contextForRequest } from './ContextPanel';
import { draftKey, buildDraft, readDraft } from './draftStorage';

function formatTime(seconds) {
  if (isNaN(seconds) || seconds == null) return "00:00.000";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

// Footer timecode: follows the playhead on its own, so playback never re-renders the whole studio
function PlayheadTimecode({ format, frameRate }) {
  const ref = useRef(null);
  useEffect(() => subscribePlayhead((t) => {
    if (ref.current) ref.current.textContent = formatTimecode(t, format, frameRate);
  }), [format, frameRate]);
  return <span ref={ref} />;
}

// Sliced multi-part chunked upload for files > 90MB (bypasses Cloudflare 100MB proxy limits)
async function uploadFileInChunks(file, apiBase, onProgress, onAllSent, signal, headers) {
  const chunkSize = 12 * 1024 * 1024; // 12 MB slices (safe for any proxy/cloud gateway)
  const totalChunks = Math.ceil(file.size / chunkSize);
  const uploadId = 'up_' + Math.random().toString(36).substring(2, 10);
  const meter = createRateMeter();

  // Cancelling leaves a half-written file on the server: ask it to delete the slices received so far
  signal?.addEventListener('abort', () => {
    try { fetch(`${apiBase}/api/subtitle/upload_chunk/${uploadId}`, { method: 'DELETE', keepalive: true }).catch(() => {}); } catch (_) { /* best effort */ }
  }, { once: true });

  let lastData = null;
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const chunkBlob = file.slice(start, end);

    const buildForm = () => {
      const formData = new FormData();
      formData.append('chunk', chunkBlob, file.name);
      formData.append('upload_id', uploadId);
      formData.append('chunk_index', i.toString());
      formData.append('total_chunks', totalChunks.toString());
      formData.append('filename', file.name);
      return formData;
    };

    let success = false;
    let lastErr = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        // Real bytes sent so far across ALL slices (earlier slices + the part of this one already out)
        const res = await xhrPostForm(`${apiBase}/api/subtitle/upload_chunk`, buildForm(), {
          meter,
          signal,
          headers,
          baseLoaded: start,
          grandTotal: file.size,
          onProgress: (p) => { if (onProgress) onProgress({ ...p, detail: `Uploading slice ${i + 1} of ${totalChunks}` }); },
          // After the very last byte the server still assembles the file and analyses the audio
          onSent: () => { if (i === totalChunks - 1 && onAllSent) onAllSent(); },
        });

        if (res.ok) {
          lastData = res.data;
          success = true;
          break;
        } else {
          lastErr = new Error(res.data?.detail || `Slice ${i + 1}/${totalChunks} failed with status ${res.status}`);
          if (res.status >= 500 || res.status === 429) {
            await sleepCancellable(attempt * 1500, signal);
            continue;
          } else {
            throw lastErr;
          }
        }
      } catch (fetchErr) {
        if (isCancelError(fetchErr) || signal?.aborted) throw new CancelledError();
        lastErr = fetchErr;
        if (fetchErr?.status && fetchErr.status >= 400 && fetchErr.status < 500 && fetchErr.status !== 429) throw fetchErr;
        if (attempt < 4) {
          if (onProgress) {
            onProgress({
              percent: (start / file.size) * 100,
              loaded: start,
              total: file.size,
              detail: `Connection problem. Retrying slice ${i + 1} of ${totalChunks} (attempt ${attempt + 1}/4)`
            });
          }
          await sleepCancellable(attempt * 2500, signal);
        }
      }
    }
    if (!success) {
      throw lastErr || new Error(`Upload failed at slice ${i + 1}/${totalChunks}`);
    }
  }
  return lastData;
}

// Robust auto video frame rate detector (backend FFprobe container probe with browser HTML5 video fallback)
async function detectVideoFrameRate(file, apiBase) {
  // 1. Try high-speed backend probe endpoint (reads first 32MB container headers)
  try {
    const formData = new FormData();
    const slice = file.slice(0, Math.min(file.size, 32 * 1024 * 1024));
    formData.append('file', slice, file.name);
    const res = await fetch(`${apiBase}/api/subtitle/probe_media`, {
      method: 'POST',
      body: formData,
    });
    if (res.ok) {
      const data = await res.json();
      if (data.frame_rate && data.width > 0) {
        return {
          frame_rate: data.frame_rate,
          width: data.width,
          height: data.height,
          duration: data.duration,
          source: 'container_probe'
        };
      }
    }
  } catch (err) {
    console.warn("Backend media probe notice:", err);
  }

  // 2. Client-side browser HTML5 video requestVideoFrameCallback fallback
  return new Promise((resolve) => {
    try {
      if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) {
        resolve({ frame_rate: 24.0, source: 'default' });
        return;
      }
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      const url = URL.createObjectURL(file);
      video.src = url;

      let frameTimes = [];
      let timeoutId = null;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        video.pause();
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
      };

      const onFrame = (now, metadata) => {
        frameTimes.push(metadata.mediaTime);
        if (frameTimes.length >= 12) {
          cleanup();
          const deltas = [];
          for (let i = 1; i < frameTimes.length; i++) {
            const d = frameTimes[i] - frameTimes[i - 1];
            if (d > 0.005 && d < 0.2) deltas.push(d);
          }
          if (deltas.length >= 4) {
            // Dropped/throttled frames produce multiples of the frame interval; the shortest one is the true interval
            const frameDelta = Math.min(...deltas);
            const rawFps = 1.0 / frameDelta;
            const standardFps = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60];
            let closest = standardFps[0];
            let minDiff = Math.abs(rawFps - closest);
            for (const fps of standardFps) {
              const diff = Math.abs(rawFps - fps);
              if (diff < minDiff) {
                minDiff = diff;
                closest = fps;
              }
            }
            const detected = minDiff < 0.6 ? closest : Math.round(rawFps * 100) / 100;
            resolve({ frame_rate: detected, source: 'browser_rvfc' });
            return;
          }
          resolve({ frame_rate: 24.0, source: 'default' });
        } else {
          video.requestVideoFrameCallback(onFrame);
        }
      };

      video.onloadeddata = async () => {
        try {
          video.requestVideoFrameCallback(onFrame);
          await video.play();
          timeoutId = setTimeout(() => {
            cleanup();
            resolve({ frame_rate: 24.0, source: 'timeout_default' });
          }, 1200);
        } catch (_) {
          cleanup();
          resolve({ frame_rate: 24.0, source: 'play_error_default' });
        }
      };

      video.onerror = () => {
        cleanup();
        resolve({ frame_rate: 24.0, source: 'video_error_default' });
      };
    } catch (_) {
      resolve({ frame_rate: 24.0, source: 'exception_default' });
    }
  });
}

export default function SubtitleApp({ onBackToHome, user, onLogout, onOpenLogoutModal }) {
  // ── Theme State: Unified Acoustic Studio Theme ──
  const { theme, isDark } = useTheme();
  // Runs short server tasks (QC fix, sync, auto-fix...) so each shows a Cancel button
  const { tasks, notice: taskNotice, run: runTask, cancel: cancelTask } = useTaskRunner(API_BASE);

  // Video & File state
  const [selectedFile, setSelectedFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [extractedAudioUrl, setExtractedAudioUrl] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentVideoId, setCurrentVideoId] = useState(null);
  const [initialWaveformPeaks, setInitialWaveformPeaks] = useState([]);
  const [audioExtractionStatus, setAudioExtractionStatus] = useState(null); // { stage, percent, detail }
  const extractedAudioFileRef = useRef(null); // Cache client-extracted audio file to avoid re-extracting
  const audioTrackInputRef = useRef(null);

  const isAudioFile = useMemo(() => {
    if (!selectedFile) return false;
    return Boolean(
      selectedFile.type?.startsWith('audio/') ||
      /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma)$/i.test(selectedFile.name || '')
    );
  }, [selectedFile]);

  // Robust Client-Side Audio Extractor & Adaptive Upload Coordinator
  const mediaJobRef = useRef(null); // the running upload/extraction, so its Cancel button can stop it
  const processAndUploadMedia = useCallback(async (fileToProcess, isAudio) => {
    const mediaJob = startJob(API_BASE);
    mediaJobRef.current = mediaJob;
    try {
      return await uploadMediaCore(fileToProcess, isAudio, mediaJob);
    } catch (err) {
      if (mediaJob.cancelled || isCancelError(err)) {
        // Stopped on purpose: the file stays loaded, nothing is half-applied
        setAutoSaveStatus('Upload cancelled. The file is still loaded; it uploads when you generate.');
        setTimeout(() => setAutoSaveStatus(''), 4000);
        return null;
      }
      throw err;
    } finally {
      if (mediaJobRef.current === mediaJob) mediaJobRef.current = null;
      setAudioExtractionStatus(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const uploadMediaCore = async (fileToProcess, isAudio, mediaJob) => {
    const { signal } = mediaJob;
    let uploadTarget = fileToProcess;
    const isWma = Boolean(
      fileToProcess?.type === 'audio/x-ms-wma' ||
      fileToProcess?.type === 'audio/wma' ||
      /\.(wma)$/i.test(fileToProcess?.name || '')
    );

    // Every update replaces the whole status so no stale numbers from a previous stage linger
    let flow = (!isAudio || isWma) ? 'video' : 'audio';
    const report = (p) => {
      if (p.stage === 'engine' || p.stage === 'local') flow = 'local';
      else if (['upload', 'saving', 'extract', 'waveform', 'download'].includes(p.stage)) flow = 'video';
      else if (p.stage === 'decode') flow = 'audio';
      setAudioExtractionStatus({ flow, ...p });
    };

    // 1. If video file or WMA file, extract lightweight mono audio track in browser or via backend (or reuse cached)
    if (!isAudio || isWma) {
      if (extractedAudioFileRef.current && !isWma) {
        uploadTarget = extractedAudioFileRef.current;
      } else {
        try {
          const extracted = await extractAudioFromMedia(fileToProcess, (p) => report(p), API_BASE, { signal, job: mediaJob, preferLocal: (() => { const m = loadPrefs().localExtraction; return m === 'always' || (m === 'large' && fileToProcess.size >= 100 * 1024 * 1024); })() });
          if (extracted.peaks && extracted.peaks.length > 0) {
            setInitialWaveformPeaks(extracted.peaks);
          }
          if (extracted.audioUrl) {
            setExtractedAudioUrl(extracted.audioUrl);
            if (isWma) setVideoUrl(extracted.audioUrl);
          }
          if (extracted.duration && extracted.duration > 0) {
            setVideoDuration(extracted.duration);
          }
          uploadTarget = extracted.audioFile || fileToProcess;
          extractedAudioFileRef.current = extracted.audioFile || null;
        } catch (extErr) {
          if (isCancelError(extErr) || signal.aborted) throw new CancelledError();
          console.warn("Client audio extraction fallback:", extErr);
          uploadTarget = fileToProcess;
        }
      }
    } else {
      extractedAudioFileRef.current = fileToProcess;
      // For audio files, extract peaks locally for instant waveform rendering
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const audioCtx = new AudioContextClass();
        const buf = await abortable(fileToProcess.arrayBuffer(), signal);
        const decoded = await abortable(audioCtx.decodeAudioData(buf), signal);
        audioCtx.close().catch(() => { });
        const channel = decoded.getChannelData(0);
        const peaks = computeWaveformPeaks(channel, decoded.duration, 50);
        if (peaks.length > 0) {
          setInitialWaveformPeaks(peaks);
        }
      } catch (peakErr) { if (isCancelError(peakErr) || signal.aborted) throw new CancelledError(); }
    }

    // 2. Upload to backend (chunked if > 20MB or if direct upload fails)
    try {
      const prepareStage = () => report({ stage: 'prepare', percent: null, detail: 'Upload complete. The server is preparing the audio for your workspace' });
      if (uploadTarget.size > 20 * 1024 * 1024) {
        report({ stage: 'send', percent: 0, loaded: 0, total: uploadTarget.size, detail: 'Uploading the audio to your workspace' });
        const chunkData = await uploadFileInChunks(uploadTarget, API_BASE, (p) => {
          report({ stage: 'send', ...p });
        }, prepareStage, signal, jobHeaders(mediaJob));
        if (chunkData?.video_id) {
          setCurrentVideoId(chunkData.video_id);
          if (chunkData.peaks && chunkData.peaks.length > 0) {
            setInitialWaveformPeaks(chunkData.peaks);
          }
          if (chunkData.audio_url) {
            const resolvedUrl = `${API_BASE}${chunkData.audio_url}`;
            setExtractedAudioUrl(resolvedUrl);
            if (isWma) setVideoUrl(resolvedUrl);
          }
          const dur = Number(chunkData?.metadata?.duration || chunkData?.duration || 0);
          if (dur > 0) setVideoDuration(dur);
          return chunkData.video_id;
        }
      } else {
        report({ stage: 'send', percent: 0, loaded: 0, total: uploadTarget.size, detail: 'Uploading the audio to your workspace' });
        let uploadSucceeded = false;
        try {
          const formData = new FormData();
          formData.append('file', uploadTarget);
          const res = await xhrPostForm(`${API_BASE}/api/subtitle/upload`, formData, {
            onProgress: (p) => report({ stage: 'send', detail: 'Uploading the audio to your workspace', ...p }),
            onSent: prepareStage,
            signal,
            headers: jobHeaders(mediaJob),
          });
          if (res.ok) {
            const data = res.data || {};
            if (data.video_id) {
              setCurrentVideoId(data.video_id);
              if (data.peaks && data.peaks.length > 0) {
                setInitialWaveformPeaks(data.peaks);
              }
              if (data.audio_url) {
                const resolvedUrl = `${API_BASE}${data.audio_url}`;
                setExtractedAudioUrl(resolvedUrl);
                if (isWma) setVideoUrl(resolvedUrl);
              }
              const dur = Number(data?.metadata?.duration || data?.duration || 0);
              if (dur > 0) setVideoDuration(dur);
              const fps = data.frame_rate || data.metadata?.frame_rate;
              if (fps && fps > 0) {
                setFrameRate(fps);
                setDetectedFpsNotice(`${fps} fps (Auto)`);
                setTimeout(() => setDetectedFpsNotice(''), 4500);
              }
              uploadSucceeded = true;
              return data.video_id;
            }
          }
        } catch (directErr) {
          if (isCancelError(directErr) || signal.aborted) throw new CancelledError();
          console.warn("Direct upload failed, falling back to sliced chunk upload:", directErr);
        }

        // Automatic fallback to chunked upload if direct POST encounters payload/network limitations
        if (!uploadSucceeded) {
          console.log("[Subtitle Studio] Fallback: uploading media in resilient sliced chunks...");
          const chunkData = await uploadFileInChunks(uploadTarget, API_BASE, (p) => {
            report({ stage: 'send', ...p });
          }, prepareStage, signal, jobHeaders(mediaJob));
          if (chunkData?.video_id) {
            setCurrentVideoId(chunkData.video_id);
            if (chunkData.peaks && chunkData.peaks.length > 0) {
              setInitialWaveformPeaks(chunkData.peaks);
            }
            if (chunkData.audio_url) {
              setExtractedAudioUrl(`${API_BASE}${chunkData.audio_url}`);
            }
            const fps = chunkData.frame_rate || chunkData.metadata?.frame_rate;
            if (fps && fps > 0) {
              setFrameRate(fps);
              setDetectedFpsNotice(`${fps} fps (Auto)`);
              setTimeout(() => setDetectedFpsNotice(''), 4500);
            }
            return chunkData.video_id;
          }
        }
      }
    } catch (err) {
      console.warn("Media upload failed:", err);
      throw err;
    } finally {
      setAudioExtractionStatus(null);
    }
    return null;
  };

  // Subtitle Dataset State
  const [events, setEvents] = useState([]);
  const [originalEvents, setOriginalEvents] = useState([]);
  const [activeEventId, setActiveEventId] = useState(null);
  const [activeSidebarTab, setActiveSidebarTab] = useState('subtitles');

  const editedEventIdsRef = useRef(new Set()); // Protected manual user edits across progressive batches
  const [userFeedbackText, setUserFeedbackText] = useState('');

  // Video playback sync state
  const [playTarget, setPlayTarget] = useState(null);

  // Netflix Rules & QC Telemetry
  const [language, setLanguage] = useState(() => {
    try {
      const saved = localStorage.getItem('karya_sub_language');
      return (saved && saved !== 'hi') ? saved : 'en';
    } catch (_) { return 'en'; }
  });
  const [script, setScript] = useState(() => {
    try {
      const saved = localStorage.getItem('karya_sub_script');
      return (saved && saved !== 'devanagari') ? saved : 'auto';
    } catch (_) { return 'auto'; }
  });
  const [contentType, setContentType] = useState('adult'); // 'adult' (20 CPS) | 'children' (17 CPS)
  const [sdhMode, setSdhMode] = useState(false);
  const [includeSpeakerTags, setIncludeSpeakerTags] = useState(false);
  const [snapToShotChanges, setSnapToShotChanges] = useState(true);
  const [numSpeakers, setNumSpeakers] = useState(() => {
    try {
      const saved = localStorage.getItem('karya_num_speakers');
      return saved ? parseInt(saved, 10) : 0;
    } catch (_) { return 0; }
  });
  const [strictNativeScript, setStrictNativeScript] = useState(() => {
    try {
      const saved = localStorage.getItem('karya_strict_native_script');
      return saved !== null ? saved === 'true' : true;
    } catch (_) { return true; }
  });
  const [frameRate, setFrameRate] = useState(() => {
    try {
      const v = localStorage.getItem('karya_sub_fps');
      return v ? parseFloat(v) : 24.0;
    } catch {
      return 24.0;
    }
  });
  const [detectedFpsNotice, setDetectedFpsNotice] = useState('');
  const [shotChanges, setShotChanges] = useState([]);
  const [complianceScore, setComplianceScore] = useState(100.0);
  const [totalErrors, setTotalErrors] = useState(0);
  const [totalWarnings, setTotalWarnings] = useState(0);
  const [cpsStats, setCpsStats] = useState(null);

  // Generation & Streaming Progress State
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStage, setProgressStage] = useState('');
  const [progressDetail, setProgressDetail] = useState('');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedTimerRef = useRef(null);

  // History for Undo/Redo
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Modals & Panels UI
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showSpeakerModal, setShowSpeakerModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showCentroidModal, setShowCentroidModal] = useState(false);
  // Language tracks: after a translation each language is its own editable subtitle track
  const [tracks, setTracks] = useState({});          // { [languageCode]: events[] } (the active track is saved on switch)
  const [activeTrack, setActiveTrack] = useState(null);
  const [sourceTrack, setSourceTrack] = useState(null);
  const [centroidState, setCentroidState] = useState({ hasResults: false, qcIssues: null });
  // Context for the transcript (speakers, key terms, writing style): saved per video file, sent with every Generate
  const [showContextPanel, setShowContextPanel] = useState(false);
  const [genContext, setGenContext] = useState(() => loadContext(null));
  const [contextRun, setContextRun] = useState(null); // what the last generation corrected using the context
  const [progressMeta, setProgressMeta] = useState({ step: 1, steps: 1, estimated: false, eta: null });
  const openCentroid = useCallback(() => {
    setShowContextPanel(false);
    setShowCentroidModal(true);
  }, []);
  const openContext = useCallback(() => {
    setShowCentroidModal(false);
    setShowContextPanel(true);
  }, []);
  const updateGenContext = useCallback((next) => {
    setGenContext(next);
    saveContext(selectedFile?.name, next);
  }, [selectedFile]);
  useEffect(() => { setGenContext(loadContext(selectedFile?.name)); setContextRun(null); }, [selectedFile?.name]);
  const [qcUnavailable, setQcUnavailable] = useState(false);
  const diffDecisionRef = useRef(null); // 'accepted' once the user accepts auto-fix changes
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [showReloadConfirmModal, setShowReloadConfirmModal] = useState(false);
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [apiKeyModalError, setApiKeyModalError] = useState(null);
  const [serverHasElevenLabsKey, setServerHasElevenLabsKey] = useState(false);
  const [showQcDrawer, setShowQcDrawer] = useState(false);
  const [qcView, setQcView] = useState('guideline'); // 'guideline' | 'centroid': the two panels of the single QC view
  const [qcHost, setQcHost] = useState(null); // DOM slot the Centroid QC panel renders into
  const openQc = useCallback((view) => {
    if (view) setQcView(view);
    setShowQcDrawer(true);
  }, []);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const [activeMenu, setActiveMenu] = useState(null); // 'file' | 'edit' | 'subtitle' | 'tools' | 'view' | 'settings' | null
  const [autoSaveStatus, setAutoSaveStatus] = useState('');
  const [pendingDraft, setPendingDraft] = useState(null); // Previous autosaved draft detection
  const [backendConnected, setBackendConnected] = useState(null); // null = checking, true = online, false = offline

  // Dismiss OOONA top desktop menu when clicking outside
  useEffect(() => {
    if (!activeMenu) return;
    const handleOutsideMenuClick = (e) => {
      if (!e.target.closest('[data-ooona-menu]')) {
        setActiveMenu(null);
      }
    };
    window.addEventListener('mousedown', handleOutsideMenuClick);
    return () => window.removeEventListener('mousedown', handleOutsideMenuClick);
  }, [activeMenu]);

  useEffect(() => {
    let isMounted = true;
    const checkConnection = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/health`, { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          if (isMounted) {
            setBackendConnected(true);
            setServerHasElevenLabsKey(!!data.has_elevenlabs_api_key);
          }
        } else if (isMounted) {
          setBackendConnected(false);
        }
      } catch {
        if (isMounted) setBackendConnected(false);
      }
    };
    checkConnection();
    return () => { isMounted = false; };
  }, []);

  // ── Browser Reload Protection & Studio-Themed Confirmation Modal ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      // ESC key dismisses active modal
      if (e.key === 'Escape') {
        if (showReloadConfirmModal) { setShowReloadConfirmModal(false); return; }
        if (showApiKeyModal) { setShowApiKeyModal(false); return; }
        if (showSettingsModal) { setShowSettingsModal(false); return; }
        if (showSpeakerModal) { setShowSpeakerModal(false); return; }
        if (showExportModal) { setShowExportModal(false); return; }
        if (showDiffModal) { setShowDiffModal(false); return; }
      }

      // Intercept F5 or Ctrl+R / Cmd+R reload shortcuts
      if (
        e.key === 'F5' ||
        ((e.ctrlKey || e.metaKey) && (e.key === 'r' || e.key === 'R'))
      ) {
        e.preventDefault();
        setShowReloadConfirmModal(true);
      }
    };

    const handleBeforeUnload = (e) => {
      // Prompt before native window unload / browser reload button if active project exists
      if (selectedFile || events.length > 0 || isGenerating) {
        e.preventDefault();
        e.returnValue = 'Are you sure you want to reload? Any active generation or unsaved progress may be lost.';
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
    events.length,
    isGenerating,
    showReloadConfirmModal,
    showSettingsModal,
    showSpeakerModal,
    showExportModal,
    showDiffModal
  ]);

  // Workspace layout (pane positions, sizes, presets) - see ./layout/layoutModel.js
  const studioLayout = useStudioLayout();
  const { layout, patch: patchLayout, applyBuiltinByIndex } = studioLayout;
  const { prefs, setPref, resetPrefs } = useStudioPrefs();
  const [settingsPage, setSettingsPage] = useState('qc');
  const [dialog, setDialog] = useState(null); // 'shift' | 'goto' | 'find'
  const [showPalette, setShowPalette] = useState(false);
  const openSettings = useCallback((page) => {
    if (page) setSettingsPage(page);
    setShowSettingsModal(true);
  }, []);

  // File Inputs & Header Refs
  const fileInputRef = useRef(null);
  const srtImportRef = useRef(null);
  const headerMenuRef = useRef(null);
  const topHeaderRef = useRef(null);
  const formatMenuRef = useRef(null);
  const uploadPromiseRef = useRef(null);

  // ── Word-Style Formatting State ──
  const [showFormatToolbar, setShowFormatToolbar] = useState(false);
  const [subtitleStyle, setSubtitleStyle] = useState(() => {
    try {
      const saved = localStorage.getItem('karya_subtitle_style');
      return saved ? JSON.parse(saved) : {
        fontFamily: 'Netflix Sans, Roboto, Helvetica, Arial, sans-serif',
        fontSize: 22,
        isBold: false,
        isItalic: false,
        isUnderline: false,
        isStrikethrough: false,
        textColor: '#ffffff',
        bgColor: 'rgba(0,0,0,0.6)',
        textAlign: 'center',
        textShadow: 'outline'
      };
    } catch (_) {
      return {
        fontFamily: 'Netflix Sans, Roboto, Helvetica, Arial, sans-serif',
        fontSize: 22,
        isBold: false,
        isItalic: false,
        isUnderline: false,
        isStrikethrough: false,
        textColor: '#ffffff',
        bgColor: 'rgba(0,0,0,0.6)',
        textAlign: 'center',
        textShadow: 'outline'
      };
    }
  });

  const updateSubtitleStyle = useCallback((keyOrObj, val) => {
    setSubtitleStyle(prev => {
      const next = typeof keyOrObj === 'object' ? { ...prev, ...keyOrObj } : { ...prev, [keyOrObj]: val };
      try { localStorage.setItem('karya_subtitle_style', JSON.stringify(next)); } catch (_) { }
      return next;
    });
  }, []);

  // ── Subtitle Formatting Scope: 'active' (Just this subtitle) | 'all' (All subtitles in project) ──
  const [formatScope, setFormatScope] = useState(() => {
    try {
      return localStorage.getItem('karya_format_scope') || 'active';
    } catch {
      return 'active';
    }
  });

  const handleSetFormatScope = useCallback((scope) => {
    setFormatScope(scope);
    try { localStorage.setItem('karya_format_scope', scope); } catch (_) { }
  }, []);

  // Helper: Detect if color is light to enforce smart black vs white text contrast
  const isLightColor = useCallback((color) => {
    if (!color || color === 'transparent') return false;
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (match) {
      const r = parseInt(match[1], 10);
      const g = parseInt(match[2], 10);
      const b = parseInt(match[3], 10);
      return (r * 299 + g * 587 + b * 114) / 1000 > 140;
    }
    let hex = color.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return (r * 299 + g * 587 + b * 114) / 1000 > 140;
    }
    return false;
  }, []);

  // ── Dynamic Subtitle & QC Threshold Settings ──
  const [cplLimit, setCplLimit] = useState(() => {
    try {
      const v = localStorage.getItem('karya_sub_cpl');
      return v ? parseInt(v, 10) : 42;
    } catch {
      return 42;
    }
  });

  const [cpsLimit, setCpsLimit] = useState(() => {
    try {
      const v = localStorage.getItem('karya_sub_cps');
      return v ? parseFloat(v) : 20.0;
    } catch {
      return 20.0;
    }
  });

  const handleLanguageChange = useCallback((newLang) => {
    setLanguage(newLang);
    try { localStorage.setItem('karya_sub_language', newLang); } catch (_) { }
    // Automatically match Netflix specs for the selected language
    if (newLang === 'ja') {
      setCplLimit(16);
      setCpsLimit(contentType === 'children' ? 5.0 : 7.5);
    } else if (newLang === 'zh' || newLang === 'zht') {
      setCplLimit(16);
      setCpsLimit(contentType === 'children' ? 7.0 : 9.5);
    } else if (newLang === 'ko') {
      setCplLimit(16);
      setCpsLimit(contentType === 'children' ? 7.5 : 10.5);
    } else if (newLang === 'th') {
      setCplLimit(35);
      setCpsLimit(20.0);
    } else {
      setCplLimit(42);
      setCpsLimit(contentType === 'children' ? 17.0 : 20.0);
    }
  }, [contentType]);

  const [glossaryTerms, setGlossaryTerms] = useState(() => {
    try {
      const saved = localStorage.getItem('karya_subtitle_glossary');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const handleUpdateGlossary = useCallback((terms) => {
    setGlossaryTerms(terms);
    try {
      localStorage.setItem('karya_subtitle_glossary', JSON.stringify(terms));
    } catch (_) { }
  }, []);

  const [maxLines, setMaxLines] = useState(() => {
    try {
      const v = localStorage.getItem('karya_sub_max_lines');
      return v ? parseInt(v, 10) : 2;
    } catch {
      return 2;
    }
  });

  const [minDuration, setMinDuration] = useState(() => {
    try {
      const v = localStorage.getItem('karya_sub_min_dur');
      return v ? parseFloat(v) : 0.833;
    } catch {
      return 0.833;
    }
  });

  const [maxDuration, setMaxDuration] = useState(() => {
    try {
      const v = localStorage.getItem('karya_sub_max_dur');
      return v ? parseFloat(v) : 7.0;
    } catch {
      return 7.0;
    }
  });

  const [geminiAutoFix, setGeminiAutoFix] = useState(() => {
    try {
      const v = localStorage.getItem('karya_sub_autofix');
      return v !== null ? v === 'true' : true;
    } catch {
      return true;
    }
  });

  const [isFixingWithGemini, setIsFixingWithGemini] = useState(false);
  const [isSyncingAudio, setIsSyncingAudio] = useState(false);

  // Sync settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('karya_sub_cpl', cplLimit);
      localStorage.setItem('karya_sub_cps', cpsLimit);
      localStorage.setItem('karya_sub_max_lines', maxLines);
      localStorage.setItem('karya_sub_min_dur', minDuration);
      localStorage.setItem('karya_sub_max_dur', maxDuration);
      localStorage.setItem('karya_sub_autofix', geminiAutoFix);
      localStorage.setItem('karya_sub_fps', frameRate);
    } catch { }
  }, [cplLimit, cpsLimit, maxLines, minDuration, maxDuration, geminiAutoFix, frameRate]);

  // Active Subtitle
  const activeEvent = useMemo(() => {
    return events.find(e => (e.id === activeEventId || e.event_id === activeEventId)) || events[0] || null;
  }, [events, activeEventId]);

  // Sanitize helper: Enforces zero overlaps, chronological order, and purges legacy errors
  const sanitizeEvents = useCallback((evs) => {
    if (!evs || !Array.isArray(evs)) return [];

    // 1. Filter out empty or whitespace-only events
    const valid = evs.filter(e => e && typeof e === 'object' && (e.text || '').trim().length > 0);

    // 2. Strict chronological sort by start time
    valid.sort((a, b) => {
      const stA = a.start_time !== undefined ? Number(a.start_time) : (a.start !== undefined ? Number(a.start) : 0);
      const stB = b.start_time !== undefined ? Number(b.start_time) : (b.start !== undefined ? Number(b.start) : 0);
      if (stA !== stB) return stA - stB;
      const etA = a.end_time !== undefined ? Number(a.end_time) : (a.end !== undefined ? Number(a.end) : 0);
      const etB = b.end_time !== undefined ? Number(b.end_time) : (b.end !== undefined ? Number(b.end) : 0);
      return etA - etB;
    });

    // 3. Cascade non-overlap enforcement (min gap = 2 frames @ 24fps = 0.083s)
    const minGap = 0.083;
    for (let i = 0; i < valid.length - 1; i++) {
      const cur = valid[i];
      const nxt = valid[i + 1];
      const curSt = cur.start_time !== undefined ? Number(cur.start_time) : (cur.start !== undefined ? Number(cur.start) : 0);
      let curEt = cur.end_time !== undefined ? Number(cur.end_time) : (cur.end !== undefined ? Number(cur.end) : curSt + 1.0);
      let nxtSt = nxt.start_time !== undefined ? Number(nxt.start_time) : (nxt.start !== undefined ? Number(nxt.start) : 0);
      let nxtEt = nxt.end_time !== undefined ? Number(nxt.end_time) : (nxt.end !== undefined ? Number(nxt.end) : nxtSt + 1.0);

      // Degenerate identical or inverted start times: sequence next cleanly after current
      if (nxtSt <= curSt + 0.05) {
        const nextDur = Math.max(0.5, nxtEt - nxtSt);
        nxtSt = Number((curEt + minGap).toFixed(3));
        nxtEt = Number((nxtSt + nextDur).toFixed(3));
        nxt.start_time = nxtSt;
        nxt.start = nxtSt;
        nxt.end_time = nxtEt;
        nxt.end = nxtEt;
      }

      // Overlap: cur ends after nxt starts
      if (curEt > nxtSt - minGap) {
        const targetEnd = Number((nxtSt - minGap).toFixed(3));
        if (targetEnd > curSt + 0.20) {
          curEt = targetEnd;
        } else {
          curEt = Number((curSt + 0.35).toFixed(3));
          nxtSt = Number((curEt + minGap).toFixed(3));
          const nextDur = Math.max(0.5, nxtEt - (nxt.start_time || 0));
          nxtEt = Number((nxtSt + nextDur).toFixed(3));
          nxt.start_time = nxtSt;
          nxt.start = nxtSt;
          nxt.end_time = nxtEt;
          nxt.end = nxtEt;
        }
        cur.end_time = curEt;
        cur.end = curEt;
      }
      cur.duration = Number(Math.max(0.1, curEt - curSt).toFixed(3));
    }

    return valid.map(e => ({
      ...e,
      qc_errors: (e.qc_errors || e.errors || []).filter(err => {
        const rid = (err.rule_id || '').toUpperCase();
        const msg = (err.message || '').toLowerCase();
        return !rid.includes('PYRAMID') && !msg.includes('pyramid') && !msg.includes('bottom-heavy');
      }),
      errors: (e.errors || []).filter(err => {
        const rid = (err.rule_id || '').toUpperCase();
        const msg = (err.message || '').toLowerCase();
        return !rid.includes('PYRAMID') && !msg.includes('pyramid') && !msg.includes('bottom-heavy');
      })
    }));
  }, []);

  // Click outside to close menus
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (topHeaderRef.current && !topHeaderRef.current.contains(e.target)) {
        setShowFileDropdown(false);
        setShowSettingsDropdown(false);
      }
      if (formatMenuRef.current && !formatMenuRef.current.contains(e.target)) {
        setShowFormatToolbar(false);
      }
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target)) {
        setShowSettingsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── Interval auto-save of a local draft (localStorage); interval is set in Settings → Editor ──
  // One stable timer that reads the latest data, so continuous editing no longer postpones the save.
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState(null);
  const autosaveDataRef = useRef(null);
  autosaveDataRef.current = { events, tracks, activeTrack, sourceTrack, complianceScore, totalErrors, totalWarnings, selectedFile, language, contentType, cplLimit, cpsLimit, frameRate, sdhMode };
  const lastSavedEventsRef = useRef(null);
  const lastSavedTracksRef = useRef(null);
  const saveDraftNow = useCallback(() => {
    const d = autosaveDataRef.current;
    if (!d || !d.events || d.events.length === 0) return false;
    try {
      localStorage.setItem(draftKey(d.selectedFile?.name), JSON.stringify(buildDraft(d)));
      lastSavedEventsRef.current = d.events;
      lastSavedTracksRef.current = d.tracks;
      setLastDraftSavedAt(new Date());
      return true;
    } catch (e) {
      console.warn('Auto-save storage quota exceeded', e);
      return false;
    }
  }, []);
  useEffect(() => {
    if (!prefs.autosaveSec) return undefined;
    const interval = setInterval(() => {
      const d = autosaveDataRef.current;
      if (!d || !d.events || d.events.length === 0 || d.events === lastSavedEventsRef.current && d.tracks === lastSavedTracksRef.current) return;
      saveDraftNow();
    }, prefs.autosaveSec * 1000);
    return () => clearInterval(interval);
  }, [prefs.autosaveSec, saveDraftNow]);
  const hasUnsavedDraftChanges = events.length > 0 && (events !== lastSavedEventsRef.current || tracks !== lastSavedTracksRef.current);

  // Workspace shortcuts (handlers are read from a ref so the listener is attached once)
  const shortcutRef = useRef({});
  useEffect(() => {
    const onKey = (e) => {
      const a = shortcutRef.current;
      const mod = e.ctrlKey || e.metaKey;
      const k = (e.key || '').toLowerCase();
      if (mod && e.shiftKey && e.code === 'KeyL') { e.preventDefault(); a.openLayout?.(); }
      else if (mod && !e.shiftKey && !e.altKey && k === 'k') { e.preventDefault(); a.palette?.(); }
      else if (mod && !e.shiftKey && !e.altKey && e.key === ',') { e.preventDefault(); a.settings?.(); }
      else if (mod && !e.shiftKey && !e.altKey && k === 'h') { e.preventDefault(); a.find?.(); }
      else if (mod && !e.shiftKey && !e.altKey && k === 'g') { e.preventDefault(); a.goTo?.(); }
      else if (mod && !e.shiftKey && !e.altKey && k === 's') { e.preventDefault(); a.save?.(); }
      else if (mod && !e.shiftKey && !e.altKey && k === 'e') { e.preventDefault(); a.exportSubs?.(); }
      else if (e.altKey && !mod && !e.shiftKey && /^Digit[1-9]$/.test(e.code)) { e.preventDefault(); a.preset?.(Number(e.code.slice(5)) - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Push to undo stack
  const pushToHistory = useCallback((newEvents) => {
    setHistory(prev => {
      const next = prev.slice(0, historyIndex + 1);
      return [...next, newEvents];
    });
    setHistoryIndex(prev => prev + 1);
  }, [historyIndex]);

  // Linting with non-destructive error map updating (never overwrites user typing)
  const handleLint = useCallback(async (updatedEvents) => {
    if (!updatedEvents || updatedEvents.length === 0) return;
    try {
      const res = await fetch(`${API_BASE}/api/subtitle/lint`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: updatedEvents,
          shot_changes: shotChanges,
          frame_rate: frameRate,
          content_type: contentType,
          custom_cpl: cplLimit,
          custom_cps: cpsLimit,
          custom_max_lines: maxLines,
          custom_min_duration: minDuration,
          custom_max_duration: maxDuration
        })
      });
      setQcUnavailable(!res.ok);
      if (res.ok) {
        const data = await res.json();
        setComplianceScore(data.compliance_score ?? 100);
        setTotalErrors(data.total_errors || 0);
        setTotalWarnings(data.total_warnings || 0);
        setCpsStats(data.cps_stats || null);
        if (data.events) {
          const sanitized = sanitizeEvents(data.events);
          const errMap = new Map(sanitized.map(e => [e.id ?? e.event_id, (e.qc_errors || e.errors || [])]));
          setEvents(prev => prev.map(e => {
            const curId = e.id ?? e.event_id;
            const newErrors = errMap.get(curId);
            if (!newErrors) return e;
            // the linter does not know about translation alignment errors: keep them until the text is edited
            const kept = (e.qc_errors || []).filter(err => err.rule_id === 'TRANSLATION-ALIGN' && !e.align_resolved);
            return { ...e, qc_errors: [...kept, ...newErrors], errors: newErrors };
          }));
        }
      }
    } catch (err) {
      console.error(err);
      setQcUnavailable(true);
    }
  }, [shotChanges, frameRate, contentType, cplLimit, cpsLimit, maxLines, minDuration, maxDuration, sanitizeEvents]);

  // ── Language tracks (translations as switchable subtitle sets) ──
  const eventsNowRef = useRef([]);
  eventsNowRef.current = events;
  const tracksRef = useRef({});
  tracksRef.current = tracks;
  const activeTrackRef = useRef(null);
  activeTrackRef.current = activeTrack;

  const resetTracks = useCallback(() => {
    setTracks({});
    setActiveTrack(null);
    setSourceTrack(null);
  }, []);

  /** Load a track into the list/timeline/video and give it a fresh undo history. */
  const loadTrackEvents = useCallback((next) => {
    setEvents(next);
    setHistory([next]);
    setHistoryIndex(0);
    setActiveEventId(next[0]?.id ?? null);
    if (next.length) handleLint(next);
  }, [handleLint]);

  /** Centroid finished: register the original and every translation as tracks (nothing on screen changes). */
  const handleTranslated = useCallback(({ sourceLang, built }) => {
    const current = tracksRef.current;
    const active = activeTrackRef.current;
    const next = { ...current };
    if (!active) {
      next[sourceLang] = eventsNowRef.current; // what is on screen now is the original-language track
      setActiveTrack(sourceLang);
      setSourceTrack(sourceLang);
    } else {
      next[active] = eventsNowRef.current;      // keep edits made to the track being viewed
    }
    Object.entries(built).forEach(([code, evs]) => {
      if (code !== activeTrackRef.current) next[code] = evs;
    });
    setTracks(next);
  }, []);

  /** Switch the editor to another language. Edits to the language you leave are kept. */
  const switchTrack = useCallback((code) => {
    const active = activeTrackRef.current;
    if (!code || code === active) return;
    const saved = { ...tracksRef.current };
    if (active) saved[active] = eventsNowRef.current;
    const target = saved[code];
    if (!target) return;
    setTracks(saved);
    setActiveTrack(code);
    loadTrackEvents(target);
  }, [loadTrackEvents]);

  /** "Show in editor" from the translate drawer: refresh that language from Centroid's result and switch to it. */
  const showTranslatedTrack = useCallback(({ code, sourceLang, events: evs }) => {
    const active = activeTrackRef.current;
    const saved = { ...tracksRef.current };
    if (!active) {
      saved[sourceLang] = eventsNowRef.current;
      setSourceTrack(sourceLang);
    } else {
      saved[active] = eventsNowRef.current;
    }
    const existing = saved[code];
    const edited = existing && JSON.stringify(existing.map((e) => e.text)) !== JSON.stringify(evs.map((e) => e.text));
    if (edited && !window.confirm(`Replace your ${langName(code)} edits with Centroid's latest ${langName(code)} translation?`)) {
      // keep the user's version and just switch to it
      setTracks(saved);
      setActiveTrack(code);
      loadTrackEvents(existing);
      return;
    }
    saved[code] = evs;
    setTracks(saved);
    setActiveTrack(code);
    loadTrackEvents(evs);
  }, [loadTrackEvents]);

  /** Centroid QC "Apply fix": write new text into the subtitles on screen, or into another language's saved track. Returns how many changed. */
  const applyTextFixes = useCallback((code, edits) => {
    const patch = (list) => {
      const next = [...list];
      let hit = 0;
      edits.forEach((ed) => {
        let i = -1;
        if (ed.id != null) i = next.findIndex((e) => (e.id ?? e.event_id) === ed.id);
        else {
          const near = (e) => e && Math.abs((e.start_time ?? e.start ?? 0) - ed.start) < 0.05;
          i = near(next[ed.index - 1]) ? ed.index - 1 : next.findIndex(near);
        }
        if (i < 0) return;
        const e = next[i];
        next[i] = { ...e, text: ed.text, lines: ed.text.split('\n'), ...(e.qc_errors?.some((x) => x.rule_id === 'TRANSLATION-ALIGN') ? { align_resolved: true } : {}) };
        editedEventIdsRef.current.add(e.id ?? e.event_id);
        hit += 1;
      });
      return { next, hit };
    };
    if (code === 'editor' || code === activeTrackRef.current) {
      const { next, hit } = patch(eventsNowRef.current);
      if (hit) { setEvents(next); pushToHistory(next); handleLint(next); }
      return hit;
    }
    const saved = tracksRef.current[code];
    if (!saved) return 0;
    const { next, hit } = patch(saved);
    if (hit) setTracks((prev) => ({ ...prev, [code]: next }));
    return hit;
  }, [pushToHistory, handleLint]);

  const lintDebounceRef = useRef(null);
  const debouncedLint = useCallback((updatedEvents) => {
    if (lintDebounceRef.current) clearTimeout(lintDebounceRef.current);
    lintDebounceRef.current = setTimeout(() => {
      handleLint(updatedEvents);
      lintDebounceRef.current = null;
    }, 750);
  }, [handleLint]);

  const historyDebounceRef = useRef(null);
  const debouncedPushHistory = useCallback((nextEvents) => {
    if (historyDebounceRef.current) clearTimeout(historyDebounceRef.current);
    historyDebounceRef.current = setTimeout(() => {
      pushToHistory(nextEvents);
      historyDebounceRef.current = null;
    }, 800);
  }, [pushToHistory]);

  // ── Word-Style Active Subtitle Formatting Helpers ──
  const applyFormatTagToActive = useCallback((tag) => {
    if (!activeEventId) return;
    setEvents(prev => {
      const idx = prev.findIndex(e => e.id === activeEventId || e.event_id === activeEventId);
      if (idx === -1) return prev;
      const ev = prev[idx];
      let curText = ev.text || '';
      const openTag = `<${tag}>`;
      const closeTag = `</${tag}>`;
      let newText = '';

      if (curText.includes(openTag) && curText.includes(closeTag)) {
        newText = curText.replaceAll(openTag, '').replaceAll(closeTag, '');
      } else {
        newText = `${openTag}${curText}${closeTag}`;
      }

      editedEventIdsRef.current.add(ev.id);
      const updated = [...prev];
      updated[idx] = { ...ev, text: newText };
      debouncedPushHistory(updated);
      debouncedLint(updated);
      return updated;
    });
  }, [activeEventId, debouncedPushHistory, debouncedLint]);

  const applyColorToActive = useCallback((colorHex) => {
    if (!activeEventId) return;
    setEvents(prev => {
      const idx = prev.findIndex(e => e.id === activeEventId || e.event_id === activeEventId);
      if (idx === -1) return prev;
      const ev = prev[idx];
      let curText = ev.text || '';
      let clean = curText.replace(/<\/?font[^>]*>/gi, '');
      const newText = `<font color="${colorHex}">${clean}</font>`;

      editedEventIdsRef.current.add(ev.id);
      const updated = [...prev];
      updated[idx] = { ...ev, text: newText };
      debouncedPushHistory(updated);
      debouncedLint(updated);
      return updated;
    });
  }, [activeEventId, debouncedPushHistory, debouncedLint]);

  const clearFormatFromActive = useCallback(() => {
    if (!activeEventId) return;
    setEvents(prev => {
      const idx = prev.findIndex(e => e.id === activeEventId || e.event_id === activeEventId);
      if (idx === -1) return prev;
      const ev = prev[idx];
      let curText = ev.text || '';
      const newText = curText.replace(/<\/?(?:b|i|u|s|strike|font)(?:\s+[^>]*)?>/gi, '');

      editedEventIdsRef.current.add(ev.id);
      const updated = [...prev];
      updated[idx] = { ...ev, text: newText, bgColor: undefined };
      debouncedPushHistory(updated);
      debouncedLint(updated);
      return updated;
    });
  }, [activeEventId, debouncedPushHistory, debouncedLint]);

  // ── Smart Formatting Handlers with Scope & Auto-Contrast ──
  const handleApplyFormatTextColor = useCallback((colorHex) => {
    if (formatScope === 'active') {
      if (activeEventId) {
        applyColorToActive(colorHex);
      }
      setSubtitleStyle(prev => ({ ...prev, textColor: colorHex }));
    } else {
      // Apply to all subtitles in project
      updateSubtitleStyle('textColor', colorHex);
      setEvents(prev => {
        const updated = prev.map(ev => {
          let curText = ev.text || '';
          let clean = curText.replace(/<\/?font[^>]*>/gi, '');
          return {
            ...ev,
            text: clean
          };
        });
        debouncedPushHistory(updated);
        debouncedLint(updated);
        return updated;
      });
    }
  }, [formatScope, activeEventId, applyColorToActive, updateSubtitleStyle, debouncedPushHistory, debouncedLint]);

  const handleApplyFormatBgColor = useCallback((bgChoice) => {
    const lightBg = isLightColor(bgChoice);
    // User chose light bg -> black text; dark bg -> white text
    const contrastTextColor = lightBg ? '#000000' : '#ffffff';

    if (formatScope === 'active') {
      if (activeEventId) {
        setEvents(prev => {
          const idx = prev.findIndex(e => e.id === activeEventId || e.event_id === activeEventId);
          if (idx === -1) return prev;
          const ev = prev[idx];
          let curText = ev.text || '';
          let clean = curText.replace(/<\/?font[^>]*>/gi, '');
          const newText = bgChoice === 'transparent' ? clean : `<font color="${contrastTextColor}">${clean}</font>`;

          editedEventIdsRef.current.add(ev.id);
          const updated = [...prev];
          updated[idx] = {
            ...ev,
            text: newText,
            bgColor: bgChoice
          };
          debouncedPushHistory(updated);
          debouncedLint(updated);
          return updated;
        });
      }
      // Update preview to reflect the chosen bg and auto-contrasted text
      setSubtitleStyle(prev => ({
        ...prev,
        bgColor: bgChoice,
        textColor: contrastTextColor
      }));
    } else {
      // Apply to all subtitles in project
      updateSubtitleStyle({
        bgColor: bgChoice,
        textColor: contrastTextColor
      });
      setEvents(prev => {
        const updated = prev.map(ev => {
          let curText = ev.text || '';
          let clean = curText.replace(/<\/?font[^>]*>/gi, '');
          return {
            ...ev,
            text: clean,
            bgColor: undefined // clear individual overrides so all inherit global project style
          };
        });
        debouncedPushHistory(updated);
        debouncedLint(updated);
        return updated;
      });
    }
  }, [formatScope, activeEventId, isLightColor, updateSubtitleStyle, debouncedPushHistory, debouncedLint]);

  const handleClearFormat = useCallback(() => {
    if (formatScope === 'active') {
      clearFormatFromActive();
      if (activeEventId) {
        setEvents(prev => {
          const idx = prev.findIndex(e => e.id === activeEventId || e.event_id === activeEventId);
          if (idx === -1) return prev;
          const updated = [...prev];
          updated[idx] = { ...updated[idx], bgColor: undefined };
          debouncedPushHistory(updated);
          return updated;
        });
      }
    } else {
      // Reset all subtitles to default standard
      const defaultStyle = {
        fontFamily: 'Netflix Sans, Roboto, Helvetica, Arial, sans-serif',
        fontSize: 22,
        isBold: false,
        isItalic: false,
        isUnderline: false,
        isStrikethrough: false,
        textColor: '#ffffff',
        bgColor: 'rgba(0,0,0,0.6)',
        textAlign: 'center',
        textShadow: 'outline'
      };
      setSubtitleStyle(defaultStyle);
      try { localStorage.setItem('karya_subtitle_style', JSON.stringify(defaultStyle)); } catch (_) { }
      setEvents(prev => {
        const updated = prev.map(ev => ({
          ...ev,
          text: (ev.text || '').replace(/<\/?(?:b|i|u|s|strike|font)(?:\s+[^>]*)?>/gi, ''),
          bgColor: undefined
        }));
        debouncedPushHistory(updated);
        debouncedLint(updated);
        return updated;
      });
    }
  }, [formatScope, activeEventId, clearFormatFromActive, debouncedPushHistory, debouncedLint]);

  const handleUndo = () => {
    if (historyIndex > 0) {
      const targetIdx = historyIndex - 1;
      const targetEvents = history[targetIdx];
      setHistoryIndex(targetIdx);
      setEvents(targetEvents);
      handleLint(targetEvents);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const targetIdx = historyIndex + 1;
      const targetEvents = history[targetIdx];
      setHistoryIndex(targetIdx);
      setEvents(targetEvents);
      handleLint(targetEvents);
    }
  };

  // Re-cut / Split active subtitle at current playhead cursor
  const handleSplitAtCursor = (splitTime) => {
    const timeToSplit = splitTime !== undefined ? splitTime : getPlayhead();
    setEvents(prev => {
      let targetIdx = prev.findIndex(e => {
        const st = e.start_time ?? e.start ?? 0;
        const en = e.end_time ?? e.end ?? 0;
        return timeToSplit > st && timeToSplit < en;
      });

      if (targetIdx === -1) {
        targetIdx = prev.findIndex(e => e.id === activeEventId);
      }

      if (targetIdx === -1) return prev;

      const ev = prev[targetIdx];
      const start = ev.start_time ?? ev.start;
      const end = ev.end_time ?? ev.end;

      if (timeToSplit <= start + 0.1 || timeToSplit >= end - 0.1) return prev;

      const text = ev.text || "";
      const mid = Math.floor(text.length / 2);
      const spaceIdx = text.lastIndexOf(" ", mid) > -1 ? text.lastIndexOf(" ", mid) : mid;
      const text1 = text.slice(0, spaceIdx > 0 ? spaceIdx : mid).trim();
      const text2 = text.slice(spaceIdx > 0 ? spaceIdx : mid).trim();

      const splitAt = Math.round(timeToSplit * 1000) / 1000;
      const secondStart = Math.round((splitAt + 0.08) * 1000) / 1000;
      const newEv1 = { ...ev, end_time: splitAt, end: splitAt, duration: Math.round((splitAt - start) * 1000) / 1000, text: text1, lines: text1.split('\n') };
      const newEv2 = { ...ev, id: Math.max(...prev.map(p => p.id || 0)) + 1, start_time: secondStart, start: secondStart, duration: Math.round((end - secondStart) * 1000) / 1000, text: text2, lines: text2.split('\n') };

      editedEventIdsRef.current.add(ev.id);
      editedEventIdsRef.current.add(newEv2.id);

      const next = [...prev];
      next.splice(targetIdx, 1, newEv1, newEv2);
      pushToHistory(next);
      handleLint(next);
      setActiveEventId(newEv2.id);
      return next;
    });
  };

  // ── Subtitle Edit Feature: Move active and all following subtitles to playhead (preserving spacing) ──
  const handleShiftAllFollowing = (targetId, targetTime) => {
    const pivotTime = targetTime !== undefined ? targetTime : getPlayhead();
    setEvents(prev => {
      if (!prev || prev.length === 0) return prev;

      let targetIdx = -1;
      if (targetId) {
        targetIdx = prev.findIndex(e => (e.id === targetId || e.event_id === targetId));
      }
      if (targetIdx === -1) {
        targetIdx = prev.findIndex(e => {
          const st = e.start_time ?? e.start ?? 0;
          return st >= pivotTime - 0.5;
        });
      }
      if (targetIdx === -1) {
        targetIdx = prev.length - 1;
      }

      const activeEv = prev[targetIdx];
      const curStart = activeEv.start_time ?? activeEv.start ?? 0;
      const delta = pivotTime - curStart;

      if (Math.abs(delta) < 0.01) return prev;

      const next = prev.map((ev, idx) => {
        if (idx >= targetIdx) {
          editedEventIdsRef.current.add(ev.id);
          const s = Math.max(0, Math.round(((ev.start_time ?? ev.start ?? 0) + delta) * 1000) / 1000);
          const e = Math.max(s + 0.1, Math.round(((ev.end_time ?? ev.end ?? 0) + delta) * 1000) / 1000);
          return {
            ...ev,
            start_time: s,
            end_time: e,
            start: s,
            end: e,
            duration: Math.round((e - s) * 1000) / 1000
          };
        }
        return ev;
      });

      pushToHistory(next);
      handleLint(next);
      console.log(`[Subtitle Studio] Shifted ${next.length - targetIdx} subtitles from #${activeEv.id} by ${delta.toFixed(3)}s`);
      return next;
    });
  };

  // ── Global Keyboard Shortcuts ──
  useEffect(() => {
    const handleKeyDown = (e) => {
      const tag = e.target?.tagName?.toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || tag === 'select';

      // Subtitle Edit Alignment: Shift active & all following subtitles to playhead (Ctrl+Space or Ctrl+Enter)
      if ((e.ctrlKey || e.metaKey) && (e.key === ' ' || e.key === 'Enter')) {
        e.preventDefault();
        handleShiftAllFollowing(activeEventId, getPlayhead());
        return;
      }

      // Undo / Redo
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
      } else if (e.key === 'F8') {
        e.preventDefault();
        jumpToNextIssue();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!isInput && activeEventId) {
          e.preventDefault();
          handleDeleteEvent(activeEventId);
        }
      } else if (e.key === 'ArrowUp' && !isInput && (e.altKey || !e.shiftKey)) {
        e.preventDefault();
        const idx = events.findIndex(ev => ev.id === activeEventId);
        if (idx > 0) {
          const prevId = events[idx - 1].id;
          setActiveEventId(prevId);
          handlePlayEvent(prevId);
        }
      } else if (e.key === 'ArrowDown' && !isInput && (e.altKey || !e.shiftKey)) {
        e.preventDefault();
        const idx = events.findIndex(ev => ev.id === activeEventId);
        if (idx < events.length - 1) {
          const nextId = events[idx + 1].id;
          setActiveEventId(nextId);
          handlePlayEvent(nextId);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [history, historyIndex, events, activeEventId]);

  // Jump to Next QC Issue
  const jumpToNextIssue = () => {
    const issueEvents = events.filter(e => (e.qc_errors || e.errors || []).length > 0);
    if (issueEvents.length === 0) return;

    const curIdx = issueEvents.findIndex(e => e.id === activeEventId);
    const nextEvent = issueEvents[(curIdx + 1) % issueEvents.length];
    if (nextEvent) {
      setActiveEventId(nextEvent.id);
      handlePlayEvent(nextEvent.id);
    }
  };

  // A file dropped on the Home screen opens here straight away
  useEffect(() => {
    const intent = takeLaunchIntent('subtitle');
    if (intent?.file) handleFileChange({ target: { files: [intent.file] } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Media File (Video or Audio) Upload Handler
  const handleFileChange = (e) => {
    resetTracks();
    const file = e.target.files?.[0];
    if (file) {
      console.log(
        '%c[Subtitle Studio]%c Selected media file: ' + file.name + ' (' + (file.size / (1024 * 1024)).toFixed(2) + ' MB, MIME: ' + (file.type || 'unknown') + ')',
        'background: #3b82f6; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
        'color: #2563eb; font-weight: 500;'
      );
      setSelectedFile(file);
      setCurrentVideoId(null);
      extractedAudioFileRef.current = null;
      setInitialWaveformPeaks([]);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);

      const isAudio = Boolean(
        file.type?.startsWith('audio/') ||
        /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma)$/i.test(file.name || '')
      );
      const isWma = Boolean(
        file.type === 'audio/x-ms-wma' ||
        file.type === 'audio/wma' ||
        /\.(wma)$/i.test(file.name || '')
      );

      if (isAudio && !isWma) {
        setExtractedAudioUrl(url);
      } else {
        setExtractedAudioUrl(null);
      }

      const mediaElem = isAudio ? document.createElement('audio') : document.createElement('video');
      mediaElem.src = url;
      mediaElem.onloadedmetadata = () => {
        setVideoDuration(mediaElem.duration || 0);
      };

      // Auto-detect container frame rate for video files
      if (!isAudio) {
        detectVideoFrameRate(file, API_BASE).then(res => {
          if (res?.frame_rate && res.frame_rate > 0) {
            setFrameRate(res.frame_rate);
            setDetectedFpsNotice(`${res.frame_rate} fps`);
            setTimeout(() => setDetectedFpsNotice(''), 4500);
          }
        }).catch(err => console.warn("FPS detection notice:", err));
      }

      // Upload in background immediately with client audio extraction and waveform generation
      uploadPromiseRef.current = processAndUploadMedia(file, isAudio);

      // Reset subtitle canvas for clean state
      setEvents([]);
      setComplianceScore(100);
      setTotalErrors(0);
      setTotalWarnings(0);
      setActiveEventId(null);

      // Check if previous autosaved draft exists
      const saved = localStorage.getItem(draftKey(file.name));
      if (saved) {
        try {
          const data = JSON.parse(saved);
          if (data.events && data.events.length > 0) {
            setPendingDraft(data);
          } else {
            setPendingDraft(null);
          }
        } catch (err) {
          console.error(err);
          setPendingDraft(null);
        }
      } else {
        setPendingDraft(null);
      }
    }
  };

  // Separate External Audio Track Upload (Sync with Video)
  const handleAudioTrackChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const aUrl = URL.createObjectURL(file);
    setExtractedAudioUrl(aUrl);
    extractedAudioFileRef.current = file;

    // Decode peaks locally for immediate waveform preview
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioContextClass();
      const buf = await file.arrayBuffer();
      const decoded = await audioCtx.decodeAudioData(buf);
      audioCtx.close().catch(() => {});
      const channel = decoded.getChannelData(0);
      const peaks = computeWaveformPeaks(channel, decoded.duration, 50);
      if (peaks.length > 0) setInitialWaveformPeaks(peaks);
    } catch (err) {
      console.warn("Audio track peak extraction fallback:", err);
    }

    // Upload audio track to server in background
    uploadPromiseRef.current = processAndUploadMedia(file, true);
    setAutoSaveStatus(`Loaded audio track: ${file.name} ✓`);
    setTimeout(() => setAutoSaveStatus(''), 4000);
  }, [processAndUploadMedia]);

  // Discard previous work for currently selected media: purges local drafts and deletes backend audio/peaks/chunks
  // Discard the saved draft and the subtitles on screen. The loaded video, its audio and the waveform stay exactly as they are,
  // so nothing is deleted from the server and nothing is extracted or uploaded again.
  const handleDiscardPreviousWork = useCallback(() => {
    resetTracks();
    try {
      if (selectedFile?.name) localStorage.removeItem(`karya_subtitle_autosave_${selectedFile.name}`);
      localStorage.removeItem('karya_subtitle_autosave_draft_subtitle');
    } catch (_) { }

    setPendingDraft(null);
    setEvents([]);
    setOriginalEvents([]);
    setActiveEventId(null);
    editedEventIdsRef.current.clear();
    setComplianceScore(100);
    setTotalErrors(0);
    setTotalWarnings(0);

    setAutoSaveStatus('Draft discarded');
    setTimeout(() => setAutoSaveStatus(''), 3000);
  }, [selectedFile]);

  /** Apply the fixes from the Context panel to the subtitles on screen (undoable). Timing is untouched. */
  const handleApplyContextFixes = useCallback((fixes) => {
    const byId = new Map(fixes.map((f) => [f.id, f.after]));
    const next = events.map((e) => {
      const id = e.id ?? e.event_id;
      return byId.has(id) ? { ...e, text: byId.get(id), lines: byId.get(id).split('\n') } : e;
    });
    setEvents(next);
    pushToHistory(next);
    handleLint(next);
  }, [events, pushToHistory, handleLint]);

  // Available speakers list derived from all current subtitle events
  const availableSpeakers = useMemo(() => {
    const set = new Set();
    events.forEach(e => {
      if (e.speaker && typeof e.speaker === 'string' && e.speaker.trim()) {
        set.add(e.speaker.trim());
      }
    });
    ['Speaker 1', 'Speaker 2', 'Speaker 3'].forEach(s => set.add(s));
    return Array.from(set);
  }, [events]);

  // Rename or switch speaker for a specific event or across all events
  const handleRenameSpeaker = useCallback((targetEventId, newSpeakerName, applyToAll = false) => {
    if (!newSpeakerName || !newSpeakerName.trim()) return;
    const trimmed = newSpeakerName.trim();

    setEvents(prev => {
      const targetEvent = prev.find(e => (e.id === targetEventId || e.event_id === targetEventId));
      const oldSpeaker = targetEvent?.speaker;

      const next = prev.map(ev => {
        const isMatch = applyToAll
          ? ((oldSpeaker && ev.speaker === oldSpeaker) || (ev.id === targetEventId || ev.event_id === targetEventId))
          : (ev.id === targetEventId || ev.event_id === targetEventId);

        if (isMatch) {
          return {
            ...ev,
            speaker: trimmed,
            speaker_id: trimmed.toLowerCase().replace(/\s+/g, '_')
          };
        }
        return ev;
      });

      pushToHistory(next);
      return next;
    });
  }, [pushToHistory]);

  // Single Subtitle Event Update (Instant 0ms latency typing)
  const handleUpdateEvent = useCallback((id, field, value) => {
    editedEventIdsRef.current.add(id);
    setEvents(prev => {
      const next = prev.map(e => {
        if (e.id === id || e.event_id === id) {
          if (typeof field === 'object' && field !== null) {
            return { ...e, ...field, ...('text' in field && e.qc_errors?.some(x => x.rule_id === 'TRANSLATION-ALIGN') ? { align_resolved: true } : {}) };
          }
          return { ...e, [field]: value, ...(field === 'text' && e.qc_errors?.some(x => x.rule_id === 'TRANSLATION-ALIGN') ? { align_resolved: true } : {}) };
        }
        return e;
      });
      debouncedPushHistory(next);
      debouncedLint(next);
      return next;
    });
  }, [debouncedPushHistory, debouncedLint]);

  // Drag Time Change from Timeline
  const handleEventTimeChange = useCallback((id, newStart, newEnd) => {
    editedEventIdsRef.current.add(id);
    setEvents(prev => {
      const next = prev.map(e => {
        if (e.id === id || e.event_id === id) {
          const dur = Math.max(0.1, newEnd - newStart);
          return {
            ...e,
            start_time: newStart,
            end_time: newEnd,
            start: newStart,
            end: newEnd,
            duration: dur
          };
        }
        return e;
      });
      debouncedPushHistory(next);
      debouncedLint(next);
      return next;
    });
  }, [debouncedPushHistory, debouncedLint]);

  // Seek and Play Subtitle Event
  const handlePlayEvent = useCallback((id) => {
    setEvents(currentEvents => {
      const target = currentEvents.find(e => (e.id === id || e.event_id === id));
      if (target) {
        const st = target.start_time !== undefined ? target.start_time : (target.start !== undefined ? target.start : 0);
        const en = target.end_time !== undefined ? target.end_time : (target.end !== undefined ? target.end : 0);
        publishPlayhead(st);
        setPlayTarget({ time: st, endTime: en, pause: false });
      }
      return currentEvents;
    });
  }, []);

  // Split Event
  // Split a subtitle in the middle (state update must not be issued from inside another updater)
  const handleSplitEvent = (id) => {
    const ev = events.find(e => (e.id === id || e.event_id === id));
    if (!ev) return;
    const st = ev.start_time ?? ev.start ?? 0;
    const en = ev.end_time ?? ev.end ?? 0;
    editedEventIdsRef.current.add(id);
    handleSplitAtCursor(Math.round(((st + en) / 2) * 1000) / 1000);
  };

  // Merge Event with Next
  const handleMergeEvents = useCallback((id) => {
    editedEventIdsRef.current.add(id);
    setEvents(prev => {
      const idx = prev.findIndex(e => (e.id === id || e.event_id === id));
      if (idx === -1 || idx >= prev.length - 1) return prev;

      const cur = prev[idx];
      const next = prev[idx + 1];

      const mergedText = `${cur.text || ''}\n${next.text || ''}`.trim();
      const mergedEnd = next.end_time ?? next.end;
      const mergedEvent = {
        ...cur,
        end_time: mergedEnd,
        end: mergedEnd,
        duration: Math.max(0.1, mergedEnd - (cur.start_time ?? cur.start ?? 0)),
        text: mergedText,
        lines: mergedText.split('\n'),
      };

      const updated = [...prev];
      updated.splice(idx, 2, mergedEvent);
      pushToHistory(updated);
      handleLint(updated);
      return updated;
    });
  }, [pushToHistory, handleLint]);

  // Delete Event
  const handleDeleteEvent = useCallback((id) => {
    editedEventIdsRef.current.add(id);
    setEvents(prev => {
      const idx = prev.findIndex(e => (e.id === id || e.event_id === id));
      if (idx === -1) return prev;
      const updated = prev.filter(e => (e.id !== id && e.event_id !== id));
      pushToHistory(updated);
      handleLint(updated);
      if (updated.length > 0) {
        const nextActive = updated[Math.min(idx, updated.length - 1)].id;
        setActiveEventId(nextActive);
      } else {
        setActiveEventId(null);
      }
      return updated;
    });
  }, [pushToHistory, handleLint]);

  // Bulk Delete Multiple Subtitle Events
  const handleBulkDelete = useCallback((idsToDelete) => {
    if (!idsToDelete || idsToDelete.length === 0) return;
    idsToDelete.forEach(id => editedEventIdsRef.current.add(id));
    const deleteSet = new Set(idsToDelete);
    setEvents(prev => {
      const updated = prev.filter(e => !deleteSet.has(e.id) && !deleteSet.has(e.event_id));
      // Renumber remaining events
      const renumbered = updated.map((e, idx) => ({ ...e, id: idx + 1, event_id: idx + 1 }));
      pushToHistory(renumbered);
      handleLint(renumbered);
      if (renumbered.length > 0) {
        setActiveEventId(renumbered[0].id);
      } else {
        setActiveEventId(null);
      }
      return renumbered;
    });
  }, [pushToHistory, handleLint]);

  // Re-break Event Text
  const handleRebreakEvent = useCallback(async (id) => {
    let targetEv = null;
    setEvents(prev => {
      targetEv = prev.find(e => (e.id === id || e.event_id === id));
      return prev;
    });
    if (!targetEv) return;

    try {
      const res = await fetch(`${API_BASE}/api/subtitle/rebreak`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [targetEv], max_cpl: cplLimit })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.events && data.events[0]) {
          handleUpdateEvent(id, 'text', data.events[0].text);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }, [cplLimit, handleUpdateEvent]);

  // Re-break every subtitle's lines to the CPL limit (QC drawer "Re-break All")
  const handleRebreakAll = async () => {
    if (events.length === 0) return;
    await runTask('Re-breaking lines', async (job) => {
    try {
      const res = await fetch(`${API_BASE}/api/subtitle/rebreak`, {
        method: 'POST',
        signal: job.signal,
        headers: jobHeaders(job, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ events, max_cpl: cplLimit })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const byId = new Map((data.events || []).map(e => [e.id ?? e.event_id, e.text]));
      const updated = events.map(e => {
        const t = byId.get(e.id ?? e.event_id);
        return t !== undefined && t !== e.text ? { ...e, text: t, lines: t.split('\n') } : e;
      });
      setEvents(updated);
      pushToHistory(updated);
      handleLint(updated);
      setAutoSaveStatus('Line breaks re-balanced ✓');
      setTimeout(() => setAutoSaveStatus(''), 2500);
    } catch (err) {
      if (job.cancelled) return;
      console.error('Re-break all failed:', err);
      alert(`Could not re-break lines: ${err.message || err}`);
    }
    });
  };

  // ── Quality check: one-click fixes for single issues (and "fix all") ──
  // Each fix works on a copy of the subtitles, so a whole batch is one undo step and one re-check.
  const applyQcFixes = useCallback(async (items) => {
    // items: [{ key, eventId, ruleId }]  ->  [{ key, ok, message }]
    const rebreakIds = new Set(items.filter(i => tools.QC_REBREAK_RULES.has(i.ruleId)).map(i => i.eventId));
    let rebroke = new Map();
    if (rebreakIds.size) {
      try {
        const res = await fetch(`${API_BASE}/api/subtitle/rebreak`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events: events.filter(e => rebreakIds.has(e.id ?? e.event_id)), max_cpl: cplLimit })
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        rebroke = new Map((data.events || []).map(e => [e.id ?? e.event_id, e.text]));
      } catch (err) {
        console.error('QC rebreak failed:', err);
      }
    }
    const fps = frameRate || 24;
    const gap = 2 / fps;
    const round = (v) => Math.round(v * 1000) / 1000;
    let work = events.map(e => ({ ...e }));
    const results = [];
    for (const item of items) {
      const idx = work.findIndex(e => (e.id ?? e.event_id) === item.eventId);
      if (idx < 0) { results.push({ key: item.key, ok: false, message: 'This subtitle no longer exists.' }); continue; }
      const e = work[idx];
      const start = e.start_time ?? e.start ?? 0;
      const end = e.end_time ?? e.end ?? start;
      const next = work.reduce((best, o, j) => {
        if (j === idx) return best;
        const os = o.start_time ?? o.start ?? 0;
        return os > start + 1e-6 && (!best || os < (best.start_time ?? best.start)) ? o : best;
      }, null);
      const roomEnd = next ? (next.start_time ?? next.start) - gap : Infinity;
      const setEnd = (newEnd) => { work[idx] = { ...e, end_time: newEnd, end: newEnd, duration: round(newEnd - start) }; };
      const rule = String(item.ruleId || '').toUpperCase();
      if (rule === 'NF-DURATION-SHORT' || rule.startsWith('NF-CPS')) {
        const chars = (e.text || '').replace(/<[^>]*>/g, '').replace(/\n/g, '').length;
        const needed = rule === 'NF-DURATION-SHORT' ? minDuration : Math.max(minDuration, chars / Math.max(1, cpsLimit - 0.1));
        const target = round(Math.min(start + needed, start + maxDuration, roomEnd));
        if (target <= end + 0.005) { results.push({ key: item.key, ok: false, message: 'No room to extend before the next subtitle. Shorten the text or merge.' }); continue; }
        setEnd(target);
        const full = target >= start + needed - 0.005;
        results.push({ key: item.key, ok: true, message: `Now ${(target - start).toFixed(2)}s long${full ? '' : ' (as far as the next subtitle allows)'}` });
      } else if (rule === 'NF-GAP-MISSING' || rule === 'NF-GAP-FLASH' || rule === 'NF-OVERLAP' || rule.startsWith('NF-GAP')) {
        const target = round(roomEnd);
        if (!next || target < start + 0.1) { results.push({ key: item.key, ok: false, message: 'Cannot close the gap without making this subtitle too short.' }); continue; }
        setEnd(target);
        results.push({ key: item.key, ok: true, message: 'Ends 2 frames before the next subtitle' });
      } else if (tools.QC_REBREAK_RULES.has(rule)) {
        const t = rebroke.get(item.eventId);
        if (t === undefined || t === e.text) { results.push({ key: item.key, ok: false, message: 'The lines could not be re-balanced. Edit the text or split the subtitle.' }); continue; }
        work[idx] = { ...e, text: t, lines: t.split('\n') };
        results.push({ key: item.key, ok: true, message: 'Lines re-broken to fit' });
      } else if (rule === 'NF-PUNCT-SPACE' || rule === 'NF-ELLIPSIS') {
        const fixed = tools.tidyWhitespace([e]).events[0];
        if (!fixed || fixed.text === e.text) { results.push({ key: item.key, ok: false, message: 'Fix this one by hand in the editor.' }); continue; }
        work[idx] = { ...e, ...fixed, lines: String(fixed.text).split('\n') };
        results.push({ key: item.key, ok: true, message: 'Spacing tidied' });
      } else {
        results.push({ key: item.key, ok: false, message: 'This one needs a manual edit.' });
      }
    }
    if (results.some(r => r.ok)) {
      items.forEach((i, n) => { if (results[n]?.ok) editedEventIdsRef.current.add(i.eventId); });
      setEvents(work);
      pushToHistory(work);
      handleLint(work);
    }
    return results;
  }, [events, frameRate, cplLimit, cpsLimit, minDuration, maxDuration, pushToHistory, handleLint]);

  // Add Manual Subtitle
  const handleAddSubtitle = (atTime = null, customEndTime = null) => {
    const startTime = atTime !== null ? Math.max(0, atTime) : (events.length > 0 ? events[events.length - 1].end_time + 0.1 : 0);
    const endTime = customEndTime !== null ? Math.max(startTime + 0.2, customEndTime) : startTime + prefs.newSubDuration;
    const newId = events.length > 0 ? Math.max(...events.map(e => e.id || 0)) + 1 : 1;

    const newEvent = {
      id: newId,
      start_time: Math.round(startTime * 1000) / 1000,
      end_time: Math.round(endTime * 1000) / 1000,
      start: Math.round(startTime * 1000) / 1000,
      end: Math.round(endTime * 1000) / 1000,
      duration: Math.round((endTime - startTime) * 1000) / 1000,
      text: prefs.newSubText || 'New subtitle',
      lines: [prefs.newSubText || 'New subtitle'],
      speaker_count: 1,
      speakers: ["Speaker 1"],
      is_italic: false,
      qc_errors: [],
      is_valid: true,
      autoFocusText: true
    };

    const updated = [...events, newEvent].sort((a, b) => (a.start_time ?? a.start) - (b.start_time ?? b.start));
    setEvents(updated);
    setActiveEventId(newId);
    pushToHistory(updated);
    handleLint(updated);
  };

  // ── Global Find & Replace across all subtitles ──
  const handleGlobalReplace = useCallback((findText, replaceText, { matchCase = false, wholeWord = false, replaceAll = true, targetId = null } = {}) => {
    if (!findText) return { count: 0 };
    let flags = matchCase ? 'g' : 'gi';
    let pattern = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord) {
      pattern = `\\b${pattern}\\b`;
    }
    let regex;
    try {
      regex = new RegExp(pattern, flags);
    } catch {
      return { count: 0 };
    }
    let totalReplaced = 0;

    setEvents(prev => {
      const next = prev.map(e => {
        if (targetId && e.id !== targetId && e.event_id !== targetId) return e;
        if (!e.text || !regex.test(e.text)) return e;
        regex.lastIndex = 0;
        const newText = replaceAll ? e.text.replaceAll(regex, replaceText) : e.text.replace(regex, replaceText);
        if (newText !== e.text) {
          totalReplaced++;
          editedEventIdsRef.current.add(e.id);
          return { ...e, text: newText, lines: newText.split('\n') };
        }
        return e;
      });
      if (totalReplaced > 0) {
        pushToHistory(next);
        handleLint(next);
      }
      return next;
    });
    return { count: totalReplaced };
  }, [pushToHistory, handleLint]);

  // ── Non-Blocking Progressive Batch-Wise Auto-Generate (Streaming SSE) ──
  const genJobRef = useRef(null);
  // Cancel while generating: stops the request, the server-side work and any upload still in flight
  const cancelGeneration = () => {
    genJobRef.current?.cancel();
    mediaJobRef.current?.cancel();
  };
  const handleGenerate = async () => {
    resetTracks();
    if (!selectedFile) {
      fileInputRef.current?.click();
      return;
    }

    const storedApiKey = (localStorage.getItem('elevenlabs_api_key') || '').trim();
    if (!storedApiKey && !serverHasElevenLabsKey) {
      setApiKeyModalError(null);
      setShowApiKeyModal(true);
      return;
    }

    // What the screen held before, so Cancel can put everything back exactly as it was
    const before = { events, complianceScore, totalErrors, totalWarnings, activeEventId, pendingDraft, feedback: userFeedbackText };
    const draftKey = `karya_subtitle_autosave_${selectedFile.name}`;
    let savedDraft = null;
    try { savedDraft = localStorage.getItem(draftKey); } catch (_) { }

    // Clear old subtitles and draft for a clean fresh AI generation
    setPendingDraft(null);
    try {
      localStorage.removeItem(draftKey);
    } catch (_) { }
    setEvents([]);
    setComplianceScore(100);
    setTotalErrors(0);
    setTotalWarnings(0);
    setActiveEventId(null);
    editedEventIdsRef.current.clear();
    setUserFeedbackText('');

    const genJob = startJob(API_BASE);
    genJobRef.current = genJob;
    const { signal } = genJob;
    setIsGenerating(true);
    setProgressPercent(null);
    setProgressStage('Uploading Video & Extracting Audio');
    setProgressDetail('Demuxing audio stream via FFmpeg...');
    setElapsedSeconds(0);

    const startTimer = Date.now();
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(parseFloat(((Date.now() - startTimer) / 1000).toFixed(1)));
    }, 200);

    try {
      // Preflight server wake-up check (Render free tier cold start handler)
      setProgressPercent(null);
      setProgressStage('Connecting to Server');
      setProgressDetail('Checking backend connection...');
      for (let attempt = 1; attempt <= 8; attempt++) {
        try {
          const ctrl = new AbortController();
          const tId = setTimeout(() => ctrl.abort(), 4000);
          const onStop = () => ctrl.abort();
          signal.addEventListener('abort', onStop, { once: true });
          const ping = await fetch(`${API_BASE}/api/health`, { method: 'GET', signal: ctrl.signal });
          clearTimeout(tId);
          signal.removeEventListener('abort', onStop);
          if (ping.ok) {
            break;
          }
        } catch (_) { }
        genJob.throwIfCancelled();
        if (attempt < 8) {
          setProgressDetail(`Server is waking up (Render boot: ${attempt * 5}s)... please wait`);
          await sleepCancellable(5000, signal);
        }
      }

      let videoId = currentVideoId;
      if (!videoId && uploadPromiseRef.current) {
        setProgressPercent(null);
        setProgressStage('Finalizing Media Transfer');
        setProgressDetail('Waiting for background media upload to finish...');
        try {
          videoId = await uploadPromiseRef.current;
          genJob.throwIfCancelled();
        } catch (e) {
          if (isCancelError(e)) throw e;
          console.warn("Background upload failed, will upload directly:", e);
        }
        if (videoId) {
          setCurrentVideoId(videoId);
        }
      }

      if (!videoId) {
        setProgressPercent(null);
        setProgressStage('Transferring Audio to Server');
        setProgressDetail('Transferring media to server...');
        videoId = await processAndUploadMedia(selectedFile, isAudioFile);
        genJob.throwIfCancelled();
        if (videoId) {
          setCurrentVideoId(videoId);
        } else {
          throw new Error('Could not transfer media to server.');
        }
      }

      setProgressPercent(null);
      setProgressMeta({ step: 1, steps: 1, estimated: false, eta: null });
      setProgressStage('Starting AI Subtitle Stream');
      setProgressDetail('Connecting to the transcription pipeline...');

      console.log(
        '%c[Subtitle Studio]%c Starting Generation Pipeline for Video ID: ' + videoId,
        'background: #2563eb; color: #fff; padding: 3px 8px; border-radius: 4px; font-weight: bold;',
        'color: #2563eb; font-weight: bold;'
      );
      console.table({
        'Video ID': videoId,
        'Selected File': selectedFile?.name || 'N/A',
        'File Size': selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB` : 'N/A',
        'Target Language': language,
        'Target Script': script,
        'Content Type': contentType,
        'CPL Limit': cplLimit,
        'Max CPS': cpsLimit,
        'Max Lines': maxLines,
        'Min Duration': `${minDuration}s`,
        'Max Duration': `${maxDuration}s`,
        'Frame Rate': `${frameRate} fps`,
        'Num Speakers': numSpeakers > 0 ? numSpeakers : 'Auto-detect',
        'Strict Native Script': strictNativeScript ? 'Enabled' : 'Disabled',
        'SDH Mode': sdhMode ? 'Enabled' : 'Disabled',
        'Snap to Shot Changes': snapToShotChanges ? 'Enabled' : 'Disabled'
      });

      let streamRes = await fetch(`${API_BASE}/api/subtitle/generate_stream`, {
        method: 'POST',
        signal,
        headers: jobHeaders(genJob, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          video_id: videoId,
          language,
          script,
          content_type: contentType,
          sdh_mode: sdhMode,
          include_speaker_tags: includeSpeakerTags,
          snap_to_shot_changes: snapToShotChanges,
          cpl_limit: cplLimit,
          max_cps: cpsLimit,
          max_lines: maxLines,
          min_duration: minDuration,
          max_duration: maxDuration,
          frame_rate: frameRate,
          gemini_auto_fix: geminiAutoFix,
          num_speakers: numSpeakers > 0 ? numSpeakers : null,
          strict_native_script: strictNativeScript,
          elevenlabs_api_key: localStorage.getItem('elevenlabs_api_key') || '',
          user_feedback: userFeedbackText.trim() || null,
          context: contextForRequest(genContext),
          project_glossary: glossaryTerms
        })
      });

      // Self-Healing Session Expiration:
      // If server restarted or disk session expired (404), re-upload media and retry stream automatically!
      if (streamRes.status === 404) {
        console.warn(`[Subtitle Studio] Session for ${videoId} expired on server (404). Automatically re-uploading media...`);
        setCurrentVideoId(null);
        setProgressPercent(null);
        setProgressStage('Re-synchronizing Media to Server');
        setProgressDetail('Cloud server session expired or restarted. Re-uploading audio track...');

        videoId = await processAndUploadMedia(selectedFile, isAudioFile);
        genJob.throwIfCancelled();
        if (!videoId) {
          throw new Error('Media re-upload failed after server session expired.');
        }
        setCurrentVideoId(videoId);

        setProgressPercent(null);
        setProgressStage('Starting AI Subtitle Stream');
        setProgressDetail('Connecting to the transcription pipeline with active session...');
        console.log(`[Subtitle Studio] Retrying stream for new Video ID: ${videoId}`);

        streamRes = await fetch(`${API_BASE}/api/subtitle/generate_stream`, {
          method: 'POST',
          signal,
          headers: jobHeaders(genJob, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            video_id: videoId,
            language,
            script,
            content_type: contentType,
            sdh_mode: sdhMode,
            include_speaker_tags: includeSpeakerTags,
            snap_to_shot_changes: snapToShotChanges,
            cpl_limit: cplLimit,
            max_cps: cpsLimit,
            max_lines: maxLines,
            min_duration: minDuration,
            max_duration: maxDuration,
            frame_rate: frameRate,
            gemini_auto_fix: geminiAutoFix,
            num_speakers: numSpeakers > 0 ? numSpeakers : null,
            strict_native_script: strictNativeScript,
            elevenlabs_api_key: localStorage.getItem('elevenlabs_api_key') || '',
            user_feedback: userFeedbackText.trim() || null,
            context: contextForRequest(genContext),
            project_glossary: glossaryTerms
          })
        });
      }

      if (!streamRes.ok) {
        const errDetail = await streamRes.json().catch(() => null);
        throw new Error(errDetail?.detail || `Stream request failed (Status: ${streamRes.status})`);
      }

      const reader = streamRes.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let accumulatedEvents = [];
      let streamCompleted = false;
      let lastBatchIndex = 0;
      let totalExpectedChunks = 1;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          // SSE comments (keepalive pings) start with ':'
          if (trimmed.startsWith(':')) {
            // Live keepalive heartbeat received from server
            continue;
          }
          if (!trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.replace(/^data:\s*/, '');
          try {
            const data = JSON.parse(jsonStr);

            if (data.type === 'init') {
              setShotChanges(data.shot_changes || []);
              if (data.frame_rate) setFrameRate(data.frame_rate);
              console.log(
                '%c[SSE Init]%c Video initialized -> Frame Rate: ' + (data.frame_rate || frameRate) + ' fps | Audio Duration: ' + (data.audio_duration ? data.audio_duration.toFixed(2) + 's' : 'N/A') + ' | Shot Changes: ' + (data.shot_changes?.length || 0),
                'background: #0284c7; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
                'color: #0284c7; font-weight: 500;'
              );
            } else if (data.type === 'progress') {
              setProgressPercent(typeof data.progress === 'number' ? data.progress : null);
              setProgressStage(data.stage || 'Working');
              setProgressDetail(data.detail || '');
              setProgressMeta({ step: data.step || 1, steps: data.steps || 1, estimated: !!data.estimated, eta: data.eta ?? null });
              console.log(
                '%c[SSE Progress ' + (data.progress || 0) + '%]%c ' + data.stage + (data.detail ? ' (' + data.detail + ')' : ''),
                'background: #6366f1; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
                'color: #4f46e5; font-weight: 500;'
              );
            } else if (data.type === 'complete') {
              streamCompleted = true;
              setUserFeedbackText('');
              const res = data.result || {};
              const finalEvents = (data.events || res.events || accumulatedEvents).map(e => ({
                ...e,
                start: e.start_time !== undefined ? e.start_time : (e.start ?? 0),
                end: e.end_time !== undefined ? e.end_time : (e.end ?? 0)
              }));
              setEvents(finalEvents);
              pushToHistory(finalEvents);
              const score = data.compliance_score ?? res.compliance_score ?? 100;
              setComplianceScore(score);
              setTotalErrors(res.total_errors || 0);
              setTotalWarnings(res.total_warnings || 0);
              setCpsStats(res.cps_stats || null);
              setProgressPercent(100);
              setContextRun(data.context_fixes || null);
              if (data.context_fixes && (data.context_fixes.ai_fixes + data.context_fixes.applied_corrections) > 0) {
                setAutoSaveStatus(`${data.context_fixes.ai_fixes + data.context_fixes.applied_corrections} subtitles corrected using your context`);
                setTimeout(() => setAutoSaveStatus(''), 6000);
              }

              const totalSec = ((Date.now() - startTimer) / 1000).toFixed(2);
              console.log(
                '%c[Subtitle Studio]%c Generated ' + finalEvents.length + ' guideline-compliant subtitle cards with ' + score + '% compliance in ' + totalSec + 's!',
                'background: #16a34a; color: white; padding: 3px 8px; border-radius: 4px; font-weight: bold;',
                'color: #16a34a; font-weight: bold;'
              );

              // Detailed diagnostic tables in console
              try {
                console.groupCollapsed(
                  '%c[Subtitle Studio Output Preview]%c ' + finalEvents.length + ' cards | Score: ' + score + '% | Errors: ' + (res.total_errors || 0) + ' | Warnings: ' + (res.total_warnings || 0),
                  'color: #059669; font-weight: bold;',
                  'color: inherit;'
                );
                if (res.cps_stats) {
                  console.log('Reading Speed (CPS) Statistics:');
                  console.table(res.cps_stats);
                }
                if (finalEvents.length > 0) {
                  console.log('First 5 Subtitle Cards:');
                  console.table(finalEvents.slice(0, 5).map(e => ({
                    ID: e.id,
                    Start: `${(e.start_time ?? e.start ?? 0).toFixed(3)}s`,
                    End: `${(e.end_time ?? e.end ?? 0).toFixed(3)}s`,
                    Duration: `${((e.end_time ?? e.end ?? 0) - (e.start_time ?? e.start ?? 0)).toFixed(2)}s`,
                    Speaker: e.primary_speaker || e.speaker || 'Speaker 1',
                    CPS: typeof e.cps === 'number' ? e.cps.toFixed(1) : (e.cps || '-'),
                    CPL: e.cpl || '-',
                    Text: (e.text || '').replace(/\n/g, ' / ')
                  })));
                }
                if (finalEvents.length > 5) {
                  console.log('Last 5 Subtitle Cards:');
                  console.table(finalEvents.slice(-5).map(e => ({
                    ID: e.id,
                    Start: `${(e.start_time ?? e.start ?? 0).toFixed(3)}s`,
                    End: `${(e.end_time ?? e.end ?? 0).toFixed(3)}s`,
                    Duration: `${((e.end_time ?? e.end ?? 0) - (e.start_time ?? e.start ?? 0)).toFixed(2)}s`,
                    Speaker: e.primary_speaker || e.speaker || 'Speaker 1',
                    CPS: typeof e.cps === 'number' ? e.cps.toFixed(1) : (e.cps || '-'),
                    CPL: e.cpl || '-',
                    Text: (e.text || '').replace(/\n/g, ' / ')
                  })));
                }
                console.log('All Subtitle Event Objects:', finalEvents);
                console.groupEnd();
              } catch (_) { }

              if (finalEvents.length === 0) {
                setProgressStage('No Dialogue Detected');
                setProgressDetail(res.error || '0 subtitles found across recording.');
                alert(res.error || `No Subtitles Generated: No audible dialogue was transcribed.\n\nTip: Ensure the audio has audible speech and your speech engine API key / quota is active in Settings.`);
              } else {
                setProgressStage('Complete');
                setProgressDetail(`All ${finalEvents.length} subtitles generated following the subtitle guidelines!`);
              }
            } else if (data.type === 'error' || data.type === 'stream_error') {
              console.error(
                '%c[SSE Error]%c ' + (data.message || data.error),
                'background: #dc2626; color: white; padding: 2px 6px; border-radius: 3px; font-weight: bold;',
                'color: #dc2626; font-weight: bold;'
              );
              const errMsg = data.message || data.error || 'Transcription failed';
              if (
                errMsg.toLowerCase().includes('api key') ||
                errMsg.toLowerCase().includes('401') ||
                errMsg.toLowerCase().includes('unauthorized') ||
                errMsg.toLowerCase().includes('quota')
              ) {
                setApiKeyModalError(errMsg);
                setShowApiKeyModal(true);
                streamCompleted = true;
                return;
              }
              throw new Error(errMsg);
            }
          } catch (e) {
            console.warn("SSE parse error:", e, jsonStr);
          }
        }
      }

      // Check for premature disconnection
      if (!streamCompleted) {
        if (accumulatedEvents.length > 0) {
          const finalEvents = accumulatedEvents.map(e => ({
            ...e,
            start: e.start_time !== undefined ? e.start_time : (e.start ?? 0),
            end: e.end_time !== undefined ? e.end_time : (e.end ?? 0)
          }));
          setEvents(finalEvents);
          pushToHistory(finalEvents);
          setProgressPercent(100);
          setProgressStage('Generation Complete');
          setProgressDetail(`${finalEvents.length} subtitles preserved.`);
        } else {
          throw new Error("Stream connection closed before subtitles could be generated. Please try again.");
        }
      }
    } catch (err) {
      if (genJob.cancelled || isCancelError(err)) {
        // Stopped on purpose: put back everything that was on screen before Generate was pressed
        setEvents(before.events);
        setComplianceScore(before.complianceScore);
        setTotalErrors(before.totalErrors);
        setTotalWarnings(before.totalWarnings);
        setActiveEventId(before.activeEventId);
        setUserFeedbackText(before.feedback);
        setPendingDraft(before.pendingDraft);
        try { if (savedDraft !== null) localStorage.setItem(draftKey, savedDraft); } catch (_) { }
        setAutoSaveStatus(before.events.length ? 'Generation cancelled. Your previous subtitles were kept.' : 'Generation cancelled.');
        setTimeout(() => setAutoSaveStatus(''), 4000);
        return;
      }
      console.error("Generation error:", err);
      if (
        err.message && (
          err.message.toLowerCase().includes('api key') ||
          err.message.toLowerCase().includes('401') ||
          err.message.toLowerCase().includes('unauthorized') ||
          err.message.toLowerCase().includes('quota')
        )
      ) {
        setApiKeyModalError(err.message);
        setShowApiKeyModal(true);
        return;
      }
      const isNetwork = err.message?.includes('Failed to fetch') ||
        err.message?.includes('NetworkError') ||
        err.message?.includes('Network error') ||
        err.message?.includes('Load failed');
      if (isNetwork) {
        alert(
          `Connection Notice: Backend Server is currently unreachable or waking up.\n\n` +
          `Backend URL: ${API_BASE || '(relative / localhost)'}\n\n` +
          `Render Free-Tier Notice: If the server was idle, it spins down and takes 30-50 seconds to boot. Once running, media uploads automatically in resilient sliced chunks. Please wait a moment and click 'Auto-Generate Subtitles' again.`
        );
      } else {
        alert(`Error generating subtitles: ${err.message}`);
      }
    } finally {
      if (genJobRef.current === genJob) genJobRef.current = null;
      setIsGenerating(false);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      setTimeout(() => {
        setProgressPercent(0);
      }, 2500);
    }
  };

  // ── Gemini-Coordinated QC Self-Correction Pass ──
  const handleGeminiFix = async () => {
    if (!events || events.length === 0) return;
    setIsFixingWithGemini(true);
    await runTask('AI QC fix', async (job) => {
    try {
      const res = await fetch(`${API_BASE}/api/subtitle/gemini_fix`, {
        method: 'POST',
        signal: job.signal,
        headers: jobHeaders(job, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          events: events,
          shot_changes: shotChanges,
          frame_rate: frameRate,
          content_type: contentType,
          cpl_limit: cplLimit,
          max_cps: cpsLimit,
          max_lines: maxLines,
          min_duration: minDuration,
          max_duration: maxDuration
        })
      });
      if (res.ok) {
        const data = await res.json();
        setOriginalEvents(events);
        if (data.events) {
          const clean = sanitizeEvents(data.events);
          setEvents(clean);
          pushToHistory(clean);
          handleLint(clean);
          setShowDiffModal(true);
        }
        setComplianceScore(data.compliance_score || 100);
        setTotalErrors(data.total_errors || 0);
        setTotalWarnings(data.total_warnings || 0);
        setCpsStats(data.cps_stats || null);
        setAutoSaveStatus('AI auto-fix applied ✓');
        setTimeout(() => setAutoSaveStatus(''), 3000);
      }
    } catch (err) {
      if (!job.cancelled) console.error("AI fix failed:", err);
    } finally {
      setIsFixingWithGemini(false);
    }
    });
  };

  // ── Closed-Loop Acoustic Audio Synchronization Pass ──
  const handleAcousticSync = async () => {
    if (!events || events.length === 0 || !currentVideoId) return;
    const storedApiKey = (localStorage.getItem('elevenlabs_api_key') || '').trim();
    if (!storedApiKey && !serverHasElevenLabsKey) {
      setApiKeyModalError(null);
      setShowApiKeyModal(true);
      return;
    }

    setIsSyncingAudio(true);
    await runTask('Syncing to audio', async (job) => {
    try {
      const res = await fetch(`${API_BASE}/api/subtitle/acoustic_sync`, {
        method: 'POST',
        signal: job.signal,
        headers: jobHeaders(job, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          video_id: currentVideoId,
          events: events,
          language: language,
          content_type: contentType,
          frame_rate: frameRate,
          cpl_limit: cplLimit,
          max_cps: cpsLimit,
          max_lines: maxLines,
          min_duration: minDuration,
          max_duration: maxDuration,
          shot_changes: shotChanges,
          elevenlabs_api_key: storedApiKey
        })
      });
      if (res.ok) {
        const data = await res.json();
        setOriginalEvents(events);
        if (data.events) {
          const clean = sanitizeEvents(data.events);
          setEvents(clean);
          pushToHistory(clean);
          handleLint(clean);
          setShowDiffModal(true);
        }
        if (data.lint_result) {
          setComplianceScore(data.lint_result.compliance_score || 100);
          setTotalErrors(data.lint_result.total_errors || 0);
          setTotalWarnings(data.lint_result.total_warnings || 0);
          setCpsStats(data.lint_result.cps_stats || null);
        }
        setAutoSaveStatus('Acoustically Synced to Audio ✓');
        setTimeout(() => setAutoSaveStatus(''), 4000);
      } else {
        const err = await res.json().catch(() => ({ detail: "Acoustic audio synchronization failed." }));
        if (err.detail && (err.detail.toLowerCase().includes('api key') || err.detail.toLowerCase().includes('401') || err.detail.toLowerCase().includes('quota'))) {
          setApiKeyModalError(err.detail);
          setShowApiKeyModal(true);
          return;
        }
        alert(err.detail || "Acoustic audio synchronization failed.");
      }
    } catch (err) {
      if (job.cancelled) return;
      console.error("Acoustic sync failed:", err);
      alert("Acoustic sync failed: " + err.message);
    } finally {
      setIsSyncingAudio(false);
    }
    });
  };

  // Auto-Fix All Issues
  const handleAutoFix = async () => {
    await runTask('Auto-fixing issues', async (job) => {
    try {
      const res = await fetch(`${API_BASE}/api/subtitle/autofix`, {
        method: 'POST',
        signal: job.signal,
        headers: jobHeaders(job, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          events: events,
          shot_changes: shotChanges,
          frame_rate: frameRate,
          content_type: contentType,
          custom_cpl: cplLimit,
          custom_cps: cpsLimit,
          custom_max_lines: maxLines,
          custom_min_duration: minDuration,
          custom_max_duration: maxDuration
        })
      });
      if (res.ok) {
        const data = await res.json();
        setOriginalEvents(events);
        setEvents(data.events || []);
        pushToHistory(data.events || []);
        handleLint(data.events || []);
        setShowDiffModal(true);
      }
    } catch (err) {
      if (job.cancelled) return;
      console.error(err);
      alert('Auto-fix failed');
    }
    });
  };

  // Import SRT / VTT File
  const handleImportSrt = (e) => {
    resetTracks();
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result;
        if (!text) return;

        const blocks = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n\n');
        const parsed = [];
        let idCounter = 1;

        for (const block of blocks) {
          const lines = block.trim().split('\n');
          if (lines.length < 2) continue;

          let timeLine = lines[0].includes('-->') ? lines[0] : lines[1];
          let textLines = lines[0].includes('-->') ? lines.slice(1) : lines.slice(2);

          if (!timeLine || !timeLine.includes('-->')) continue;

          const [startStr, endStr] = timeLine.split('-->').map(s => s.trim());
          const parseS = (s) => {
            const clean = s.replace(',', '.');
            const parts = clean.split(':');
            if (parts.length === 3) {
              return parseFloat(parts[0]) * 3600 + parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
            }
            return 0;
          };

          const sTime = parseS(startStr);
          const eTime = parseS(endStr);
          const subText = textLines.join('\n').trim();

          parsed.push({
            id: idCounter++,
            start_time: sTime,
            end_time: eTime,
            start: sTime,
            end: eTime,
            text: subText,
            lines: subText.split('\n'),
            speaker_count: subText.includes('-') ? 2 : 1,
            speakers: ['Speaker 1'],
            is_italic: subText.includes('<i>'),
            qc_errors: [],
            is_valid: true
          });
        }

        if (parsed.length > 0) {
          setEvents(parsed);
          pushToHistory(parsed);
          setActiveEventId(parsed[0].id);
          handleLint(parsed);
          setAutoSaveStatus(`Imported ${parsed.length} subtitles from ${file.name}`);
          setTimeout(() => setAutoSaveStatus(''), 4000);
        }
      } catch (err) {
        console.error(err);
        setAutoSaveStatus('Failed to parse subtitle file.');
        setTimeout(() => setAutoSaveStatus(''), 4000);
      }
    };
    reader.readAsText(file);
  };

  // ── Menu actions ──
  const flashStatus = (msg) => {
    setAutoSaveStatus(msg);
    setTimeout(() => setAutoSaveStatus(''), 3500);
  };
  const hasEvents = events.length > 0;
  const hasActive = activeEventId != null && events.some((e) => e.id === activeEventId || e.event_id === activeEventId);
  const activeIdx = events.findIndex((e) => e.id === activeEventId || e.event_id === activeEventId);

  /** Run a pure bulk edit through the normal undo history + QC. */
  const applyEdit = (fn, doneMsg, noneMsg = 'Nothing to change.') => {
    const { events: next, changed } = fn(events);
    if (!changed) { flashStatus(noneMsg); return; }
    next.forEach((ev) => editedEventIdsRef.current.add(ev.id));
    setEvents(next);
    pushToHistory(next);
    handleLint(next);
    flashStatus(typeof doneMsg === 'function' ? doneMsg(changed) : doneMsg);
  };
  const scopeIds = hasActive ? new Set([activeEventId]) : null; // selected subtitle, otherwise everything
  const scopeWord = hasActive ? 'selected subtitle' : 'all subtitles';
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  const goToIndex = (i) => {
    const ev = events[i];
    if (!ev) return;
    setActiveEventId(ev.id);
    handlePlayEvent(ev.id);
  };
  const goToTime = (t) => {
    publishPlayhead(t);
    setPlayTarget({ time: t, pause: true });
  };
  const jumpToPrevIssue = () => {
    const issues = events.filter((e) => (e.qc_errors || e.errors || []).length > 0);
    if (!issues.length) return;
    const cur = issues.findIndex((e) => e.id === activeEventId);
    const prev = issues[(cur <= 0 ? issues.length : cur) - 1];
    if (prev) { setActiveEventId(prev.id); handlePlayEvent(prev.id); }
  };
  const findNext = (find, opts) => {
    const re = tools.makeMatcher(find, opts);
    if (!re || !events.length) return;
    const start = activeIdx + 1;
    for (let n = 0; n < events.length; n += 1) {
      const ev = events[(start + n) % events.length];
      if (re.test(ev.text || '')) {
        setActiveEventId(ev.id);
        goToTime(ev.start_time ?? ev.start ?? 0);
        return;
      }
    }
  };
  const sendKey = (key) => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const confirmGenerate = () => {
    if (hasEvents && prefs.confirmGenerate && !window.confirm('Generate new subtitles? This replaces the current subtitles (you can undo) and uses transcription credits.')) return;
    handleGenerate();
  };
  const exportSubs = () => { if (hasEvents) setShowExportModal(true); else flashStatus('Nothing to export yet. Generate or import subtitles first.'); };
  const saveDraftCmd = () => { flashStatus(saveDraftNow() ? 'Draft saved on this device.' : 'Nothing to save yet.'); };
  const toggleLayoutKey = (key, on, off) => patchLayout({ [key]: layout[key] === off ? on : off });

  shortcutRef.current = {
    openLayout: () => openSettings('layout'),
    palette: () => setShowPalette(true),
    settings: () => openSettings(),
    find: () => { if (hasEvents) setDialog('find'); },
    goTo: () => { if (hasEvents) setDialog('goto'); },
    save: saveDraftCmd,
    exportSubs,
    preset: applyBuiltinByIndex,
  };

  const menus = [
    {
      id: 'file',
      label: 'File',
      items: [
        { label: 'Open media…', icon: FolderOpen, onSelect: () => fileInputRef.current?.click() },
        { label: 'Import subtitles (SRT / VTT)…', icon: FileText, onSelect: () => srtImportRef.current?.click() },
        { type: 'separator' },
        { label: 'Export subtitles…', icon: Download, shortcut: 'Ctrl+E', disabled: !hasEvents, onSelect: exportSubs },
        { label: 'Save draft now', icon: Save, shortcut: 'Ctrl+S', disabled: !hasEvents, onSelect: saveDraftCmd },
        { type: 'separator' },
        { label: 'Settings…', icon: Settings, shortcut: 'Ctrl+,', onSelect: () => openSettings() },
        { type: 'separator' },
        { label: 'Discard draft', icon: Trash2, danger: true, onSelect: () => handleDiscardPreviousWork() },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { label: 'Undo', icon: Undo2, shortcut: 'Ctrl+Z', disabled: historyIndex <= 0, onSelect: handleUndo },
        { label: 'Redo', icon: Redo2, shortcut: 'Ctrl+Y', disabled: historyIndex >= history.length - 1, onSelect: handleRedo },
        { type: 'separator' },
        { label: 'Search subtitle list', icon: Search, shortcut: 'Ctrl+F', disabled: !hasEvents, onSelect: () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true })) },
        { label: 'Find and replace…', icon: Replace, shortcut: 'Ctrl+H', disabled: !hasEvents, onSelect: () => setDialog('find') },
        { label: 'Go to subtitle or time…', icon: ListOrdered, shortcut: 'Ctrl+G', disabled: !hasEvents, onSelect: () => setDialog('goto') },
        { type: 'separator' },
        { label: 'Move selected and following to playhead', icon: Clock, shortcut: 'Ctrl+Space', disabled: !hasActive, onSelect: () => handleShiftAllFollowing(activeEventId, getPlayhead()) },
        { label: 'Clear text formatting', icon: Eraser, disabled: !hasEvents, onSelect: handleClearFormat },
      ],
    },
    {
      id: 'subtitle',
      label: 'Subtitle',
      items: [
        { label: 'Add at playhead', icon: Plus, onSelect: () => handleAddSubtitle(getPlayhead()) },
        { label: 'Split at playhead', icon: Split, disabled: !hasEvents, onSelect: () => handleSplitAtCursor(getPlayhead()) },
        { label: 'Merge selected with next', icon: Merge, disabled: !hasActive || activeIdx >= events.length - 1, onSelect: () => handleMergeEvents(activeEventId) },
        { label: 'Extend selected to next subtitle', icon: ArrowRightLeft, disabled: !hasActive || activeIdx >= events.length - 1, onSelect: () => applyEdit((evs) => tools.extendToNext(evs, activeEventId, frameRate), 'Extended to the next subtitle.', 'Already touching the next subtitle.') },
        { label: 'Delete selected', icon: Trash2, danger: true, shortcut: 'Del', disabled: !hasActive, onSelect: () => handleDeleteEvent(activeEventId) },
        { type: 'separator' },
        { type: 'heading', label: 'Navigate' },
        { label: 'Previous subtitle', icon: SkipBack, disabled: !hasEvents || activeIdx <= 0, onSelect: () => goToIndex(activeIdx - 1) },
        { label: 'Next subtitle', icon: SkipForward, disabled: !hasEvents || activeIdx >= events.length - 1, onSelect: () => goToIndex(activeIdx + 1) },
        { type: 'separator' },
        { type: 'heading', label: 'Timing' },
        { label: 'Shift timings…', icon: ArrowRightLeft, disabled: !hasEvents, onSelect: () => setDialog('shift') },
        { label: 'Snap in/out points to frames', icon: AlignJustify, disabled: !hasEvents, onSelect: () => applyEdit((evs) => tools.snapToFrames(evs, frameRate), (n) => `Snapped ${plural(n, 'subtitle')} to the frame grid.`, 'Everything is already on the frame grid.') },
        { label: 'Enforce 2-frame gaps', icon: AlignJustify, disabled: !hasEvents, onSelect: () => applyEdit((evs) => tools.enforceMinGap(evs, frameRate, 2), (n) => `Opened the gap on ${plural(n, 'subtitle')}.`, 'All gaps already meet the 2-frame minimum.') },
        { label: 'Sort by start time', icon: SkipForward, disabled: !hasEvents, onSelect: () => applyEdit(tools.sortByStart, 'Sorted by start time.', 'Already in order.') },
        { type: 'separator' },
        { type: 'heading', label: `Change case (${scopeWord})` },
        { label: 'UPPERCASE', icon: CaseSensitive, disabled: !hasEvents, onSelect: () => applyEdit((evs) => tools.changeCase(evs, 'upper', scopeIds), (n) => `Updated ${plural(n, 'subtitle')}.`) },
        { label: 'lowercase', icon: CaseSensitive, disabled: !hasEvents, onSelect: () => applyEdit((evs) => tools.changeCase(evs, 'lower', scopeIds), (n) => `Updated ${plural(n, 'subtitle')}.`) },
        { label: 'Sentence case', icon: CaseSensitive, disabled: !hasEvents, onSelect: () => applyEdit((evs) => tools.changeCase(evs, 'sentence', scopeIds), (n) => `Updated ${plural(n, 'subtitle')}.`) },
        { label: 'Title Case', icon: CaseSensitive, disabled: !hasEvents, onSelect: () => applyEdit((evs) => tools.changeCase(evs, 'title', scopeIds), (n) => `Updated ${plural(n, 'subtitle')}.`) },
        { type: 'separator' },
        { type: 'heading', label: 'Clean up' },
        { label: 'Tidy spaces and blank lines', icon: Eraser, disabled: !hasEvents, onSelect: () => applyEdit((evs) => tools.tidyWhitespace(evs, scopeIds), (n) => `Tidied ${plural(n, 'subtitle')}.`, 'Spacing is already clean.') },
        { label: 'Remove empty subtitles', icon: Trash2, disabled: !hasEvents, onSelect: () => applyEdit(tools.removeEmpty, (n) => `Removed ${plural(n, 'empty subtitle')}.`, 'No empty subtitles.') },
        { label: 'Merge repeated neighbours', icon: Merge, disabled: !hasEvents, onSelect: () => applyEdit((evs) => tools.mergeDuplicates(evs), (n) => `Merged ${plural(n, 'repeat')}.`, 'No repeated neighbours.') },
        { label: 'Strip formatting tags', icon: Eraser, disabled: !hasEvents, onSelect: () => applyEdit((evs) => tools.stripTags(evs, scopeIds), (n) => `Stripped tags from ${plural(n, 'subtitle')}.`, 'No formatting tags found.') },
        { type: 'separator' },
        { label: 'Auto-fix QC issues (rules)', icon: Sparkles, disabled: !hasEvents, onSelect: handleAutoFix },
      ],
    },
    {
      id: 'tools',
      label: 'Tools',
      items: [
        { label: 'Generate subtitles…', icon: Sparkles, disabled: isGenerating || !(selectedFile || currentVideoId), onSelect: confirmGenerate },
        { label: 'Re-sync timings to speech…', icon: Volume2, disabled: !hasEvents || !currentVideoId, onSelect: handleAcousticSync },
        { label: 'Fix QC issues with AI…', icon: Wand2, disabled: !hasEvents, onSelect: handleGeminiFix },
        { label: 'Re-break all line breaks', icon: AlignJustify, disabled: !hasEvents, onSelect: handleRebreakAll },
        { label: 'Context…', icon: BookText, onSelect: openContext },
        { label: 'Translate subtitles…', icon: Languages, onSelect: () => openCentroid() },
        { type: 'separator' },
        { label: 'Speakers…', icon: Users, disabled: !hasEvents, onSelect: () => setShowSpeakerModal(true) },
        { label: 'Glossary…', icon: BookText, onSelect: () => openSettings('glossary') },
        { label: 'Quality check (QC)…', icon: ShieldCheck, onSelect: () => openQc() },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: [
        { type: 'heading', label: 'Panes' },
        { label: 'Video monitor', checked: layout.videoPos !== 'hidden', onSelect: () => toggleLayoutKey('videoPos', 'left', 'hidden') },
        { label: 'Timeline', checked: layout.timelinePos !== 'hidden', onSelect: () => toggleLayoutKey('timelinePos', 'bottom', 'hidden') },
        { label: 'Tool rail', checked: layout.sidebar !== 'hidden', onSelect: () => toggleLayoutKey('sidebar', 'left', 'hidden') },
        { label: 'Status bar', checked: layout.showFooter, onSelect: () => patchLayout({ showFooter: !layout.showFooter }) },
        { label: 'QC panel', checked: showQcDrawer, onSelect: () => setShowQcDrawer((v) => !v) },
        { type: 'separator' },
        { type: 'heading', label: 'Focus' },
        { label: 'Focus on video', checked: layout.maximize === 'video', onSelect: () => patchLayout({ maximize: layout.maximize === 'video' ? 'none' : 'video' }) },
        { label: 'Focus on subtitle list', checked: layout.maximize === 'list', onSelect: () => patchLayout({ maximize: layout.maximize === 'list' ? 'none' : 'list' }) },
        { label: 'Focus on timeline', checked: layout.maximize === 'timeline', onSelect: () => patchLayout({ maximize: layout.maximize === 'timeline' ? 'none' : 'timeline' }) },
        { type: 'separator' },
        { type: 'heading', label: 'Layout preset' },
        ...BUILTIN_PRESETS.slice(0, 9).map((p, i) => ({ label: p.name, shortcut: `Alt+${i + 1}`, checked: studioLayout.activeId === p.id, onSelect: () => studioLayout.applyPreset(p.id) })),
        { label: 'More layouts and customisation…', icon: LayoutDashboard, shortcut: 'Ctrl+Shift+L', onSelect: () => openSettings('layout') },
        { type: 'separator' },
        { label: 'Previous QC issue', icon: SkipBack, disabled: !hasEvents, onSelect: jumpToPrevIssue },
        { label: 'Next QC issue', icon: SkipForward, shortcut: 'F8', disabled: !hasEvents, onSelect: jumpToNextIssue },
        { type: 'separator' },
        { label: 'Appearance…', icon: Palette, onSelect: () => openSettings('appearance') },
        { label: 'Full screen', icon: Maximize, onSelect: toggleFullscreen },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { label: 'Command palette…', icon: Command, shortcut: 'Ctrl+K', onSelect: () => setShowPalette(true) },
        { label: 'Keyboard shortcuts', icon: Keyboard, onSelect: () => openSettings('shortcuts') },
        { type: 'separator' },
        { label: 'Reset layout to Classic', icon: RotateCcw, onSelect: () => studioLayout.reset() },
        { label: 'Back up or reset settings…', icon: Settings, onSelect: () => openSettings('data') },
      ],
    },
  ];

  // Command palette = every menu command + every settings page + playback
  const paletteCommands = [
    ...menus.flatMap((m) => m.items
      .filter((i) => i.onSelect)
      .map((i) => ({ id: `${m.id}:${i.label}`, label: i.label.replace(/…$/, ''), group: m.label, icon: i.icon, shortcut: i.shortcut, disabled: i.disabled, onSelect: i.onSelect }))),
    ...SETTINGS_GROUPS.flatMap((g) => g.pages.map((pg) => ({ id: `settings:${pg.id}`, label: `Settings: ${pg.label}`, group: 'Settings', icon: pg.icon, keywords: pg.desc, onSelect: () => openSettings(pg.id) }))),
    { id: 'play:toggle', label: 'Play / pause', group: 'Playback', icon: Play, shortcut: 'Space', onSelect: () => sendKey(' ') },
    { id: 'play:back', label: 'Seek back', group: 'Playback', icon: StepBack, shortcut: '←', onSelect: () => sendKey('ArrowLeft') },
    { id: 'play:fwd', label: 'Seek forward', group: 'Playback', icon: StepForward, shortcut: '→', onSelect: () => sendKey('ArrowRight') },
    { id: 'play:frame-', label: 'Previous frame', group: 'Playback', icon: StepBack, shortcut: ',', onSelect: () => sendKey(',') },
    { id: 'play:frame+', label: 'Next frame', group: 'Playback', icon: StepForward, shortcut: '.', onSelect: () => sendKey('.') },
  ];

  return (
    <div className={`subtitle-studio h-screen w-screen overflow-hidden flex flex-col select-none animate-studio-entrance bg-[var(--ss-bg)] text-[var(--ss-text)]`}>
      {/* Hidden File Upload Inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="video/mp4,video/mkv,video/quicktime,video/webm,video/avi,audio/mp3,audio/wav,audio/m4a,audio/aac,audio/flac,audio/ogg,audio/mpeg,audio/opus,audio/x-ms-wma,audio/wma,.mp4,.mkv,.mov,.webm,.avi,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.wma"
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none', overflow: 'hidden' }}
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        type="file"
        ref={audioTrackInputRef}
        onChange={handleAudioTrackChange}
        accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.wma"
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none', overflow: 'hidden' }}
        tabIndex={-1}
        aria-hidden="true"
      />
      <input
        type="file"
        ref={srtImportRef}
        onChange={handleImportSrt}
        accept=".srt,.vtt,.txt"
        style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none', overflow: 'hidden' }}
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* ── Professional Broadcast Master Header Bar (Reference Exact) ── */}
      {!layout.showHeader && (
        <Button
          size="sm"
          icon={Settings}
          onClick={() => openSettings('layout')}
          className="fixed top-2 right-2 z-40 shadow-lg"
          title="Settings (Ctrl+,)"
        >
          Settings
        </Button>
      )}
      {layout.showHeader && (
      <header className="shrink-0 z-40 h-12 px-3 flex items-center gap-2 border-b border-[var(--ss-line)] bg-[var(--ss-bg)] select-none">
        {/* Left: back, brand, menus */}
        <div className="flex items-center gap-1.5 min-w-0">
          <IconButton icon={ArrowLeft} label="Back to hub" onClick={onBackToHome} />
          <div className="flex items-center gap-2 pl-1 pr-2">
            <BrandLogo size={24} />
            <span className="text-[13px] font-semibold tracking-tight text-[var(--ss-text)] whitespace-nowrap hidden sm:inline">Lower Third <span className="font-medium text-[var(--ss-muted,var(--kt-muted))]">Subtitle</span></span>
            <span className="h-[18px] px-1.5 rounded-full hidden md:inline-flex items-center text-[10px] font-bold text-[var(--ss-accent)] border border-[var(--ss-accent)]/40 bg-[var(--ss-accent)]/10">PRO</span>
          </div>
          <span className="h-5 w-px bg-[var(--ss-line)] mx-0.5" aria-hidden="true" />
          {layout.menuStyle === 'compact' ? (
            <StudioMenuBar menus={menus} compact />
          ) : (
            <>
              <div className="hidden lg:block"><StudioMenuBar menus={menus} /></div>
              <div className="lg:hidden"><StudioMenuBar menus={menus} compact /></div>
            </>
          )}
        </div>

        {/* Centre: media file */}
        <div className="flex-1 min-w-0 flex justify-center px-2">
          {layout.showMediaPill && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="h-8 max-w-[420px] min-w-0 px-2.5 rounded-lg inline-flex items-center gap-2 border border-[var(--ss-line)] bg-[var(--ss-raised)] hover:bg-[var(--ss-hover)] hover:border-[var(--ss-muted)] transition-colors cursor-pointer"
              title={selectedFile ? `${selectedFile.name} (click to change)` : 'Open a video or audio file'}
            >
              <span className={`h-[18px] px-1.5 rounded inline-flex items-center text-[10px] font-bold shrink-0 border ${isAudioFile ? 'text-[var(--ss-accent)] border-[var(--ss-accent)]/40 bg-[var(--ss-accent)]/10' : 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'}`}>
                {isAudioFile ? 'AUDIO' : 'VIDEO'}
              </span>
              <span className="text-[12.5px] text-[var(--ss-text)] truncate">{selectedFile ? selectedFile.name : 'Open a video or audio file…'}</span>
              <ChevronDown size={13} className="text-[var(--ss-faint)] shrink-0" />
            </button>
          )}
        </div>

        {/* Right: status, history, search, export, settings, account */}
        <div className="flex items-center gap-1.5 shrink-0">
          {layout.showSaveStatus && (autoSaveStatus || hasEvents) && (
            <div className="hidden xl:flex items-center gap-1.5 mr-1 text-[11.5px] text-[var(--ss-muted)] max-w-[260px]" title="A copy of your work is kept in this browser. Use Export to save files." role="status">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${hasUnsavedDraftChanges && !autoSaveStatus ? 'bg-[var(--ss-warn)]' : 'bg-emerald-400'}`} />
              <span className="truncate">
                {autoSaveStatus || (hasUnsavedDraftChanges
                  ? (lastDraftSavedAt ? `Draft saved ${lastDraftSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · newer edits pending` : 'Not saved to a draft yet')
                  : `Draft saved ${lastDraftSavedAt ? lastDraftSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`)}
              </span>
            </div>
          )}
          <IconButton icon={Undo2} label="Undo (Ctrl+Z)" onClick={handleUndo} disabled={historyIndex <= 0} />
          <IconButton icon={Redo2} label="Redo (Ctrl+Y)" onClick={handleRedo} disabled={historyIndex >= history.length - 1} />
          <span className="h-5 w-px bg-[var(--ss-line)] mx-0.5" aria-hidden="true" />
          <div className="hidden md:block">
            <Button onClick={() => setShowPalette(true)} icon={Search} title="Search every command (Ctrl+K)">
              <span className="hidden xl:inline">Commands</span>
              <span className="hidden xl:inline-flex"><Kbd>Ctrl K</Kbd></span>
            </Button>
          </div>
          <Button variant="primary" icon={Download} onClick={exportSubs} disabled={!hasEvents} title="Export subtitles (Ctrl+E)">
            <span className="hidden sm:inline">Export</span>
          </Button>
          <IconButton icon={Settings} label="Settings (Ctrl+,)" onClick={() => openSettings()} active={showSettingsModal} variant="secondary" />
          <NotificationBellDropdown />
          {user ? <AccountMenuDropdown user={user} onOpenLogoutModal={onOpenLogoutModal || onLogout} /> : null}
        </div>
      </header>
      )}

      {/* Generation progress: one slim strip. Percent, stage and ETA come from the server's real stage events. */}
      {isGenerating && (
        <GenerateProgress
          progress={{ percent: progressPercent, stage: progressStage, detail: progressDetail, ...progressMeta }}
          elapsed={elapsedSeconds}
          onCancel={cancelGeneration}
        />
      )}

      {/* Backend Connection Warning Banner */}
      {backendConnected === false && (
        <div className="px-4 py-2 flex items-center justify-between border-b border-amber-800 bg-amber-950/80 text-amber-200 text-xs shrink-0 z-10 transition-all">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Backend Disconnected:</strong> Could not reach backend at <code className="bg-black/30 px-1 py-0.5 rounded-none font-mono text-[11px]">{API_BASE || '(relative / localhost)'}</code>. If this is a live deployed website, configure your live Backend API URL.
            </span>
          </div>
          <button
            onClick={() => openSettings('connection')}
            className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-black rounded-none text-xs font-bold shrink-0 transition-colors cursor-pointer"
          >
            Configure API URL
          </button>
        </div>
      )}

      {/* Real-time media preparation progress (measured bytes, FFmpeg media time, server stages) */}
      {audioExtractionStatus && <MediaProgress status={audioExtractionStatus} fileName={selectedFile?.name} onCancel={() => mediaJobRef.current?.cancel()} />}

      {/* QC fixes, sync, auto-fix and similar tasks: each one can be stopped */}
      <TaskStrip tasks={tasks} notice={taskNotice} onCancel={cancelTask} />

      {/* Draft Restore Notification Banner */}
      {pendingDraft && (
        <div className={`px-4 py-2 flex items-center justify-between border-b text-xs shrink-0 z-10 transition-all border-[var(--ss-line)] bg-[var(--ss-raised)] text-slate-200`}>
          <div className="flex items-center gap-2">
            <Sparkles className={`w-4 h-4 shrink-0 text-[var(--ss-accent)]`} />
            <span>
              Found an earlier saved draft for <strong>{selectedFile?.name}</strong> with {pendingDraft.events?.length || 0} subtitles ({pendingDraft.timestamp ? new Date(pendingDraft.timestamp).toLocaleTimeString() : 'autosaved'}).
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const restored = readDraft(pendingDraft);
                const restoredEvents = restored.events;
                setTracks(restored.tracks);
                setActiveTrack(restored.activeTrack);
                setSourceTrack(restored.sourceTrack);
                setEvents(restoredEvents);
                setComplianceScore(pendingDraft.complianceScore || 100);
                setTotalErrors(pendingDraft.totalErrors || 0);
                setTotalWarnings(pendingDraft.totalWarnings || 0);
                setActiveEventId(restoredEvents[0]?.id || null);
                setPendingDraft(null);
              }}
              className={`px-3 py-1 rounded-none font-bold cursor-pointer transition-colors shadow-xs bg-[var(--ss-accent)] hover:bg-[var(--ss-accent-hover)] text-black`}
            >
              Restore Draft
            </button>
            <button
              onClick={() => handleDiscardPreviousWork()}
              className={`px-3 py-1 rounded-none cursor-pointer transition-colors bg-[var(--ss-hover)] hover:bg-rose-950/40 hover:text-rose-300 text-slate-300`}
              title="Discard this saved draft. Your video and audio stay loaded."
            >
              Discard draft
            </button>
          </div>
        </div>
      )}

      {/* ── Workstation: tool rail + (panes, optional docked QC report) ── */}
      <div
        className="flex-1 min-h-0 flex overflow-hidden bg-[var(--ss-bg)] select-none"
        style={{ flexDirection: layout.sidebar === 'top' || layout.sidebar === 'bottom' ? 'column' : 'row' }}
      >
        {layout.sidebar !== 'hidden' && (
        <Sidebar
          qcOpen={showQcDrawer}
          isGenerating={isGenerating}
          canGenerate={Boolean(selectedFile || currentVideoId)}
          onTabChange={(tabId) => {
            if (tabId === 'generate') {
              confirmGenerate();
            }
            if (tabId === 'context') { if (showContextPanel) setShowContextPanel(false); else openContext(); }
            if (tabId === 'qc') { if (showQcDrawer) setShowQcDrawer(false); else openQc(); }
            if (tabId === 'translate') { if (showCentroidModal) setShowCentroidModal(false); else openCentroid(); }
          }}
          translateOpen={showCentroidModal}
          contextOpen={showContextPanel}
          contextActive={Object.keys(contextForRequest(genContext)).some((k) => !['strict', 'writing_style'].includes(k))}
          centroidQcCount={centroidState.qcIssues}
          position={layout.sidebar}
          showLabels={layout.sidebarLabels}
        />
        )}

        <div
          className="flex-1 min-w-0 min-h-0 flex overflow-hidden"
          style={{ flexDirection: layout.qcDock === 'bottom' ? 'column' : 'row', order: 1 }}
        >
          <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden" style={{ order: 1 }} aria-label="Subtitle workspace">
            <StudioStage
              layout={layout}
              patch={patchLayout}
              video={
                <div className="h-full flex flex-col overflow-hidden bg-[var(--ss-bg)]">
              <VideoPlayer
                videoUrl={videoUrl}
                audioUrl={extractedAudioUrl}
                onOpenFilePicker={() => fileInputRef.current?.click()}
                onFileSelect={(file) => {
                  const syntheticEvent = { target: { files: [file] } };
                  handleFileChange(syntheticEvent);
                }}
                events={events}
                activeEventId={activeEventId}
                setActiveEventId={setActiveEventId}
                playTarget={playTarget}
                frameRate={frameRate}
                theme={theme}
                isAudio={isAudioFile}
                subtitleStyle={subtitleStyle}
                onUpdateSubtitleStyle={updateSubtitleStyle}
                seekStep={prefs.seekStep}
              />
                </div>
              }
              list={
                <div className="h-full overflow-hidden flex flex-col bg-[var(--ss-panel)]">
              <LanguageTracks tracks={tracks} active={activeTrack} source={sourceTrack} onSwitch={switchTrack} />
              <SubtitleTablePanel
                events={events}
                activeEventId={activeEventId}
                setActiveEventId={setActiveEventId}
                onSeek={(t) => {
                  publishPlayhead(t);
                  setPlayTarget({ time: t, pause: true });
                }}
                onPlayEvent={handlePlayEvent}
                onDeleteEvent={handleDeleteEvent}
                onBulkDelete={handleBulkDelete}
                onUpdateEvent={handleUpdateEvent}
                onTimeChange={handleEventTimeChange}
                onSplitEvent={handleSplitEvent}
                onMergeWithNext={handleMergeEvents}
                onRebreakEvent={handleRebreakEvent}
                onAddSubtitle={(t) => handleAddSubtitle(t)}
                onExport={() => setShowExportModal(true)}
                availableSpeakers={availableSpeakers}
                frameRate={frameRate}
                cplLimit={cplLimit}
                cpsLimit={cpsLimit}
                minDuration={minDuration}
                maxDuration={maxDuration}
                sourceEvents={activeTrack && sourceTrack && activeTrack !== sourceTrack ? tracks[sourceTrack] || null : null}
                sourceLang={sourceTrack}
                targetLang={activeTrack}
              />
                </div>
              }
              timeline={
                <div className="h-full w-full overflow-hidden bg-[var(--ss-bg)]">
            <AudioWaveformTimeline
              videoUrl={videoUrl}
              audioUrl={extractedAudioUrl}
              selectedFile={selectedFile}
              videoId={currentVideoId || null}
              initialPeaks={initialWaveformPeaks}
              API_BASE={API_BASE}
              isAudio={isAudioFile}
              events={events}
              shotChanges={shotChanges}
              duration={videoDuration}
              activeEventId={activeEventId}
              setActiveEventId={setActiveEventId}
              onEventTimeChange={handleEventTimeChange}
              onSeek={(t) => {
                publishPlayhead(t);
                setPlayTarget({ time: t, pause: true });
              }}
              onAddSubtitleAtTime={handleAddSubtitle}
              onShiftAllFollowing={handleShiftAllFollowing}
              onContinueFromTime={null}
              onUndo={historyIndex > 0 ? handleUndo : null}
              onRedo={historyIndex < history.length - 1 ? handleRedo : null}
              onDeleteEvent={handleDeleteEvent}
              onSplitAtTime={handleSplitAtCursor}
              onMergeWithNext={handleMergeEvents}
              onPlayEvent={handlePlayEvent}
              frameRate={frameRate}
              cpsLimit={cpsLimit}
              cplLimit={cplLimit}
              theme={theme}
            />
                </div>
              }
            />
          </main>

          {/* Netflix QC report: floating overlay, or docked beside / below the panes */}
          {showQcDrawer && (
            <div
              className={layout.qcDock === 'overlay'
                ? 'qc-panel fixed inset-y-0 right-0 z-50 w-[92vw] md:w-[460px] shadow-2xl border-l p-4 flex flex-col animate-in slide-in-from-right duration-200 border-[var(--kt-s4)] bg-[var(--ss-panel)] text-slate-200'
                : 'qc-panel shrink-0 min-h-0 min-w-0 flex flex-col p-4 border-[var(--kt-s4)] bg-[var(--ss-panel)] text-slate-200 overflow-hidden ' + (layout.qcDock === 'bottom' ? 'border-t' : layout.qcDock === 'left' ? 'border-r' : 'border-l')}
              style={layout.qcDock === 'overlay' ? undefined : (layout.qcDock === 'bottom' ? { height: layout.qcSize, order: 2 } : { width: layout.qcSize, order: layout.qcDock === 'left' ? 0 : 2 })}
            >
            <div className="shrink-0 flex items-center gap-2 pb-3">
              <div className="flex-1 min-w-0">
                <Segmented
                  label="QC panel"
                  value={qcView}
                  onChange={setQcView}
                  options={[
                    { value: 'guideline', label: 'Guideline QC', icon: ShieldCheck },
                    { value: 'centroid', label: centroidState.qcIssues != null ? `Centroid QC · ${centroidState.qcIssues}` : 'Centroid QC', icon: BadgeCheck },
                  ]}
                />
              </div>
              <button
                type="button"
                onClick={() => setShowQcDrawer(false)}
                className="p-1 rounded-none hover:bg-[var(--ss-hover)] text-slate-400 hover:text-white transition-colors cursor-pointer"
                title="Close QC"
                aria-label="Close QC"
              >
                <X size={16} />
              </button>
            </div>
            {qcView === 'centroid' && <div ref={setQcHost} className="flex-1 min-h-0 flex flex-col" />}
            {qcView === 'guideline' && (
            <NetflixQCPanel
              qcUnavailable={qcUnavailable}
              complianceScore={complianceScore}
              totalErrors={totalErrors}
              totalWarnings={totalWarnings}
              totalEvents={events.length}
              cpsStats={cpsStats}
              events={events}
              contentType={contentType}
              cplLimit={cplLimit}
              cpsLimit={cpsLimit}
              onAutoFix={handleAutoFix}
              onRebreakAll={handleRebreakAll}
              onApplyFixes={applyQcFixes}
              onGeminiFix={handleGeminiFix}
              isFixingWithGemini={isFixingWithGemini}
              onAcousticSync={handleAcousticSync}
              isSyncingAudio={isSyncingAudio}
              onExport={() => setShowExportModal(true)}
              onJumpToEvent={(id) => {
                setActiveEventId(id);
                handlePlayEvent(id);
                if (layout.qcDock === 'overlay') setShowQcDrawer(false);
              }}
            />
            )}
            </div>
          )}
        </div>
      </div>

      {dialog === 'shift' && (
        <ShiftTimingsDialog
          events={events}
          activeEventId={activeEventId}
          frameRate={frameRate}
          onClose={() => setDialog(null)}
          onApply={(delta, fromId) => applyEdit((evs) => tools.shiftTimes(evs, delta, { fromId }), (n) => `Shifted ${plural(n, 'subtitle')} by ${delta > 0 ? '+' : ''}${delta.toFixed(3)} s.`)}
        />
      )}
      {dialog === 'goto' && (
        <GoToDialog
          eventCount={events.length}
          frameRate={frameRate}
          duration={videoDuration}
          onClose={() => setDialog(null)}
          onGoToIndex={goToIndex}
          onGoToTime={goToTime}
        />
      )}
      {dialog === 'find' && (
        <FindReplaceDialog
          events={events}
          onClose={() => setDialog(null)}
          onFindNext={findNext}
          onReplaceAll={(find, rep, opts) => {
            const { events: next, changed } = tools.replaceInEvents(events, find, rep, opts);
            if (changed) {
              next.forEach((ev) => editedEventIdsRef.current.add(ev.id));
              setEvents(next);
              pushToHistory(next);
              handleLint(next);
            }
            return { count: changed };
          }}
        />
      )}
      {showPalette && <CommandPalette commands={paletteCommands} onClose={() => setShowPalette(false)} />}

      {/* ── Broadcast Studio Status Bar / Footer (44px SMPTE Timecode & QC Telemetry) ── */}
      {layout.showFooter && (
      <footer className={`h-6 px-3 border-t flex items-center justify-between text-[11px] font-mono shrink-0 select-none z-20 ${
        'bg-[var(--ss-bg)] border-[var(--kt-s3)] text-slate-400'
      }`}>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 font-semibold">
            <span className="text-slate-300">
              {activeEventId != null && events.length > 0
                ? `Subtitle ${(events.findIndex(e => (e.id === activeEventId || e.event_id === activeEventId)) + 1) || '–'} of ${events.length}`
                : 'No subtitle selected'}
            </span>
          </span>
          <span className="opacity-40">|</span>
          <span className="flex items-center gap-1">
            <span className="text-slate-400">TC</span>
            <span className="font-semibold text-[var(--ss-accent)]">
              <PlayheadTimecode format={prefs.tcFormat} frameRate={frameRate} />
            </span>
            <span className="opacity-40">/</span>
            <span>{formatTimecode(videoDuration, prefs.tcFormat, frameRate)}</span>
          </span>
          <span className="opacity-40">|</span>
          <span>{Number(frameRate).toFixed(2)} FPS</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Netflix Compliance Health */}
          <div 
            onClick={() => setShowQcDrawer(true)} 
            className="flex items-center gap-1.5 cursor-pointer hover:underline"
            title="Click to open the QC panel"
          >
            <div className={`w-2 h-2 rounded-none ${
              totalErrors > 0 ? 'bg-rose-500 animate-pulse' : totalWarnings > 0 ? 'bg-amber-400' : 'bg-emerald-400'
            }`} />
            <span className="font-semibold">
              {qcUnavailable ? 'Guideline QC: unavailable (backend offline)' : `Guideline QC: ${complianceScore.toFixed(0)}%`}
            </span>
            {!qcUnavailable && totalErrors > 0 && <span className="text-rose-400 font-bold">({totalErrors} Err)</span>}
          </div>

          <span className="opacity-40">|</span>

          {/* Quick Shortcuts Hint */}
          {layout.showHints && <div className="hidden md:flex items-center gap-2 opacity-70 text-[10px]">
            <span>Space: Play</span>
            <span>·</span>
            <span>,: -1f</span>
            <span>·</span>
            <span>.: +1f</span>
            <span>·</span>
            <span>L: Loop</span>
            <span>·</span>
            <span>Ctrl+F: Search</span>
            <span>·</span>
            <span>F8: Next issue</span>
          </div>}
        </div>
      </footer>
      )}

      {/* ── Speaker Rename Modal (shared with Transcription) ── */}
      <SpeakerCustomizerModal
        isOpen={showSpeakerModal}
        onClose={() => setShowSpeakerModal(false)}
        segments={events}
        getSpeaker={(ev) => ev.speaker || (ev.speakers && ev.speakers[0]) || ''}
        setSpeaker={(ev, name) => ({
          ...ev,
          speaker: name,
          speaker_id: name.toLowerCase().replace(/\s+/g, '_'),
          ...(Array.isArray(ev.speakers) ? { speakers: [name] } : {})
        })}
        onUpdateSegments={(updated) => {
          setEvents(updated);
          pushToHistory(updated);
        }}
      />

      {/* ── Subtitle & QC Settings Modal ── */}
      <SubtitleSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        page={settingsPage}
        onPageChange={setSettingsPage}
        studioLayout={studioLayout}
        prefs={prefs}
        setPref={setPref}
        resetPrefs={resetPrefs}
        onSaveDraft={saveDraftCmd}
        hasEvents={hasEvents}
        isDark={true}
        cplLimit={cplLimit}
        setCplLimit={setCplLimit}
        cpsLimit={cpsLimit}
        setCpsLimit={setCpsLimit}
        maxLines={maxLines}
        setMaxLines={setMaxLines}
        minDuration={minDuration}
        setMinDuration={setMinDuration}
        maxDuration={maxDuration}
        setMaxDuration={setMaxDuration}
        frameRate={frameRate}
        setFrameRate={setFrameRate}
        language={language}
        setLanguage={handleLanguageChange}
        script={script}
        setScript={setScript}
        contentType={contentType}
        setContentType={setContentType}
        sdhMode={sdhMode}
        setSdhMode={setSdhMode}
        includeSpeakerTags={includeSpeakerTags}
        setIncludeSpeakerTags={setIncludeSpeakerTags}
        snapToShotChanges={snapToShotChanges}
        setSnapToShotChanges={setSnapToShotChanges}
        numSpeakers={numSpeakers}
        setNumSpeakers={(val) => {
          setNumSpeakers(val);
          try { localStorage.setItem('karya_num_speakers', String(val)); } catch (_) {}
        }}
        strictNativeScript={strictNativeScript}
        setStrictNativeScript={(val) => {
          setStrictNativeScript(val);
          try { localStorage.setItem('karya_strict_native_script', String(val)); } catch (_) {}
        }}
        geminiAutoFix={geminiAutoFix}
        setGeminiAutoFix={setGeminiAutoFix}
        glossaryTerms={glossaryTerms}
        setGlossaryTerms={handleUpdateGlossary}
        onApply={() => {
          if (events && events.length > 0) {
            handleLint(events);
          }
        }}
      />

      {/* ── ElevenLabs API Key Modal ── */}
      <ElevenLabsApiKeyModal
        isOpen={showApiKeyModal}
        onClose={() => {
          setShowApiKeyModal(false);
          setApiKeyModalError(null);
        }}
        errorMessage={apiKeyModalError}
        initialKey={localStorage.getItem('elevenlabs_api_key') || ''}
        onSave={() => {
          setApiKeyModalError(null);
          if (selectedFile && !isGenerating) {
            setTimeout(() => {
              handleGenerate();
            }, 100);
          }
        }}
      />

      {/* ── Centroid Translate & QC (kept mounted so results survive closing the panel) ── */}
      <CentroidModal
        isOpen={showCentroidModal}
        onClose={() => setShowCentroidModal(false)}
        defaultSourceLang={language}
        qcHost={showQcDrawer && qcView === 'centroid' ? qcHost : null}
        onOpenQc={() => openQc('centroid')}
        onOpenTranslate={() => { setShowQcDrawer(false); openCentroid(); }}
        onStateChange={setCentroidState}
        onJumpToEvent={(id) => { setActiveEventId(id); handlePlayEvent(id); }}
        events={events}
        glossaryTerms={glossaryTerms}
        cplLimit={cplLimit}
        cpsLimit={cpsLimit}
        maxLines={maxLines}
        fileName={selectedFile?.name || 'subtitles'}
        onApplyTextFixes={applyTextFixes}
        activeLang={activeTrack}
        trackLangs={Object.keys(tracks)}
        onTranslated={handleTranslated}
        onShowTrack={showTranslatedTrack}
      />

      {/* ── Context for the transcript (kept mounted so nothing is lost when it is closed) ── */}
      <ContextPanel
        isOpen={showContextPanel}
        onClose={() => setShowContextPanel(false)}
        ctx={genContext}
        onChange={updateGenContext}
        events={events}
        fileName={selectedFile?.name}
        language={language}
        cplLimit={cplLimit}
        maxLines={maxLines}
        glossaryTerms={glossaryTerms}
        onApplyFixes={handleApplyContextFixes}
        lastRun={contextRun}
        onJumpToEvent={(id) => { setActiveEventId(id); handlePlayEvent(id); }}
      />

      {/* ── Export Deliverables Modal ── */}
      {showExportModal && (
        <SubtitleExportModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          events={events}
          complianceScore={complianceScore}
          filename={(activeTrack && sourceTrack && activeTrack !== sourceTrack)
            ? (selectedFile?.name || 'subtitles').replace(/(\.[^.]+)?$/, `.${activeTrack}$1`)
            : (selectedFile?.name || 'subtitles')}
          API_BASE={API_BASE}
        />
      )}

      {/* ── Auto-Fix Diff Comparison Modal ── */}
      {showDiffModal && (
        <SubtitleDiffModal
          isOpen={showDiffModal}
          originalEvents={originalEvents}
          fixedEvents={events}
          onAcceptAll={() => { diffDecisionRef.current = 'accepted'; }}
          onAcceptSelective={(ids) => {
            diffDecisionRef.current = 'accepted';
            const chosen = new Set(ids);
            const merged = originalEvents.map((orig, i) => {
              const fixed = events[i];
              return fixed && chosen.has(fixed.id ?? fixed.event_id ?? i + 1) ? fixed : orig;
            });
            setEvents(merged);
            pushToHistory(merged);
            handleLint(merged);
          }}
          onClose={() => {
            // Closing without accepting (Cancel, X, Esc) restores the subtitles from before the auto-fix
            if (diffDecisionRef.current !== 'accepted') {
              setEvents(originalEvents);
              pushToHistory(originalEvents);
              handleLint(originalEvents);
            }
            diffDecisionRef.current = null;
            setShowDiffModal(false);
          }}
        />
      )}


      {/* ── Custom Studio-Themed Reload Confirmation Modal ── */}
      <ReloadConfirmModal
        isOpen={showReloadConfirmModal}
        onClose={() => setShowReloadConfirmModal(false)}
        onConfirm={() => {
          setShowReloadConfirmModal(false);
          window.location.reload();
        }}
        title="Reload Subtitle Studio?"
        description="Are you sure you want to reload? Any active AI subtitle streaming, acoustic audio syncing, or unsaved draft changes will be interrupted."
      />
    </div>
  );
}
