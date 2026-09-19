import React, { useState } from 'react';
import {
  X, Download, FileSpreadsheet, FileText, Code2, Film, CheckSquare, Square, Package
} from 'lucide-react';

export default function ExportModal({
  isOpen,
  onClose,
  transcriptionResult
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [selectedFormats, setSelectedFormats] = useState(['csv', 'docx', 'xlsx', 'srt']);
  const [filenameTemplate, setFilenameTemplate] = useState('default');
  const [customFilename, setCustomFilename] = useState('');
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

  if (!isOpen || !transcriptionResult) return null;

  const handleDismiss = () => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 220);
  };

  const formats = [
    {
      id: 'csv',
      title: 'CSV Deliverable',
      ext: '.csv',
      desc: 'Standard Karya tabular format (Filename, Speaker, Gender, In/Out (s), Transcript, QC).',
      icon: FileSpreadsheet,
      badge: 'Official CSV'
    },
    {
      id: 'docx',
      title: 'Word Document',
      ext: '.docx',
      desc: 'Microsoft Word deliverable with metadata table and verbatim conversation lines.',
      icon: FileText,
      badge: 'Word'
    },
    {
      id: 'xlsx',
      title: 'Excel Workbook',
      ext: '.xlsx',
      desc: 'Multi-sheet workbook with full transcription and acoustic quality audit sheet.',
      icon: FileSpreadsheet,
      badge: 'Excel'
    },
    {
      id: 'srt',
      title: 'Subtitles (SRT)',
      ext: '.srt',
      desc: 'Standard subtitle file with millisecond timestamps for media playback.',
      icon: Film,
      badge: 'SRT'
    },
    {
      id: 'vtt',
      title: 'WebVTT Subtitles',
      ext: '.vtt',
      desc: 'Browser-native subtitle format for HTML5 video, YouTube, and modern media players.',
      icon: Film,
      badge: 'VTT'
    },
    {
      id: 'txt',
      title: 'Plain Text (TXT)',
      ext: '.txt',
      desc: 'Human-readable verbatim script with timestamps and speaker tags.',
      icon: FileText,
      badge: 'TXT'
    },
    {
      id: 'json',
      title: 'Karya Standard JSON',
      ext: '.json',
      desc: 'JSON array of segments with start_sec, end_sec, transcription, speaker, and gender_label.',
      icon: Code2,
      badge: 'JSON'
    }
  ];

  const toggleFormat = (id) => {
    if (selectedFormats.includes(id)) {
      if (selectedFormats.length > 1) {
        setSelectedFormats(selectedFormats.filter((f) => f !== id));
      }
    } else {
      setSelectedFormats([...selectedFormats, id]);
    }
  };

  const toggleSelectAll = () => {
    if (selectedFormats.length === formats.length) {
      setSelectedFormats(['csv']);
    } else {
      setSelectedFormats(formats.map((f) => f.id));
    }
  };

  const getEffectiveBaseName = () => {
    const rawName = (transcriptionResult?.filename || 'audio').replace(/\.[^/.]+$/, "");
    const lang = transcriptionResult?.language || 'Hindi';
    const dateStr = new Date().toISOString().slice(0, 10);

    if (filenameTemplate === 'lang_date') return `${rawName}_${lang}_${dateStr}`;
    if (filenameTemplate === 'clean') return `${rawName}_transcript`;
    if (filenameTemplate === 'custom' && customFilename.trim()) return customFilename.trim();
    return `${rawName}_karya`;
  };

  const handleDownloadSelected = async () => {
    if (selectedFormats.length === 0) return;
    setIsExporting(true);

    try {
      const res = await fetch('/api/export/multi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          result: transcriptionResult,
          formats: selectedFormats
        })
      });

      if (res.ok) {
        const blob = await res.blob();
        const effectiveBase = getEffectiveBaseName();
        let filename = `${effectiveBase}_deliverables.zip`;
        if (selectedFormats.length === 1) {
          filename = `${effectiveBase}.${selectedFormats[0]}`;
        }

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      } else {
        alert('Failed to export deliverables');
      }
    } catch (err) {
      console.error('Export multi error:', err);
      alert('Export failed: ' + err);
    } finally {
      setIsExporting(false);
    }
  };

  const downloadSingle = async (formatId) => {
    setIsExporting(true);
    try {
      const res = await fetch('/api/export/multi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          result: transcriptionResult,
          formats: [formatId]
        })
      });

      if (res.ok) {
        const blob = await res.blob();
        const effectiveBase = getEffectiveBaseName();
        const filename = `${effectiveBase}.${formatId}`;

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Single export failed:', err);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md transition-opacity duration-200 ${
        isClosing ? 'animate-mac-backdrop-exit pointer-events-none' : 'animate-in fade-in duration-200'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
    >
      <div className={`bg-[#14151a] border border-[#262734] rounded-2xl max-w-2xl w-full p-6 shadow-2xl relative max-h-[90vh] overflow-y-auto text-slate-200 custom-scrollbar ${
        isClosing ? 'animate-mac-squish-exit' : 'animate-mac-squish'
      }`}>
        {/* Close Button */}
        <button
          onClick={handleDismiss}
          className="absolute top-5 right-5 p-2 text-slate-400 hover:text-white rounded-xl bg-[#181920] hover:bg-[#22232c] border border-[#262734] transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Header */}
        <div className="mb-4">
          <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <Package className="w-5 h-5 text-[#00e5be]" />
            Multi-Select Deliverables Export
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Select one or more deliverable formats to download for <span className="text-[#00e5be] font-semibold">{transcriptionResult.filename}</span>
          </p>
        </div>

        {/* FEAT-12: Custom Filename Template Selector */}
        <div className="p-3 bg-[#181920] border border-[#262734] rounded-xl mb-4 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
              Filename Template
            </label>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setFilenameTemplate('default')}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${
                  filenameTemplate === 'default' ? 'bg-[#00e5be] text-black shadow-xs' : 'bg-[#14151a] text-slate-400 border border-[#262734] hover:text-white'
                }`}
              >
                Standard
              </button>
              <button
                type="button"
                onClick={() => setFilenameTemplate('lang_date')}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${
                  filenameTemplate === 'lang_date' ? 'bg-[#00e5be] text-black shadow-xs' : 'bg-[#14151a] text-slate-400 border border-[#262734] hover:text-white'
                }`}
              >
                +Lang+Date
              </button>
              <button
                type="button"
                onClick={() => setFilenameTemplate('custom')}
                className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${
                  filenameTemplate === 'custom' ? 'bg-[#00e5be] text-black shadow-xs' : 'bg-[#14151a] text-slate-400 border border-[#262734] hover:text-white'
                }`}
              >
                Custom
              </button>
            </div>
          </div>

          {filenameTemplate === 'custom' ? (
            <input
              type="text"
              placeholder="Enter custom export basename..."
              value={customFilename}
              onChange={(e) => setCustomFilename(e.target.value)}
              className="w-full bg-[#0e0f12] border border-[#262734] rounded-xl px-3 py-1 text-xs text-white focus:outline-none focus:border-[#00e5be] font-mono"
            />
          ) : (
            <div className="text-[11px] font-mono text-[#00e5be] bg-[#0e0f12] px-2.5 py-1 rounded-xl border border-[#262734]">
              Preview: <span className="font-bold">{getEffectiveBaseName()}</span>.[ext]
            </div>
          )}
        </div>

        {/* Multi-Select Action Bar */}
        <div className="flex items-center justify-between bg-[#181920] p-3 rounded-xl border border-[#262734] mb-4">
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-2 text-xs font-bold text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            {selectedFormats.length === formats.length ? (
              <CheckSquare className="w-4 h-4 text-[#00e5be]" />
            ) : (
              <Square className="w-4 h-4 text-slate-500" />
            )}
            <span>Select All ({selectedFormats.length}/{formats.length})</span>
          </button>

          <span className="text-xs text-slate-400 font-medium">
            {selectedFormats.length > 1 ? 'Will download as a single ZIP bundle' : 'Will download directly'}
          </span>
        </div>

        {/* Formats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          {formats.map((fmt) => {
            const isSelected = selectedFormats.includes(fmt.id);
            const Icon = fmt.icon;

            return (
              <div
                key={fmt.id}
                onClick={() => toggleFormat(fmt.id)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? 'bg-[#181920] border-[#00e5be] ring-1 ring-[#00e5be]/40 shadow-[0_0_12px_rgba(0,229,190,0.1)]'
                    : 'bg-[#14151a] border-[#262734] hover:border-[#383a4c] hover:bg-[#181920]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div className={`p-1.5 rounded-lg ${
                        isSelected ? 'bg-[#00e5be] text-black shadow-xs' : 'bg-[#181920] text-slate-400'
                      }`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="font-bold text-sm text-slate-200">{fmt.title}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#0e0f12] text-[#00e5be] border border-[#262734]">
                        {fmt.ext}
                      </span>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="rounded accent-[#00e5be] h-4 w-4 pointer-events-none"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{fmt.desc}</p>
                </div>

                <div className="mt-2.5 pt-2 border-t border-[#262734] flex items-center justify-end">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadSingle(fmt.id);
                    }}
                    className="text-[11px] font-bold text-[#00e5be] hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <Download className="w-3 h-3" />
                    Download only this
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer with Big Multi-Download Button */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-[#262734]">
          <button
            onClick={handleDismiss}
            className="px-4 py-2.5 bg-[#181920] hover:bg-[#22232c] text-slate-300 rounded-xl text-xs font-semibold border border-[#262734] cursor-pointer"
          >
            Cancel
          </button>

          <button
            onClick={handleDownloadSelected}
            disabled={isExporting || selectedFormats.length === 0}
            className="flex items-center gap-2 px-6 py-2.5 bg-[#00e5be] hover:bg-[#00c9a7] active:scale-95 text-black rounded-xl text-xs font-bold shadow-[0_0_15px_rgba(0,229,190,0.25)] transition-all disabled:opacity-50 cursor-pointer"
          >
            <Download className="w-4 h-4" />
            <span>
              {isExporting
                ? 'Preparing Download...'
                : `Download Selected Formats (${selectedFormats.length})`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
