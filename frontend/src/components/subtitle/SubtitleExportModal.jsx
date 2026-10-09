import React, { useState, useMemo, useRef } from 'react';
import { X, Download, FileText, FileCode, File, Globe, Check } from 'lucide-react';
import { API_BASE } from '../../config';
import { startJob, jobHeaders, isCancelError } from '../../utils/cancellable';

import { langName } from './languages';
import { exportLanguageOptions, isValidExportLanguage, eventsForExport, exportLanguageSuffix } from '../../utils/exportLanguage';
import { exportSrtLocally, exportVttLocally, exportTtmlLocally, exportTxtLocally, downloadLocally } from '../../utils/localExporter';

const EXPORT_FORMATS = [
  {
    key: 'ttml',
    name: 'TTML / DFXP',
    ext: '.ttml',
    icon: FileCode,
    description: 'Primary delivery format with styling cues, regions, and XML namespace.',
    badge: 'For broadcast delivery',
    badgeColor: 'bg-[var(--ss-raised)] text-slate-300 border-[var(--ss-line)]',
  },
  {
    key: 'srt',
    name: 'SubRip Subtitle',
    ext: '.srt',
    icon: FileText,
    description: 'Universal standard subtitle format with millisecond timecodes and styling.',
    badge: 'Most common',
    badgeColor: 'bg-[var(--ss-raised)] text-slate-300 border-[var(--ss-line)]',
  },
  {
    key: 'vtt',
    name: 'WebVTT',
    ext: '.vtt',
    icon: Globe,
    description: 'Web-native format with HTML5 video player integration and line positioning.',
    badge: 'For web players',
    badgeColor: 'bg-[var(--ss-raised)] text-slate-300 border-[var(--ss-line)]',
  },
  {
    key: 'txt',
    name: 'Plain Text Transcript',
    ext: '.txt',
    icon: File,
    description: 'Clean dialogue text without timecodes for review and print deliverables.',
    badge: 'No timecodes',
    badgeColor: 'bg-[var(--ss-raised)] text-slate-300 border-[var(--ss-line)]',
  },
];

