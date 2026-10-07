import React, { useMemo, useState } from 'react';
import './transcribe.css';
import TopBar from './TopBar';
import SpeakerRail from './SpeakerRail';
import TranscriptList from './TranscriptList';
import ProgressStrip from './ProgressStrip';
import EmptyState from './EmptyState';
import AudioWaveform from '../AudioWaveform';
import VideoPane, { createMediaBus } from './VideoPane';
import CastModal from './CastModal';
import { buildRoster } from './speakerUtils';
import { loadCast, saveCast, findCastMember } from './castUtils';

/**
 * Transcribe Studio layout. All state and API handlers stay in App.jsx (TranscribeApp);
 * this component only arranges the screen and applies speaker-level edits.
 */
export default function TranscribeStudio(p) {
  const [filterSpeaker, setFilterSpeaker] = useState(null);
  const [mediaBus] = useState(createMediaBus);
  const [cast, setCast] = useState(loadCast);
  const [showCast, setShowCast] = useState(false);
  const [dismissedNotes, setDismissedNotes] = useState(null);
  const roster = useMemo(() => buildRoster(p.segments), [p.segments]);
  const hasSegments = p.segments.length > 0;
  const video = p.videoUrl ? <VideoPane src={p.videoUrl} bus={mediaBus} /> : null;

  const applyToSegments = (updated) => {
    p.setSegments(updated);
    p.pushToHistory(updated);
    p.onLint(updated);
  };

  // Renaming to an existing speaker's name merges the two
  const renameSpeaker = (oldName, newName) => {
    // A name that matches a cast member also takes that member's gender
    const member = findCastMember(cast, newName);
    applyToSegments(p.segments.map((s) => (s.speaker === oldName
      ? { ...s, speaker: member ? member.name : newName, ...(member ? { gender: member.gender } : {}) }
      : s)));
    if (filterSpeaker === oldName) setFilterSpeaker(member ? member.name : newName);
  };

  const updateCast = (next) => { setCast(next); saveCast(next); };

  const notes = (p.notes || []).filter((n) => n !== dismissedNotes);

  const setSpeakerGender = (name, gender) => {
    applyToSegments(p.segments.map((s) => (s.speaker === name ? { ...s, gender } : s)));
  };

  return (
    <div className="transcribe-studio">
      <TopBar
        filename={p.filename} canTranscribe={p.canTranscribe}
        language={p.language} setLanguage={p.setLanguage}
        script={p.script} setScript={p.setScript}
        isTranscribing={p.isTranscribing} progressPercent={p.progressPercent}
        isExtractingAudio={p.isExtractingAudio}
        onFileSelect={p.onFileSelect} onTranscribe={p.onTranscribe} onBackToHome={p.onBackToHome}
        segmentCount={p.segments.length}
        complianceScore={hasSegments ? p.complianceScore : null}
        totalErrors={p.totalErrors} totalWarnings={p.totalWarnings}
        canUndo={p.canUndo} canRedo={p.canRedo} onUndo={p.onUndo} onRedo={p.onRedo}
        isSaving={p.isSaving} onSave={p.onSave}
        exportFormats={p.exportFormats} onToggleFormat={p.onToggleFormat}
        onDownload={p.onDownload} onDubbing={p.onDubbing} isExporting={p.isExporting} onCancelExport={p.onCancelExport}
        onOpenProjects={p.onOpenProjects} onOpenStats={p.onOpenStats} onOpenDiff={p.onOpenDiff}
        onOpenNotes={p.onOpenNotes} onOpenGuidelines={p.onOpenGuidelines}
        onImportSubtitles={p.onImportSubtitles}
        user={p.user} onOpenLogoutModal={p.onOpenLogoutModal}
      />

      {p.isTranscribing && (
        <ProgressStrip
          stage={p.progressStage} detail={p.progressDetail} percent={p.progressPercent}
          stepIndex={p.progressStepIndex} elapsedSeconds={p.elapsedSeconds}
          onCancel={p.onCancelTranscribe}
        />
      )}

      {notes.length > 0 && !p.isTranscribing && (
        <div
          role="alert" className="flex items-start gap-3 shrink-0 px-4 py-2.5"
          style={{ background: 'rgba(245,184,74,0.1)', borderBottom: '1px solid rgba(245,184,74,0.35)', color: 'var(--ts-text)' }}
        >
          <span className="ts-chip ts-chip-warn" style={{ flex: 'none' }}>Heads up</span>
          <span style={{ flex: 1, lineHeight: 1.5 }}>{notes.join(' ')}</span>
          <button type="button" className="ts-btn ts-btn-sm ts-btn-ghost" onClick={() => setDismissedNotes(notes[0])}>Dismiss</button>
        </div>
      )}

      {hasSegments ? (
        <div className="flex flex-1 min-h-0">
          <SpeakerRail
            roster={roster} filterSpeaker={filterSpeaker}
            onFilter={(name) => setFilterSpeaker(filterSpeaker === name ? null : name)}
            onRename={renameSpeaker} onSetGender={setSpeakerGender} onOpenBulk={p.onOpenSpeakerSwap} video={video}
            cast={cast} onOpenCast={() => setShowCast(true)} onAssign={renameSpeaker}
          />
          <TranscriptList
            segments={p.segments} roster={roster}
            filterSpeaker={filterSpeaker} setFilterSpeaker={setFilterSpeaker}
            activeSegmentId={p.activeSegmentId} setActiveSegmentId={p.setActiveSegmentId}
            setSegments={p.setSegments}
            onPlaySegment={p.onPlaySegment} onStopSegment={p.onStopSegment}
            onLint={p.onLint} onSplit={p.onSplit} onMerge={p.onMerge} onAdd={p.onAdd}
            onOpenSrtPreview={p.onOpenSrtPreview}
          />
        </div>
      ) : (
        !p.isTranscribing && (
          <EmptyState
            filename={p.canTranscribe ? p.filename : null} isExtractingAudio={p.isExtractingAudio} extractionNotice={p.extractionNotice} onCancelExtract={p.onCancelExtract}
            onDropFile={(file) => p.onFileSelect({ target: { files: [file] } })}
            onTranscribe={p.onTranscribe} onOpenProjects={p.onOpenProjects} video={video}
          />
        )
      )}
      {!hasSegments && p.isTranscribing && <div className="flex-1" />}

      {p.audioUrl && (
        <footer className="shrink-0" style={{ background: 'var(--ts-panel)', borderTop: '1px solid var(--ts-line)', maxHeight: '42vh', overflowY: 'auto' }}>
          <AudioWaveform
            audioUrl={p.audioUrl}
            segments={p.segments}
            currentSegmentId={p.activeSegmentId}
            setActiveSegmentId={p.setActiveSegmentId}
            onSegmentClick={(seg) => p.setActiveSegmentId(seg.segment_id)}
            onSegmentTimeChange={p.onSegmentTimeChange}
            onSplitSegment={p.onSplit}
            onMergeSegment={p.onMerge}
            onAddSegmentAtTime={p.onAdd}
            playTargetTime={p.playTargetTime}
            onTimeUpdate={(t) => mediaBus.emit({ time: t })}
            onPlayStateChange={(playing) => mediaBus.emit({ playing })}
          />
        </footer>
      )}

      <CastModal isOpen={showCast} cast={cast} onSave={updateCast} onClose={() => setShowCast(false)} />

      {(p.toast) && (
        <div
          role="status"
          className="fixed flex items-center gap-2"
          style={{ right: 16, bottom: 16, zIndex: 80, background: 'var(--ts-raised)', border: '1px solid var(--ts-line)', borderRadius: 10, padding: '10px 14px', boxShadow: '0 12px 32px rgba(0,0,0,0.45)' }}
        >
          <span className="ts-spkdot" style={{ background: 'var(--ts-accent)' }} />
          {p.toast}
        </div>
      )}
    </div>
  );
}
