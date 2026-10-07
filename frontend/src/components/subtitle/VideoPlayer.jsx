import { publishPlayhead, subscribePlayhead } from '../../utils/playheadBus';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize, Minimize, 
  StepBack, StepForward, Grid, Eye, EyeOff, RotateCcw, Volume1, Repeat,
  Upload, Film, ChevronFirst, ChevronLast,
  ArrowUpDown, Camera, ChevronDown, Crop, Layers, Sparkles
} from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';


// Cue under time t using half-open [start, end) so touching cues never resolve to the previous one.
// Prefers the currently selected cue when it contains t.
function findCueAt(events, t, preferId = null) {
  if (!events || events.length === 0) return null;
  const contains = (e) => {
    const st = e.start_time ?? e.start ?? 0;
    const en = e.end_time ?? e.end ?? 0;
    return t >= st && t < en;
  };
  if (preferId != null) {
    const pref = events.find(e => (e.id ?? e.event_id) === preferId);
    if (pref && contains(pref)) return pref;
  }
  return events.find(contains) || null;
}

// True while the user is typing somewhere (e.g. editing a subtitle), so playback doesn't move the selection under them
function isTypingInField() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName?.toLowerCase();
  return tag === 'textarea' || tag === 'input' || tag === 'select' || el.isContentEditable;
}

