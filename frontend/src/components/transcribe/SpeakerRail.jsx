import React, { useState } from 'react';
import { Users } from 'lucide-react';
import { formatClock } from './speakerUtils';

const GENDERS = [
  { value: 'Male', short: 'M', label: 'Male' },
  { value: 'Female', short: 'F', label: 'Female' },
  { value: 'Unknown', short: '?', label: 'Unknown' },
];

function SpeakerCard({ speaker, isFiltered, onFilter, onRename, onSetGender, cast, onAssign }) {
  const [draft, setDraft] = useState(null); // null = not editing
  const commit = () => {
    if (draft !== null && draft.trim() && draft.trim() !== speaker.name) onRename(speaker.name, draft.trim());
    setDraft(null);
  };

  return (
    <div
      className="rounded-xl p-3 border"
      style={{
        background: isFiltered ? 'var(--ts-selected)' : 'var(--ts-raised)',
        borderColor: isFiltered ? 'rgba(var(--ts-accent-rgb), 0.5)' : 'var(--ts-line)',
      }}
    >
      <div className="flex items-center gap-2">
        <span className="ts-spkdot" style={{ background: speaker.color }} />
        <input
          aria-label={`Rename ${speaker.name}`}
          className="ts-field ts-field-sm flex-1 font-semibold"
          style={{ background: 'transparent', borderColor: draft === null ? 'transparent' : undefined, paddingLeft: 4 }}
          value={draft ?? speaker.name}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') { setDraft(null); e.currentTarget.blur(); }
          }}
          title="Click to rename. Renames every line of this speaker."
        />
      </div>

      <div className="flex items-center justify-between mt-2.5">
        <div className="ts-seg" role="group" aria-label={`Gender for ${speaker.name}`}>
          {GENDERS.map((g) => (
            <button
              key={g.value}
              type="button"
              title={g.label}
              aria-pressed={speaker.gender === g.value && !speaker.mixedGender}
              onClick={() => onSetGender(speaker.name, g.value)}
            >
              {g.short}
            </button>
          ))}
        </div>
        <span className="ts-mono" style={{ color: 'var(--ts-muted)', fontSize: 12 }}>
          {speaker.count} lines · {formatClock(speaker.seconds)}
        </span>
      </div>

      {cast.length > 0 && (
        <select
          className="ts-field ts-field-sm" style={{ width: '100%', marginTop: 10 }}
          aria-label={`Assign a character to ${speaker.name}`} value=""
          onChange={(e) => { if (e.target.value) onAssign(speaker.name, e.target.value); }}
        >
          <option value="">Assign character…</option>
          {cast.map((c) => <option key={c.name} value={c.name}>{c.name} ({c.gender})</option>)}
        </select>
      )}

      <div className="flex items-center justify-between mt-2.5">
        <button type="button" className="ts-btn ts-btn-sm ts-btn-ghost" onClick={() => onFilter(speaker.name)} style={{ paddingLeft: 0 }}>
          {isFiltered ? 'Show all speakers' : 'Show only this speaker'}
        </button>
        {speaker.mixedGender && (
          <span className="ts-chip ts-chip-warn" title="This speaker has lines with different genders. Pick one to apply to all.">
            Mixed
          </span>
        )}
      </div>
    </div>
  );
}

export default function SpeakerRail({ roster, filterSpeaker, onFilter, onRename, onSetGender, onOpenPanel, video, cast, onOpenCast, onAssign }) {
  return (
    <aside
      aria-label="Speakers"
      className="flex flex-col flex-1 min-h-0 min-w-0"
      style={{ background: 'var(--ts-panel)', borderRight: '1px solid var(--ts-line)' }}
    >
      {video && <div className="p-3 pb-0 shrink-0">{video}</div>}
      <div className="flex items-center justify-between px-4" style={{ height: 48, borderBottom: '1px solid var(--ts-line)' }}>
        <div className="flex items-center gap-2 font-semibold">
          <Users size={15} style={{ color: 'var(--ts-accent)' }} />
          Speakers
          <span className="ts-chip">{roster.length}</span>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" className="ts-btn ts-btn-sm ts-btn-primary" onClick={onOpenPanel} title="Listen to each speaker, name them, merge or move lines">
            Edit
          </button>
          <button type="button" className="ts-btn ts-btn-sm" onClick={onOpenCast} title="Characters and genders for this show">
            Cast{cast.length ? ` (${cast.length})` : ''}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {roster.map((spk) => (
          <SpeakerCard
            key={spk.name}
            speaker={spk}
            isFiltered={filterSpeaker === spk.name}
            onFilter={onFilter}
            onRename={onRename}
            onSetGender={onSetGender}
            cast={cast}
            onAssign={onAssign}
          />
        ))}
      </div>

      <p className="px-4 py-3" style={{ color: 'var(--ts-faint)', fontSize: 12, borderTop: '1px solid var(--ts-line)', lineHeight: 1.5 }}>
        Rename or set gender here and it applies to every line of that speaker, and to all exports.
      </p>
    </aside>
  );
}
