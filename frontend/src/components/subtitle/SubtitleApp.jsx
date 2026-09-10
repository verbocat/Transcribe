import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft, Upload, CheckCircle2, AlertCircle, Sparkles, RefreshCw,
  FileDown, Sliders, ShieldCheck, Film, Undo2, Redo2,
  SlidersHorizontal, Search, Split, Merge, Scissors, Trash2, Plus,
  ChevronDown, X, Play, Clock, Activity, FileText, Check, Settings,
  Menu, Download, Eye, AlertTriangle, Layers, Type, Sun, Moon, Loader2, Globe, Volume2,
  MessageSquare, ChevronRight
} from 'lucide-react';
import { API_BASE } from '../../config';
import VideoPlayer from './VideoPlayer';
import AudioWaveformTimeline from './AudioWaveformTimeline';
import SubtitleGridView from './SubtitleGridView';
import NetflixQCPanel from './NetflixQCPanel';
import SubtitleExportModal from './SubtitleExportModal';
import SubtitleDiffModal from './SubtitleDiffModal';
import SubtitleSettingsModal from './SubtitleSettingsModal';
import CustomTimeResumeModal from './CustomTimeResumeModal';
import { extractAudioFromMedia, computeWaveformPeaks } from '../../utils/audioExtractor';

function formatTime(seconds) {
  if (isNaN(seconds) || seconds == null) return "00:00.000";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 1000);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
}