export default function SubtitleExportModal({ isOpen, onClose, events: liveEvents = [], filename = 'subtitles', tracks = {}, activeTrack = null, sourceTrack = null }) {
  const [selectedFormat, setSelectedFormat] = useState('srt');
  const [isExporting, setIsExporting] = useState(false);
  const exportJob = useRef(null); // the server-side export, if one is running
  const [customFilename, setCustomFilename] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [languageChoice, setLanguageChoice] = useState(null); // null = follow the track being edited

  // Language tracks: the track on screen is `liveEvents`, the others come from `tracks`
  const trackEventsFor = (code) => (code === activeTrack ? liveEvents : tracks[code] || null);
  const sourceCode = sourceTrack || activeTrack;
  const translatedCodes = useMemo(
    () => Object.keys({ ...tracks, ...(activeTrack ? { [activeTrack]: 1 } : {}) }).filter((c) => c !== sourceCode),
    [tracks, activeTrack, sourceCode],
  );
  const languageOptions = useMemo(
    () => exportLanguageOptions(translatedCodes, sourceCode ? langName(sourceCode) : ''),
    [translatedCodes, sourceCode],
  );
  const language = languageChoice && isValidExportLanguage(languageChoice, translatedCodes)
    ? languageChoice : (activeTrack && activeTrack !== sourceCode ? `tr:${activeTrack}` : 'src');
  const languageCode = language.includes(':') ? language.split(':')[1] : null;
  const events = useMemo(() => {
    const source = sourceCode ? trackEventsFor(sourceCode) || liveEvents : liveEvents;
    return eventsForExport(language, source, languageCode ? trackEventsFor(languageCode) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language, liveEvents, tracks, activeTrack, sourceCode]);

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
    exportJob.current?.cancel(); // Cancel also stops an export that is still compiling on the server
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      onClose();
    }, 220);
  };

  const languageSuffix = exportLanguageSuffix(language);
  const exportFilename = customFilename.trim() || `${filename.replace(/\.[^/.]+$/, '') || 'subtitles'}${languageSuffix}`;
  const selectedFormatInfo = EXPORT_FORMATS.find(f => f.key === selectedFormat);

  const handleExport = async () => {
    if (!events || events.length === 0) return;
    setIsExporting(true);

    try {
      let content = '';
      let mimeType = 'text/plain;charset=utf-8';

      if (selectedFormat === 'srt') {
        content = exportSrtLocally(events);
        mimeType = 'text/plain;charset=utf-8';
      } else if (selectedFormat === 'vtt') {
        content = exportVttLocally(events);
        mimeType = 'text/vtt;charset=utf-8';
      } else if (selectedFormat === 'ttml') {
        content = exportTtmlLocally(events, languageCode || sourceCode || 'en');
        mimeType = 'application/xml;charset=utf-8';
      } else if (selectedFormat === 'txt') {
        content = exportTxtLocally(events);
        mimeType = 'text/plain;charset=utf-8';
      } else {
        content = exportSrtLocally(events);
      }

      const ext = selectedFormatInfo?.ext || '.srt';
      downloadLocally(content, `${exportFilename}${ext}`, mimeType);
      onClose();
    } catch (err) {
      console.warn('Local export error, attempting backend fallback:', err);
      const job = startJob(API_BASE);
      exportJob.current = job;
      try {
        const response = await fetch(`${API_BASE}/api/subtitle/export`, {
          method: 'POST',
          signal: job.signal,
          headers: jobHeaders(job, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({
            events: events,
            filename: exportFilename,
            format: selectedFormat,
            language: languageCode || sourceCode || 'en',
          }),
        });

        if (!response.ok) throw new Error('Export failed');

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${exportFilename}${selectedFormatInfo?.ext || '.srt'}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        onClose();
      } catch (backupErr) {
        if (isCancelError(backupErr)) return; // cancelled on purpose: no file, no error
        console.error('Export error:', backupErr);
        alert('Export failed. Please verify the backend connection.');
      } finally {
        if (exportJob.current === job) exportJob.current = null;
      }
    } finally {
      setIsExporting(false);
    }
  };

  if (!isOpen) return null;

  const labelCls = 'block text-[11px] font-semibold text-[var(--ss-faint)] mb-1.5';
  const fieldCls = 'w-full h-9 px-3 rounded-lg bg-[var(--ss-bg)] border border-[var(--ss-line)] text-[13px] text-[var(--ss-text)] focus:outline-none focus:border-[var(--ss-accent)] disabled:opacity-60';

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm transition-opacity duration-200 ${
        isClosing ? 'animate-mac-backdrop-exit pointer-events-none' : 'animate-in fade-in duration-200'
      }`}
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Export subtitles"
        className={`flex flex-col bg-[var(--ss-panel)] border border-[var(--ss-line)] rounded-xl shadow-2xl w-full max-w-lg max-h-[calc(100dvh-1.5rem)] sm:max-h-[calc(100dvh-2rem)] overflow-hidden text-[var(--ss-text)] ${
          isClosing ? 'animate-mac-squish-exit' : 'animate-mac-squish'
        }`}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b border-[var(--ss-line)] shrink-0">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-[var(--ss-text)]">Export subtitles</h2>
            <p className="text-[11px] text-[var(--ss-muted)] mt-0.5 truncate">{events.length} {events.length === 1 ? 'subtitle' : 'subtitles'} → {exportFilename}{selectedFormatInfo?.ext}</p>
          </div>
          <button onClick={handleDismiss} aria-label="Close" className="p-1.5 rounded-lg hover:bg-[var(--ss-raised)] text-[var(--ss-muted)] hover:text-[var(--ss-text)] transition-colors cursor-pointer shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable body: shrinks to any window height */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls} htmlFor="export-filename">File name</label>
              <input
                id="export-filename"
                type="text"
                value={customFilename}
                onChange={e => setCustomFilename(e.target.value)}
                placeholder={filename.replace(/\.[^/.]+$/, '')}
                className={`${fieldCls} font-mono`}
              />
            </div>
            <div>
              <label className={labelCls} htmlFor="export-language">Language</label>
              <select
                id="export-language"
                value={language}
                onChange={e => setLanguageChoice(e.target.value)}
                disabled={languageOptions.length < 2}
                className={fieldCls}
              >
                {languageOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              {languageOptions.length < 2 && (
                <p className="text-[10px] text-[var(--ss-faint)] mt-1">Translate the subtitles to export other languages.</p>
              )}
            </div>
          </div>

          <div>
            <span className={labelCls}>Format</span>
            <div className="space-y-2">
              {EXPORT_FORMATS.map(fmt => {
                const Icon = fmt.icon;
                const isSelected = selectedFormat === fmt.key;
                return (
                  <button
                    key={fmt.key}
                    onClick={() => setSelectedFormat(fmt.key)}
                    aria-pressed={isSelected}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg border transition-colors text-left cursor-pointer ${
                      isSelected
                        ? 'border-[var(--ss-accent)] bg-[var(--ss-selected)]'
                        : 'border-[var(--ss-line)] bg-[var(--ss-bg)]/40 hover:bg-[var(--ss-raised)]'
                    }`}
                  >
                    <div className={`w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${isSelected ? 'bg-[var(--ss-accent)] text-[var(--ss-accent-ink)]' : 'bg-[var(--ss-raised)] text-[var(--ss-muted)]'}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[13px] font-semibold text-[var(--ss-text)]">{fmt.name}</span>
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-md border bg-[var(--ss-raised)] text-[var(--ss-muted)] border-[var(--ss-line)]">{fmt.badge}</span>
                      </div>
                      <p className="text-[11px] text-[var(--ss-muted)] mt-0.5 line-clamp-2">{fmt.description}</p>
                    </div>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-[var(--ss-accent)] text-[var(--ss-accent-ink)] flex items-center justify-center shrink-0">
                        <Check className="w-3 h-3" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--ss-line)] shrink-0">
          <button
            onClick={handleDismiss}
            className="h-9 px-4 rounded-lg text-[13px] font-medium text-[var(--ss-muted)] hover:text-[var(--ss-text)] hover:bg-[var(--ss-raised)] border border-[var(--ss-line)] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={isExporting || !events || events.length === 0}
            className="h-9 px-4 rounded-lg text-[13px] font-semibold text-[var(--ss-accent-ink)] bg-[var(--ss-accent)] hover:bg-[var(--ss-accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            {isExporting ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                Compiling...
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                Export {selectedFormatInfo?.ext}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

