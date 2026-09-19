import React, { useState } from 'react';
import {
  Database, Clock, FileAudio, CheckCircle2, AlertTriangle, Trash2, ArrowRight, X, Search, RefreshCw
} from 'lucide-react';

export default function ProjectsModal({
  isOpen,
  onClose,
  projects,
  isLoading,
  onRefresh,
  onLoadProject,
  onDeleteProject
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  React.useEffect(() => {
    if (!isOpen) {
      setIsClosing(false);
      return;
    }
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleDismiss = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 220);
  };

  if (!isOpen) return null;

  const filtered = (projects || []).filter((p) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      (p.filename || '').toLowerCase().includes(q) ||
      (p.language || '').toLowerCase().includes(q) ||
      (p.script || '').toLowerCase().includes(q)
    );
  });

  const formatDate = (isoStr) => {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-opacity duration-200 ${
        isClosing ? 'animate-mac-backdrop-exit pointer-events-none' : 'animate-in fade-in'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
    >
      <div className={`bg-[#14151a] rounded-2xl max-w-2xl w-full max-h-[85vh] shadow-2xl border border-[#262734] overflow-hidden flex flex-col text-slate-200 ${
        isClosing ? 'animate-mac-squish-exit' : 'animate-mac-squish'
      }`}>
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-[#262734] bg-[#14151a]">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-[#00e5be]/15 text-[#00e5be] border border-[#00e5be]/30">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Saved Cloud Workstation Sessions</h2>
              <p className="text-xs text-slate-400">PostgreSQL / Neon database synced project archives</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="p-2 text-slate-400 hover:text-white hover:bg-[#22232c] rounded-xl transition-colors cursor-pointer"
              title="Refresh projects list"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-[#22232c] rounded-xl transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-[#262734] bg-[#14151a]">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by filename, language, or script..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 bg-[#0e0f12] border border-[#262734] rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#00e5be] transition-all"
            />
          </div>
        </div>

        {/* Projects List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
          {isLoading ? (
            <div className="text-center py-16 text-slate-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-[#00e5be]" />
              <p className="text-xs font-semibold text-slate-300">Loading projects from Neon DB...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-14 px-6 bg-[#181920] border border-dashed border-[#262734] rounded-2xl">
              <div className="w-12 h-12 rounded-2xl bg-[#00e5be]/15 text-[#00e5be] border border-[#00e5be]/30 flex items-center justify-center mx-auto mb-3">
                <Database className="w-6 h-6" />
              </div>
              <p className="text-sm font-bold text-white">No saved projects in Neon DB</p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto leading-relaxed">
                Transcribe any audio file or click "Save to Neon DB" to store full transcripts, timestamps, and confidence matrices in your PostgreSQL cloud.
              </p>
              <button
                onClick={onClose}
                className="mt-4 px-4 py-2 bg-[#00e5be] hover:bg-[#00c9a7] text-black rounded-xl text-xs font-bold transition-all shadow-[0_0_12px_rgba(0,229,190,0.25)] cursor-pointer"
              >
                Upload New Audio
              </button>
            </div>
          ) : (
            filtered.map((proj) => (
              <div
                key={proj.id}
                className="group p-4 bg-[#181920] hover:bg-[#22232c] border border-[#262734] hover:border-[#00e5be] rounded-xl transition-all shadow-xs flex flex-wrap items-center justify-between gap-3"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-[#14151a] text-[#00e5be] border border-[#262734] rounded-xl mt-0.5">
                    <FileAudio className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-white line-clamp-1">{proj.filename}</h3>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-slate-400">
                      <span className="font-semibold text-[#00e5be] bg-[#0e0f12] border border-[#262734] px-2 py-0.5 rounded-md">
                        {proj.language} ({proj.script})
                      </span>
                      <span>•</span>
                      <span>{proj.segment_count} segments</span>
                      <span>•</span>
                      <span>{proj.duration.toFixed(1)}s</span>
                      <span>•</span>
                      <span className="flex items-center gap-1 text-slate-400">
                        <Clock className="w-3 h-3" />
                        {formatDate(proj.updated_at || proj.created_at)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border ${
                    proj.compliance_score >= 95
                      ? 'bg-[#00e5be]/15 text-[#00e5be] border-[#00e5be]/30'
                      : 'bg-amber-950/40 text-amber-300 border-amber-800'
                  }`}>
                    {proj.compliance_score.toFixed(0)}% Score
                  </span>

                  <button
                    onClick={() => {
                      onLoadProject(proj.id);
                      onClose();
                    }}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00e5be] hover:bg-[#00c9a7] text-black rounded-xl text-xs font-bold shadow-[0_0_12px_rgba(0,229,190,0.25)] transition-transform active:scale-95 cursor-pointer"
                  >
                    <span>Open</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>

                  <button
                    onClick={() => onDeleteProject(proj.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 rounded-lg transition-colors cursor-pointer"
                    title="Delete project from Neon DB"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
