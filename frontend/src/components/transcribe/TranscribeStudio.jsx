import React, { useEffect, useMemo, useState } from 'react';
import './transcribe.css';
import TopBar from './TopBar';
import SpeakerRail from './SpeakerRail';
import TranscriptList from './TranscriptList';
import ProgressStrip from './ProgressStrip';
import EmptyState from './EmptyState';
import TranscribeTimeline from './TranscribeTimeline';
import VideoPane, { createMediaBus } from './VideoPane';
import CastModal from './CastModal';
import SpeakerPanel from './SpeakerPanel';
import { rememberSpeakerName } from './speakerNames';
import { API_BASE } from '../../config';
import QcDrawer from './QcDrawer';
import CentroidModal from '../subtitle/CentroidModal';
import { ALL_LANGS } from '../subtitle/languages';
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
  const [showSpeakers, setShowSpeakers] = useState(false);
  const [dismissedNotes, setDismissedNotes] = useState(null);
  // Translate (Centroid) and QC. Subtitle Studio's Centroid panel is reused as is; it works on {id, start_time, end_time, text}.
  const [showTranslate, setShowTranslate] = useState(false);
  const [showQc, setShowQc] = useState(false);
  const [qcView, setQcView] = useState('karya');
  const [qcHost, setQcHost] = useState(null);
  const [centroidState, setCentroidState] = useState({ hasResults: false, qcIssues: null });
  const [tracks, setTracks] = useState({}); // language code -> translated cues
  const [activeTrack, setActiveTrack] = useState(null);
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
    rememberSpeakerName(member ? member.name : newName);
    applyToSegments(p.segments.map((s) => (s.speaker === oldName
      ? { ...s, speaker: member ? member.name : newName, ...(member ? { gender: member.gender } : {}) }
      : s)));
    if (filterSpeaker === oldName) setFilterSpeaker(member ? member.name : newName);
  };

  // Gender most lines of a speaker agree on (ignores Unknown); null when nothing is known
  const speakerGender = (segs, name) => {
    const tally = {};
    segs.forEach((s) => { if (s.speaker === name && s.gender && s.gender !== 'Unknown') tally[s.gender] = (tally[s.gender] || 0) + 1; });
    return Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] || null;
  };

  const mergeSpeakers = (from, into) => {
    if (from === into) return;
    const g = speakerGender(p.segments, into);
    applyToSegments(p.segments.map((s) => (s.speaker === from ? { ...s, speaker: into, ...(g ? { gender: g } : {}) } : s)));
    if (filterSpeaker === from) setFilterSpeaker(into);
  };

  // `to` null starts a new speaker
  const moveLine = (id, to) => {
    let target = to;
    if (!target) {
      const used = new Set(p.segments.map((s) => s.speaker));
      let n = 1;
      while (used.has(`Speaker ${n}`)) n += 1;
      target = `Speaker ${n}`;
    }
    const g = speakerGender(p.segments, target);
    applyToSegments(p.segments.map((s) => (s.segment_id === id ? { ...s, speaker: target, ...(g ? { gender: g } : {}) } : s)));
  };

  // AI second pass: the server only suggests (merge two speakers, move single lines); applying is one undoable edit
  const aiReviewSpeakers = async () => {
    const res = await fetch(`${API_BASE}/api/speakers/refine`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ segments: p.segments, language: p.detectedLanguage || 'Hindi' }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || `server said ${res.status}`);
    const { speaker_map: map = {}, reassign = {}, notes = [] } = await res.json();
    const merged = Object.keys(map).length;
    let moved = 0;
    const next = p.segments.map((s) => {
      const to = reassign[String(s.segment_id)] || map[s.speaker];
      if (!to || to === s.speaker) return s;
      if (reassign[String(s.segment_id)]) moved += 1;
      const g = speakerGender(p.segments, to);
      return { ...s, speaker: to, ...(g ? { gender: g } : {}) };
    });
    const extra = notes.join(' ');
    if (!merged && !moved) return `AI found nothing to fix. ${extra}`.trim();
    applyToSegments(next);
    const parts = [];
    if (merged) parts.push(`merged ${Object.entries(map).map(([a, b]) => `${a} into ${b}`).join(', ')}`);
    if (moved) parts.push(`moved ${moved} line${moved === 1 ? '' : 's'}`);
    return `AI ${parts.join(' and ')}. Use Undo to revert. ${extra}`.trim();
  };

  const updateCast = (next) => { setCast(next); saveCast(next); };

  const events = useMemo(() => p.segments.map((s) => ({
    id: s.segment_id, event_id: s.segment_id, start_time: s.start_time, end_time: s.end_time,
    start: s.start_time, end: s.end_time, text: s.transcript || '', speaker: s.speaker,
  })), [p.segments]);
  const sourceLangCode = useMemo(() => {
    const name = (p.detectedLanguage || '').toLowerCase();
    return (ALL_LANGS.find(([, n]) => n.toLowerCase() === name) || [null])[0] || 'hi';
  }, [p.detectedLanguage]);
  const translation = useMemo(() => (activeTrack && tracks[activeTrack]
    ? { code: activeTrack, byId: new Map(tracks[activeTrack].map((e) => [e.id, e.text])) } : null), [activeTrack, tracks]);

  // A new transcript invalidates the translations of the old one
  useEffect(() => { setTracks({}); setActiveTrack(null); }, [p.audioUrl, p.filename]);

  const openTranslate = () => { setShowTranslate((v) => !v); };
  const openQc = (view) => { if (view) setQcView(view); setShowQc(true); };

  // QC fixes: the transcript itself, or a translated track
  const applyTextFixes = (code, edits) => {
    const patch = (list, key) => {
      let hit = 0;
      const next = list.map((e) => e);
      edits.forEach((ed) => {
        const idKey = key === 'id' ? 'id' : 'segment_id';
        let i = ed.id != null ? next.findIndex((e) => e[idKey] === ed.id) : -1;
        if (i < 0) i = next.findIndex((e) => Math.abs((e.start_time ?? 0) - ed.start) < 0.05);
        if (i < 0) return;
        next[i] = key === 'id' ? { ...next[i], text: ed.text, lines: ed.text.split('\n') } : { ...next[i], transcript: ed.text };
        hit += 1;
      });
      return { next, hit };
    };
    if (code === 'editor') {
      const { next, hit } = patch(p.segments, 'segment_id');
      if (hit) applyToSegments(next);
      return hit;
    }
    const saved = tracks[code];
    if (!saved) return 0;
    const { next, hit } = patch(saved, 'id');
    if (hit) setTracks((prev) => ({ ...prev, [code]: next }));
    return hit;
  };

  const jumpTo = (seg) => { p.setActiveSegmentId(seg.segment_id); p.onPlaySegment(seg.start_time, seg.end_time); };

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
        onDownload={p.onDownload} onDubbing={p.onDubbing} isExporting={p.isExporting}
        onOpenProjects={p.onOpenProjects} onOpenStats={p.onOpenStats} onOpenDiff={p.onOpenDiff}
        onOpenNotes={p.onOpenNotes} onOpenGuidelines={p.onOpenGuidelines}
        onImportSubtitles={p.onImportSubtitles}
        user={p.user} onOpenLogoutModal={p.onOpenLogoutModal}
        onOpenTranslate={openTranslate} translateOpen={showTranslate}
        onOpenQc={() => (showQc ? setShowQc(false) : openQc())} qcOpen={showQc} centroidQcIssues={centroidState.qcIssues}
      />

      {p.isTranscribing && (
        <ProgressStrip
          stage={p.progressStage} detail={p.progressDetail} percent={p.progressPercent}
          estimated={p.progressEstimated} stepCount={p.progressStepCount} meta={p.progressMeta} stepIndex={p.progressStepIndex} elapsedSeconds={p.elapsedSeconds}
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
            onRename={renameSpeaker} onSetGender={setSpeakerGender} onOpenBulk={p.onOpenSpeakerSwap} onOpenPanel={() => setShowSpeakers(true)} video={video}
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
            translation={translation} onClearTranslation={() => setActiveTrack(null)}
          />
          {showQc && (
            <QcDrawer
              view={qcView} onView={setQcView} centroidIssues={centroidState.qcIssues} onClose={() => setShowQc(false)}
              setHost={setQcHost} segments={p.segments} score={p.complianceScore} errors={p.totalErrors} warnings={p.totalWarnings}
              onJump={jumpTo}
            />
          )}
        </div>
      ) : (
        !p.isTranscribing && (
          <EmptyState
            filename={p.canTranscribe ? p.filename : null} isExtractingAudio={p.isExtractingAudio} extractionNotice={p.extractionNotice}
            onDropFile={(file) => p.onFileSelect({ target: { files: [file] } })}
            onTranscribe={p.onTranscribe} onOpenProjects={p.onOpenProjects} video={video}
            language={p.language} setLanguage={p.setLanguage} script={p.script} setScript={p.setScript}
          />
        )
      )}
      {!hasSegments && p.isTranscribing && <div className="flex-1" />}

      {p.audioUrl && (
        <footer className="shrink-0" style={{ background: 'var(--ts-panel)', borderTop: '1px solid var(--ts-line)', height: '38vh', minHeight: 260 }}>
          <TranscribeTimeline
            audioUrl={p.audioUrl}
            videoUrl={p.videoUrl}
            segments={p.segments}
            activeSegmentId={p.activeSegmentId}
            setActiveSegmentId={p.setActiveSegmentId}
            onSegmentTimeChange={p.onSegmentTimeChange}
            onSplit={p.onSplit}
            onMerge={p.onMerge}
            onAdd={p.onAdd}
            onUndo={p.canUndo ? p.onUndo : null}
            onRedo={p.canRedo ? p.onRedo : null}
            playTargetTime={p.playTargetTime}
            onTimeUpdate={(t) => mediaBus.emit({ time: t })}
            onPlayStateChange={(playing) => mediaBus.emit({ playing })}
          />
        </footer>
      )}

      {/* Kept mounted so translations and QC results survive closing the panels */}
      <CentroidModal
        isOpen={showTranslate}
        onClose={() => setShowTranslate(false)}
        defaultSourceLang={sourceLangCode}
        qcHost={showQc && qcView === 'centroid' ? qcHost : null}
        onOpenQc={() => openQc('centroid')}
        onOpenTranslate={() => { setShowQc(false); setShowTranslate(true); }}
        onStateChange={setCentroidState}
        onJumpToEvent={(id) => { const seg = p.segments.find((s) => s.segment_id === id); if (seg) jumpTo(seg); }}
        events={events}
        glossaryTerms={[]}
        fileName={p.filename || 'transcript'}
        onApplyTextFixes={applyTextFixes}
        activeLang={activeTrack}
        trackLangs={Object.keys(tracks)}
        onTranslated={({ built }) => { setTracks(built); setActiveTrack(null); }}
        onShowTrack={({ code, events: cues }) => { setTracks((prev) => ({ ...prev, [code]: cues })); setActiveTrack(code); }}
      />

      <SpeakerPanel
        isOpen={showSpeakers} onClose={() => setShowSpeakers(false)}
        roster={roster} segments={p.segments} cast={cast} mediaBus={mediaBus} canPlay={Boolean(p.audioUrl)}
        onPlayOnce={p.onPlayOnce} onStop={p.onStopSegment}
        onRename={renameSpeaker} onMerge={mergeSpeakers} onMoveLine={moveLine} onAiReview={aiReviewSpeakers}
        canUndo={p.canUndo} canRedo={p.canRedo} onUndo={p.onUndo} onRedo={p.onRedo}
      />

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