// Sliced multi-part chunked upload for files > 90MB (bypasses Cloudflare 100MB proxy limits)
async function uploadFileInChunks(file, apiBase, onProgress) {
  const chunkSize = 12 * 1024 * 1024; // 12 MB slices (safe for any proxy/cloud gateway)
  const totalChunks = Math.ceil(file.size / chunkSize);
  const uploadId = 'up_' + Math.random().toString(36).substring(2, 10);

  let lastData = null;
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const end = Math.min(file.size, start + chunkSize);
    const chunkBlob = file.slice(start, end);

    const formData = new FormData();
    formData.append('chunk', chunkBlob, file.name);
    formData.append('upload_id', uploadId);
    formData.append('chunk_index', i.toString());
    formData.append('total_chunks', totalChunks.toString());
    formData.append('filename', file.name);

    if (onProgress) {
      const pct = Math.round(((i + 1) / totalChunks) * 100);
      onProgress({ percent: pct, detail: `Uploading slice ${i + 1}/${totalChunks}...` });
    }

    let success = false;
    let lastErr = null;
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const res = await fetch(`${apiBase}/api/subtitle/upload_chunk`, {
          method: 'POST',
          body: formData
        });

        if (res.ok) {
          lastData = await res.json();
          success = true;
          break;
        } else {
          const err = await res.json().catch(() => null);
          lastErr = new Error(err?.detail || `Slice ${i + 1}/${totalChunks} failed with status ${res.status}`);
          if (res.status >= 500 || res.status === 429) {
            await new Promise(r => setTimeout(r, attempt * 1500));
            continue;
          } else {
            throw lastErr;
          }
        }
      } catch (fetchErr) {
        lastErr = fetchErr;
        if (attempt < 4) {
          if (onProgress) {
            onProgress({
              percent: Math.round(((i) / totalChunks) * 100),
              detail: `Server connecting (attempt ${attempt}/4)... Retrying slice ${i + 1}/${totalChunks}...`
            });
          }
          await new Promise(r => setTimeout(r, attempt * 2500));
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
        if (frameTimes.length >= 8) {
          cleanup();
          const deltas = [];
          for (let i = 1; i < frameTimes.length; i++) {
            const d = frameTimes[i] - frameTimes[i - 1];
            if (d > 0.005 && d < 0.2) deltas.push(d);
          }
          if (deltas.length >= 4) {
            const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
            const rawFps = 1.0 / avgDelta;
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

export default function SubtitleApp({ onBackToHome }) {
  // ── Theme State: Unified Dark Creative Suite ──
  const [theme] = useState('dark');
  const isDark = true;

  // Video & File state
  const [selectedFile, setSelectedFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [videoDuration, setVideoDuration] = useState(0);
  const [currentVideoId, setCurrentVideoId] = useState(null);
  const [initialWaveformPeaks, setInitialWaveformPeaks] = useState([]);
  const [audioExtractionStatus, setAudioExtractionStatus] = useState(null); // { stage, percent, detail }
  const extractedAudioFileRef = useRef(null); // Cache client-extracted audio file to avoid re-extracting

  const isAudioFile = useMemo(() => {
    if (!selectedFile) return false;
    return Boolean(
      selectedFile.type?.startsWith('audio/') ||
      /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma)$/i.test(selectedFile.name || '')
    );
  }, [selectedFile]);

  // Robust Client-Side Audio Extractor & Adaptive Upload Coordinator
  const processAndUploadMedia = useCallback(async (fileToProcess, isAudio) => {
    let uploadTarget = fileToProcess;

    // 1. If video file, extract lightweight mono audio track in browser first (or reuse cached)
    if (!isAudio) {
      if (extractedAudioFileRef.current) {
        uploadTarget = extractedAudioFileRef.current;
      } else {
        try {
          setAudioExtractionStatus({ stage: 'extracting', percent: 20, detail: 'Extracting audio in browser...' });
          const extracted = await extractAudioFromMedia(fileToProcess, (p) => {
            setAudioExtractionStatus({ stage: 'extracting', ...p });
          });
          if (extracted.peaks && extracted.peaks.length > 0) {
            setInitialWaveformPeaks(extracted.peaks);
          }
          uploadTarget = extracted.audioFile;
          extractedAudioFileRef.current = extracted.audioFile;
        } catch (extErr) {
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
        const buf = await fileToProcess.arrayBuffer();
        const decoded = await audioCtx.decodeAudioData(buf);
        audioCtx.close().catch(() => { });
        const channel = decoded.getChannelData(0);
        const peaks = computeWaveformPeaks(channel, decoded.duration, 50);
        if (peaks.length > 0) {
          setInitialWaveformPeaks(peaks);
        }
      } catch (_) { }
    }

    // 2. Upload to backend (chunked if > 20MB or if direct upload fails)
    try {
      if (uploadTarget.size > 20 * 1024 * 1024) {
        setAudioExtractionStatus({ stage: 'uploading', percent: 10, detail: 'Uploading via chunked slices...' });
        const chunkData = await uploadFileInChunks(uploadTarget, API_BASE, (p) => {
          setAudioExtractionStatus({ stage: 'uploading', ...p });
        });
        if (chunkData?.video_id) {
          setCurrentVideoId(chunkData.video_id);
          if (chunkData.peaks && chunkData.peaks.length > 0) {
            setInitialWaveformPeaks(chunkData.peaks);
          }
          return chunkData.video_id;
        }
      } else {
        setAudioExtractionStatus({ stage: 'uploading', percent: 50, detail: 'Transferring audio to server...' });
        let uploadSucceeded = false;
        try {
          const formData = new FormData();
          formData.append('file', uploadTarget);
          const res = await fetch(`${API_BASE}/api/subtitle/upload`, {
            method: 'POST',
            body: formData
          });
          if (res.ok) {
            const data = await res.json();
            if (data.video_id) {
              setCurrentVideoId(data.video_id);
              if (data.peaks && data.peaks.length > 0) {
                setInitialWaveformPeaks(data.peaks);
              }
              uploadSucceeded = true;
              return data.video_id;
            }
          }
        } catch (directErr) {
          console.warn("Direct upload failed, falling back to sliced chunk upload:", directErr);
        }

        // Automatic fallback to chunked upload if direct POST encounters payload/network limitations
        if (!uploadSucceeded) {
          console.log("[Subtitle Studio] Fallback: uploading media in resilient sliced chunks...");
          const chunkData = await uploadFileInChunks(uploadTarget, API_BASE, (p) => {
            setAudioExtractionStatus({ stage: 'uploading', ...p });
          });
          if (chunkData?.video_id) {
            setCurrentVideoId(chunkData.video_id);
            if (chunkData.peaks && chunkData.peaks.length > 0) {
              setInitialWaveformPeaks(chunkData.peaks);
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
  }, []);

  // Subtitle Dataset State
  const [events, setEvents] = useState([]);
  const [originalEvents, setOriginalEvents] = useState([]);
  const [activeEventId, setActiveEventId] = useState(null);
  const editedEventIdsRef = useRef(new Set()); // Protected manual user edits across progressive batches
  const [qcNotification, setQcNotification] = useState(null); // { message, chunkIndex, totalChunks, timestamp }
  const [batchPauseData, setBatchPauseData] = useState(null); // { chunkIndex, totalChunks, nextChunk, prevBatchEnd, prevEventsCount, prevContext, message }
  const [userFeedbackText, setUserFeedbackText] = useState('');

  // Video playback sync state
  const [currentTime, setCurrentTime] = useState(0);
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

  // Resume / Continue Generation State
  const [resumeChunk, setResumeChunk] = useState(null); // Next batch index to resume (e.g. 34)
  const [totalChunks, setTotalChunks] = useState(null); // Total batches (e.g. 113)
  const [canResume, setCanResume] = useState(false);

  // Generation & Streaming Progress State
  const [isGenerating, setIsGenerating] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressStage, setProgressStage] = useState('');
  const [progressDetail, setProgressDetail] = useState('');
  const [batchProgress, setBatchProgress] = useState(null); // { current: 1, total: 4 }
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedTimerRef = useRef(null);

  // History for Undo/Redo
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Modals & Panels UI
  const [showExportModal, setShowExportModal] = useState(false);
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [showQcDrawer, setShowQcDrawer] = useState(false);
  const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);
  const [showFileDropdown, setShowFileDropdown] = useState(false);
  const [showCustomTimeModal, setShowCustomTimeModal] = useState(false);
  const [customStartTime, setCustomStartTime] = useState(0);
  const [autoSaveStatus, setAutoSaveStatus] = useState('');
  const [pendingDraft, setPendingDraft] = useState(null); // Previous autosaved draft detection
  const [backendConnected, setBackendConnected] = useState(null); // null = checking, true = online, false = offline

  useEffect(() => {
    let isMounted = true;
    const checkConnection = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/health`, { method: 'GET' });
        if (isMounted) setBackendConnected(res.ok);
      } catch {
        if (isMounted) setBackendConnected(false);
      }
    };
    checkConnection();
    return () => { isMounted = false; };
  }, []);

  // Resizable Layout Dimensions (Default: Left 480px, Bottom 210px)
  const [leftPanelWidth, setLeftPanelWidth] = useState(480);
  const [bottomTimelineHeight, setBottomTimelineHeight] = useState(210);

  const isResizingLeftRef = useRef(false);
  const isResizingBottomRef = useRef(false);

  // File Inputs
  const fileInputRef = useRef(null);
  const srtImportRef = useRef(null);
  const headerMenuRef = useRef(null);
  const uploadPromiseRef = useRef(null);

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

  const [showSettingsModal, setShowSettingsModal] = useState(false);
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

  // Sanitize helper to purge any cached/legacy NF-PYRAMID errors
  const sanitizeEvents = useCallback((evs) => {
    if (!evs || !Array.isArray(evs)) return [];
    return evs.map(e => ({
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
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target)) {
        setShowFileDropdown(false);
        setShowSettingsDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // ── 1-Minute Interval Auto-Save to Database / localStorage ──
  useEffect(() => {
    if (!events || events.length === 0) return;
    const interval = setInterval(() => {
      try {
        const fileId = selectedFile?.name || 'draft_subtitle';
        localStorage.setItem(`karya_subtitle_autosave_${fileId}`, JSON.stringify({
          events,
          complianceScore,
          totalErrors,
          totalWarnings,
          resumeChunk,
          totalChunks,
          settings: { language, contentType, cplLimit, cpsLimit, frameRate, sdhMode },
          timestamp: new Date().toISOString()
        }));
        setAutoSaveStatus('Draft Saved (1m sync) ✓');
        setTimeout(() => setAutoSaveStatus(''), 2500);
      } catch (e) {
        console.warn('Auto-save storage quota exceeded', e);
      }
    }, 60000); // Once every 1 minute
    return () => clearInterval(interval);
  }, [events, complianceScore, totalErrors, totalWarnings, selectedFile, language, contentType, cplLimit, cpsLimit, frameRate, sdhMode, resumeChunk, totalChunks]);

  // ── Mouse Drag Splitter Handlers for Resizable Panes ──
  const handleLeftSplitterDown = (e) => {
    e.preventDefault();
    isResizingLeftRef.current = true;
    document.body.style.cursor = 'col-resize';
  };

  const handleBottomSplitterDown = (e) => {
    e.preventDefault();
    isResizingBottomRef.current = true;
    document.body.style.cursor = 'row-resize';
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizingLeftRef.current) {
        const newWidth = Math.max(260, Math.min(750, e.clientX - 12));
        setLeftPanelWidth(newWidth);
      } else if (isResizingBottomRef.current) {
        const windowHeight = window.innerHeight;
        const newHeight = Math.max(140, Math.min(420, windowHeight - e.clientY - 12));
        setBottomTimelineHeight(newHeight);
      }
    };

    const handleMouseUp = () => {
      if (isResizingLeftRef.current || isResizingBottomRef.current) {
        isResizingLeftRef.current = false;
        isResizingBottomRef.current = false;
        document.body.style.cursor = 'default';
      }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
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
      if (res.ok) {
        const data = await res.json();
        setComplianceScore(data.compliance_score || 100);
        setTotalErrors(data.total_errors || 0);
        setTotalWarnings(data.total_warnings || 0);
        setCpsStats(data.cps_stats || null);
        if (data.events) {
          const sanitized = sanitizeEvents(data.events);
          const errMap = new Map(sanitized.map(e => [e.id ?? e.event_id, (e.qc_errors || e.errors || [])]));
          setEvents(prev => prev.map(e => {
            const curId = e.id ?? e.event_id;
            const newErrors = errMap.get(curId);
            return newErrors ? { ...e, qc_errors: newErrors, errors: newErrors } : e;
          }));
        }
      }
    } catch (err) {
      console.error(err);
    }
  }, [shotChanges, frameRate, contentType, cplLimit, cpsLimit, maxLines, minDuration, maxDuration, sanitizeEvents]);

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
    const timeToSplit = splitTime !== undefined ? splitTime : currentTime;
    setEvents(prev => {
      let targetIdx = prev.findIndex(e => {
        const st = e.start_time ?? e.start ?? 0;
        const en = e.end_time ?? e.end ?? 0;
        return timeToSplit >= st && timeToSplit <= en;
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

      const newEv1 = { ...ev, end_time: timeToSplit, end: timeToSplit, text: text1 };
      const newEv2 = { ...ev, id: Math.max(...prev.map(p => p.id || 0)) + 1, start_time: timeToSplit + 0.08, start: timeToSplit + 0.08, text: text2 };

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
    const pivotTime = targetTime !== undefined ? targetTime : currentTime;
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
        handleShiftAllFollowing(activeEventId, currentTime);
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
  }, [history, historyIndex, events, activeEventId, currentTime]);

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

  // Media File (Video or Audio) Upload Handler
  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
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
      setCanResume(false);
      setResumeChunk(null);
      setTotalChunks(null);

      // Check if previous autosaved draft exists
      const saved = localStorage.getItem(`karya_subtitle_autosave_${file.name}`);
      if (saved) {
        try {
          const data = JSON.parse(saved);
          if (data.events && data.events.length > 0) {
            setPendingDraft(data);
            if (data.resumeChunk && data.totalChunks && data.resumeChunk <= data.totalChunks) {
              setResumeChunk(data.resumeChunk);
              setTotalChunks(data.totalChunks);
              setCanResume(true);
            }
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

  // Single Subtitle Event Update (Instant 0ms latency typing)
  const handleUpdateEvent = useCallback((id, field, value) => {
    editedEventIdsRef.current.add(id);
    setEvents(prev => {
      const next = prev.map(e => ((e.id === id || e.event_id === id) ? { ...e, [field]: value } : e));
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
        setCurrentTime(st);
        setPlayTarget({ time: st, endTime: en, pause: false });
      }
      return currentEvents;
    });
  }, []);

  // Split Event
  const handleSplitEvent = useCallback((id) => {
    editedEventIdsRef.current.add(id);
    setEvents(prev => {
      const ev = prev.find(e => (e.id === id || e.event_id === id));
      if (!ev) return prev;
      const st = ev.start_time ?? ev.start ?? 0;
      const en = ev.end_time ?? ev.end ?? 0;
      const midTime = Math.round(((st + en) / 2) * 1000) / 1000;
      handleSplitAtCursor(midTime);
      return prev;
    });
  }, [handleSplitAtCursor]);

  // Merge Event with Next
  const handleMergeEvents = useCallback((id) => {
    editedEventIdsRef.current.add(id);
    setEvents(prev => {
      const idx = prev.findIndex(e => (e.id === id || e.event_id === id));
      if (idx === -1 || idx >= prev.length - 1) return prev;

      const cur = prev[idx];
      const next = prev[idx + 1];

      const mergedText = `${cur.text || ''}\n${next.text || ''}`.trim();
      const mergedEvent = {
        ...cur,
        end_time: next.end_time ?? next.end,
        end: next.end_time ?? next.end,
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

  // Add Manual Subtitle
  const handleAddSubtitle = (atTime = null) => {
    const startTime = atTime !== null ? Math.max(0, atTime) : (events.length > 0 ? events[events.length - 1].end_time + 0.1 : 0);
    const endTime = startTime + 2.4;
    const newId = events.length > 0 ? Math.max(...events.map(e => e.id || 0)) + 1 : 1;

    const newEvent = {
      id: newId,
      start_time: Math.round(startTime * 1000) / 1000,
      end_time: Math.round(endTime * 1000) / 1000,
      start: Math.round(startTime * 1000) / 1000,
      end: Math.round(endTime * 1000) / 1000,
      text: "New dialogue subtitle line",
      lines: ["New dialogue subtitle line"],
      speaker_count: 1,
      speakers: ["Speaker 1"],
      is_italic: false,
      qc_errors: [],
      is_valid: true
    };

    const updated = [...events, newEvent].sort((a, b) => a.start_time - b.start_time);
    setEvents(updated);
    setActiveEventId(newId);
    pushToHistory(updated);
    handleLint(updated);
  };

  // ── Non-Blocking Progressive Batch-Wise Auto-Generate (Streaming SSE) ──
  const handleGenerate = async () => {
    if (!selectedFile) {
      fileInputRef.current?.click();
      return;
    }

    // Clear old subtitles and draft for a clean fresh AI generation
    setPendingDraft(null);
    try {
      localStorage.removeItem(`karya_subtitle_autosave_${selectedFile.name}`);
    } catch (_) { }
    setEvents([]);
    setComplianceScore(100);
    setTotalErrors(0);
    setTotalWarnings(0);
    setActiveEventId(null);
    editedEventIdsRef.current.clear();
    setQcNotification(null);
    setResumeChunk(null);
    setTotalChunks(null);
    setCanResume(false);
    setBatchPauseData(null);
    setUserFeedbackText('');

    setIsGenerating(true);
    setProgressPercent(5);
    setProgressStage('Uploading Video & Extracting Audio');
    setProgressDetail('Demuxing audio stream via FFmpeg...');
    setBatchProgress(null);
    setElapsedSeconds(0);

    const startTimer = Date.now();
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(parseFloat(((Date.now() - startTimer) / 1000).toFixed(1)));
    }, 200);

    try {
      // Preflight server wake-up check (Render free tier cold start handler)
      setProgressPercent(6);
      setProgressStage('Connecting to Server');
      setProgressDetail('Checking backend connection...');
      for (let attempt = 1; attempt <= 8; attempt++) {
        try {
          const ctrl = new AbortController();
          const tId = setTimeout(() => ctrl.abort(), 4000);
          const ping = await fetch(`${API_BASE}/api/health`, { method: 'GET', signal: ctrl.signal });
          clearTimeout(tId);
          if (ping.ok) {
            break;
          }
        } catch (_) { }
        if (attempt < 8) {
          setProgressDetail(`Server is waking up (Render boot: ${attempt * 5}s)... please wait`);
          await new Promise(r => setTimeout(r, 5000));
        }
      }

      let videoId = currentVideoId;
      if (!videoId && uploadPromiseRef.current) {
        setProgressPercent(10);
        setProgressStage('Finalizing Media Transfer');
        setProgressDetail('Waiting for background media upload to finish...');
        try {
          videoId = await uploadPromiseRef.current;
        } catch (e) {
          console.warn("Background upload failed, will upload directly:", e);
        }
        if (videoId) {
          setCurrentVideoId(videoId);
        }
      }

      if (!videoId) {
        setProgressPercent(12);
        setProgressStage('Transferring Audio to Server');
        setProgressDetail('Transferring media to server...');
        videoId = await processAndUploadMedia(selectedFile, isAudioFile);
        if (videoId) {
          setCurrentVideoId(videoId);
        } else {
          throw new Error('Could not transfer media to server.');
        }
      }

      setProgressPercent(20);
      setProgressStage('Starting AI Subtitle Stream');
      setProgressDetail('Connecting to Gemini AI pipeline...');

      console.log(`[Subtitle Studio] Starting batch stream for Video ID: ${videoId}`);
      let streamRes = await fetch(`${API_BASE}/api/subtitle/generate_stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoId,
          language,
          script,
          content_type: contentType,
          sdh_mode: sdhMode,
          cpl_limit: cplLimit,
          max_cps: cpsLimit,
          max_lines: maxLines,
          min_duration: minDuration,
          max_duration: maxDuration,
          frame_rate: frameRate,
          gemini_auto_fix: geminiAutoFix,
          batch_mode: 'all',
          user_feedback: userFeedbackText.trim() || null
        })
      });

      // Self-Healing Session Expiration:
      // If server restarted or disk session expired (404), re-upload media and retry stream automatically!
      if (streamRes.status === 404) {
        console.warn(`[Subtitle Studio] Session for ${videoId} expired on server (404). Automatically re-uploading media...`);
        setCurrentVideoId(null);
        setProgressPercent(14);
        setProgressStage('Re-synchronizing Media to Server');
        setProgressDetail('Cloud server session expired or restarted. Re-uploading audio track...');

        videoId = await processAndUploadMedia(selectedFile, isAudioFile);
        if (!videoId) {
          throw new Error('Media re-upload failed after server session expired.');
        }
        setCurrentVideoId(videoId);

        setProgressPercent(22);
        setProgressStage('Starting AI Subtitle Stream');
        setProgressDetail('Connecting to Gemini AI pipeline with active session...');
        console.log(`[Subtitle Studio] Retrying batch stream for new Video ID: ${videoId}`);

        streamRes = await fetch(`${API_BASE}/api/subtitle/generate_stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video_id: videoId,
            language,
            script,
            content_type: contentType,
            sdh_mode: sdhMode,
            cpl_limit: cplLimit,
            max_cps: cpsLimit,
            max_lines: maxLines,
            min_duration: minDuration,
            max_duration: maxDuration,
            frame_rate: frameRate,
            gemini_auto_fix: geminiAutoFix,
            batch_mode: 'all',
            user_feedback: userFeedbackText.trim() || null
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
              setFrameRate(data.frame_rate || 24.0);
              setProgressPercent(30);
              setProgressStage('Analyzing Audio & Dialogue Splits');
              totalExpectedChunks = data.total_chunks || 1;
              setTotalChunks(totalExpectedChunks);
              setProgressDetail(`Splitting recording into ${data.total_chunks} audio batches...`);
              setBatchProgress({ current: 0, total: data.total_chunks });
            } else if (data.type === 'heartbeat') {
              // Live heartbeat update from server worker
              if (data.stage) {
                setProgressDetail(data.stage);
              }
            } else if (data.type === 'progress') {
              const pct = 30 + Math.floor((data.chunk_index / data.total_chunks) * 55);
              setProgressPercent(pct);
              setProgressStage(`Generating Batch ${data.chunk_index} of ${data.total_chunks}`);
              setProgressDetail(data.stage || `Transcribing dialogue & applying Netflix rules for Batch ${data.chunk_index}...`);
              setBatchProgress({ current: data.chunk_index, total: data.total_chunks });
            } else if (data.type === 'batch') {
              lastBatchIndex = data.chunk_index || lastBatchIndex;
              if (lastBatchIndex < totalExpectedChunks) {
                setResumeChunk(lastBatchIndex + 1);
                setTotalChunks(totalExpectedChunks);
              }
              if (data.fallback) {
                setProgressDetail(`Batch ${data.chunk_index}: Transcribed via local Whisper fallback ✓`);
              }
              // Append / Merge Batch Events Progressively in Real-Time!
              const newBatchEvents = data.events || [];
              accumulatedEvents = [...accumulatedEvents, ...newBatchEvents];
              setEvents(prev => {
                const prevMap = new Map(prev.map(e => [e.id, e]));
                const merged = [...prev];
                for (const newEv of newBatchEvents) {
                  if (!prevMap.has(newEv.id)) {
                    merged.push(newEv);
                  } else if (!editedEventIdsRef.current.has(newEv.id)) {
                    // Update only if user hasn't manually edited this event
                    const idx = merged.findIndex(e => e.id === newEv.id);
                    if (idx !== -1) merged[idx] = newEv;
                  }
                }
                return merged;
              });
              if (!activeEventId && accumulatedEvents.length > 0) {
                setActiveEventId(accumulatedEvents[0].id);
              }
              console.log(`[Subtitle Studio] Ingested Batch ${data.chunk_index}/${data.total_chunks} (${newBatchEvents.length} events). User edits strictly protected!`);
            } else if (data.type === 'batch_ready') {
              setQcNotification({
                message: data.message || `Part ${data.chunk_index} is complete! You can do manual QC on it now.`,
                chunkIndex: data.chunk_index,
                totalChunks: data.total_chunks,
                timestamp: Date.now()
              });
            } else if (data.type === 'batch_pause') {
              streamCompleted = true;
              setBatchPauseData({
                chunkIndex: data.chunk_index,
                totalChunks: data.total_chunks,
                nextChunk: data.next_chunk,
                prevBatchEnd: data.prev_batch_end,
                prevEventsCount: data.prev_events_count,
                prevContext: data.prev_context,
                message: data.message
              });
              setResumeChunk(data.next_chunk);
              setTotalChunks(data.total_chunks);
              setCanResume(true);
              const pct = Math.floor((data.chunk_index / data.total_chunks) * 100);
              setProgressPercent(pct);
              setProgressStage(`Batch ${data.chunk_index} of ${data.total_chunks} Ready for Review`);
              setProgressDetail(data.message || `Batch ${data.chunk_index} ready. Provide feedback below or continue.`);
              console.log(`[Subtitle Studio] Batch ${data.chunk_index}/${data.total_chunks} paused for review.`);
              try { await reader.cancel(); } catch (_) { }
              break;
            } else if (data.type === 'batch_error') {
              console.warn(`[Subtitle Studio] Batch ${data.chunk_index} notice:`, data.error);
              setProgressDetail(`Batch ${data.chunk_index} notice: ${data.error ? String(data.error).slice(0, 70) : 'issue processing'}`);
            } else if (data.type === 'stream_error') {
              console.error(`[Subtitle Studio] Fatal stream error reported:`, data.error);
              throw new Error(`Server generation error: ${data.error}`);
            } else if (data.type === 'complete') {
              streamCompleted = true;
              setCanResume(false);
              setResumeChunk(null);
              setBatchPauseData(null);
              setUserFeedbackText('');
              const res = data.result || {};
              const finalEvents = (res.events || accumulatedEvents).map(e => ({
                ...e,
                start: e.start_time || e.start,
                end: e.end_time || e.end
              }));
              setEvents(prev => {
                const prevMap = new Map(prev.map(e => [e.id, e]));
                return finalEvents.map(e => {
                  // Protect manual edits made by user while subsequent batches were generating
                  if (editedEventIdsRef.current.has(e.id) && prevMap.has(e.id)) {
                    return prevMap.get(e.id);
                  }
                  return e;
                });
              });
              pushToHistory(finalEvents);
              setComplianceScore(res.compliance_score || 100);
              setTotalErrors(res.total_errors || 0);
              setTotalWarnings(res.total_warnings || 0);
              setCpsStats(res.cps_stats || null);
              setProgressPercent(100);
              if (finalEvents.length === 0) {
                setProgressStage('No Dialogue Detected');
                setProgressDetail(res.error || '0 subtitles found across recording.');
                alert(res.error || `No Subtitles Generated: No audible dialogue was transcribed across all parts.\n\nTip: If you recently uploaded multiple files, your Gemini API key free tier quota may be temporarily rate-limited (429). The system also attempts local Whisper fallback.`);
              } else {
                setProgressStage('Complete');
                setProgressDetail(`All ${finalEvents.length} subtitles generated and audited!`);
                console.log("[Subtitle Studio] Subtitle generation completed successfully!");
              }
            }
          } catch (e) {
            console.warn("SSE parse error:", e, jsonStr);
          }
        }
      }

      // Check for premature disconnection
      if (!streamCompleted) {
        console.warn(`[Subtitle Studio] Stream reader closed without 'complete' event. Ingested ${lastBatchIndex}/${totalExpectedChunks} batches (${accumulatedEvents.length} events).`);
        if (accumulatedEvents.length > 0) {
          const finalEvents = accumulatedEvents.map(e => ({
            ...e,
            start: e.start_time || e.start,
            end: e.end_time || e.end
          }));
          setEvents(finalEvents);
          pushToHistory(finalEvents);
          if (lastBatchIndex < totalExpectedChunks) {
            setCanResume(true);
            setResumeChunk(lastBatchIndex + 1);
            setTotalChunks(totalExpectedChunks);
          }
          setProgressPercent(100);
          setProgressStage('Generation Paused');
          setProgressDetail(`Stream paused at Batch ${lastBatchIndex}/${totalExpectedChunks}. All ${finalEvents.length} subtitles preserved!`);
          alert(`Subtitle Generation Paused: ${finalEvents.length} subtitles generated across ${lastBatchIndex || 1} of ${totalExpectedChunks} batches and saved to your timeline.\n\nYou can click 'Continue (Batch ${(lastBatchIndex || 1) + 1}/${totalExpectedChunks})' anytime to resume from where it stopped without restarting!`);
        } else {
          throw new Error("Stream connection closed before subtitles could be generated. Please try again.");
        }
      }
    } catch (err) {
      console.error("Generation error:", err);
      if (lastBatchIndex > 0 && lastBatchIndex < totalExpectedChunks) {
        setCanResume(true);
        setResumeChunk(lastBatchIndex + 1);
        setTotalChunks(totalExpectedChunks);
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
      setIsGenerating(false);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      setTimeout(() => {
        setProgressPercent(0);
        setBatchProgress(null);
      }, 2500);
    }
  };

  // ── Continue / Resume Subtitle Generation from Last Processed Batch ──
  const handleContinueGenerate = async (targetMode = 'all', feedbackText = null) => {
    if (!selectedFile) {
      fileInputRef.current?.click();
      return;
    }

    const chunkToStart = resumeChunk || 1;
    const prevEventsCount = events.length;
    const prevBatchEnd = events.length > 0 ? (events[events.length - 1].end_time ?? events[events.length - 1].end ?? 0.0) : 0.0;
    const prevContext = events.slice(-3).map(e => e.text).filter(Boolean);
    const activeFeedback = (typeof feedbackText === 'string' && feedbackText.trim()) ? feedbackText.trim() : (userFeedbackText.trim() || null);

    setBatchPauseData(null);
    setIsGenerating(true);
    setProgressPercent(Math.min(95, Math.floor(((chunkToStart - 1) / (totalChunks || chunkToStart)) * 100)));
    setProgressStage(`Resuming from Batch ${chunkToStart} of ${totalChunks || '?'}`);
    setProgressDetail(`Connecting to resume stream from ${prevEventsCount} existing subtitles...`);
    setBatchProgress({ current: chunkToStart - 1, total: totalChunks || chunkToStart });
    setElapsedSeconds(0);

    const startTimer = Date.now();
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(parseFloat(((Date.now() - startTimer) / 1000).toFixed(1)));
    }, 200);

    let lastBatchIndex = chunkToStart - 1;
    let totalExpectedChunks = totalChunks || 1;

    try {
      let videoId = currentVideoId;
      if (!videoId) {
        setProgressDetail('Transferring media to server session...');
        videoId = await processAndUploadMedia(selectedFile, isAudioFile);
        if (videoId) {
          setCurrentVideoId(videoId);
        } else {
          throw new Error('Could not transfer media to server.');
        }
      }

      console.log(`[Subtitle Studio] Resuming stream for Video ID: ${videoId} starting at Batch ${chunkToStart} (mode: ${targetMode})`);
      let streamRes = await fetch(`${API_BASE}/api/subtitle/generate_stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoId,
          language,
          script,
          content_type: contentType,
          sdh_mode: sdhMode,
          cpl_limit: cplLimit,
          max_cps: cpsLimit,
          max_lines: maxLines,
          min_duration: minDuration,
          max_duration: maxDuration,
          frame_rate: frameRate,
          gemini_auto_fix: geminiAutoFix,
          start_time: prevBatchEnd,
          start_chunk: chunkToStart,
          prev_events_count: prevEventsCount,
          prev_batch_end: prevBatchEnd,
          prev_context: prevContext,
          batch_mode: targetMode,
          user_feedback: activeFeedback
        })
      });

      if (streamRes.status === 404) {
        console.warn(`[Subtitle Studio] Session for ${videoId} expired on server (404). Re-uploading media...`);
        setCurrentVideoId(null);
        videoId = await processAndUploadMedia(selectedFile, isAudioFile);
        if (!videoId) {
          throw new Error('Media re-upload failed after server session expired.');
        }
        setCurrentVideoId(videoId);

        streamRes = await fetch(`${API_BASE}/api/subtitle/generate_stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video_id: videoId,
            language,
            script,
            content_type: contentType,
            sdh_mode: sdhMode,
            cpl_limit: cplLimit,
            max_cps: cpsLimit,
            max_lines: maxLines,
            min_duration: minDuration,
            max_duration: maxDuration,
            frame_rate: frameRate,
            gemini_auto_fix: geminiAutoFix,
            start_time: prevBatchEnd,
            start_chunk: chunkToStart,
            prev_events_count: prevEventsCount,
            prev_batch_end: prevBatchEnd,
            prev_context: prevContext,
            batch_mode: targetMode,
            user_feedback: activeFeedback
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
      let streamCompleted = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith(':')) continue;
          if (!trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.replace(/^data:\s*/, '');
          try {
            const data = JSON.parse(jsonStr);

            if (data.type === 'init') {
              totalExpectedChunks = data.total_chunks || totalExpectedChunks;
              setTotalChunks(totalExpectedChunks);
              setProgressDetail(`Continuing batches ${data.start_chunk || chunkToStart} to ${totalExpectedChunks}...`);
              setBatchProgress({ current: data.start_chunk || chunkToStart, total: totalExpectedChunks });
            } else if (data.type === 'heartbeat') {
              if (data.stage) setProgressDetail(data.stage);
            } else if (data.type === 'progress') {
              const pct = Math.floor((data.chunk_index / data.total_chunks) * 100);
              setProgressPercent(pct);
              setProgressStage(`Generating Batch ${data.chunk_index} of ${data.total_chunks}`);
              setProgressDetail(data.stage || `Transcribing dialogue & applying Netflix rules for Batch ${data.chunk_index}...`);
              setBatchProgress({ current: data.chunk_index, total: data.total_chunks });
            } else if (data.type === 'batch') {
              lastBatchIndex = data.chunk_index || lastBatchIndex;
              const newBatchEvents = data.events || [];
              setEvents(prev => {
                const prevMap = new Map(prev.map(e => [e.id, e]));
                const merged = [...prev];
                for (const newEv of newBatchEvents) {
                  if (!prevMap.has(newEv.id)) {
                    merged.push(newEv);
                  } else if (!editedEventIdsRef.current.has(newEv.id)) {
                    const idx = merged.findIndex(e => e.id === newEv.id);
                    if (idx !== -1) merged[idx] = newEv;
                  }
                }
                return merged;
              });
              const nextToResume = lastBatchIndex + 1;
              if (nextToResume <= (data.total_chunks || totalExpectedChunks)) {
                setResumeChunk(nextToResume);
                setTotalChunks(data.total_chunks || totalExpectedChunks);
                setCanResume(true);
              }
              console.log(`[Subtitle Studio] Appended Batch ${data.chunk_index}/${data.total_chunks} (${newBatchEvents.length} new events).`);
            } else if (data.type === 'batch_ready') {
              setQcNotification({
                message: data.message || `Part ${data.chunk_index} is complete!`,
                chunkIndex: data.chunk_index,
                totalChunks: data.total_chunks,
                timestamp: Date.now()
              });
            } else if (data.type === 'batch_pause') {
              streamCompleted = true;
              setBatchPauseData({
                chunkIndex: data.chunk_index,
                totalChunks: data.total_chunks,
                nextChunk: data.next_chunk,
                prevBatchEnd: data.prev_batch_end,
                prevEventsCount: data.prev_events_count,
                prevContext: data.prev_context,
                message: data.message
              });
              setResumeChunk(data.next_chunk);
              setTotalChunks(data.total_chunks);
              setCanResume(true);
              const pct = Math.floor((data.chunk_index / data.total_chunks) * 100);
              setProgressPercent(pct);
              setProgressStage(`Batch ${data.chunk_index} of ${data.total_chunks} Ready for Review`);
              setProgressDetail(data.message || `Batch ${data.chunk_index} ready. Check subtitles or provide AI guidance.`);
              console.log(`[Subtitle Studio] Batch ${data.chunk_index}/${data.total_chunks} paused for review.`);
              try { await reader.cancel(); } catch (_) { }
              break;
            } else if (data.type === 'batch_error') {
              console.warn(`[Subtitle Studio] Batch ${data.chunk_index} issue:`, data.error);
              setProgressDetail(`Batch ${data.chunk_index} had an issue: continuing to next batch...`);
            } else if (data.type === 'stream_error') {
              console.error(`[Subtitle Studio] Stream error:`, data.error);
              throw new Error(`Server generation error: ${data.error}`);
            } else if (data.type === 'complete') {
              streamCompleted = true;
              setCanResume(false);
              setResumeChunk(null);
              setBatchPauseData(null);
              setUserFeedbackText('');
              const res = data.result || {};
              setComplianceScore(res.compliance_score || 100);
              setTotalErrors(res.total_errors || 0);
              setTotalWarnings(res.total_warnings || 0);
              setCpsStats(res.cps_stats || null);
              setProgressPercent(100);
              setProgressStage('Complete');
              setProgressDetail(`All batches generated and audited!`);
              console.log("[Subtitle Studio] Continued subtitle generation completed successfully!");
            }
          } catch (e) {
            console.warn("SSE parse error:", e, jsonStr);
          }
        }
      }

      if (!streamCompleted) {
        console.warn(`[Subtitle Studio] Stream stopped at batch ${lastBatchIndex}/${totalExpectedChunks}.`);
        if (lastBatchIndex < totalExpectedChunks) {
          setResumeChunk(lastBatchIndex + 1);
          setTotalChunks(totalExpectedChunks);
          setCanResume(true);
          alert(`Generation paused at batch ${lastBatchIndex} of ${totalExpectedChunks}. Existing subtitles are safely preserved.\n\nYou can click 'Continue (Batch ${lastBatchIndex + 1}/${totalExpectedChunks})' anytime to continue.`);
        }
      }
    } catch (err) {
      console.error("Resume error:", err);
      if (lastBatchIndex > 0 && lastBatchIndex < totalExpectedChunks) {
        setCanResume(true);
        setResumeChunk(lastBatchIndex + 1);
        setTotalChunks(totalExpectedChunks);
      }
      alert(`Error resuming subtitle generation: ${err.message}`);
    } finally {
      setIsGenerating(false);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      setTimeout(() => {
        setProgressPercent(0);
        setBatchProgress(null);
      }, 2500);
    }
  };

  // ── Step Continue with AI Steering Guidance ──
  const handleContinueBatchStep = async (mode = 'single') => {
    const feedback = userFeedbackText.trim();
    setBatchPauseData(null);
    await handleContinueGenerate(mode, feedback);
  };

  // ── Open Custom Time Resume Modal ──
  const handleOpenCustomTimeModal = useCallback((initialTime = null) => {
    let t = initialTime;
    if (t === 'lastSub' || (t === null && events.length > 0)) {
      const lastEv = events[events.length - 1];
      t = lastEv ? (lastEv.end_time ?? lastEv.end ?? 0) : currentTime;
    } else if (t === null) {
      t = currentTime;
    }
    setCustomStartTime(t);
    setShowCustomTimeModal(true);
  }, [currentTime, events]);

  // ── Continue / Generate Subtitles From Custom Timestamp on Timeline ──
  const handleStartGenerationFromCustomTime = useCallback(async (targetSec, shouldPreserve = true) => {
    setShowCustomTimeModal(false);
    if (!selectedFile) {
      fileInputRef.current?.click();
      return;
    }

    const t = Math.max(0, typeof targetSec === 'number' ? targetSec : parseFloat(targetSec) || 0);

    // If shouldPreserve is true, keep events starting before t
    const preservedEvents = shouldPreserve
      ? events.filter(e => {
        const st = e.start_time ?? e.start ?? 0;
        return st < t;
      })
      : [];

    setEvents(preservedEvents);
    pushToHistory(preservedEvents);

    const prevEventsCount = preservedEvents.length;
    const prevBatchEnd = preservedEvents.length > 0
      ? (preservedEvents[preservedEvents.length - 1].end_time ?? preservedEvents[preservedEvents.length - 1].end ?? t)
      : t;
    const prevContext = preservedEvents.slice(-3).map(e => e.text).filter(Boolean);

    setIsGenerating(true);
    setProgressPercent(Math.min(95, Math.floor((t / Math.max(1, videoDuration || t)) * 100)));
    setProgressStage(`Generating from ${formatTime(t)}`);
    setProgressDetail(`Starting stream from ${formatTime(t)} (${prevEventsCount} earlier subtitles preserved)...`);
    setBatchProgress(null);
    setElapsedSeconds(0);

    const startTimer = Date.now();
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSeconds(parseFloat(((Date.now() - startTimer) / 1000).toFixed(1)));
    }, 200);

    let lastBatchIndex = 0;
    let totalExpectedChunks = 1;

    try {
      let videoId = currentVideoId;
      if (!videoId) {
        setProgressDetail('Transferring media to server session...');
        videoId = await processAndUploadMedia(selectedFile, isAudioFile);
        if (videoId) {
          setCurrentVideoId(videoId);
        } else {
          throw new Error('Could not transfer media to server.');
        }
      }

      console.log(`[Subtitle Studio] Starting stream from custom timestamp: ${t.toFixed(3)}s`);
      let streamRes = await fetch(`${API_BASE}/api/subtitle/generate_stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          video_id: videoId,
          language,
          script,
          content_type: contentType,
          sdh_mode: sdhMode,
          cpl_limit: cplLimit,
          max_cps: cpsLimit,
          max_lines: maxLines,
          min_duration: minDuration,
          max_duration: maxDuration,
          frame_rate: frameRate,
          gemini_auto_fix: geminiAutoFix,
          start_time: t,
          prev_events_count: prevEventsCount,
          prev_batch_end: prevBatchEnd,
          prev_context: prevContext
        })
      });

      if (streamRes.status === 404) {
        console.warn(`[Subtitle Studio] Session for ${videoId} expired on server (404). Re-uploading media...`);
        setCurrentVideoId(null);
        videoId = await processAndUploadMedia(selectedFile, isAudioFile);
        if (!videoId) {
          throw new Error('Media re-upload failed after server session expired.');
        }
        setCurrentVideoId(videoId);

        streamRes = await fetch(`${API_BASE}/api/subtitle/generate_stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            video_id: videoId,
            language,
            script,
            content_type: contentType,
            sdh_mode: sdhMode,
            cpl_limit: cplLimit,
            max_cps: cpsLimit,
            max_lines: maxLines,
            min_duration: minDuration,
            max_duration: maxDuration,
            frame_rate: frameRate,
            gemini_auto_fix: geminiAutoFix,
            start_time: t,
            prev_events_count: prevEventsCount,
            prev_batch_end: prevBatchEnd,
            prev_context: prevContext
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
      let streamCompleted = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith(':')) continue;
          if (!trimmed.startsWith('data:')) continue;
          const jsonStr = trimmed.replace(/^data:\s*/, '');
          try {
            const data = JSON.parse(jsonStr);

            if (data.type === 'init') {
              totalExpectedChunks = data.total_chunks || totalExpectedChunks;
              setTotalChunks(totalExpectedChunks);
              setProgressDetail(`Generating ${totalExpectedChunks} batches from ${formatTime(t)}...`);
              setBatchProgress({ current: 0, total: totalExpectedChunks });
            } else if (data.type === 'heartbeat') {
              if (data.stage) setProgressDetail(data.stage);
            } else if (data.type === 'progress') {
              const pct = Math.floor((data.chunk_index / data.total_chunks) * 100);
              setProgressPercent(pct);
              setProgressStage(`Generating Batch ${data.chunk_index} of ${data.total_chunks}`);
              setProgressDetail(data.stage || `Transcribing dialogue for Batch ${data.chunk_index}...`);
              setBatchProgress({ current: data.chunk_index, total: data.total_chunks });
            } else if (data.type === 'batch') {
              lastBatchIndex = data.chunk_index || lastBatchIndex;
              const newBatchEvents = data.events || [];
              setEvents(prev => {
                const prevMap = new Map(prev.map(e => [e.id, e]));
                const merged = [...prev];
                for (const newEv of newBatchEvents) {
                  if (!prevMap.has(newEv.id)) {
                    merged.push(newEv);
                  } else if (!editedEventIdsRef.current.has(newEv.id)) {
                    const idx = merged.findIndex(e => e.id === newEv.id);
                    if (idx !== -1) merged[idx] = newEv;
                  }
                }
                return merged;
              });
              const nextToResume = lastBatchIndex + 1;
              if (nextToResume <= (data.total_chunks || totalExpectedChunks)) {
                setResumeChunk(nextToResume);
                setTotalChunks(data.total_chunks || totalExpectedChunks);
                setCanResume(true);
              }
              console.log(`[Subtitle Studio] Appended Batch ${data.chunk_index}/${data.total_chunks} (${newBatchEvents.length} events from ${formatTime(t)}).`);
            } else if (data.type === 'batch_ready') {
              setQcNotification({
                message: data.message || `Part ${data.chunk_index} is complete!`,
                chunkIndex: data.chunk_index,
                totalChunks: data.total_chunks,
                timestamp: Date.now()
              });
            } else if (data.type === 'batch_error') {
              console.warn(`[Subtitle Studio] Batch ${data.chunk_index} issue:`, data.error);
              setProgressDetail(`Batch ${data.chunk_index} issue: continuing...`);
            } else if (data.type === 'stream_error') {
              console.error(`[Subtitle Studio] Stream error:`, data.error);
              throw new Error(`Server generation error: ${data.error}`);
            } else if (data.type === 'complete') {
              streamCompleted = true;
              setCanResume(false);
              setResumeChunk(null);
              const res = data.result || {};
              setComplianceScore(res.compliance_score || 100);
              setTotalErrors(res.total_errors || 0);
              setTotalWarnings(res.total_warnings || 0);
              setCpsStats(res.cps_stats || null);
              setProgressPercent(100);
              setProgressStage('Complete');
              setProgressDetail(`All batches generated from ${formatTime(t)}!`);
            }
          } catch (e) {
            console.warn("SSE parse error:", e, jsonStr);
          }
        }
      }

      if (!streamCompleted) {
        if (lastBatchIndex < totalExpectedChunks) {
          setResumeChunk(lastBatchIndex + 1);
          setTotalChunks(totalExpectedChunks);
          setCanResume(true);
          alert(`Generation paused at batch ${lastBatchIndex} of ${totalExpectedChunks}. Subtitles are preserved. You can continue anytime.`);
        }
      }
    } catch (err) {
      console.error("Custom time generate error:", err);
      alert(`Error generating subtitles from ${formatTime(t)}: ${err.message}`);
    } finally {
      setIsGenerating(false);
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
      setTimeout(() => {
        setProgressPercent(0);
        setBatchProgress(null);
      }, 2500);
    }
  }, [selectedFile, events, videoDuration, currentVideoId, isAudioFile, processAndUploadMedia, language, script, contentType, sdhMode, cplLimit, cpsLimit, maxLines, minDuration, maxDuration, geminiAutoFix, pushToHistory]);



  // ── Gemini-Coordinated QC Self-Correction Pass ──
  const handleGeminiFix = async () => {
    if (!events || events.length === 0) return;
    setIsFixingWithGemini(true);
    try {
      const res = await fetch(`${API_BASE}/api/subtitle/gemini_fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
        setAutoSaveStatus('Gemini Auto-Fix Applied ✓');
        setTimeout(() => setAutoSaveStatus(''), 3000);
      }
    } catch (err) {
      console.error("Gemini fix failed:", err);
    } finally {
      setIsFixingWithGemini(false);
    }
  };

  // ── Closed-Loop Acoustic Audio Synchronization Pass ──
  const handleAcousticSync = async () => {
    if (!events || events.length === 0 || !currentVideoId) return;
    setIsSyncingAudio(true);
    try {
      const res = await fetch(`${API_BASE}/api/subtitle/acoustic_sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          shot_changes: shotChanges
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
        const err = await res.json();
        alert(err.detail || "Acoustic audio synchronization failed.");
      }
    } catch (err) {
      console.error("Acoustic sync failed:", err);
      alert("Acoustic sync failed: " + err.message);
    } finally {
      setIsSyncingAudio(false);
    }
  };

  // Auto-Fix All Issues
  const handleAutoFix = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/subtitle/autofix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
      console.error(err);
      alert('Auto-fix failed');
    }
  };

  // Import SRT / VTT File
  const handleImportSrt = (e) => {
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
          alert(`Successfully imported ${parsed.length} subtitles from ${file.name}`);
        }
      } catch (err) {
        console.error(err);
        alert('Failed to parse subtitle file.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col font-sans select-none transition-colors duration-150 bg-[#0e0f12] text-[#f1f2f6]">
      {/* Hidden File Upload Inputs */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept="video/mp4,video/mkv,video/quicktime,video/webm,video/avi,audio/mp3,audio/wav,audio/m4a,audio/aac,audio/flac,audio/ogg,audio/mpeg,audio/opus,.mp4,.mkv,.mov,.webm,.avi,.mp3,.wav,.m4a,.aac,.flac,.ogg,.opus"
        className="hidden"
      />
      <input
        type="file"
        ref={srtImportRef}
        onChange={handleImportSrt}
        accept=".srt,.vtt,.txt"
        className="hidden"
      />

      {/* ── Top Header Bar (Sleek NLE Studio Menu) ── */}
      <nav ref={headerMenuRef} className="border-b border-[#262734] bg-[#121318] px-3 py-1 flex items-center justify-between shadow-xs shrink-0 z-40 transition-colors">
        {/* Left: Brand & Studio Title */}
        <div className="flex items-center gap-2">
          <button
            onClick={onBackToHome}
            className="p-1 px-2 rounded transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-semibold border border-[#262734] hover:bg-[#181920] text-slate-300 hover:text-white"
            title="Return to Hub"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-[#00e5be]" />
            <span>Hub</span>
          </button>

          <div className="h-4 w-px bg-[#262734]" />

          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-gradient-to-tr from-[#00e5be] to-[#00b4d8] text-black flex items-center justify-center font-black shadow-xs">
              <Film className="w-3 h-3" />
            </div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-xs font-bold tracking-tight uppercase font-mono text-white">
                SUBTITLE STUDIO
              </h1>
              <span className="text-[8px] font-black uppercase tracking-wider px-1.5 py-0.2 bg-[#00e5be]/15 text-[#00e5be] rounded border border-[#00e5be]/40">
                PRO
              </span>
            </div>
          </div>

          {selectedFile && (
            <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-[#262734] truncate max-w-[220px] text-slate-300 bg-[#181920] flex items-center gap-1.5" title={selectedFile.name}>
              <span className={`px-1 py-0.2 rounded text-[9px] font-bold ${isAudioFile ? 'bg-cyan-500/20 text-[#00e5ff] border border-cyan-500/40' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                }`}>
                {isAudioFile ? '🎵 AUDIO' : '🎬 VIDEO'}
              </span>
              <span className="truncate">{selectedFile.name}</span>
            </span>
          )}

          {autoSaveStatus && (
            <span className="text-[10px] text-[#00e5be] font-mono font-bold animate-pulse">
              {autoSaveStatus}
            </span>
          )}
        </div>

        {/* Center / Non-Blocking Streaming Indicator Banner */}
        {isGenerating ? (
          <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-[#00e5be]/50 bg-[#181920] text-[#00e5be] shadow-sm">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00e5be]" />
            <span className="text-[11px] font-bold">{progressStage}</span>
            {batchProgress && (
              <span className="text-[10px] font-mono font-black px-1.5 py-0.2 bg-[#00e5be] text-black rounded">
                Batch {batchProgress.current}/{batchProgress.total}
              </span>
            )}
            <span className="text-[10px] font-mono opacity-80">({Math.round(progressPercent)}%)</span>
            <span className="text-[10px] font-mono opacity-60">[{elapsedSeconds}s]</span>
          </div>
        ) : (
          <div className="flex items-center gap-1">
            {/* File Dropdown */}
            <div className="relative">
              <button
                onClick={() => { setShowFileDropdown(!showFileDropdown); setShowSettingsDropdown(false); }}
                className="px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer border border-[#262734] hover:bg-[#181920] text-slate-300 hover:text-white"
              >
                <span>File</span>
                <ChevronDown size={12} />
              </button>

              {showFileDropdown && (
                <div className="absolute top-full left-0 mt-1 w-56 rounded-lg shadow-xl border border-[#262734] p-1 z-50 animate-in fade-in zoom-in-95 duration-150 bg-[#181920] text-slate-200">
                  <button
                    onClick={() => { fileInputRef.current?.click(); setShowFileDropdown(false); }}
                    className="w-full text-left px-3 py-2 text-xs rounded flex items-center gap-2 cursor-pointer hover:bg-[#22232c] text-slate-200"
                  >
                    <Upload size={13} className="text-[#00e5be]" />
                    <span>Open Media (Video / Audio)...</span>
                  </button>
                  <button
                    onClick={() => { srtImportRef.current?.click(); setShowFileDropdown(false); }}
                    className="w-full text-left px-3 py-2 text-xs rounded flex items-center gap-2 cursor-pointer hover:bg-[#22232c] text-slate-200"
                  >
                    <FileText size={13} className="text-emerald-400" />
                    <span>Import Subtitle (SRT/VTT)...</span>
                  </button>
                  <div className="h-px my-1 bg-[#262734]" />
                  <button
                    onClick={() => { setShowExportModal(true); setShowFileDropdown(false); }}
                    className="w-full text-left px-3 py-2 text-xs rounded flex items-center gap-2 font-bold cursor-pointer hover:bg-[#22232c] text-[#00e5be]"
                  >
                    <Download size={13} />
                    <span>Export Subtitles...</span>
                  </button>
                  <div className="h-px my-1 bg-[#262734]" />
                  <button
                    onClick={() => {
                      if (window.confirm("Clear all current subtitles and remove any saved draft for this video?")) {
                        try {
                          if (selectedFile?.name) {
                            localStorage.removeItem(`karya_subtitle_autosave_${selectedFile.name}`);
                          }
                        } catch (_) { }
                        setEvents([]);
                        setComplianceScore(100);
                        setTotalErrors(0);
                        setTotalWarnings(0);
                        setActiveEventId(null);
                        setPendingDraft(null);
                      }
                      setShowFileDropdown(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-xs rounded flex items-center gap-2 font-medium cursor-pointer text-rose-400 hover:bg-rose-950/40`}
                  >
                    <Trash2 size={13} />
                    <span>Clear Subtitles & Draft</span>
                  </button>
                </div>
              )}
            </div>

            {/* Settings Modal Trigger Button */}
            <button
              onClick={() => setShowSettingsModal(true)}
              className="px-2 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border hover:bg-[#181920] text-slate-300 border-[#262734]"
              title="Configure CPL, CPS, Frame Rate (FPS), Line Limits & AI Auto-Fix"
            >
              <Settings size={13} className="text-[#00e5be]" />
              <span>Settings</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-[#00e5be]/15 text-[#00e5be] border border-[#00e5be]/30">
                {cplLimit} CPL · {cpsLimit} CPS · {frameRate} FPS
              </span>
            </button>

            {/* Quick Frame Rate Indicator / Selector Badge */}
            <button
              onClick={() => setShowSettingsModal(true)}
              className={`px-2 py-1 rounded text-xs font-mono font-semibold flex items-center gap-1 transition-all cursor-pointer border ${detectedFpsNotice
                  ? 'bg-[#00e5be] text-black border-[#00e5be] shadow-[0_0_10px_rgba(0,229,190,0.4)] animate-pulse'
                  : 'bg-[#14151a] hover:bg-[#181920] text-slate-300 border-[#262734] hover:border-slate-500'
                }`}
              title="Click to view or change Video Frame Rate (FPS)"
            >
              <span>🎬</span>
              <span>{detectedFpsNotice ? `FPS: ${detectedFpsNotice}` : `${frameRate} fps`}</span>
            </button>

            {/* Undo / Redo */}
            <div className="flex items-center border border-[#262734] bg-[#14151a] rounded overflow-hidden">
              <button
                onClick={handleUndo}
                disabled={historyIndex <= 0}
                className="p-1.5 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#1f2638] text-slate-300 hover:text-white"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 size={13} />
              </button>
              <button
                onClick={handleRedo}
                disabled={historyIndex >= history.length - 1}
                className="p-1.5 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed border-l border-[#262734] hover:bg-[#1f2638] text-slate-300 hover:text-white"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 size={13} />
              </button>
            </div>
          </div>
        )}

        {/* Right Menu Strip (CapCut Aesthetic) */}
        <div className="flex items-center gap-1.5">
          {/* Language & Script Fast Selectors */}
          <div className="flex items-center gap-1.5 bg-[#181920] border border-[#262734] px-2 py-0.5 rounded text-xs">
            <Globe size={12} className="text-[#00e5be] shrink-0" />
            <select
              value={language}
              onChange={(e) => {
                setLanguage(e.target.value);
                try { localStorage.setItem('karya_sub_language', e.target.value); } catch (_) { }
              }}
              disabled={isGenerating}
              className="bg-transparent text-slate-200 font-semibold text-xs focus:outline-none cursor-pointer"
              title="Target Spoken Language"
            >
              <option value="auto" className="bg-[#181920]">Auto-Detect</option>
              <option value="hi" className="bg-[#181920]">Hindi (हिंदी)</option>
              <option value="en" className="bg-[#181920]">English</option>
              <option value="hinglish" className="bg-[#181920]">Hinglish (Hindi in Latin)</option>
              <option value="bn" className="bg-[#181920]">Bengali (বাংলা)</option>
              <option value="ta" className="bg-[#181920]">Tamil (தமிழ்)</option>
              <option value="te" className="bg-[#181920]">Telugu (తెలుగు)</option>
              <option value="mr" className="bg-[#181920]">Marathi (मराठी)</option>
              <option value="gu" className="bg-[#181920]">Gujarati (ગુજરાતી)</option>
              <option value="pa" className="bg-[#181920]">Punjabi (ਪੰਜਾਬੀ)</option>
              <option value="kn" className="bg-[#181920]">Kannada (ಕನ್ನಡ)</option>
              <option value="ml" className="bg-[#181920]">Malayalam (മലയാളം)</option>
              <option value="ur" className="bg-[#181920]">Urdu (اردو)</option>
              <option value="es" className="bg-[#181920]">Spanish (Español)</option>
              <option value="fr" className="bg-[#181920]">French (Français)</option>
              <option value="de" className="bg-[#181920]">German (Deutsch)</option>
              <option value="ja" className="bg-[#181920]">Japanese (日本語)</option>
              <option value="ko" className="bg-[#181920]">Korean (한국어)</option>
              <option value="ar" className="bg-[#181920]">Arabic (العربية)</option>
            </select>

            <div className="h-3 w-px bg-[#262734]" />

            <select
              value={script}
              onChange={(e) => {
                setScript(e.target.value);
                try { localStorage.setItem('karya_sub_script', e.target.value); } catch (_) { }
              }}
              disabled={isGenerating}
              className="bg-transparent text-[#00e5be] font-semibold text-xs focus:outline-none cursor-pointer"
              title="Target Output Script"
            >
              <option value="auto" className="bg-[#181920]">Native / Auto Script</option>
              <option value="devanagari" className="bg-[#181920]">Devanagari (देवनागरी)</option>
              <option value="latin" className="bg-[#181920]">Latin (Hinglish / Roman)</option>
            </select>
          </div>

          {/* Auto-Fix Button */}
          <button
            onClick={handleAutoFix}
            disabled={isGenerating || events.length === 0}
            className="px-2.5 py-1 rounded text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer border border-emerald-500/40 bg-[#181920] hover:bg-[#22232c] text-emerald-400 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
            title="Auto-Fix Netflix Compliance Rules"
          >
            <Sparkles className="w-3 h-3 text-emerald-400" />
            <span>Auto-Fix</span>
          </button>

          {/* Continue Subtitle Generation Button - ALWAYS VISIBLE */}
          <button
            onClick={() => handleOpenCustomTimeModal('lastSub')}
            disabled={isGenerating}
            className={`px-3 py-1 rounded text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs ${canResume || events.length > 0
                ? 'bg-amber-500 hover:bg-amber-400 text-black shadow-[0_0_12px_rgba(245,158,11,0.35)]'
                : 'bg-[#181920] hover:bg-[#22232c] border border-amber-500/50 text-amber-300'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            title={
              canResume
                ? `Continue generation from Batch ${resumeChunk} of ${totalChunks}`
                : events.length > 0
                  ? `Continue generating subtitles from where you left off (${formatTime(events[events.length - 1]?.end_time ?? events[events.length - 1]?.end ?? 0)}) or choose timeline time`
                  : `Continue / start generating subtitles from specific timeline time`
            }
          >
            <Play className={`w-3.5 h-3.5 ${canResume || events.length > 0 ? 'fill-black text-black' : 'fill-amber-300 text-amber-300'}`} />
            <span>Continue</span>
            {canResume ? (
              <span className="text-[10px] font-mono opacity-90">(Batch {resumeChunk}/{totalChunks})</span>
            ) : events.length > 0 ? (
              <span className="text-[10px] font-mono opacity-85">({formatTime(events[events.length - 1]?.end_time ?? events[events.length - 1]?.end ?? 0).slice(0, 5)})</span>
            ) : null}
          </button>

          {/* Auto-Generate AI Button */}
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className="px-3 py-1 rounded text-xs font-semibold bg-[#22232c] hover:bg-[#2c2d38] border border-[#00e5be]/50 text-[#00e5be] flex items-center gap-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Run Gemini AI Netflix Subtitle Pipeline"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[#00e5be]" />
                <span>Generating...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 text-[#00e5be]" />
                <span>Auto-Generate</span>
              </>
            )}
          </button>

          {/* Acoustic Audio Sync Button */}
          <button
            onClick={handleAcousticSync}
            disabled={events.length === 0 || isSyncingAudio || !currentVideoId}
            className="px-3 py-1 rounded text-xs font-semibold bg-emerald-950/70 border border-emerald-500/40 hover:bg-emerald-900/80 text-emerald-300 flex items-center gap-1.5 transition-all shadow-[0_0_10px_rgba(16,185,129,0.2)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Snap and re-synchronize all subtitles directly to speech audio acoustics (Whisper + VAD)"
          >
            <Volume2 className={`w-3.5 h-3.5 text-emerald-400 ${isSyncingAudio ? 'animate-bounce' : ''}`} />
            <span>{isSyncingAudio ? 'Syncing...' : 'Sync Audio'}</span>
          </button>

          {/* Export Button (CapCut Signature Neon Turquoise Action) */}
          <button
            onClick={() => setShowExportModal(true)}
            disabled={events.length === 0}
            className="px-3.5 py-1 rounded text-xs font-bold bg-[#00e5be] hover:bg-[#00c9a7] text-black flex items-center gap-1.5 transition-all shadow-[0_0_12px_rgba(0,229,190,0.25)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            title="Export TTML / SRT / VTT"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>

          {/* Netflix QC Score Capsule */}
          <button
            onClick={() => setShowQcDrawer(!showQcDrawer)}
            className={`px-2.5 py-1 rounded text-xs font-mono font-bold flex items-center gap-1.5 transition-colors cursor-pointer border ${complianceScore >= 98
              ? 'bg-[#181920] border-emerald-500/50 text-emerald-400'
              : complianceScore >= 80
                ? 'bg-[#181920] border-amber-500/50 text-amber-400'
                : 'bg-[#181920] border-rose-500/50 text-rose-400'
              }`}
            title="Open Netflix Quality Control Dashboard"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>QC: {complianceScore}%</span>
            {totalErrors > 0 && (
              <span className="px-1.5 py-0.2 bg-rose-500 text-white rounded-full text-[9px] font-black">
                {totalErrors}
              </span>
            )}
          </button>
        </div>
      </nav>

      {/* Backend Connection Warning Banner */}
      {backendConnected === false && (
        <div className="px-4 py-2 flex items-center justify-between border-b border-amber-800 bg-amber-950/80 text-amber-200 text-xs shrink-0 z-30 transition-all">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Backend Disconnected:</strong> Could not reach backend at <code className="bg-black/30 px-1 py-0.5 rounded font-mono text-[11px]">{API_BASE || '(relative / localhost)'}</code>. If this is a live deployed website, configure your live Backend API URL.
            </span>
          </div>
          <button
            onClick={() => setShowSettingsModal(true)}
            className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-bold shrink-0 transition-colors cursor-pointer"
          >
            Configure API URL
          </button>
        </div>
      )}

      {/* Client Audio Extraction & Fast Cloud Transfer Progress Banner */}
      {audioExtractionStatus && (
        <div className="px-4 py-2 flex items-center justify-between border-b border-cyan-800/60 bg-cyan-950/90 text-cyan-200 text-xs shrink-0 z-30 transition-all animate-pulse">
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 text-cyan-400 animate-spin shrink-0" />
            <span>
              <strong>⚡ Fast Cloud Transfer:</strong> {audioExtractionStatus.detail || 'Extracting lightweight audio from video...'} ({audioExtractionStatus.percent || 0}%)
            </span>
          </div>
          <span className="text-[11px] text-cyan-300 font-mono hidden sm:inline">Bypassing 100MB cloud limits</span>
        </div>
      )}

      {/* Draft Restore Notification Banner */}
      {pendingDraft && (
        <div className="px-4 py-2 flex items-center justify-between border-b border-[#262734] bg-[#181920] text-slate-200 text-xs shrink-0 z-30 transition-all">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#00e5be] shrink-0" />
            <span>
              Found an earlier saved draft for <strong>{selectedFile?.name}</strong> with {pendingDraft.events?.length || 0} subtitles ({pendingDraft.timestamp ? new Date(pendingDraft.timestamp).toLocaleTimeString() : 'autosaved'}).
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const restoredEvents = pendingDraft.events || [];
                setEvents(restoredEvents);
                setComplianceScore(pendingDraft.complianceScore || 100);
                setTotalErrors(pendingDraft.totalErrors || 0);
                setTotalWarnings(pendingDraft.totalWarnings || 0);
                setActiveEventId(restoredEvents[0]?.id || null);
                if (pendingDraft.resumeChunk && pendingDraft.totalChunks && pendingDraft.resumeChunk <= pendingDraft.totalChunks) {
                  setResumeChunk(pendingDraft.resumeChunk);
                  setTotalChunks(pendingDraft.totalChunks);
                  setCanResume(true);
                }
                setPendingDraft(null);
              }}
              className="px-3 py-1 bg-[#00e5be] hover:bg-[#00c9a7] text-black rounded font-bold cursor-pointer transition-colors shadow-xs"
            >
              Restore Draft
            </button>
            <button
              onClick={() => {
                try {
                  localStorage.removeItem(`karya_subtitle_autosave_${selectedFile?.name}`);
                } catch (_) { }
                setPendingDraft(null);
              }}
              className="px-3 py-1 rounded cursor-pointer transition-colors bg-[#22232c] hover:bg-[#2c2d38] text-slate-300"
            >
              Discard & Start Fresh
            </button>
          </div>
        </div>
      )}

      {/* Resume Interrupted Generation Notification Banner */}
      {canResume && !isGenerating && events.length > 0 && (
        <div className="px-4 py-1.5 flex items-center justify-between border-b border-amber-500/40 bg-amber-950/70 text-amber-200 text-xs shrink-0 z-30 transition-all">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
            <span>
              <strong>Generation Interrupted:</strong> Completed through Batch {(resumeChunk || 2) - 1} of {totalChunks || '?'} ({events.length} subtitles generated). You can continue generating remaining batches anytime!
            </span>
          </div>
          <button
            onClick={() => handleContinueGenerate('all')}
            className="px-3 py-1 bg-amber-500 hover:bg-amber-400 text-black font-bold rounded text-xs shrink-0 transition-colors cursor-pointer flex items-center gap-1.5 shadow-xs"
          >
            <Play className="w-3 h-3 fill-black" />
            <span>Continue Generation (Batch {resumeChunk}/{totalChunks})</span>
          </button>
        </div>
      )}

      {/* Slim Real-Time Progress Line during Streaming */}
      {isGenerating && (
        <div className="w-full h-1 bg-[#181920] overflow-hidden shrink-0">
          <div
            className="h-full bg-gradient-to-r from-[#00e5be] via-[#00c9a7] to-[#00b4d8] shadow-[0_0_8px_rgba(0,229,190,0.5)] transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      )}

      {/* ── Resizable Subtitle Studio Workstation ── */}
      <div className="flex-1 min-h-0 flex flex-col p-1.5 gap-1.5 w-full mx-auto overflow-hidden relative select-none">

        {/* Top Resizable Split Area (Left: Subtitle Sheet vs Right: Video + Inspector) */}
        <div className="flex-1 min-h-0 flex gap-0 overflow-hidden">

          {/* Left Panel: Subtitle List / Spreadsheet View (Resizable Width) */}
          <div
            style={{ width: `${leftPanelWidth}px` }}
            className="shrink-0 flex flex-col h-full overflow-hidden rounded-lg border border-[#262734] bg-[#14151a] shadow-sm transition-colors"
          >
            <SubtitleGridView
              events={events}
              activeEventId={activeEventId}
              setActiveEventId={setActiveEventId}
              onPlayEvent={handlePlayEvent}
              onUpdateEvent={handleUpdateEvent}
              onDeleteEvent={handleDeleteEvent}
              onBulkDelete={handleBulkDelete}
              onSplitEvent={handleSplitEvent}
              onMergeEvent={handleMergeEvents}
              onRebreakEvent={handleRebreakEvent}
              onAddSubtitle={() => handleAddSubtitle(currentTime)}
              onJumpNextIssue={jumpToNextIssue}
              cplLimit={cplLimit}
              cpsLimit={cpsLimit}
              frameRate={frameRate}
              theme={theme}
            />
          </div>

          {/* ── Vertical Resizer Splitter (Left Subtitles vs Right Video) ── */}
          <div
            onMouseDown={handleLeftSplitterDown}
            className="w-2 hover:w-2.5 hover:bg-[#00e5be]/40 cursor-col-resize flex items-center justify-center transition-all group z-30 shrink-0"
            title="Drag to resize Subtitle Sheet width"
          >
            <div className="w-0.5 h-10 bg-[#262734] rounded-full group-hover:bg-[#00e5be] transition-colors" />
          </div>

          {/* Right Panel: Full Video Player Viewport */}
          <div className="flex-1 min-w-0 h-full overflow-hidden bg-black rounded-lg border border-[#262734]">
            <VideoPlayer
              videoUrl={videoUrl}
              events={events}
              activeEventId={activeEventId}
              setActiveEventId={setActiveEventId}
              playTarget={playTarget}
              onTimeUpdate={(t) => setCurrentTime(t)}
              frameRate={frameRate}
              theme={theme}
              isAudio={isAudioFile}
            />
          </div>
        </div>

        {/* ── Horizontal Resizer Splitter (Top Panels vs Bottom Timeline) ── */}
        <div
          onMouseDown={handleBottomSplitterDown}
          className="h-2 hover:h-2.5 hover:bg-[#00e5be]/40 cursor-row-resize flex items-center justify-center transition-all group z-30 w-full shrink-0"
          title="Drag to resize Timeline height"
        >
          <div className="h-0.5 w-16 bg-[#262734] rounded-full group-hover:bg-[#00e5be] transition-colors" />
        </div>

        {/* Bottom Row: Audio Waveform Timeline with Clean Continuous Waveform & Rectangular Subtitle Boxes */}
        <div style={{ height: `${bottomTimelineHeight}px` }} className="w-full shrink-0 overflow-hidden">
          <AudioWaveformTimeline
            videoUrl={videoUrl}
            selectedFile={selectedFile}
            videoId={currentVideoId || null}
            initialPeaks={initialWaveformPeaks}
            API_BASE={API_BASE}
            isAudio={isAudioFile}
            events={events}
            shotChanges={shotChanges}
            duration={videoDuration}
            currentTime={currentTime}
            activeEventId={activeEventId}
            setActiveEventId={setActiveEventId}
            onEventTimeChange={handleEventTimeChange}
            onSeek={(t) => {
              setCurrentTime(t);
              setPlayTarget({ time: t, pause: true });
            }}
            onAddSubtitleAtTime={handleAddSubtitle}
            onShiftAllFollowing={handleShiftAllFollowing}
            onContinueFromTime={handleOpenCustomTimeModal}
            frameRate={frameRate}
            cpsLimit={cpsLimit}
            cplLimit={cplLimit}
            theme={theme}
          />
        </div>

        {/* ── Slide-Over Netflix QC Panel Drawer ── */}
        {showQcDrawer && (
          <div className="fixed inset-y-0 right-0 z-50 w-80 md:w-96 shadow-2xl border-l border-[#262734] bg-[#14151a] text-slate-200 p-4 flex flex-col animate-in slide-in-from-right duration-200">
            <NetflixQCPanel
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
              onGeminiFix={handleGeminiFix}
              isFixingWithGemini={isFixingWithGemini}
              onAcousticSync={handleAcousticSync}
              isSyncingAudio={isSyncingAudio}
              onExport={() => setShowExportModal(true)}
              onJumpToEvent={(id) => {
                setActiveEventId(id);
                handlePlayEvent(id);
                setShowQcDrawer(false);
              }}
              onClose={() => setShowQcDrawer(false)}
            />
          </div>
        )}
      </div>

      {/* ── Progressive Batch Ready QC Notification Toast ── */}
      {qcNotification && (
        <div className="fixed top-16 right-6 z-50 flex items-center gap-3 px-4 py-3 bg-[#131b18]/95 border border-[#00e5be]/60 rounded-xl shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-300 text-slate-100 max-w-md">
          <div className="w-8 h-8 rounded-lg bg-[#00e5be]/20 border border-[#00e5be]/40 flex items-center justify-center text-[#00e5be] shrink-0">
            <CheckCircle2 className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-white flex items-center gap-1.5">
              <span>Part {qcNotification.chunkIndex} Complete</span>
              <span className="px-1.5 py-0.2 bg-[#00e5be]/20 text-[#00e5be] rounded text-[9px] font-mono font-black uppercase">
                Ready for Manual QC
              </span>
            </div>
            <div className="text-[11px] text-slate-300 truncate mt-0.5">
              {qcNotification.message}
            </div>
            {isGenerating && (
              <div className="text-[10px] text-emerald-400/80 font-mono mt-0.5 flex items-center gap-1">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                <span>Next part processing concurrently in background...</span>
              </div>
            )}
          </div>
          <button
            onClick={() => setQcNotification(null)}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition shrink-0"
            title="Dismiss notification"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Subtitle & QC Settings Modal ── */}
      <SubtitleSettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
        isDark={isDark}
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
        setLanguage={setLanguage}
        script={script}
        setScript={setScript}
        contentType={contentType}
        setContentType={setContentType}
        sdhMode={sdhMode}
        setSdhMode={setSdhMode}
        geminiAutoFix={geminiAutoFix}
        setGeminiAutoFix={setGeminiAutoFix}
        onApply={() => {
          if (events && events.length > 0) {
            handleLint(events);
          }
        }}
      />

      {/* ── Export Deliverables Modal ── */}
      {showExportModal && (
        <SubtitleExportModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          events={events}
          complianceScore={complianceScore}
          filename={selectedFile?.name || 'subtitles'}
          API_BASE={API_BASE}
        />
      )}

      {/* ── Auto-Fix Diff Comparison Modal ── */}
      {showDiffModal && (
        <SubtitleDiffModal
          isOpen={showDiffModal}
          onClose={() => setShowDiffModal(false)}
          originalEvents={originalEvents}
          fixedEvents={events}
          onAccept={() => setShowDiffModal(false)}
          onReject={() => {
            setEvents(originalEvents);
            setShowDiffModal(false);
          }}
        />
      )}

      {/* ── Custom Timeline Time Resume Modal ── */}
      <CustomTimeResumeModal
        isOpen={showCustomTimeModal}
        onClose={() => setShowCustomTimeModal(false)}
        targetTime={customStartTime}
        playheadTime={currentTime}
        videoDuration={videoDuration}
        events={events}
        onStartGeneration={handleStartGenerationFromCustomTime}
      />
    </div>
  );
}
