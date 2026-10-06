const STORAGE_KEY = 'karya_cast_list';

const GENDER_WORDS = {
  male: 'Male', m: 'Male', man: 'Male', boy: 'Male',
  female: 'Female', f: 'Female', woman: 'Female', girl: 'Female',
};

// Accepts "Name, Gender", "Name<TAB>Gender", or rows pasted straight from a spreadsheet such as
// "1<TAB>Bhide<TAB>Male" (a leading serial number and a header row are ignored).
export function parseCast(text) {
  const seen = new Set();
  const cast = [];
  (text || '').split(/\r?\n/).forEach((line) => {
    const cells = line.split(/\t|,|;|\|/).map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) return;
    const genderCell = cells.find((c) => GENDER_WORDS[c.toLowerCase()]);
    if (!genderCell) return;
    const name = cells.find((c) => c !== genderCell && !/^\d+\.?$/.test(c) && !/^(sr\.?\s*no\.?|character|name)$/i.test(c));
    if (!name || seen.has(name.toLowerCase())) return;
    seen.add(name.toLowerCase());
    cast.push({ name, gender: GENDER_WORDS[genderCell.toLowerCase()] });
  });
  return cast;
}

export function castToText(cast) {
  return (cast || []).map((c) => `${c.name}, ${c.gender}`).join('\n');
}

export function loadCast() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((c) => c && c.name && c.gender) : [];
  } catch {
    return [];
  }
}

export function saveCast(cast) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(cast)); } catch { /* storage unavailable */ }
}

export function findCastMember(cast, name) {
  const key = (name || '').trim().toLowerCase();
  return (cast || []).find((c) => c.name.toLowerCase() === key) || null;
}
