import { getSpeakerPalette } from '../../theme/themeEngine';

// Distinct data colours for telling speakers apart (editable in Appearance > Speakers).
const palette = () => getSpeakerPalette();

export function speakerColor(name, order) {
  if (typeof order === 'number') return palette()[order % palette().length];
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = (name || '').charCodeAt(i) + ((hash << 5) - hash);
  return palette()[Math.abs(hash) % palette().length];
}

// Speakers in order of first appearance, with counts and total talk time.
export function buildRoster(segments) {
  const map = new Map();
  (segments || []).forEach((s) => {
    const name = s.speaker || 'Speaker 1';
    if (!map.has(name)) map.set(name, { name, count: 0, seconds: 0, genders: {} });
    const r = map.get(name);
    r.count += 1;
    r.seconds += Math.max(0, (s.end_time || 0) - (s.start_time || 0));
    const g = s.gender || 'Unknown';
    r.genders[g] = (r.genders[g] || 0) + 1;
  });
  return Array.from(map.values()).map((r, i) => ({
    ...r,
    color: palette()[i % palette().length],
    gender: Object.keys(r.genders).sort((a, b) => r.genders[b] - r.genders[a])[0] || 'Unknown',
    mixedGender: Object.keys(r.genders).length > 1,
  }));
}

export function formatClock(secs) {
  const s = Math.max(0, secs || 0);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function formatStamp(secs) {
  const s = Math.max(0, secs || 0);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.round((s - Math.floor(s)) * 1000);
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
}
