import React, { useEffect, useMemo, useRef, useState } from 'react';
import './transcribe.css';
import TopBar from './TopBar';
import TranscribeRail from './TranscribeRail';
import SpeakerRail from './SpeakerRail';
import TranscriptList from './TranscriptList';
import ProgressStrip from './ProgressStrip';
import EmptyState from './EmptyState';
import TranscribeTimeline from './TranscribeTimeline';
import VideoPane, { createMediaBus } from './VideoPane';
import CastModal from './CastModal';
import LayoutPanel from './LayoutPanel';
import Splitter from './Splitter';
import { useTranscribeLayout, DEFAULT_LAYOUT, LIMITS, TIMELINE_MIN } from './layoutModel';
import SpeakerPanel from './SpeakerPanel';
import { rememberSpeakerName } from './speakerNames';
import { API_BASE } from '../../config';
import QcDrawer from './QcDrawer';
import CentroidModal from '../subtitle/CentroidModal';
import { AUTO_SOURCE, TRANSLATE_LANGUAGES, TRANSLATE_SOURCE_LANGUAGES, translateCodeForName, translateLangName } from '../../data/languageCatalog';
import { buildRoster } from './speakerUtils';
import { exportLanguageOptions, isValidExportLanguage, segmentsForExport, parseExportLanguage } from '../../utils/exportLanguage';
import { loadCast, saveCast, findCastMember } from './castUtils';

/**
 * Transcribe Studio layout. All state and API handlers stay in App.jsx (TranscribeApp);
 * this component only arranges the screen and applies speaker-level edits.
 */
