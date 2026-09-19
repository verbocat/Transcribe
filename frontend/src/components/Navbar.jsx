import React, { useRef } from 'react';
import {
  BookOpen, Sparkles, ShieldCheck, Database, BarChart2,
  Users, Undo2, Redo2, UploadCloud, GitCompare, StickyNote
} from 'lucide-react';
import AccountMenuDropdown from './AccountMenuDropdown';

export default function Navbar({
  hasApiKey,
  setShowGuidelines,
  onOpenProjects,
  onOpenStats,
  onOpenSpeakers,
  onOpenDiff,
  onOpenNotes,
  onImportSubtitles,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  currentFilename,
  segmentCount,
  complianceScore,
  totalErrors,
  totalWarnings,
  user,
  onOpenLogoutModal
}) {
  const isPassing = complianceScore !== null && complianceScore !== undefined && complianceScore >= 98.0;
  const subtitleInputRef = useRef(null);

  const handleSubtitleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file && onImportSubtitles) {
      onImportSubtitles(file);
      e.target.value = '';
    }
  };

  return (
    <header className="sticky top-0 z-40 bg-[#121318] border-b border-[#262734] px-3 sm:px-4 py-1.5 select-none shadow-sm">
      <div className="w-full flex flex-wrap items-center justify-between gap-2">
        {/* Left: Brand & Undo/Redo */}
        <div className="flex items-center gap-2.5">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-tr from-[#00e5be] to-teal-600 flex items-center justify-center shadow-xs text-black font-black shrink-0">
            <Sparkles className="w-3.5 h-3.5 fill-current" />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-xs text-white uppercase tracking-wider font-mono">Karya Transcribe</span>
              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-[#00e5be]/15 text-[#00e5be] border border-[#00e5be]/30 uppercase">
                Verbatim AI
              </span>
            </div>
            <p className="text-[10px] text-[#9496a8] hidden sm:block">Conversational Speech Segmentation & QA Studio</p>
          </div>

          {/* Quick Undo / Redo Controls */}
          {segmentCount > 0 && (
            <div className="flex items-center gap-0.5 ml-2 pl-2 border-l border-[#262734]">
              <button
                onClick={onUndo}
                disabled={!canUndo}
                className="p-1 rounded-md text-[#9496a8] hover:text-white hover:bg-[#1e202a] disabled:opacity-25 transition-colors cursor-pointer"
                title="Undo (Ctrl+Z)"
              >
                <Undo2 className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={onRedo}
                disabled={!canRedo}
                className="p-1 rounded-md text-[#9496a8] hover:text-white hover:bg-[#1e202a] disabled:opacity-25 transition-colors cursor-pointer"
                title="Redo (Ctrl+Y)"
              >
                <Redo2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Center: Sleek Compact Compliance Score Badge */}
        {segmentCount > 0 && complianceScore !== null && (
          <div className={`flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs font-mono font-bold shadow-2xs transition-all ${
            isPassing
              ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800'
              : complianceScore >= 80
              ? 'bg-amber-950/70 text-amber-300 border-amber-800'
              : 'bg-rose-950/70 text-rose-300 border-rose-800'
          }`}>
            <ShieldCheck className={`w-3.5 h-3.5 ${isPassing ? 'text-emerald-400' : 'text-amber-400'}`} />
            <div className="flex items-center gap-1.5">
              <span className="font-black text-xs">{complianceScore}%</span>
              <span className="text-[9px] uppercase font-bold px-1 py-0.2 rounded bg-black/40 border border-white/10">
                {isPassing ? 'PASSED (≥98%)' : 'NEEDS QA'}
              </span>
              <span className="text-[#9496a8] font-medium text-[11px] ml-0.5">
                ({totalErrors} Err · {totalWarnings} Warn)
              </span>
            </div>
          </div>
        )}

        {/* Right: Actions, Neon DB & Status */}
        <div className="flex items-center gap-1.5">
          {/* Subtitle Import Button */}
          <input
            type="file"
            ref={subtitleInputRef}
            onChange={handleSubtitleFileChange}
            accept=".srt,.vtt,text/plain"
            className="hidden"
          />
          <button
            onClick={() => subtitleInputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-[#181920] hover:bg-[#22232c] text-[#e2e4ed] hover:text-white rounded-lg text-xs font-medium border border-[#262734] transition-colors cursor-pointer"
            title="Import existing .SRT or .VTT subtitles to edit"
          >
            <UploadCloud className="w-3.5 h-3.5 text-[#00e5be]" />
            <span className="hidden sm:inline">Import SRT</span>
          </button>

          {/* Speakers Management Button */}
          {segmentCount > 0 && onOpenSpeakers && (
            <button
              onClick={onOpenSpeakers}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#181920] hover:bg-[#22232c] text-[#e2e4ed] hover:text-white rounded-lg text-xs font-medium border border-[#262734] transition-colors cursor-pointer"
              title="Manage and Rename Speakers"
            >
              <Users className="w-3.5 h-3.5 text-[#00e5be]" />
              <span className="hidden md:inline">Speakers</span>
            </button>
          )}

          {/* Stats Button */}
          {segmentCount > 0 && onOpenStats && (
            <button
              onClick={onOpenStats}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#181920] hover:bg-[#22232c] text-[#e2e4ed] hover:text-white rounded-lg text-xs font-medium border border-[#262734] transition-colors cursor-pointer"
              title="View Transcript Analytics & Distribution"
            >
              <BarChart2 className="w-3.5 h-3.5 text-[#00e5be]" />
              <span className="hidden md:inline">Stats</span>
            </button>
          )}

          {/* Diff View Button */}
          {segmentCount > 0 && onOpenDiff && (
            <button
              onClick={onOpenDiff}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#181920] hover:bg-[#22232c] text-[#e2e4ed] hover:text-white rounded-lg text-xs font-medium border border-[#262734] transition-colors cursor-pointer"
              title="View side-by-side changes against original AI transcription"
            >
              <GitCompare className="w-3.5 h-3.5 text-[#00e5be]" />
              <span className="hidden md:inline">Diff</span>
            </button>
          )}

          {/* Notes & Tags Button */}
          {segmentCount > 0 && onOpenNotes && (
            <button
              onClick={onOpenNotes}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-[#181920] hover:bg-[#22232c] text-[#e2e4ed] hover:text-white rounded-lg text-xs font-medium border border-[#262734] transition-colors cursor-pointer"
              title="Project Notes & Classification Tags"
            >
              <StickyNote className="w-3.5 h-3.5 text-[#00e5be]" />
              <span className="hidden md:inline">Notes</span>
            </button>
          )}

          {/* Neon Cloud Projects Button */}
          <button
            onClick={onOpenProjects}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-[#181920] hover:bg-[#22232c] text-[#00e5be] rounded-lg text-xs font-bold border border-[#00e5be]/30 transition-colors cursor-pointer shadow-xs"
            title="Open Neon PostgreSQL Cloud Projects"
          >
            <Database className="w-3.5 h-3.5 text-[#00e5be]" />
            <span>Projects</span>
          </button>

          {/* Guidelines Button */}
          <button
            onClick={() => setShowGuidelines(true)}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-[#181920] hover:bg-[#22232c] text-[#9496a8] hover:text-white rounded-lg text-xs font-medium border border-[#262734] transition-colors cursor-pointer"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span className="hidden lg:inline">Guidelines</span>
          </button>

          {/* API Key Status Indicator */}
          <div
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-mono border ${
              hasApiKey
                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-800'
                : 'bg-amber-950/60 text-amber-300 border-amber-800'
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                hasApiKey ? 'bg-[#00e5be] shadow-[0_0_6px_#00e5be]' : 'bg-amber-400'
              }`}
            />
            <span className="font-semibold text-[10px]">{hasApiKey ? 'Gemini Flash' : 'API Key Setup'}</span>
          </div>

          {/* User Account & Seat Status Dropdown */}
          {user && (
            <AccountMenuDropdown
              user={user}
              onOpenLogoutModal={onOpenLogoutModal}
            />
          )}
        </div>
      </div>
    </header>
  );
}

