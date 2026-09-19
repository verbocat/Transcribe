import React, { useState, useEffect } from 'react';
import { X, Tag, StickyNote, Check, Plus, Trash2 } from 'lucide-react';

export default function ProjectNotesModal({ isOpen, onClose, filename }) {
  const storageKey = `karya_notes_${filename || 'default'}`;
  const tagsKey = `karya_tags_${filename || 'default'}`;

  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState([]);
  const [newTagInput, setNewTagInput] = useState('');
  const [toast, setToast] = useState('');
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
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

  useEffect(() => {
    if (isOpen) {
      const savedNotes = localStorage.getItem(storageKey) || '';
      const savedTags = JSON.parse(localStorage.getItem(tagsKey) || '["Karya Standard", "Verbatim"]');
      setNotes(savedNotes);
      setTags(savedTags);
    }
  }, [isOpen, storageKey, tagsKey]);

  const handleSave = () => {
    localStorage.setItem(storageKey, notes);
    localStorage.setItem(tagsKey, JSON.stringify(tags));
    setToast('Project notes & tags saved locally ✓');
    setTimeout(() => {
      setToast('');
      handleDismiss();
    }, 800);
  };

  const handleAddTag = () => {
    const clean = newTagInput.trim();
    if (clean && !tags.includes(clean)) {
      setTags([...tags, clean]);
      setNewTagInput('');
    }
  };

  const handleRemoveTag = (tagToRemove) => {
    setTags(tags.filter(t => t !== tagToRemove));
  };

  if (!isOpen) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-opacity duration-200 ${
        isClosing ? 'animate-mac-backdrop-exit pointer-events-none' : 'animate-in fade-in'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
    >
      <div className={`bg-[#14151a] border border-[#262734] rounded-2xl w-full max-w-xl p-6 shadow-2xl flex flex-col max-h-[90vh] text-slate-200 ${
        isClosing ? 'animate-mac-squish-exit' : 'animate-mac-squish'
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#262734]">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-[#1c1d25] text-[#00e5be] border border-[#262734] rounded-xl shadow-xs">
              <StickyNote className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight">Project Notes & Tags</h2>
              <p className="text-xs text-slate-400 font-medium">{filename || 'Current Project'}</p>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1.5 text-slate-400 hover:text-white rounded-xl bg-[#181920] hover:bg-[#22232c] border border-[#262734] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Toast */}
        {toast && (
          <div className="mt-3 p-2 bg-emerald-950/40 text-emerald-300 border border-emerald-500/30 rounded-xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
            <Check className="w-4 h-4 text-[#00e5be]" />
            <span>{toast}</span>
          </div>
        )}

        <div className="space-y-4 mt-4 flex-1 overflow-y-auto custom-scrollbar">
          {/* Tags Section */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-[#00e5be]" />
              <span>Project Classification Tags</span>
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#181920] text-slate-200 border border-[#262734]"
                >
                  <span>{t}</span>
                  <button
                    onClick={() => handleRemoveTag(t)}
                    className="hover:text-rose-400 ml-1 cursor-pointer font-bold"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>

            <div className="flex items-center gap-2 mt-2">
              <input
                type="text"
                placeholder="Add custom tag (e.g. 'telephonic', 'accent review')..."
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddTag();
                }}
                className="flex-1 bg-[#0e0f12] border border-[#262734] rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-[#00e5be] font-medium"
              />
              <button
                onClick={handleAddTag}
                disabled={!newTagInput.trim()}
                className="px-3 py-1.5 bg-[#181920] hover:bg-[#22232c] disabled:opacity-40 text-slate-300 hover:text-white border border-[#262734] rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Annotator Notes Section */}
          <div className="space-y-2">
            <label className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <StickyNote className="w-3.5 h-3.5 text-[#00e5be]" />
              <span>Annotator Notes & Quality Remarks</span>
            </label>
            <textarea
              rows={6}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Record guidelines clarifications, domain terminology notes, acronym pronunciations, speaker accents, or reviewer feedback here..."
              className="w-full bg-[#0e0f12] border border-[#262734] rounded-xl p-3 text-xs text-slate-200 placeholder-slate-500 focus:border-[#00e5be] focus:outline-none resize-y leading-relaxed font-sans"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 pt-3 border-t border-[#262734] flex items-center justify-between">
          <span className="text-[11px] text-slate-500">Stored in browser local storage</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDismiss}
              className="px-3.5 py-1.5 bg-[#181920] hover:bg-[#22232c] text-slate-300 hover:text-white rounded-xl text-xs font-semibold border border-[#262734] transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-1.5 bg-[#00e5be] hover:bg-[#00c8a5] text-black rounded-xl text-xs font-bold transition-all shadow-[0_0_15px_rgba(0,229,190,0.2)] cursor-pointer"
            >
              Save Notes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