export default function TranscribeStudio(p) {
  const studio = useTranscribeLayout(Boolean(p.user));
  const { layout } = studio;
  const timelineHidden = layout.timelinePos === 'hidden';
  const [showLayout, setShowLayout] = useState(false);
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
  const [centroidCmd, setCentroidCmd] = useState(null);
  const [tracks, setTracks] = useState({}); // language code -> translated cues
  const [activeTrack, setActiveTrack] = useState(null);
  const [exportChoice, setExportChoice] = useState(null); // null = follow the active track
  const [listView, setListView] = useState('side'); // 'side' = source + active language, 'only' = active language alone
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
  // Centroid code of the language the transcript was detected as (null while unknown)
  const detectedCode = useMemo(() => translateCodeForName(p.detectedLanguage), [p.detectedLanguage]);
  const translation = useMemo(() => (activeTrack && tracks[activeTrack]
    ? { code: activeTrack, byId: new Map(tracks[activeTrack].map((e) => [e.id, e.text])) } : null), [activeTrack, tracks]);

  // A different transcript invalidates the translations of the old one. Keyed on the file name only: relinking or
  // restoring media for the same file must not wipe its tracks.
  useEffect(() => {
    setTracks({});
    setActiveTrack(null);
    setExportChoice(null);
  }, [p.filename]);

  // Draft / project restore: put back translated tracks (and which one was active), QC state and view choices.
  // Declared after the effect above so a restore that arrives together with a new file name wins.
  const [centroidRestore, setCentroidRestore] = useState(null);
  const centroidGet = useRef(null);
  useEffect(() => {
    const r = p.studioRestore;
    if (!r) return;
    const d = r.data || {};
    setTracks(d.tracks || {});
    setActiveTrack(d.activeTrack && d.tracks?.[d.activeTrack] ? d.activeTrack : null);
    setExportChoice(d.exportChoice || null);
    if (d.listView) setListView(d.listView);
    if (d.qcView) setQcView(d.qcView);
    setCentroidRestore({ n: r.n, data: d.centroid || null });
  }, [p.studioRestore]); // eslint-disable-line react-hooks/exhaustive-deps

  // What a draft or saved project keeps. The app reads this when it saves, so it is always current.
  if (p.studioApiRef) {
    p.studioApiRef.current = {
      get: () => ({ tracks, activeTrack, listView, qcView, exportChoice, centroid: centroidGet.current ? centroidGet.current() : null }),
    };
  }
  // Tell the app when there is something new to save (a translation, a QC run, a fix applied)
  useEffect(() => { p.onStudioDirty?.(); }, [tracks, activeTrack, centroidState, listView, exportChoice]); // eslint-disable-line react-hooks/exhaustive-deps

  // Export language: follows the track on screen until the user picks one
  const trackCodes = Object.keys(tracks);
  const exportLang = exportChoice && isValidExportLanguage(exportChoice, trackCodes)
    ? exportChoice : (activeTrack && tracks[activeTrack] ? `tr:${activeTrack}` : 'src');
  const exportLangOptions = useMemo(
    () => exportLanguageOptions(Object.keys(tracks), p.detectedLanguage || p.language),
    [tracks, p.detectedLanguage, p.language],
  );
  /** Segments and language label for an export in the chosen language */
  const exportPayload = () => {
    const { kind, code } = parseExportLanguage(exportLang);
    const label = code ? translateLangName(code) : null;
    return {
      segments: segmentsForExport(exportLang, p.segments, code ? tracks[code] : null),
      translationLanguage: kind === 'both' ? label : null,
      suffix: kind === 'tr' ? `.${code}` : kind === 'both' ? `.${code}+orig` : '',
    };
  };

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
        const cur = next[i];
        const text = ed.text ?? (key === 'id' ? cur.text : cur.transcript);
        if (key === 'id') {
          const end = ed.end ?? cur.end_time;
          next[i] = { ...cur, text, lines: text.split('\n'), ...(ed.end != null ? { end_time: end, end, duration: Math.round((end - cur.start_time) * 1000) / 1000 } : {}) };
        } else {
          next[i] = { ...cur, transcript: text, ...(ed.end != null ? { end_time: ed.end } : {}) };
        }
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

  const cards = layout.paneStyle === 'cards';
  const paneStyle = cards
    ? { borderRadius: layout.radius, border: '1px solid var(--ts-line)', overflow: 'hidden' }
    : undefined;

  const notes = (p.notes || []).filter((n) => n !== dismissedNotes);

  const setSpeakerGender = (name, gender) => {
    applyToSegments(p.segments.map((s) => (s.speaker === name ? { ...s, gender } : s)));
  };

  return (
    <div className="transcribe-studio">
      <TopBar
        filename={p.filename} canTranscribe={p.canTranscribe}
        isTranscribing={p.isTranscribing} progressPercent={p.progressPercent}
        isExtractingAudio={p.isExtractingAudio}
        onFileSelect={p.onFileSelect} onTranscribe={p.onTranscribe} onBackToHome={p.onBackToHome}
        segmentCount={p.segments.length}
        canUndo={p.canUndo} canRedo={p.canRedo} onUndo={p.onUndo} onRedo={p.onRedo}
        isSaving={p.isSaving} onSave={p.onSave}
        exportFormats={p.exportFormats} onDownload={() => p.onDownload(exportPayload())} onDubbing={() => p.onDubbing(exportPayload())} isExporting={p.isExporting}
        onOpenProjects={p.onOpenProjects} onOpenStats={p.onOpenStats} onOpenDiff={p.onOpenDiff}
        onOpenNotes={p.onOpenNotes} onOpenGuidelines={p.onOpenGuidelines}
        onImportSubtitles={p.onImportSubtitles}
        user={p.user} onOpenLogoutModal={p.onOpenLogoutModal}
        onOpenSpeakers={() => setShowSpeakers(true)} speakersOpen={showSpeakers}
        onOpenLayout={() => setShowLayout(true)} onResetLayout={studio.reset}
        timelineHidden={layout.timelinePos === 'hidden'} onToggleTimeline={() => studio.patch({ timelinePos: layout.timelinePos === 'hidden' ? 'bottom' : 'hidden' })}
        onOpenTranslate={openTranslate} onOpenQc={() => (showQc ? setShowQc(false) : openQc())}
        sourceLabel={detectedCode ? translateLangName(detectedCode) : (p.detectedLanguage || 'Auto-detect')} sourceCode={detectedCode}
        targetLanguages={TRANSLATE_LANGUAGES} translateState={centroidState} activeTarget={activeTrack}
        trackCodes={Object.keys(tracks)}
        onPickTarget={(code) => { if (code === 'none') setActiveTrack(null); else if (tracks[code]) setActiveTrack(code); else setCentroidCmd({ type: 'translate', code, n: Date.now() }); }}
        onRetranslate={(code) => setCentroidCmd({ type: 'translate', code, n: Date.now() })}
        onCancelTranslate={() => setCentroidCmd({ type: 'cancel', n: Date.now() })}
      />

      <div className="ts-body">
      {layout.toolRail && (
      <TranscribeRail
        disabled={!hasSegments} translateOpen={showTranslate} onTranslate={openTranslate}
        qcOpen={showQc} onQc={() => (showQc ? setShowQc(false) : openQc())} qcIssues={centroidState.qcIssues}
        formats={p.exportFormats} onToggleFormat={p.onToggleFormat}
        onDownload={() => p.onDownload(exportPayload())} onDubbing={() => p.onDubbing(exportPayload())}
        isExporting={p.isExporting} onCancelExport={p.onCancelExport}
        exportLang={exportLang} exportLangOptions={exportLangOptions} onExportLang={setExportChoice}
      />)}
      <div className="ts-main">

      {p.isTranscribing && (
        <ProgressStrip
          stage={p.progressStage} detail={p.progressDetail} percent={p.progressPercent}
          estimated={p.progressEstimated} stepCount={p.progressStepCount} meta={p.progressMeta} stepIndex={p.progressStepIndex} elapsedSeconds={p.elapsedSeconds}
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
        <div
          className="flex flex-1 min-h-0 min-w-0"
          style={{ flexDirection: layout.speakersPos === 'right' ? 'row-reverse' : 'row', padding: cards ? layout.gap : 0, gap: cards ? 0 : undefined }}
        >
          {layout.speakersPos !== 'hidden' && (<>
            <div className="flex min-h-0 shrink-0" style={{ width: layout.speakersW, ...paneStyle }}>
              <SpeakerRail
                roster={roster} filterSpeaker={filterSpeaker}
                onFilter={(name) => setFilterSpeaker(filterSpeaker === name ? null : name)}
                onRename={renameSpeaker} onSetGender={setSpeakerGender} onOpenPanel={() => setShowSpeakers(true)} video={layout.showVideo ? video : null}
                cast={cast} onOpenCast={() => setShowCast(true)} onAssign={renameSpeaker}
              />
            </div>
            <Splitter
              axis="x" sign={layout.speakersPos === 'right' ? -1 : 1} label="Resize speaker list"
              value={layout.speakersW} min={LIMITS.speakersW[0]} max={LIMITS.speakersW[1]}
              onChange={(v) => studio.patch({ speakersW: v })} onReset={() => studio.patch({ speakersW: DEFAULT_LAYOUT.speakersW })}
              thickness={cards ? layout.gap || 6 : 6}
            />
          </>)}
          <div className="flex flex-1 min-w-0 min-h-0" style={paneStyle}>
          <TranscriptList
            segments={p.segments} roster={roster}
            filterSpeaker={filterSpeaker} setFilterSpeaker={setFilterSpeaker}
            activeSegmentId={p.activeSegmentId} setActiveSegmentId={p.setActiveSegmentId}
            setSegments={p.setSegments}
            onPlaySegment={p.onPlaySegment} onStopSegment={p.onStopSegment}
            onLint={p.onLint} onSplit={p.onSplit} onMerge={p.onMerge} onAdd={p.onAdd}
            onOpenSrtPreview={p.onOpenSrtPreview}
            translation={translation} viewMode={listView} onViewMode={setListView}
            trackCodes={trackCodes} sourceLabel={p.detectedLanguage || p.language} onSelectTrack={setActiveTrack} onTranslateMore={openTranslate}
          />
          </div>
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
            filename={p.canTranscribe ? p.filename : null} isExtractingAudio={p.isExtractingAudio} extractionNotice={p.extractionNotice} onCancelExtract={p.onCancelExtract}
            onDropFile={(file) => p.onFileSelect({ target: { files: [file] } })}
            onOpenProjects={p.onOpenProjects} video={video}
            language={p.language} setLanguage={p.setLanguage}
          />
        )
      )}
      {!hasSegments && p.isTranscribing && <div className="flex-1" />}

      {/* Timeline dock. The audio element lives inside the timeline, so it stays mounted (collapsed) when hidden. */}
      {timelineHidden && (hasSegments || p.audioUrl) && (
        <div className="flex items-center gap-2 shrink-0 px-3" style={{ height: 34, background: 'var(--ts-panel)', borderTop: '1px solid var(--ts-line)' }}>
          <span style={{ color: 'var(--ts-muted)' }}>Timeline is hidden</span>
          <button type="button" className="ts-btn ts-btn-sm ts-btn-primary" onClick={() => studio.patch({ timelinePos: 'bottom' })}>Show timeline</button>
          <button type="button" className="ts-btn ts-btn-sm ts-btn-ghost" onClick={studio.reset} title="Back to the default layout">Reset layout</button>
        </div>
      )}
      {!timelineHidden && (p.audioUrl || hasSegments) && (
        <Splitter
          axis="y" sign={-1} label="Resize timeline" thickness={cards ? layout.gap || 6 : 6}
          value={layout.timelineH || 240} min={TIMELINE_MIN} max={LIMITS.timelineH[1]}
          onChange={(v) => studio.patch({ timelineH: v })} onReset={() => studio.patch({ timelineH: 0 })}
        />
      )}
      {(p.audioUrl || hasSegments) && (
        <footer
          className="shrink-0 min-h-0"
          style={timelineHidden
            ? { height: 0, overflow: 'hidden', visibility: 'hidden' }
            : { background: 'var(--ts-panel)', borderTop: '1px solid var(--ts-line)', height: layout.timelineH ? `min(${layout.timelineH}px, 60vh)` : '42vh', minHeight: layout.timelineH ? undefined : 310, maxHeight: '75vh', ...(cards ? { margin: `0 ${layout.gap}px ${layout.gap}px`, borderRadius: layout.radius, border: '1px solid var(--ts-line)', overflow: 'hidden' } : {}) }}
        >
          <TranscribeTimeline
            audioUrl={p.audioUrl}
            videoUrl={p.videoUrl}
            restoredPeaks={p.restoredPeaks}
            restoredDuration={p.restoredDuration}
            onPeaksReady={p.onPeaksReady}
            busyNotice={p.mediaBusyNotice}
            onRelink={() => document.getElementById('ts-relink-input')?.click()}
            segments={p.segments}
            textById={translation ? translation.byId : null}
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

      </div>
      </div>

      <input
        id="ts-relink-input" type="file" accept="video/*,audio/*,.mkv,.ts,.wma" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) p.onRelinkMedia?.(f); }}
      />

      {/* Kept mounted so translations and QC results survive closing the panels */}
      <CentroidModal
        isOpen={showTranslate}
        onClose={() => setShowTranslate(false)}
        defaultSourceLang={detectedCode || AUTO_SOURCE}
        sourceHint={detectedCode}
        languages={TRANSLATE_LANGUAGES}
        sourceLanguages={TRANSLATE_SOURCE_LANGUAGES}
        langStoreSuffix="_transcribe"
        qcHost={showQc && qcView === 'centroid' ? qcHost : null}
        onOpenQc={() => openQc('centroid')}
        onOpenTranslate={() => { setShowQc(false); setShowTranslate(true); }}
        onStateChange={setCentroidState}
        onJumpToEvent={(id) => { const seg = p.segments.find((s) => s.segment_id === id); if (seg) jumpTo(seg); }}
        events={events}
        cueUnit="segment"
        glossaryTerms={[]}
        fileName={p.filename || 'transcript'}
        onApplyTextFixes={applyTextFixes}
        activeLang={activeTrack}
        trackLangs={Object.keys(tracks)}
        command={centroidCmd}
        stateRef={centroidGet}
        restoreState={centroidRestore}
        onTranslated={({ built }) => { setTracks((prev) => ({ ...prev, ...built })); const c = Object.keys(built)[0]; setActiveTrack(c || null); }}
        onShowTrack={({ code, events: cues }) => { setTracks((prev) => ({ ...prev, [code]: cues })); setActiveTrack(code); }}
      />

      <SpeakerPanel
        isOpen={showSpeakers} onClose={() => setShowSpeakers(false)}
        roster={roster} segments={p.segments} cast={cast} mediaBus={mediaBus} canPlay={Boolean(p.audioUrl)}
        onPlayOnce={p.onPlayOnce} onStop={p.onStopSegment}
        onRename={renameSpeaker} onMerge={mergeSpeakers} onMoveLine={moveLine} onAiReview={aiReviewSpeakers}
        canUndo={p.canUndo} canRedo={p.canRedo} onUndo={p.onUndo} onRedo={p.onRedo}
      />

      <LayoutPanel isOpen={showLayout} onClose={() => setShowLayout(false)} studio={studio} />

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