export default function VideoPlayer({
  videoUrl,
  audioUrl = null,
  onOpenFilePicker = null,
  onFileSelect = null,
  events = [],
  activeEventId = null,
  setActiveEventId = () => {},
  playTarget = null,
  onTimeUpdate = () => {},
  frameRate = 24,
  theme = 'light', // 'light' | 'dark'
  isAudio = false,
  subtitleStyle = null,
  onUpdateSubtitleStyle = null,
  seekStep = 2,
}) {
  const themeContext = useTheme();
  const isDark = true;

  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const containerRef = useRef(null);
  const loopRef = useRef(null);
  const animFrameRef = useRef(null);

  const isAudioMode = isAudio || /\.(mp3|wav|m4a|aac|flac|ogg|opus|wma)(\?.*)?$/i.test(videoUrl || '');

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [volume, setVolume] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [videoDims, setVideoDims] = useState(null); // real width × height from metadata
  const [currentSubtitle, setCurrentSubtitle] = useState(null);
  const [showTitleSafe, setShowTitleSafe] = useState(false);
  const [subtitlePosition, setSubtitlePosition] = useState('bottom'); // 'bottom' | 'top'
  const [subtitleFontSize, setSubtitleFontSize] = useState(24); // px relative

  const [hoverTime, setHoverTime] = useState(null);
  const [hoverPosition, setHoverPosition] = useState(0);

  const activeEventIdRef = useRef(activeEventId);
  activeEventIdRef.current = activeEventId;

  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;

  const setActiveEventIdRef = useRef(setActiveEventId);
  setActiveEventIdRef.current = setActiveEventId;

  const eventsRef = useRef(events);
  eventsRef.current = events;

  const lastActiveSubtitleIdRef = useRef(null);
  const lastRenderedTimeRef = useRef(0);

  // Format SMPTE Timecode HH:MM:SS:FF
  const formatSMPTE = useCallback((seconds) => {
    if (isNaN(seconds) || seconds == null) return "00:00:00:00";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const f = Math.floor((seconds % 1) * frameRate);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}:${f.toString().padStart(2, '0')}`;
  }, [frameRate]);

  // Format Milliseconds HH:MM:SS.mmm
  const formatMillis = useCallback((seconds) => {
    if (isNaN(seconds) || seconds == null) return "00:00:00.000";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  }, []);

  const togglePlay = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().catch(e => console.error("Playback failed:", e));
      if (audioRef.current && audioUrl && !isAudioMode) {
        audioRef.current.currentTime = videoRef.current.currentTime;
        audioRef.current.play().catch(() => {});
      }
    } else {
      videoRef.current.pause();
      if (audioRef.current && audioUrl && !isAudioMode) {
        audioRef.current.pause();
      }
    }
  }, [audioUrl, isAudioMode]);

  // Global Keyboard Shortcuts (Space, Left/Right 2s, comma/period frame step, L loop)
  const handleKeyDown = useCallback((e) => {
    if (!videoRef.current) return;
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag)) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        togglePlay();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        const prevT = Math.max(0, videoRef.current.currentTime - seekStep);
        videoRef.current.currentTime = prevT;
        if (audioRef.current && audioUrl) audioRef.current.currentTime = prevT;
        break;
      case 'ArrowRight':
        e.preventDefault();
        const nextT = Math.min(duration, videoRef.current.currentTime + seekStep);
        videoRef.current.currentTime = nextT;
        if (audioRef.current && audioUrl) audioRef.current.currentTime = nextT;
        break;
      case ',':
      case '<':
        e.preventDefault();
        const prevFrame = Math.max(0, videoRef.current.currentTime - (1 / frameRate));
        videoRef.current.currentTime = prevFrame;
        if (audioRef.current && audioUrl) audioRef.current.currentTime = prevFrame;
        break;
      case '.':
      case '>':
        e.preventDefault();
        const nextFrame = Math.min(duration, videoRef.current.currentTime + (1 / frameRate));
        videoRef.current.currentTime = nextFrame;
        if (audioRef.current && audioUrl) audioRef.current.currentTime = nextFrame;
        break;
      case 'l':
      case 'L':
        e.preventDefault();
        if (activeEventId) {
          const ev = events.find(x => (x.id === activeEventId || x.event_id === activeEventId));
          if (ev) {
            const st = ev.start_time ?? ev.start ?? 0;
            const en = ev.end_time ?? ev.end ?? 0;
            videoRef.current.currentTime = st;
            if (audioRef.current && audioUrl) audioRef.current.currentTime = st;
            loopRef.current = { start: st, end: en };
            videoRef.current.play().catch(() => {});
            if (audioRef.current && audioUrl) audioRef.current.play().catch(() => {});
          }
        }
        break;
      default:
        break;
    }
  }, [duration, frameRate, togglePlay, activeEventId, events, audioUrl, seekStep]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Synchronize currentSubtitle immediately when events or currentTime change (e.g. paused seek) ──
  useEffect(() => {
    const t = videoRef.current ? videoRef.current.currentTime : currentTime;
    const currentEvents = eventsRef.current || events;
    if (!currentEvents || currentEvents.length === 0) {
      if (lastActiveSubtitleIdRef.current !== null) {
        lastActiveSubtitleIdRef.current = null;
        setCurrentSubtitle(null);
      }
      return;
    }
    const active = findCueAt(currentEvents, t, activeEventIdRef.current);
    const aId = active ? (active.id ?? active.event_id) : null;
    if (aId !== lastActiveSubtitleIdRef.current) {
      lastActiveSubtitleIdRef.current = aId;
      setCurrentSubtitle(active || null);
    } else if (active && active !== currentSubtitle) {
      setCurrentSubtitle(active); // same cue, edited text/timing: refresh the overlay live
    }
  }, [events, currentTime]);

  // Smooth Playback Loop & Meter (Decoupled from render cascades)
  useEffect(() => {
    let animId;
    if (isPlaying) {
      const loop = () => {
        if (videoRef.current) {
          const t = videoRef.current.currentTime;
          publishPlayhead(t); // every frame: timeline needle moves smoothly without React renders

          // 1. No React state per frame: the scrub bar, timeline needle, list and timecodes all follow the bus above.
          //    Only the audio-only spectrum animation needs renders, and ~8 per second is enough for it.
          if (isAudioMode && Math.abs(t - lastRenderedTimeRef.current) >= 0.12) {
            lastRenderedTimeRef.current = t;
            setCurrentTime(t);
          }

          // 4. Enforce Loop Mode
          if (loopRef.current && loopRef.current.end !== undefined) {
            if (t >= loopRef.current.end) {
              videoRef.current.currentTime = loopRef.current.start || 0;
              if (audioRef.current && audioUrl) {
                audioRef.current.currentTime = loopRef.current.start || 0;
              }
            }
          }

          // 5. Resync audio track drift if out of sync (> 120ms)
          if (audioRef.current && audioUrl && !videoRef.current.paused) {
            if (Math.abs(audioRef.current.currentTime - t) > 0.12) {
              audioRef.current.currentTime = t;
            }
          }

          // 6. Cue under the playhead: drives the overlay and selects that cue, so the list and timeline follow
          //    playback. Runs only when the cue changes. Gaps keep the last selection; typing is never interrupted.
          const currentEvents = eventsRef.current;
          if (currentEvents && currentEvents.length > 0) {
            const active = findCueAt(currentEvents, t);
            const aId = active ? (active.id ?? active.event_id) : null;
            if (aId !== lastActiveSubtitleIdRef.current) {
              lastActiveSubtitleIdRef.current = aId;
              setCurrentSubtitle(active || null);
              if (aId != null && aId !== activeEventIdRef.current && !isTypingInField()) {
                setActiveEventIdRef.current?.(aId);
              }
            }
          } else if (lastActiveSubtitleIdRef.current !== null) {
            lastActiveSubtitleIdRef.current = null;
            setCurrentSubtitle(null);
          }
        }
        animId = requestAnimationFrame(loop);
      };
      animId = requestAnimationFrame(loop);
    } else if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isPlaying, audioUrl, isAudioMode]);

  // Scrub bar follows the playhead bus every frame by writing styles directly (no React renders)
  const progressFillRef = useRef(null);
  const progressThumbRef = useRef(null);
  useEffect(() => subscribePlayhead((t) => {
    const pct = duration > 0 ? `${Math.max(0, Math.min(100, (t / duration) * 100))}%` : '0%';
    if (progressFillRef.current) progressFillRef.current.style.width = pct;
    if (progressThumbRef.current) progressThumbRef.current.style.left = pct;
  }), [duration]);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    const t = videoRef.current.currentTime;
    
    // When playing, the requestAnimationFrame loop handles smooth throttled updates.
    // When paused or seeking, update immediately:
    if (!isPlaying) {
      publishPlayhead(t);
      setCurrentTime(t);
      onTimeUpdateRef.current?.(t);

      const currentEvents = eventsRef.current;
      if (currentEvents && currentEvents.length > 0) {
        const active = findCueAt(currentEvents, t, activeEventIdRef.current);
        const aId = active ? (active.id ?? active.event_id) : null;
        if (aId !== lastActiveSubtitleIdRef.current) {
          lastActiveSubtitleIdRef.current = aId;
          setCurrentSubtitle(active || null);
          if (aId && aId !== activeEventIdRef.current) {
            setActiveEventIdRef.current?.(aId);
          }
        }
      } else if (lastActiveSubtitleIdRef.current !== null) {
        lastActiveSubtitleIdRef.current = null;
        setCurrentSubtitle(null);
      }
    }
  }, [isPlaying]);

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      const { videoWidth, videoHeight } = videoRef.current;
      setVideoDims(videoWidth && videoHeight ? { w: videoWidth, h: videoHeight } : null);
    }
  };

  useEffect(() => {
    if (playTarget && videoRef.current) {
      const video = videoRef.current;
      if (playTarget.pause) {
        video.pause();
        if (audioRef.current && audioUrl) audioRef.current.pause();
        if (playTarget.time !== undefined) {
          video.currentTime = playTarget.time;
          if (audioRef.current && audioUrl) audioRef.current.currentTime = playTarget.time;
          setCurrentTime(playTarget.time);
          publishPlayhead(playTarget.time);
        }
        loopRef.current = null;
      } else {
        if (playTarget.time !== undefined) {
          video.currentTime = playTarget.time;
          if (audioRef.current && audioUrl) audioRef.current.currentTime = playTarget.time;
          setCurrentTime(playTarget.time);
          publishPlayhead(playTarget.time);
        }
        if (playTarget.endTime !== undefined) {
          loopRef.current = { start: playTarget.time || 0, end: playTarget.endTime };
        } else {
          loopRef.current = null;
        }
        video.play().catch(e => console.log('playback error', e));
        if (audioRef.current && audioUrl) {
          audioRef.current.play().catch(() => {});
        }
      }
    }
  }, [playTarget, audioUrl]);

  // Keep volume, muted, and playbackRate in sync with audioRef
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = isMuted;
      audioRef.current.playbackRate = playbackRate;
    }
  }, [volume, isMuted, playbackRate]);

  // Fullscreen support
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => console.error(err));
    } else {
      document.exitFullscreen().catch(err => console.error(err));
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const cyclePlaybackRate = () => {
    const rates = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
    const currentIndex = rates.indexOf(playbackRate);
    const nextRate = rates[(currentIndex + 1) % rates.length];
    setPlaybackRate(nextRate);
    if (videoRef.current) {
      videoRef.current.playbackRate = nextRate;
    }
    if (audioRef.current && audioUrl) {
      audioRef.current.playbackRate = nextRate;
    }
  };

  const handleProgressClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    if (videoRef.current) {
      const targetTime = percentage * duration;
      videoRef.current.currentTime = targetTime;
      if (audioRef.current && audioUrl) {
        audioRef.current.currentTime = targetTime;
      }
    }
  };

  const handleProgressMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    setHoverPosition(x);
    setHoverTime(percentage * duration);
  };

  // Helper: Detect whether background color is light for smart black/white contrast
  const isColorLight = (c) => {
    if (!c || c === 'transparent') return false;
    const match = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
    if (match) {
      const r = parseInt(match[1], 10);
      const g = parseInt(match[2], 10);
      const b = parseInt(match[3], 10);
      return (r * 299 + g * 587 + b * 114) / 1000 > 140;
    }
    let hex = c.replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(x => x + x).join('');
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return (r * 299 + g * 587 + b * 114) / 1000 > 140;
    }
    return false;
  };

  // Render Netflix Subtitle Typography with MS Word Formatting Support
  const renderSubtitleText = (text, isHighlighted, subtitleObj = null) => {
    if (!text) return null;
    const lines = text.split('\n');

    const fontFamily = subtitleObj?.style?.fontFamily || subtitleStyle?.fontFamily || 'Netflix Sans, Roboto, Helvetica, Arial, sans-serif';
    const fontSize = subtitleObj?.style?.fontSize || subtitleStyle?.fontSize || subtitleFontSize;
    const effectiveBg = subtitleObj?.bgColor || subtitleObj?.style?.bgColor || subtitleStyle?.bgColor || 'rgba(0,0,0,0.6)';
    const isBgLight = isColorLight(effectiveBg);

    let textColor = subtitleObj?.style?.textColor || subtitleStyle?.textColor || (isBgLight ? '#000000' : '#ffffff');
    // If background is light and global text color is white, automatically enforce black text for contrast
    if (isBgLight && (textColor.toLowerCase() === '#ffffff' || textColor.toLowerCase() === '#fff')) {
      textColor = '#000000';
    }

    const textAlign = subtitleStyle?.textAlign || 'center';
    const isBold = subtitleStyle?.isBold || false;
    const isItalicGlobal = subtitleStyle?.isItalic || false;
    const isUnderlineGlobal = subtitleStyle?.isUnderline || false;
    const isStrikethroughGlobal = subtitleStyle?.isStrikethrough || false;

    let textShadow = '0 2px 4px rgba(0,0,0,0.95), -1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000';
    if (isBgLight || textColor === '#000000' || textColor === 'var(--kt-s1)' || subtitleStyle?.textShadow === 'none') {
      textShadow = 'none';
    } else if (subtitleStyle?.textShadow === 'shadow') {
      textShadow = '0 3px 6px rgba(0,0,0,0.9)';
    }

    return (
      <div 
        className={`transition-all duration-150 select-none ${
          textAlign === 'left' ? 'text-left' : textAlign === 'right' ? 'text-right' : 'text-center'
        } ${isHighlighted ? 'drop-shadow-[0_0_12px_rgba(52,211,153,0.9)]' : ''}`}
        style={{ 
          textShadow,
          fontFamily,
          lineHeight: '1.25',
          fontSize: `${fontSize}px`,
          color: textColor,
          fontWeight: isBold ? 'bold' : 'normal',
          fontStyle: isItalicGlobal ? 'italic' : 'normal',
          textDecoration: [
            isUnderlineGlobal ? 'underline' : '',
            isStrikethroughGlobal ? 'line-through' : ''
          ].filter(Boolean).join(' ') || 'none'
        }}
      >
        {lines.map((line, i) => {
          const isDual = line.trim().startsWith('-');
          const tagRegex = /(<\/?(?:b|i|u|s|strike|font)(?:\s+color=["']?([^"'>]+)["']?)?>)/gi;
          const tokens = line.split(tagRegex);

          let curB = isBold;
          let curI = isItalicGlobal;
          let curU = isUnderlineGlobal;
          let curS = isStrikethroughGlobal;
          let curColor = textColor;

          const renderedParts = [];

          for (let idx = 0; idx < tokens.length; idx++) {
            const token = tokens[idx];
            if (!token) continue;

            const lower = token.toLowerCase();
            if (lower === '<b>') { curB = true; continue; }
            if (lower === '</b>') { curB = isBold; continue; }
            if (lower === '<i>') { curI = true; continue; }
            if (lower === '</i>') { curI = isItalicGlobal; continue; }
            if (lower === '<u>') { curU = true; continue; }
            if (lower === '</u>') { curU = isUnderlineGlobal; continue; }
            if (lower === '<s>' || lower === '<strike>') { curS = true; continue; }
            if (lower === '</s>' || lower === '</strike>') { curS = isStrikethroughGlobal; continue; }
            if (lower.startsWith('<font')) {
              const colorMatch = token.match(/color=["']?([^"'>\s]+)["']?/i);
              if (colorMatch && colorMatch[1]) {
                curColor = colorMatch[1];
              }
              continue;
            }
            if (lower === '</font>') {
              curColor = textColor;
              continue;
            }
            if (idx > 0 && tokens[idx - 1] && tokens[idx - 1].toLowerCase().startsWith('<font')) {
              continue;
            }

            let textPart = token.replace(/♪/g, ' ♪ ');
            renderedParts.push(
              <span 
                key={idx} 
                style={{
                  fontWeight: curB ? 'bold' : 'normal',
                  fontStyle: curI ? 'italic' : 'normal',
                  textDecoration: [
                    curU ? 'underline' : '',
                    curS ? 'line-through' : ''
                  ].filter(Boolean).join(' ') || 'none',
                  color: curColor
                }}
              >
                {textPart}
              </span>
            );
          }

          return (
            <div 
              key={i} 
              className={`inline-block mx-auto relative px-2.5 py-0.5 rounded-none transition-all duration-150 ${
                isCurrentActive 
                  ? 'ring-1 ring-white/30 shadow-[0_0_15px_rgba(0,0,0,0.5)]' 
                  : ''
              } ${isDual ? 'text-amber-100 font-medium' : 'font-medium'}`}
              style={{
                backgroundColor: effectiveBg === 'transparent' ? 'transparent' : effectiveBg
              }}
            >
              {renderedParts}
            </div>
          );
        })}
      </div>
    );
  };

  const isCurrentActive = currentSubtitle && (currentSubtitle.id === activeEventId || currentSubtitle.event_id === activeEventId);

  return (
    <div 
      ref={containerRef}
      tabIndex={0}
      className={`relative rounded-none overflow-hidden flex flex-col group focus:outline-none border w-full h-full transition-colors ${
        'bg-[var(--ss-bg)] border-[var(--ss-line)]'
      }`}
    >
      {/* Program Monitor Header HUD - Reference Image Style */}
      <div className={`px-3 py-2 border-b flex items-center justify-between text-xs shrink-0 z-20 select-none ${
        'bg-[var(--ss-panel)] border-[var(--ss-line)] text-slate-300'
      }`}>
        <div className="flex items-center gap-2">
          {/* Framerate */}
          <span className="font-mono text-[11px] text-slate-400 font-semibold px-1.5 py-0.5">
            {Number(frameRate).toFixed(2)} FPS
          </span>

          {/* Resolution */}
          {videoDims && !isAudioMode && (
            <span className="font-mono text-[11px] text-slate-400 font-semibold px-1.5 py-0.5">
              {videoDims.w} × {videoDims.h}
            </span>
          )}
        </div>

        {/* Right side: Safe Areas Toggle switch & Fit dropdown */}
        <div className="flex items-center gap-3">
          {/* Safe Areas Switch Toggle */}
          <button
            type="button"
            onClick={() => setShowTitleSafe(v => !v)}
            className="flex items-center gap-2 cursor-pointer"
            title="Show the Netflix action-safe / title-safe guides"
          >
            <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${showTitleSafe ? 'bg-[var(--ss-accent)]' : 'bg-[var(--ss-line)]'}`}>
              <div className={`w-3 h-3 rounded-full bg-white transition-transform ${showTitleSafe ? 'translate-x-4' : 'translate-x-0'}`} />
            </div>
            <span className="text-[11px] font-semibold text-slate-300">Safe Areas</span>
          </button>
        </div>
      </div>

      {/* Center Video / Audio Stage */}
      <div className={`relative w-full flex-grow flex items-center justify-center min-h-[220px] overflow-hidden select-none transition-colors ${
        'bg-black'
      }`}>
        {videoUrl ? (
          <>
            <video
              ref={videoRef}
              src={(isAudioMode && audioUrl) ? audioUrl : videoUrl}
              muted={Boolean(audioUrl && !isAudioMode) || isMuted}
              className={isAudioMode ? "hidden" : "w-full h-full object-contain cursor-pointer"}
              onClick={togglePlay}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={() => {
                setIsPlaying(true);
                if (audioRef.current && audioUrl && !isAudioMode) {
                  audioRef.current.currentTime = videoRef.current?.currentTime || 0;
                  audioRef.current.play().catch(() => {});
                }
              }}
              onPause={() => {
                setIsPlaying(false);
                if (audioRef.current && audioUrl && !isAudioMode) {
                  audioRef.current.pause();
                }
              }}
              onEnded={() => {
                setIsPlaying(false);
                loopRef.current = null;
                if (audioRef.current && audioUrl && !isAudioMode) {
                  audioRef.current.pause();
                }
              }}
              onVolumeChange={(e) => {
                if (!audioUrl || isAudioMode) {
                  setIsMuted(e.target.muted);
                  setVolume(e.target.volume);
                }
              }}
            />

            {/* Synchronized Master Audio Stream (for video + external audio track) */}
            {audioUrl && !isAudioMode && (
              <audio
                ref={audioRef}
                src={audioUrl}
                preload="auto"
                style={{ display: 'none' }}
              />
            )}

            {/* Dedicated Pro Studio Audio Deck & Equalizer Spectrum */}
            {isAudioMode && (
              <div 
                onClick={togglePlay}
                className="w-full h-full flex flex-col items-center justify-center cursor-pointer bg-radial from-[var(--kt-s2)] via-[var(--kt-s0)] to-[var(--kt-s0)] select-none p-6 relative overflow-hidden"
              >
                {/* Background Ambient Glow */}
                <div className={`absolute w-72 h-72 rounded-none blur-3xl pointer-events-none transition-all duration-500 ${
                  isPlaying ? 'bg-[var(--kt-info)]/10 scale-110' : 'bg-slate-800/10 scale-90'
                }`} />

                {/* Animated Spectrum Waveform Bars */}
                <div className="flex items-end gap-1.5 h-24 mb-6 px-5 py-3 rounded-none bg-[var(--kt-s1)]/90 border border-[var(--kt-s4)] shadow-2xl backdrop-blur-sm z-0">
                  {[...Array(24)].map((_, idx) => {
                    const baseHeight = 15 + Math.sin(idx * 0.45) * 12;
                    const animatedHeight = isPlaying 
                      ? Math.max(12, Math.min(95, Math.sin((currentTime * 7) + (idx * 0.6)) * 40 + baseHeight + 25))
                      : Math.max(8, baseHeight);
                    return (
                      <div
                        key={idx}
                        className="w-1.5 rounded-none transition-all duration-150 ease-linear"
                        style={{
                          height: `${animatedHeight}%`,
                          backgroundColor: isPlaying ? 'var(--kt-info)' : '#475569',
                          boxShadow: isPlaying ? '0 0 10px rgba(var(--kt-accent-rgb),0.45)' : 'none',
                          opacity: isPlaying ? 0.75 + (Math.sin(idx + currentTime * 4) * 0.25) : 0.4,
                        }}
                      />
                    );
                  })}
                </div>

                {/* Audio Master Badge */}
                <div className="flex items-center gap-2 px-3 py-1 rounded-none bg-[var(--ss-panel)] border border-[var(--kt-s4)] text-[11px] font-mono text-blue-300 shadow-sm z-0">
                  <Volume2 className={`w-3.5 h-3.5 ${isPlaying ? 'text-[var(--kt-info)] animate-pulse' : 'text-slate-500'}`} />
                  <span className="font-bold tracking-wider">AUDIO MONITOR</span>
                  <span className="text-slate-600">|</span>
                  <span className="text-slate-400 font-sans">STEREO PCM</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div 
            onClick={onOpenFilePicker}
            onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                onFileSelect?.(e.dataTransfer.files[0]);
              }
            }}
            className={`flex flex-col items-center justify-center gap-3 p-8 text-center cursor-pointer transition-all border-2 border-dashed m-6 rounded-none ${
              'border-[var(--ss-line)] hover:border-[var(--ss-accent)]/50 bg-[var(--kt-s1)]/60 hover:bg-[var(--ss-panel)]'
            }`}
          >
            <div className={`w-14 h-14 rounded-none border flex items-center justify-center transition-all ${
              'bg-[var(--kt-s2)] border-[var(--kt-s5)] text-[var(--ss-accent)] shadow-[0_0_20px_rgba(var(--kt-accent-rgb),0.15)]'
            }`}>
              <Upload className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <p className={`text-sm font-bold text-slate-200`}>
                Import Video or Audio Media
              </p>
              <p className={`text-xs max-w-sm text-slate-400`}>
                Drag & drop or click to select MP4, MKV, MOV, WebM, WAV, MP3. Audio waveforms & speech sync are automatically extracted.
              </p>
            </div>
            {onOpenFilePicker && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onOpenFilePicker(); }}
                className="mt-1 px-4 py-1.5 rounded-none text-xs font-semibold bg-gradient-to-r from-blue-500 to-blue-500 text-black hover:opacity-90 transition-opacity shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <Film className="w-3.5 h-3.5" />
                <span>Browse Media</span>
              </button>
            )}
          </div>
        )}

        {/* Floating Vertical Tool Strip on Right Side of Video Canvas */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex flex-col gap-1.5 p-1 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 z-20 select-none">
          <button
            type="button"
            onClick={() => {
              if (videoRef.current) {
                const canvas = document.createElement('canvas');
                canvas.width = videoRef.current.videoWidth || 1920;
                canvas.height = videoRef.current.videoHeight || 1080;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
                const a = document.createElement('a');
                a.href = canvas.toDataURL('image/jpeg', 0.95);
                a.download = `snapshot_${formatSMPTE(videoRef.current.currentTime).replace(/[:.]/g, '-')}.jpg`;
                a.click();
              }
            }}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
            title="Save this frame as a JPEG image"
          >
            <Camera size={14} />
          </button>
          <button
            type="button"
            onClick={() => setSubtitlePosition(subtitlePosition === 'bottom' ? 'top' : 'bottom')}
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/15 transition-colors cursor-pointer"
            title={subtitlePosition === 'bottom' ? 'Move subtitle preview to the top' : 'Move subtitle preview to the bottom'}
          >
            <ArrowUpDown size={14} />
          </button>
        </div>

        {/* Netflix Title-Safe Grid Box Overlay */}
        {showTitleSafe && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            {/* 90% Action Safe */}
            <div className="w-[90%] h-[90%] border border-[var(--ss-accent)]/30 border-dashed rounded-lg flex items-center justify-center relative">
              <span className="absolute top-1 left-1.5 text-[8px] font-mono text-[var(--ss-accent)]/60 bg-black/50 px-1 rounded">
                90% ACTION SAFE
              </span>
              {/* 80% Title Safe */}
              <div className="w-[88%] h-[88%] border border-amber-400/40 border-dashed rounded-md relative">
                <span className="absolute bottom-1 right-1.5 text-[8px] font-mono text-amber-400/70 bg-black/50 px-1 rounded">
                  80% NETFLIX TITLE SAFE
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Live Subtitle Overlay - Modern Pill Card Style matching reference */}
        <div 
          className={`absolute left-0 right-0 px-8 pointer-events-none flex flex-col items-center justify-center z-10 transition-all ${
            subtitlePosition === 'top' ? 'top-[8%]' : 'bottom-[7%]'
          }`}
        >
          {currentSubtitle?.text && (
            <div className="ss-script bg-black/70 text-white px-3 py-1 rounded-md text-[clamp(14px,1.6vw,22px)] font-medium text-center max-w-[85%] leading-snug whitespace-pre-line [text-shadow:0_1px_2px_rgba(0,0,0,0.8)]">
              {currentSubtitle.text.replace(/<[^>]+>/g, '')}
            </div>
          )}
        </div>

        {/* Loop Banner */}
        {loopRef.current && (
          <div className="absolute top-3 left-3 bg-[var(--ss-accent)] text-[var(--ss-accent-ink)] text-[10px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-md z-20 backdrop-blur-xs">
            <Repeat className="w-3 h-3" />
            <span>Looping subtitle {(events.findIndex(e => (e.id ?? e.event_id) === activeEventId) + 1) || ''}</span>
          </div>
        )}
      </div>

      {/* ── Modern Pro Transport & Scrub Bar matching reference image ── */}
      <div className={`p-2.5 flex flex-col gap-2 relative z-20 shrink-0 border-t select-none ${
        'bg-[var(--ss-panel)] text-white border-[var(--ss-line)]'
      }`}>
        {/* Scrubber Progress Bar with Circular Blue Thumb */}
        <div 
          className="w-full h-1.5 hover:h-2 cursor-pointer relative rounded-full transition-all group/progress bg-[var(--kt-s4)]"
          onClick={handleProgressClick}
          onMouseMove={handleProgressMouseMove}
          onMouseLeave={() => setHoverTime(null)}
        >
          <div 
            ref={progressFillRef}
            className="h-full rounded-full pointer-events-none bg-[var(--ss-accent)]"
          />
          {/* Circular Scrubber Thumb */}
          <div 
            ref={progressThumbRef}
            className="absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white border-2 border-[var(--ss-accent)] rounded-full shadow-md pointer-events-none transform -translate-x-1/2"
          />
          {hoverTime !== null && (
            <div 
              className="absolute -top-7 border text-[10px] font-mono px-2 py-0.5 rounded-md shadow-lg pointer-events-none transform -translate-x-1/2 whitespace-nowrap hidden group-hover/progress:block z-30 bg-[var(--ss-panel)] border-[var(--ss-line)] text-white font-bold"
              style={{ left: `${hoverPosition}px` }}
            >
              {formatSMPTE(hoverTime)}
            </div>
          )}
        </div>

        {/* Transport Row Controls: Play, Prev, Next, Volume, Speed, Fullscreen */}
        <div className="flex items-center justify-between gap-3">
          {/* Left Controls: Play, Skip Prev, Skip Next */}
          <div className="flex items-center gap-2">
            {/* Play/Pause Button */}
            <button 
              onClick={togglePlay} 
              className="w-7 h-7 rounded-lg flex items-center justify-center transition-all cursor-pointer text-slate-200 hover:text-white hover:bg-white/10"
              title="Play / Pause (Space)"
            >
              {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
            </button>

            {/* Prev Subtitle */}
            <button 
              onClick={() => {
                if (!events.length) return;
                let idx = events.findIndex(x => (x.id === activeEventId || x.event_id === activeEventId));
                if (idx === -1) {
                  const t = videoRef.current?.currentTime ?? currentTime;
                  idx = events.findIndex(x => (x.start_time ?? x.start ?? 0) >= t - 0.001);
                  if (idx === -1) idx = events.length;
                }
                if (idx > 0) {
                  const prevEv = events[idx - 1];
                  const s = prevEv.start_time ?? prevEv.start ?? 0;
                  setActiveEventId(prevEv.id ?? prevEv.event_id);
                  if (videoRef.current) videoRef.current.currentTime = s;
                }
              }}
              className="p-1 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
              title="Previous Subtitle"
            >
              <SkipBack size={15} />
            </button>

            {/* Next Subtitle */}
            <button 
              onClick={() => {
                if (!events.length) return;
                let idx = events.findIndex(x => (x.id === activeEventId || x.event_id === activeEventId));
                if (idx === -1) {
                  const t = videoRef.current?.currentTime ?? currentTime;
                  idx = events.findIndex(x => (x.start_time ?? x.start ?? 0) > t + 0.001) - 1;
                  if (idx < -1) idx = events.length - 1;
                }
                if (idx < events.length - 1) {
                  const nextEv = events[idx + 1];
                  const s = nextEv.start_time ?? nextEv.start ?? 0;
                  setActiveEventId(nextEv.id ?? nextEv.event_id);
                  if (videoRef.current) videoRef.current.currentTime = s;
                }
              }}
              className="p-1 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
              title="Next Subtitle"
            >
              <SkipForward size={15} />
            </button>

            {/* Volume Control */}
            <div className="flex items-center gap-1.5 ml-2">
              <button 
                onClick={() => { 
                  if (videoRef.current) { 
                    const m = !isMuted; 
                    setIsMuted(m); 
                    videoRef.current.muted = m; 
                  } 
                }} 
                className="text-slate-300 hover:text-white cursor-pointer"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0 ? <VolumeX size={15} className="text-rose-400" /> : <Volume2 size={15} />}
              </button>
              <input 
                type="range"
                aria-label="Volume" 
                min="0" max="1" step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  setVolume(v);
                  setIsMuted(v === 0);
                  if (videoRef.current) {
                    videoRef.current.volume = v;
                    videoRef.current.muted = v === 0;
                  }
                }}
                className="w-16 h-1 rounded-full appearance-none cursor-pointer bg-slate-600 accent-[var(--ss-accent)]"
              />
              <Volume1 size={14} className="text-slate-500" />
            </div>
          </div>

          {/* Right Controls: Speed 1x, Aspect, Fullscreen */}
          <div className="flex items-center gap-2">
            {/* Playback Speed Dropdown */}
            <button 
              onClick={cyclePlaybackRate} 
              className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ss-raised)] border border-[var(--ss-line)] text-[11px] font-semibold text-slate-200 hover:text-white cursor-pointer"
              title="Playback speed (click to change)"
            >
              <span>{playbackRate}x</span>
            </button>


            {/* Fullscreen */}
            <button 
              onClick={toggleFullscreen} 
              className="p-1 text-slate-300 hover:text-white cursor-pointer"
              title="Fullscreen"
            >
              {isFullscreen ? <Minimize size={15} /> : <Maximize size={15} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
