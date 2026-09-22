import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize, Minimize, 
  StepBack, StepForward, Grid, Eye, EyeOff, RotateCcw, Volume1, Repeat
} from 'lucide-react';

export default function VideoPlayer({
  videoUrl,
  events = [],
  activeEventId = null,
  setActiveEventId = () => {},
  playTarget = null,
  onTimeUpdate = () => {},
  frameRate = 24,
  theme = 'dark', // 'dark' | 'light'
  isAudio = false,
  subtitleStyle = null,
  onUpdateSubtitleStyle = null,
}) {
  const videoRef = useRef(null);
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
  const [currentSubtitle, setCurrentSubtitle] = useState(null);
  const [showTitleSafe, setShowTitleSafe] = useState(false);
  const [subtitlePosition, setSubtitlePosition] = useState('bottom'); // 'bottom' | 'top'
  const [subtitleFontSize, setSubtitleFontSize] = useState(24); // px relative
  const [audioLevel, setAudioLevel] = useState(0); // for fake/real VU meter

  const [hoverTime, setHoverTime] = useState(null);
  const [hoverPosition, setHoverPosition] = useState(0);

  const activeEventIdRef = useRef(activeEventId);
  activeEventIdRef.current = activeEventId;

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
    } else {
      videoRef.current.pause();
    }
  }, []);

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
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 2);
        break;
      case 'ArrowRight':
        e.preventDefault();
        videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 2);
        break;
      case ',':
      case '<':
        e.preventDefault();
        videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - (1 / frameRate));
        break;
      case '.':
      case '>':
        e.preventDefault();
        videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + (1 / frameRate));
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
            loopRef.current = { start: st, end: en };
            videoRef.current.play().catch(() => {});
          }
        }
        break;
      default:
        break;
    }
  }, [duration, frameRate, togglePlay, activeEventId, events]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Synchronize currentSubtitle immediately when events or currentTime change (even when paused) ──
  useEffect(() => {
    const t = videoRef.current ? videoRef.current.currentTime : currentTime;
    if (!events || events.length === 0) {
      setCurrentSubtitle(null);
      return;
    }
    const active = events.find(e => {
      const st = e.start_time !== undefined ? e.start_time : (e.start !== undefined ? e.start : 0);
      const en = e.end_time !== undefined ? e.end_time : (e.end !== undefined ? e.end : 0);
      return t >= st && t <= en;
    });
    setCurrentSubtitle(active || null);
  }, [events, currentTime]);

  // 60FPS Continuous Time Update & Meter Loop for Buttery Smooth Motion
  useEffect(() => {
    let animId;
    if (isPlaying) {
      const loop = () => {
        if (videoRef.current) {
          const t = videoRef.current.currentTime;
          setCurrentTime(t);
          onTimeUpdate(t);

          // Audio Meter jitter
          setAudioLevel(0.25 + Math.random() * 0.65);

          // Enforce Loop Mode
          if (loopRef.current && loopRef.current.end !== undefined) {
            if (t >= loopRef.current.end) {
              videoRef.current.currentTime = loopRef.current.start || 0;
            }
          }

          // Active subtitle lookup
          if (events && events.length > 0) {
            const active = events.find(e => {
              const st = e.start_time !== undefined ? e.start_time : (e.start !== undefined ? e.start : 0);
              const en = e.end_time !== undefined ? e.end_time : (e.end !== undefined ? e.end : 0);
              return t >= st && t <= en;
            });
            setCurrentSubtitle(active || null);
            if (active) {
              const aId = active.id ?? active.event_id;
              if (aId !== activeEventIdRef.current) {
                setActiveEventId(aId);
              }
            }
          } else {
            setCurrentSubtitle(null);
          }
        }
        animId = requestAnimationFrame(loop);
      };
      animId = requestAnimationFrame(loop);
    } else {
      setAudioLevel(0);
    }

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [isPlaying, events, onTimeUpdate, setActiveEventId]);

  const handleTimeUpdate = useCallback(() => {
    if (!videoRef.current) return;
    const t = videoRef.current.currentTime;
    setCurrentTime(t);
    onTimeUpdate(t);

    if (events && events.length > 0) {
      const active = events.find(e => {
        const st = e.start_time !== undefined ? e.start_time : (e.start !== undefined ? e.start : 0);
        const en = e.end_time !== undefined ? e.end_time : (e.end !== undefined ? e.end : 0);
        return t >= st && t <= en;
      });
      setCurrentSubtitle(active || null);
      if (active) {
        const aId = active.id ?? active.event_id;
        if (aId !== activeEventIdRef.current) {
          setActiveEventId(aId);
        }
      }
    } else {
      setCurrentSubtitle(null);
    }
  }, [events, onTimeUpdate, setActiveEventId]);

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
    }
  };

  useEffect(() => {
    if (playTarget && videoRef.current) {
      const video = videoRef.current;
      if (playTarget.pause) {
        video.pause();
        if (playTarget.time !== undefined) {
          video.currentTime = playTarget.time;
          setCurrentTime(playTarget.time);
        }
        loopRef.current = null;
      } else {
        if (playTarget.time !== undefined) {
          video.currentTime = playTarget.time;
          setCurrentTime(playTarget.time);
        }
        if (playTarget.endTime !== undefined) {
          loopRef.current = { start: playTarget.time || 0, end: playTarget.endTime };
        } else {
          loopRef.current = null;
        }
        video.play().catch(e => console.log('playback error', e));
      }
    }
  }, [playTarget]);

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
  };

  const handleProgressClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    if (videoRef.current) {
      videoRef.current.currentTime = percentage * duration;
    }
  };

  const handleProgressMouseMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = Math.max(0, Math.min(1, x / rect.width));
    setHoverPosition(x);
    setHoverTime(percentage * duration);
  };

  // Render Netflix Subtitle Typography with MS Word Formatting Support
  const renderSubtitleText = (text, isHighlighted) => {
    if (!text) return null;
    const lines = text.split('\n');

    const fontFamily = subtitleStyle?.fontFamily || 'Netflix Sans, Roboto, Helvetica, Arial, sans-serif';
    const fontSize = subtitleStyle?.fontSize || subtitleFontSize;
    const textColor = subtitleStyle?.textColor || '#ffffff';
    const bgColor = subtitleStyle?.bgColor || 'rgba(0,0,0,0.6)';
    const textAlign = subtitleStyle?.textAlign || 'center';
    const isBold = subtitleStyle?.isBold || false;
    const isItalicGlobal = subtitleStyle?.isItalic || false;
    const isUnderlineGlobal = subtitleStyle?.isUnderline || false;
    const isStrikethroughGlobal = subtitleStyle?.isStrikethrough || false;

    let textShadow = '0 2px 4px rgba(0,0,0,0.95), -1.5px -1.5px 0 #000, 1.5px -1.5px 0 #000, -1.5px 1.5px 0 #000, 1.5px 1.5px 0 #000';
    if (subtitleStyle?.textShadow === 'none') {
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
              className={`inline-block mx-auto relative ${
                isCurrentActive 
                  ? 'border-2 border-[#00e5ff] rounded px-2.5 py-0.5 shadow-[0_0_12px_rgba(0,229,255,0.4)]' 
                  : 'px-2 py-0.5 rounded'
              } ${isDual ? 'text-amber-100 font-medium' : 'font-medium'}`}
              style={{
                backgroundColor: bgColor === 'transparent' ? 'transparent' : (isCurrentActive ? 'rgba(0,0,0,0.75)' : bgColor)
              }}
            >
              {isCurrentActive && (
                <>
                  <div className="absolute -top-1 -left-1 w-2 h-2 rounded-full bg-[#00e5ff]" />
                  <div className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-[#00e5ff]" />
                  <div className="absolute -bottom-1 -left-1 w-2 h-2 rounded-full bg-[#00e5ff]" />
                  <div className="absolute -bottom-1 -right-1 w-2 h-2 rounded-full bg-[#00e5ff]" />
                </>
              )}
              {renderedParts}
            </div>
          );
        })}
      </div>
    );
  };

  const isDark = theme === 'dark';
  const isCurrentActive = currentSubtitle && (currentSubtitle.id === activeEventId || currentSubtitle.event_id === activeEventId);

  return (
    <div 
      ref={containerRef}
      tabIndex={0}
      className="relative rounded-lg overflow-hidden shadow-sm flex flex-col group focus:outline-none border w-full h-full transition-colors bg-[#0e0f12] border-[#262734]"
    >
      {/* Top Monitor Header HUD (CapCut Style) */}
      <div className="px-3 py-1 border-b flex items-center justify-between text-xs shrink-0 z-20 transition-colors bg-[#14151a] border-[#262734] text-slate-300">
        <div className="flex items-center gap-2">
          <span className="font-bold text-xs uppercase tracking-wider font-sans text-slate-200">Player</span>
          <span className="font-mono text-[10px] px-1.5 py-0.2 rounded border text-slate-400 bg-[#181920] border-[#262734]">
            {frameRate} FPS
          </span>
        </div>

        {/* Safe Area & Position Toggles */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowTitleSafe(!showTitleSafe)}
            className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer flex items-center gap-1 ${
              showTitleSafe 
                ? 'bg-[#00e5be]/20 border-[#00e5be] text-[#00e5be]' 
                : 'bg-[#181920] border-[#262734] text-slate-400 hover:text-white'
            }`}
            title="Toggle Netflix 90% Title-Safe Box"
          >
            <Grid className="w-3 h-3" />
            <span>Title Safe</span>
          </button>

          <button
            onClick={() => setSubtitlePosition(subtitlePosition === 'bottom' ? 'top' : 'bottom')}
            className="px-2 py-0.5 rounded text-[10px] font-bold border transition-colors cursor-pointer bg-[#181920] border-[#262734] text-slate-400 hover:text-white"
            title="Toggle Subtitle Top/Bottom Screen Position"
          >
            Pos: {subtitlePosition === 'bottom' ? 'Bottom 80%' : 'Top 20%'}
          </button>

          <div className="flex items-center gap-1 border rounded px-1.5 py-0.5 bg-[#181920] border-[#262734]">
            <span className="text-[10px] opacity-60">Size:</span>
            <button
              onClick={() => {
                const currentSz = subtitleStyle?.fontSize || subtitleFontSize;
                const newSz = Math.max(12, currentSz - 2);
                setSubtitleFontSize(newSz);
                if (onUpdateSubtitleStyle) onUpdateSubtitleStyle('fontSize', newSz);
              }}
              className="opacity-70 hover:opacity-100 text-xs px-0.5 font-bold cursor-pointer"
            >
              -
            </button>
            <span className="text-[10px] font-mono font-bold text-[#00e5be]">
              {subtitleStyle?.fontSize || subtitleFontSize}px
            </span>
            <button
              onClick={() => {
                const currentSz = subtitleStyle?.fontSize || subtitleFontSize;
                const newSz = Math.min(60, currentSz + 2);
                setSubtitleFontSize(newSz);
                if (onUpdateSubtitleStyle) onUpdateSubtitleStyle('fontSize', newSz);
              }}
              className="opacity-70 hover:opacity-100 text-xs px-0.5 font-bold cursor-pointer"
            >
              +
            </button>
          </div>
        </div>
      </div>

      {/* Center Video / Audio Stage */}
      <div className="relative w-full flex-grow flex items-center justify-center bg-black min-h-[220px] overflow-hidden select-none">
        {videoUrl ? (
          <>
            <video
              ref={videoRef}
              src={videoUrl}
              className={isAudioMode ? "hidden" : "w-full h-full object-contain cursor-pointer"}
              onClick={togglePlay}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onEnded={() => { setIsPlaying(false); loopRef.current = null; }}
              onVolumeChange={(e) => {
                setIsMuted(e.target.muted);
                setVolume(e.target.volume);
              }}
            />

            {/* Dedicated Pro Studio Audio Deck & Equalizer Spectrum */}
            {isAudioMode && (
              <div 
                onClick={togglePlay}
                className="w-full h-full flex flex-col items-center justify-center cursor-pointer bg-radial from-[#13151f] via-[#0d0e14] to-[#08080c] select-none p-6 relative overflow-hidden"
              >
                {/* Background Ambient Glow */}
                <div className={`absolute w-72 h-72 rounded-full blur-3xl pointer-events-none transition-all duration-500 ${
                  isPlaying ? 'bg-[#00e5ff]/10 scale-110' : 'bg-slate-800/10 scale-90'
                }`} />

                {/* Animated Spectrum Waveform Bars */}
                <div className="flex items-end gap-1.5 h-24 mb-6 px-5 py-3 rounded-2xl bg-[#12141c]/90 border border-[#232736] shadow-2xl backdrop-blur-sm z-0">
                  {[...Array(24)].map((_, idx) => {
                    const baseHeight = 15 + Math.sin(idx * 0.45) * 12;
                    const animatedHeight = isPlaying 
                      ? Math.max(12, Math.min(95, Math.sin((currentTime * 7) + (idx * 0.6)) * 40 + baseHeight + 25))
                      : Math.max(8, baseHeight);
                    return (
                      <div
                        key={idx}
                        className="w-1.5 rounded-full transition-all duration-75"
                        style={{
                          height: `${animatedHeight}%`,
                          backgroundColor: isPlaying ? '#00e5ff' : '#475569',
                          boxShadow: isPlaying ? '0 0 10px rgba(0,229,255,0.45)' : 'none',
                          opacity: isPlaying ? 0.75 + (Math.sin(idx + currentTime * 4) * 0.25) : 0.4,
                        }}
                      />
                    );
                  })}
                </div>

                {/* Audio Master Badge */}
                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-[#151722] border border-[#252838] text-[11px] font-mono text-cyan-300 shadow-sm z-0">
                  <Volume2 className={`w-3.5 h-3.5 ${isPlaying ? 'text-[#00e5ff] animate-pulse' : 'text-slate-500'}`} />
                  <span className="font-bold tracking-wider">AUDIO MONITOR</span>
                  <span className="text-slate-600">|</span>
                  <span className="text-slate-400 font-sans">STEREO PCM</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center text-slate-500 gap-2 p-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-[#14151a] border border-[#262734] flex items-center justify-center text-[#00e5be]">
              <Play className="w-5 h-5 ml-0.5" />
            </div>
            <p className="text-xs font-semibold text-slate-300">No Media Loaded</p>
            <p className="text-[11px] text-slate-500 max-w-xs">Select or drop a video or audio file from the top bar to preview real-time subtitle overlays.</p>
          </div>
        )}

        {/* Netflix Title-Safe Grid Box Overlay */}
        {showTitleSafe && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            {/* 90% Action Safe */}
            <div className="w-[90%] h-[90%] border border-[#00e5be]/30 border-dashed rounded flex items-center justify-center relative">
              <span className="absolute top-1 left-1.5 text-[8px] font-mono text-[#00e5be]/60 bg-black/50 px-1 rounded">
                90% ACTION SAFE
              </span>
              {/* 80% Title Safe */}
              <div className="w-[88%] h-[88%] border border-amber-400/40 border-dashed rounded relative">
                <span className="absolute bottom-1 right-1.5 text-[8px] font-mono text-amber-400/70 bg-black/50 px-1 rounded">
                  80% NETFLIX TITLE SAFE
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Live Subtitle Overlay */}
        <div 
          className={`absolute left-0 right-0 px-8 pointer-events-none flex flex-col items-center justify-center z-10 transition-all ${
            subtitlePosition === 'top' ? 'top-[8%]' : 'bottom-[7%]'
          }`}
        >
          {renderSubtitleText(currentSubtitle?.text, isCurrentActive)}
        </div>

        {/* Loop Banner */}
        {loopRef.current && (
          <div className="absolute top-3 left-3 bg-[#00e5be]/90 text-black text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 shadow-md z-20 backdrop-blur-xs">
            <Repeat className="w-3 h-3 animate-spin" />
            <span>LOOPING #{activeEventId}</span>
          </div>
        )}
      </div>

      {/* Pro Transport & Scrub Bar */}
      <div className="p-2 flex flex-col gap-1.5 relative z-20 shrink-0 border-t transition-colors bg-[#14151a] text-white border-[#262734]">
        {/* Scrubber Progress Bar */}
        <div 
          className="w-full h-1.5 cursor-pointer relative rounded-full hover:h-2 transition-all duration-150 group/progress overflow-hidden bg-[#181920]"
          onClick={handleProgressClick}
          onMouseMove={handleProgressMouseMove}
          onMouseLeave={() => setHoverTime(null)}
        >
          <div 
            className="h-full bg-gradient-to-r from-[#00e5be] via-[#00c9a7] to-[#00b4d8] shadow-[0_0_8px_rgba(0,229,190,0.5)] rounded-full pointer-events-none transition-all duration-75"
            style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
          />
          {hoverTime !== null && (
            <div 
              className="absolute -top-7 border text-[10px] font-mono px-2 py-0.5 rounded shadow-lg pointer-events-none transform -translate-x-1/2 whitespace-nowrap hidden group-hover/progress:block z-30 bg-[#181920] border-[#262734] text-slate-200"
              style={{ left: `${hoverPosition}px` }}
            >
              {formatSMPTE(hoverTime)}
            </div>
          )}
        </div>

        {/* Controls Deck (CapCut Style) */}
        <div className="flex items-center justify-between">
          {/* Left: Playback Controls */}
          <div className="flex items-center gap-1.5">
            <button 
              onClick={togglePlay} 
              className="w-7 h-7 rounded-full bg-[#00e5be] hover:bg-[#00c9a7] text-black flex items-center justify-center transition-transform active:scale-95 shadow-[0_0_12px_rgba(0,229,190,0.25)] cursor-pointer"
              title="Play / Pause (Space)"
            >
              {isPlaying ? <Pause size={13} fill="currentColor" /> : <Play size={13} fill="currentColor" className="ml-0.5" />}
            </button>
            
            <div className="flex items-center gap-0.5 p-0.5 rounded border text-slate-300 bg-[#181920] border-[#262734]">
              <button onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 2); }} title="Rewind 2s (Left Arrow)" className="p-1 rounded transition-colors cursor-pointer hover:text-white hover:bg-[#22232c]">
                <SkipBack size={12} />
              </button>
              <button onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - (1/frameRate)); }} title="Step Back 1 Frame (,)" className="p-1 rounded transition-colors cursor-pointer hover:text-white hover:bg-[#22232c]">
                <StepBack size={12} />
              </button>
              <button onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + (1/frameRate)); }} title="Step Forward 1 Frame (.)" className="p-1 rounded transition-colors cursor-pointer hover:text-white hover:bg-[#22232c]">
                <StepForward size={12} />
              </button>
              <button onClick={() => { if (videoRef.current) videoRef.current.currentTime = Math.min(duration, videoRef.current.currentTime + 2); }} title="Forward 2s (Right Arrow)" className="p-1 rounded transition-colors cursor-pointer hover:text-white hover:bg-[#22232c]">
                <SkipForward size={12} />
              </button>
            </div>

            {/* Neon Turquoise / Cyan Monospace Timecode Readout */}
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded border font-mono text-xs bg-[#181920] border-[#262734]">
              <span className="font-bold text-[#00e5be]">{formatSMPTE(currentTime)}</span>
              <span className="opacity-40 text-[10px]">/</span>
              <span className="opacity-75 text-[11px] text-slate-400">{formatSMPTE(duration)}</span>
            </div>
          </div>

          {/* Right: VU Meter, Rate, Volume, Fullscreen */}
          <div className="flex items-center gap-2">
            {/* Audio VU Meter */}
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border bg-[#181920] border-[#262734]" title="Audio Peak Level">
              <Volume1 className="w-3.5 h-3.5 opacity-60 text-slate-400" />
              <div className="w-10 h-1.5 rounded-full overflow-hidden flex gap-0.5 p-0.5 bg-[#22232c]">
                <div 
                  className={`h-full rounded-full transition-all duration-75 ${
                    audioLevel > 0.8 ? 'bg-rose-500' : audioLevel > 0.5 ? 'bg-amber-400' : 'bg-[#00e5be]'
                  }`}
                  style={{ width: `${Math.min(100, audioLevel * 100)}%` }}
                />
              </div>
            </div>

            {/* Playback Speed */}
            <button 
              onClick={cyclePlaybackRate} 
              className="text-[10px] font-bold border px-1.5 py-0.5 rounded text-center transition-colors cursor-pointer text-slate-200 hover:text-white bg-[#181920] border-[#262734] hover:bg-[#22232c]"
              title="Cycle Speed"
            >
              {playbackRate}x
            </button>

            {/* Volume Control */}
            <div className="flex items-center gap-1 border px-1.5 py-0.5 rounded bg-[#181920] border-[#262734]">
              <button onClick={() => { if (videoRef.current) { const m = !isMuted; setIsMuted(m); videoRef.current.muted = m; } }} className="cursor-pointer">
                {isMuted || volume === 0 ? <VolumeX size={13} className="text-rose-400" /> : <Volume2 size={13} className="text-slate-300" />}
              </button>
              <input 
                type="range" 
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
                className="w-12 h-1 bg-slate-600 rounded appearance-none cursor-pointer accent-[#00e5be]"
              />
            </div>

            {/* Fullscreen */}
            <button 
              onClick={toggleFullscreen} 
              className="p-1 rounded border transition-colors cursor-pointer bg-[#181920] border-[#262734] text-slate-300 hover:text-white hover:bg-[#22232c]"
              title="Fullscreen"
            >
              {isFullscreen ? <Minimize size={13} /> : <Maximize size={13} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
