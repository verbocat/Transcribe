import React, { useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, StepBack, StepForward, ChevronsLeft, ChevronsRight, AudioLines } from 'lucide-react';
import { timecode } from './editModel';

function Tbtn({ icon: Icon, onClick, title, primary }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-label={title}
      className={`grid place-items-center rounded-md cursor-pointer ${primary ? 'h-8 w-8 bg-[var(--kt-accent)] text-[var(--kt-accent-ink)] hover:opacity-90' : 'h-7 w-7 text-[var(--kt-muted)] hover:text-[var(--kt-text)] hover:bg-[var(--kt-s3)]'}`}>
      <Icon size={primary ? 15 : 14} />
    </button>
  );
}

export default function ProgramMonitor({ mediaUrl, isVideo, player, fps, duration, getTime, playing, rate, controls }) {
  const tc = useRef(null);
  useEffect(() => {
    let raf;
    const tick = () => { if (tc.current) tc.current.textContent = timecode(getTime(), fps); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [getTime, fps]);

  return (
    <section className="h-full min-w-0 flex flex-col bg-[var(--kt-s1)]" aria-label="Program monitor">
      <div className="h-8 shrink-0 px-3 flex items-center border-b border-[var(--kt-s4)] text-[11px] font-semibold uppercase tracking-wider text-[var(--kt-faint)]">Program</div>
      <div className="flex-1 min-h-0 bg-black grid place-items-center overflow-hidden">
        {!mediaUrl ? <span className="text-xs text-[var(--kt-faint)]">Loading media…</span> : isVideo
          ? <video ref={player} src={mediaUrl} preload="auto" playsInline className="max-w-full max-h-full" onClick={controls.toggle} />
          : (
            <div className="flex flex-col items-center gap-2 text-[var(--kt-faint)]">
              <AudioLines size={40} />
              <span className="text-xs">Audio project</span>
              <audio ref={player} src={mediaUrl} preload="auto" />
            </div>
          )}
      </div>
      <div className="shrink-0 border-t border-[var(--kt-s4)] px-3 py-1.5 flex items-center gap-2">
        <span ref={tc} className="text-[13px] text-[var(--kt-accent)] tabular-nums min-w-[96px]" style={{ fontFamily: 'var(--kt-font-mono)' }}>00:00:00:00</span>
        <div className="flex-1 flex items-center justify-center gap-0.5">
          <Tbtn icon={SkipBack} title="Go to start (Home)" onClick={controls.goStart} />
          <Tbtn icon={ChevronsLeft} title="Previous edit point (Up)" onClick={controls.prevEdit} />
          <Tbtn icon={StepBack} title="Back one frame (Left)" onClick={() => controls.step(-1)} />
          <Tbtn icon={playing ? Pause : Play} primary title={playing ? 'Pause (Space or K)' : 'Play (Space or L)'} onClick={controls.toggle} />
          <Tbtn icon={StepForward} title="Forward one frame (Right)" onClick={() => controls.step(1)} />
          <Tbtn icon={ChevronsRight} title="Next edit point (Down)" onClick={controls.nextEdit} />
          <Tbtn icon={SkipForward} title="Go to end (End)" onClick={controls.goEnd} />
        </div>
        <span className="text-[11px] text-[var(--kt-faint)] tabular-nums min-w-[96px] text-right" style={{ fontFamily: 'var(--kt-font-mono)' }}>
          {rate && rate !== 1 ? <span className="text-[var(--kt-warn)] mr-2">{rate > 0 ? '▶' : '◀'} {Math.abs(rate)}×</span> : null}
          {timecode(duration, fps)}
        </span>
      </div>
    </section>
  );
}
