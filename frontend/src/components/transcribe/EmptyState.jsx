import React, { useState } from 'react';
import '../noun.css';
import { UploadCloud, Loader2, Square, FolderOpen } from 'lucide-react';
import LanguageSelect from './LanguageSelect';

/**
 * Pre-transcription screen: one centered card. Empty, it is a drop zone; once media is loaded it becomes a
 * compact summary; the spoken language is picked here and Transcribe is in the top bar.
 */
export default function EmptyState({
  filename, isExtractingAudio, extractionNotice, onCancelExtract, onDropFile, onOpenProjects, video, language, setLanguage,
}) {
  const [dragging, setDragging] = useState(false);
  const drop = {
    onDragOver: (e) => { e.preventDefault(); setDragging(true); },
    onDragLeave: () => setDragging(false),
    onDrop: (e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onDropFile(f); },
  };
  const card = {
    width: '100%', maxWidth: 560, borderRadius: 22, background: 'var(--ts-panel)', transition: 'border-color 0.15s, background 0.15s, box-shadow 0.15s',
    border: `${filename || isExtractingAudio ? '1px solid' : '2px dashed'} ${dragging ? 'var(--ts-accent)' : 'var(--ts-line)'}`,
    boxShadow: dragging ? '0 0 0 4px rgba(var(--kt-accent-rgb), .2)' : 'none',
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto" {...drop}>
      {!filename && !isExtractingAudio && (
        <div style={{ width: '100%', maxWidth: 560, marginBottom: 20 }}>
          <h1 className="nx-display" style={{ fontSize: 28, fontWeight: 700, lineHeight: 1.1, margin: 0 }}>Transcribe a recording</h1>
          <p style={{ color: 'var(--ts-muted)', marginTop: 8 }}>Speaker-labelled transcripts with QC, ready as CSV, DOCX and XLSX.</p>
        </div>
      )}
      {!filename && !isExtractingAudio ? (
        <label htmlFor="ts-media-input" className="flex flex-col items-center text-center" style={{ ...card, cursor: 'pointer', padding: '52px 32px', background: dragging ? 'var(--ts-selected)' : card.background }}>
          <span className="nx-brand-grad" style={{ width: 56, height: 56, borderRadius: 16, display: 'grid', placeItems: 'center', color: '#fff' }}><UploadCloud size={26} /></span>
          <span className="nx-display" style={{ fontSize: 19, fontWeight: 600, marginTop: 14 }}>Drop an audio or video file to start</span>
          <span style={{ color: 'var(--ts-muted)', marginTop: 4 }}>or click to browse. MP3, WAV, M4A, MP4, MKV, MOV and more.</span>
        </label>
      ) : (
        <div style={{ ...card, padding: 20 }}>
          <div className="flex items-center gap-4">
            <div style={{ width: 112, flex: 'none' }}>
              {video || <div style={{ aspectRatio: '16 / 9', borderRadius: 10, background: 'var(--ts-raised)' }} />}
            </div>
            <div className="min-w-0" style={{ flex: 1 }}>
              <div title={filename} style={{ fontWeight: 600, fontSize: 14, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', wordBreak: 'break-word' }}>{filename}</div>
              {isExtractingAudio
                ? <div className="flex items-center gap-1.5" style={{ color: 'var(--ts-muted)', marginTop: 4 }}><Loader2 size={12} className="animate-spin" /> {extractionNotice || 'Preparing audio'}</div>
                : <label htmlFor="ts-media-input" style={{ color: 'var(--ts-accent)', cursor: 'pointer', marginTop: 4, display: 'inline-block' }}>Change</label>}
            </div>
          </div>

          {isExtractingAudio && onCancelExtract && (
            <button type="button" className="ts-btn" onClick={onCancelExtract} style={{ width: '100%', height: 42, fontSize: 14, marginTop: 12 }}>
              <Square size={14} /> Cancel
            </button>
          )}

          {!isExtractingAudio && (
            <p style={{ color: 'var(--ts-muted)', marginTop: 16, lineHeight: 1.5 }}>
              Check the language below, then press <strong style={{ color: 'var(--ts-text)' }}>Transcribe</strong>.
            </p>
          )}
        </div>
      )}

      {setLanguage && !isExtractingAudio && (
        <div style={{ width: '100%', maxWidth: 560, marginTop: 16 }}>
          <LanguageSelect value={language} onChange={setLanguage} />
        </div>
      )}

      <button type="button" onClick={onOpenProjects} className="nx-ghost" style={{ marginTop: 22 }}>
        <FolderOpen size={15} /> Open saved project
      </button>

      <p className="text-center ts-mono" style={{ color: 'var(--ts-faint)', fontSize: 11, marginTop: 12 }}>
        build {typeof window !== 'undefined' ? window.__TRANSCRIBE_BUILD__ : ''}
      </p>
    </div>
  );
}
