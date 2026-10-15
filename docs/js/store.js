// État local de l'utilisateur (progression, examens, réglages), stocké dans localStorage.
const KEY = 'prepa-ja-v1';
export const LEVELS = ['JALA', 'JALC', 'JAFA', 'JAFC'];
export const LEVEL_NAMES = {
  JALA: 'Juge-arbitre de ligue accrédité',
  JALC: 'Juge-arbitre de ligue certifié',
  JAFA: 'Juge-arbitre fédéral accrédité',
  JAFC: 'Juge-arbitre fédéral certifié',
};

const blank = () => ({
  version: 1,
  createdAt: new Date().toISOString(),
  settings: { level: 'JALA', theme: 'auto', examOverrides: {}, onboarded: false },
  q: {},          // id -> { b: boîte Leitner 0..5, n: tentatives, c: réussites, t: horodatage, f: favori }
  exams: [],      // historique des examens blancs
  cases: {},      // id -> { best, last, n, t }
  checklists: {}, // liste -> { item: true }
  selfEval: {},   // critère -> 0..3
  drills: { poule: { n: 0, ok: 0 } },
  pdfShas: {},    // chemin PDF -> empreinte téléchargée (mode hors-ligne)
});

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const data = JSON.parse(raw);
    const base = blank();
    return { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) },
      drills: { ...base.drills, ...(data.drills || {}) } };
  } catch (err) {
    console.warn('Progression illisible, réinitialisation', err);
    return blank();
  }
}

export const state = load();

let saveTimer;
export function save(now = false) {
  clearTimeout(saveTimer);
  const write = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      console.warn('Sauvegarde impossible', err);
    }
  };
  if (now) write(); else saveTimer = setTimeout(write, 150);
}

// sauvegarde immédiate quand l'application passe en arrière-plan ou se ferme (mobile)
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => save(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(true); });
}

export function setting(key, value) {
  if (value === undefined) return state.settings[key];
  state.settings[key] = value;
  save();
  return value;
}

export function qStat(id) {
  return state.q[id] || { b: 0, n: 0, c: 0, t: 0 };
}

/** Répétition espacée simplifiée (boîtes de Leitner). */
export function recordAnswer(id, correct) {
  const s = { ...qStat(id) };
  s.n += 1;
  if (correct) {
    s.c += 1;
    s.b = Math.min(5, s.b + 1);
  } else {
    s.b = Math.max(0, s.b - 2);
  }
  s.t = Date.now();
  s.last = correct ? 1 : 0;
  state.q[id] = s;
  save();
}

export function toggleFavorite(id) {
  const s = { ...qStat(id) };
  s.f = !s.f;
  state.q[id] = s;
  save();
  return s.f;
}

export function recordExam(result) {
  state.exams.unshift(result);
  state.exams = state.exams.slice(0, 100);
  save(true);
}

export function recordCase(id, score) {
  const prev = state.cases[id] || { best: 0, n: 0 };
  state.cases[id] = { best: Math.max(prev.best, score), last: score, n: prev.n + 1, t: Date.now() };
  save();
}

export function exportData() {
  return JSON.stringify({ app: 'prepa-ja', exportedAt: new Date().toISOString(), data: state }, null, 1);
}

export function importData(text) {
  const parsed = JSON.parse(text);
  const data = parsed.data || parsed;
  if (!data || typeof data !== 'object' || !data.settings) throw new Error('Fichier de progression invalide');
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, blank(), data);
  save(true);
}

export function resetAll() {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, blank(), { settings: { ...blank().settings, onboarded: true } });
  save(true);
}
