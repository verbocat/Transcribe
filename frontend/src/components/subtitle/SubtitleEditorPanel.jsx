import React, { useState, useEffect } from 'react';
import { 
  ChevronDown, 
  ChevronUp, 
  Link2, 
  Download, 
  Bold, 
  Italic, 
  Underline, 
  AlignLeft, 
  AlignCenter, 
  AlignRight, 
  Move, 
  Sparkles, 
  Wand2, 
  User, 
  CheckCircle2, 
  Layers 
} from 'lucide-react';

function toSMPTE(seconds, fps = 24.0) {
  if (seconds === undefined || seconds === null || isNaN(seconds)) return '00:00:00.000';
  const totalMs = Math.round(seconds * 1000);
  const ms = totalMs % 1000;
  const totalSecs = Math.floor(totalMs / 1000);
  const s = totalSecs % 60;
  const m = Math.floor(totalSecs / 60) % 60;
  const h = Math.floor(totalSecs / 3600);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}

function parseSMPTE(str, fps = 24.0) {
  if (!str) return 0;
  const parts = str.trim().split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2]) || 0;
    return h * 3600 + m * 60 + s;
  }
  return parseFloat(str) || 0;
}

export default function SubtitleEditorPanel({
  activeEvent = null,
  onUpdateEvent = () => {},
  onSetIn = () => {},
  onSetOut = () => {},
  onExport = () => {},
  currentTime = 0,
  frameRate = 24.0,
  cplLimit = 42,
  cpsLimit = 20,
  availableSpeakers = ['Speaker 1', 'Speaker 2', 'Speaker 3'],
  onAutoFix = () => {}
}) {
  const [activeTab, setActiveTab] = useState('edit'); // edit | translate | ai | qa
  const [localText, setLocalText] = useState('');
  const [startTimeStr, setStartTimeStr] = useState('00:00:00.000');
  const [endTimeStr, setEndTimeStr] = useState('00:00:00.000');
  const [selectedSpeaker, setSelectedSpeaker] = useState('Speaker 1');
  const [isLockedDuration, setIsLockedDuration] = useState(false);
  const [alignment, setAlignment] = useState('center'); // left | center | right

  useEffect(() => {
    if (activeEvent) {
      setLocalText(activeEvent.text || '');
      const s = activeEvent.start_time ?? activeEvent.start ?? 0;
      const e = activeEvent.end_time ?? activeEvent.end ?? 0;
      setStartTimeStr(toSMPTE(s, frameRate));
      setEndTimeStr(toSMPTE(e, frameRate));
      setSelectedSpeaker(activeEvent.speaker || 'Speaker 1');
    } else {
      setLocalText('');
      setStartTimeStr('00:00:00.000');
      setEndTimeStr('00:00:00.000');
    }
  }, [activeEvent, frameRate]);

  if (!activeEvent) {
    return (
      <div className="w-[340px] shrink-0 h-full bg-[var(--kt-s1)] flex flex-col items-center justify-center p-6 text-center text-slate-500 select-none">
        <Sparkles className="w-8 h-8 text-blue-500/40 mb-2" />
        <p className="text-xs font-semibold text-slate-300">No Subtitle Selected</p>
        <p className="text-[11px] text-slate-500 mt-1">Select a subtitle in the table or timeline to inspect and edit.</p>
      </div>
    );
  }

  const id = activeEvent.id ?? activeEvent.event_id;
  const startSec = activeEvent.start_time ?? activeEvent.start ?? 0;
  const endSec = activeEvent.end_time ?? activeEvent.end ?? 0;
  const duration = Math.max(0.01, endSec - startSec);

  // Character calculations
  const rawTextLength = localText.replace(/<[^>]+>/g, '').trim().length;
  const lines = localText.split('\n');
  const maxLineLength = Math.max(...lines.map(l => l.replace(/<[^>]+>/g, '').trim().length), 0);
  const cps = duration > 0 ? rawTextLength / duration : 0;
  const isCplOver = maxLineLength > cplLimit;
  const isCpsOver = cps > cpsLimit;

  // Commit text change
  const handleTextCommit = (val) => {
    setLocalText(val);
    onUpdateEvent(id, { text: val });
  };

  // Nudge start/end
  const handleNudgeStart = (deltaFrames) => {
    const delta = deltaFrames / frameRate;
    const newStart = Math.max(0, startSec + delta);
    if (newStart < endSec) {
      onUpdateEvent(id, { start_time: newStart, end_time: endSec });
    }
  };

  const handleNudgeEnd = (deltaFrames) => {
    const delta = deltaFrames / frameRate;
    const newEnd = Math.max(startSec + 0.1, endSec + delta);
    onUpdateEvent(id, { start_time: startSec, end_time: newEnd });
  };

  // Format tags insertion (HTML/Style)
  const applyFormatTag = (tag) => {
    const textarea = document.getElementById('active-subtitle-textarea');
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = localText.substring(start, end);
    const before = localText.substring(0, start);
    const after = localText.substring(end);
    let wrapped;
    if (selected) {
      wrapped = `${before}<${tag}>${selected}</${tag}>${after}`;
    } else {
      wrapped = `${before}<${tag}></${tag}>${after}`;
    }
    handleTextCommit(wrapped);
  };

  return (
    <div className="w-[340px] shrink-0 h-full flex flex-col bg-[var(--kt-s1)] overflow-y-auto custom-scrollbar select-none">
      {/* ── Top Tabs & Export Button ── */}
      <div className="h-12 px-3 border-b border-[var(--kt-s3)] flex items-center justify-between shrink-0 bg-[var(--kt-s1)]">
        {/* Navigation Tabs */}
        <div className="flex items-center gap-1">
          {[
            { id: 'edit', label: 'Edit' },
            { id: 'translate', label: 'Translate' },
            { id: 'ai', label: 'AI Tools' },
            { id: 'qa', label: 'QA' },
          ].map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer relative ${
                  isActive
                    ? 'text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
                {isActive && (
                  <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-blue-500 rounded-full" />
                )}
              </button>
            );
          })}
        </div>

        {/* Pro Export Deliverables Button */}
        <button
          type="button"
          onClick={onExport}
          className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg px-3 py-1.5 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-blue-600/30 transition-all cursor-pointer"
        >
          <Download size={13} />
          <span>Export</span>
          <ChevronDown size={11} className="opacity-70" />
        </button>
      </div>

      {/* ── Main Inspector Content Area ── */}
      <div className="p-3.5 flex flex-col gap-3.5 flex-1">
        {/* Row 1: Start Time, Link, End Time, Duration */}
        <div className="grid grid-cols-[1fr_auto_1fr_auto] items-end gap-2 bg-[var(--kt-s1)] p-2.5 rounded-xl border border-[var(--kt-s4)]">
          {/* Start Time */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-slate-400">Start Time</span>
            <div className="relative flex items-center bg-[var(--kt-s2)] border border-[var(--kt-s4)] rounded-lg px-2 py-1 text-xs">
              <input
                type="text"
                value={startTimeStr}
                onChange={(e) => setStartTimeStr(e.target.value)}
                onBlur={() => {
                  const s = parseSMPTE(startTimeStr, frameRate);
                  if (s < endSec) onUpdateEvent(id, { start_time: s, end_time: endSec });
                }}
                className="w-full bg-transparent font-mono text-xs text-white focus:outline-none"
              />
              <div className="flex flex-col shrink-0 ml-1">
                <button 
                  onClick={() => handleNudgeStart(1)} 
                  className="hover:text-blue-400 text-slate-500 cursor-pointer"
                >
                  <ChevronUp size={10} />
                </button>
                <button 
                  onClick={() => handleNudgeStart(-1)} 
                  className="hover:text-blue-400 text-slate-500 cursor-pointer"
                >
                  <ChevronDown size={10} />
                </button>
              </div>
            </div>
          </div>

          {/* Link Icon (Lock duration) */}
          <div className="pb-1">
            <button
              type="button"
              onClick={() => setIsLockedDuration(prev => !prev)}
              className={`p-1.5 rounded-lg border transition-colors cursor-pointer ${
                isLockedDuration 
                  ? 'bg-blue-600 text-white border-blue-500' 
                  : 'bg-[var(--kt-s2)] border-[var(--kt-s4)] text-slate-400 hover:text-white'
              }`}
              title="Lock Duration"
            >
              <Link2 size={13} />
            </button>
          </div>

          {/* End Time */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-slate-400">End Time</span>
            <div className="relative flex items-center bg-[var(--kt-s2)] border border-[var(--kt-s4)] rounded-lg px-2 py-1 text-xs">
              <input
                type="text"
                value={endTimeStr}
                onChange={(e) => setEndTimeStr(e.target.value)}
                onBlur={() => {
                  const e = parseSMPTE(endTimeStr, frameRate);
                  if (e > startSec) onUpdateEvent(id, { start_time: startSec, end_time: e });
                }}
                className="w-full bg-transparent font-mono text-xs text-white focus:outline-none"
              />
              <div className="flex flex-col shrink-0 ml-1">
                <button 
                  onClick={() => handleNudgeEnd(1)} 
                  className="hover:text-blue-400 text-slate-500 cursor-pointer"
                >
                  <ChevronUp size={10} />
                </button>
                <button 
                  onClick={() => handleNudgeEnd(-1)} 
                  className="hover:text-blue-400 text-slate-500 cursor-pointer"
                >
                  <ChevronDown size={10} />
                </button>
              </div>
            </div>
          </div>

          {/* Duration */}
          <div className="flex flex-col gap-1 items-end min-w-[50px]">
            <span className="text-[10px] font-semibold text-slate-400">Duration</span>
            <div className="h-[28px] flex items-center font-mono text-xs font-bold text-slate-200">
              {duration.toFixed(2)}s
            </div>
          </div>
        </div>

        {/* Row 2: Dialogue Textarea with Character Limit counter */}
        <div className="relative bg-[var(--kt-s1)] rounded-xl border border-[var(--kt-s4)] p-2.5 focus-within:border-blue-500 transition-colors">
          <textarea
            id="active-subtitle-textarea"
            rows={4}
            value={localText}
            onChange={(e) => handleTextCommit(e.target.value)}
            placeholder="Type subtitle dialogue..."
            className="w-full bg-transparent text-white text-xs leading-relaxed focus:outline-none resize-none font-medium placeholder-slate-500"
          />
          <div className="flex items-center justify-between pt-1 border-t border-[var(--kt-s4)]/60 mt-1">
            <span className="text-[10px] text-slate-500 font-mono">
              Line {lines.length} · Max {maxLineLength} chars
            </span>
            <span className={`text-[10px] font-mono font-bold ${
              isCplOver ? 'text-rose-400' : 'text-slate-400'
            }`}>
              {rawTextLength} / {cplLimit}
            </span>
          </div>
        </div>

        {/* Row 3: Formatting & Text Alignment Toolbar */}
        <div className="flex items-center justify-between bg-[var(--kt-s1)] px-2.5 py-1.5 rounded-xl border border-[var(--kt-s4)]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => applyFormatTag('b')}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-[var(--kt-s3)] transition-colors cursor-pointer"
              title="Bold (Ctrl+B)"
            >
              <Bold size={13} />
            </button>
            <button
              type="button"
              onClick={() => applyFormatTag('i')}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-[var(--kt-s3)] transition-colors cursor-pointer"
              title="Italic (Ctrl+I)"
            >
              <Italic size={13} />
            </button>
            <button
              type="button"
              onClick={() => applyFormatTag('u')}
              className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-[var(--kt-s3)] transition-colors cursor-pointer"
              title="Underline (Ctrl+U)"
            >
              <Underline size={13} />
            </button>
            <div className="w-4 h-4 rounded border border-white/20 bg-black cursor-pointer ml-1" title="Color Picker" />
          </div>

          <div className="w-[1px] h-4 bg-[var(--kt-s4)]" />

          {/* Alignment */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setAlignment('left')}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                alignment === 'left' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-[var(--kt-s3)]'
              }`}
              title="Align Left"
            >
              <AlignLeft size={13} />
            </button>
            <button
              type="button"
              onClick={() => setAlignment('center')}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                alignment === 'center' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-[var(--kt-s3)]'
              }`}
              title="Align Center"
            >
              <AlignCenter size={13} />
            </button>
            <button
              type="button"
              onClick={() => setAlignment('right')}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                alignment === 'right' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-[var(--kt-s3)]'
              }`}
              title="Align Right"
            >
              <AlignRight size={13} />
            </button>
            <button
              type="button"
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[var(--kt-s3)] transition-colors cursor-pointer"
              title="Position Anchor"
            >
              <Move size={13} />
            </button>
          </div>
        </div>

        {/* Row 4: Speaker, CPS, Gap In, Gap Out */}
        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-2 items-center bg-[var(--kt-s1)] p-2.5 rounded-xl border border-[var(--kt-s4)]">
          {/* Speaker Dropdown */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-semibold text-slate-400">Speaker</span>
            <div className="flex items-center gap-1.5 bg-[var(--kt-s2)] border border-[var(--kt-s4)] rounded-lg px-2 py-1 text-xs text-white">
              <User size={12} className="text-emerald-400 shrink-0" />
              <select
                value={selectedSpeaker}
                onChange={(e) => {
                  setSelectedSpeaker(e.target.value);
                  onUpdateEvent(id, { speaker: e.target.value });
                }}
                className="w-full bg-transparent text-xs text-white focus:outline-none cursor-pointer"
              >
                {availableSpeakers.map(spk => (
                  <option key={spk} value={spk} className="bg-[var(--kt-s2)] text-white">
                    {spk}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* CPS */}
          <div className="flex flex-col gap-1 text-center">
            <span className="text-[10px] font-semibold text-slate-400">CPS</span>
            <div className="h-[28px] flex items-center justify-center font-mono text-xs font-bold text-white bg-[var(--kt-s2)] border border-[var(--kt-s4)] rounded-lg px-1">
              <span className={isCpsOver ? 'text-rose-400' : 'text-slate-200'}>
                {cps.toFixed(1)}
              </span>
            </div>
          </div>

          {/* Gap In */}
          <div className="flex flex-col gap-1 text-center">
            <span className="text-[10px] font-semibold text-slate-400">Gap In</span>
            <div className="h-[28px] flex items-center justify-center font-mono text-xs text-slate-300 bg-[var(--kt-s2)] border border-[var(--kt-s4)] rounded-lg px-1">
              0.08s
            </div>
          </div>

          {/* Gap Out */}
          <div className="flex flex-col gap-1 text-center">
            <span className="text-[10px] font-semibold text-slate-400">Gap Out</span>
            <div className="h-[28px] flex items-center justify-center font-mono text-xs text-slate-300 bg-[var(--kt-s2)] border border-[var(--kt-s4)] rounded-lg px-1">
              0.08s
            </div>
          </div>
        </div>

        {/* Row 5: Action Buttons [ Set In ] [ Set Out ] [ Apply ] */}
        <div className="flex items-center gap-2 mt-auto pt-2">
          <button
            type="button"
            onClick={() => onSetIn(id, currentTime)}
            className="flex-1 py-2 rounded-lg bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border border-[var(--kt-s4)] text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            [ Set In
          </button>
          <button
            type="button"
            onClick={() => onSetOut(id, currentTime)}
            className="flex-1 py-2 rounded-lg bg-[var(--kt-s2)] hover:bg-[var(--kt-s3)] border border-[var(--kt-s4)] text-white text-xs font-semibold transition-colors cursor-pointer"
          >
            ] Set Out
          </button>
          <button
            type="button"
            onClick={() => onAutoFix(id)}
            className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-blue-600/30 transition-all cursor-pointer"
          >
            <Wand2 size={13} />
            <span>Apply</span>
          </button>
        </div>
      </div>
    </div>
  );
}
