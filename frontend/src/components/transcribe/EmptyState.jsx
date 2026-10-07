import React, { useState } from 'react';
import { UploadCloud, Sparkles, Loader2, Users, Mic2, ShieldCheck } from 'lucide-react';

export default function EmptyState({ filename, isExtractingAudio, extractionNotice, onPickFile, onDropFile, onTranscribe, onOpenProjects, video }) {
  const [dragging, setDragging] = useState(false);

  return (
    <div className="flex-1 flex items-center justify-center p-8 overflow-y-auto">
      <div className="w-full" style={{ maxWidth: 640 }}>
        {video && <div style={{ marginBottom: 16, maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>{video}<p style={{ color: 'var(--ts-faint)', fontSize: 12, marginTop: 8, textAlign: 'center' }}>Preview follows the player below. Use it to check the video before transcribing.</p></div>}
        <label
          htmlFor="ts-media-input"
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files?.[0]; if (f) onDropFile(f); }}
          className="flex flex-col items-center text-center"
          style={{
            cursor: 'pointer', padding: '48px 32px', borderRadius: 16, transition: 'all 0.15s',
            border: `1.5px dashed ${dragging ? 'var(--ts-accent)' : 'var(--ts-line)'}`,
            background: dragging ? 'var(--ts-selected)' : 'var(--ts-panel)',
          }}
        >
          {isExtractingAudio ? (
            <Loader2 size={36} className="animate-spin" style={{ color: 'var(--ts-accent)' }} />
          ) : (
            <UploadCloud size={36} style={{ color: 'var(--ts-accent)' }} />
          )}
          <h1 style={{ fontSize: 20, fontWeight: 600, marginTop: 16 }}>
            {filename ? filename : 'Drop a video or audio file'}
          </h1>
          <p style={{ color: 'var(--ts-muted)', marginTop: 6 }}>
            {isExtractingAudio
              ? extractionNotice || 'Preparing audio'
              : filename
              ? 'Media is ready. Choose the language above, then start.'
              : 'MP4, MKV, MOV, WAV, MP3, M4A, FLAC and more. Or click to browse.'}
          </p>
        </label>

        {filename && !isExtractingAudio && (
          <div className="flex justify-center mt-5">
            <button type="button" className="ts-btn ts-btn-primary" style={{ height: 40, padding: '0 20px', fontSize: 14 }} onClick={onTranscribe}>
              <Sparkles size={16} /> Start transcription
            </button>
          </div>
        )}

        <div className="grid grid-cols-3 gap-3 mt-8">
          {[
            [Users, 'Every speaker separate', 'Each voice gets its own line and label, never merged.'],
            [Mic2, 'Gender detected', 'Set per line, correctable for a whole speaker at once.'],
            [ShieldCheck, 'Checked against Karya rules', 'Live quality score as you edit.'],
          ].map(([Icon, title, text]) => (
            <div key={title} style={{ background: 'var(--ts-panel)', border: '1px solid var(--ts-line)', borderRadius: 12, padding: 14 }}>
              <Icon size={16} style={{ color: 'var(--ts-accent)' }} />
              <div style={{ fontWeight: 600, marginTop: 8 }}>{title}</div>
              <div style={{ color: 'var(--ts-muted)', fontSize: 12, marginTop: 2, lineHeight: 1.5 }}>{text}</div>
            </div>
          ))}
        </div>

        <p className="text-center mt-6" style={{ color: 'var(--ts-muted)' }}>
          Already transcribed something?{' '}
          <button type="button" onClick={onOpenProjects} style={{ color: 'var(--ts-accent)', background: 'none', border: 0, textDecoration: 'underline' }}>
            Open a saved project
          </button>
        </p>
        <p className="text-center ts-mono" style={{ color: 'var(--ts-faint)', fontSize: 11, marginTop: 12 }}>
          build {typeof window !== 'undefined' ? window.__TRANSCRIBE_BUILD__ : ''}
        </p>
      </div>
    </div>
  );
}
