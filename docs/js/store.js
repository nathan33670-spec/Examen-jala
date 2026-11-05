// État local de l'utilisateur (progression, examens, réglages), stocké dans localStorage.
import { blankActivity, noteAnswer } from './activity.js';

const KEY = 'prepa-ja-v1';
/** Deux parcours : juge-arbitre (examen JALA) et arbitre (ALA). */
export const LEVELS = ['JALA', 'ALA'];
export const LEVEL_NAMES = {
  JALA: 'Juge-arbitre de ligue accrédité (JALA)',
  ALA: 'Arbitre de ligue accrédité (ALA)',
};
export const LEVEL_SHORT = { JALA: 'Juge-arbitre', ALA: 'Arbitre' };

/** Ligues régionales de la FFBaD : les questions marquées « G: <code> » ne concernent que cette ligue (interclubs régionaux…). */
export const LIGUES = {
  AURA: 'Auvergne-Rhône-Alpes', BFC: 'Bourgogne-Franche-Comté', BRET: 'Bretagne', CVL: 'Centre-Val de Loire',
  CORS: 'Corse', GEST: 'Grand Est', HDF: 'Hauts-de-France', IDF: 'Île-de-France', NORM: 'Normandie',
  NAQ: 'Nouvelle-Aquitaine', OCCI: 'Occitanie', PDL: 'Pays de la Loire', PACA: 'Provence-Alpes-Côte d’Azur',
  GUAD: 'Guadeloupe', MART: 'Martinique', GUY: 'Guyane', REUN: 'La Réunion', MAY: 'Mayotte',
  NC: 'Nouvelle-Calédonie', PF: 'Polynésie française', WF: 'Wallis-et-Futuna',
};
/** Question visible pour la ligue de l'utilisateur (questions nationales + celles de sa ligue). */
export const forMyLigue = (q) => !q.ligue || q.ligue === state.settings.ligue;

/** Question retenue pour l'examen blanc et la jauge du parcours (le JALA exclut les points réservés aux grades supérieurs). */
export const inExamScope = (q, level) => q.levels.includes(level) && forMyLigue(q) && (level !== 'JALA' || !q.grades || q.grades.includes('JALA'));

const blank = () => ({
  version: 1,
  createdAt: new Date().toISOString(),
  settings: { level: 'JALA', ligue: '', theme: 'auto', examOverrides: {}, onboarded: false, dailyGoal: 20,
    sound: false, haptics: true, seed: newSeed() },
  q: {},          // id -> { b: boîte Leitner 0..5, n: tentatives, c: réussites, t: horodatage, f: favori }
  exams: [],      // historique des examens blancs
  cases: {},      // id -> { best, last, n, t }
  checklists: {}, // liste -> { item: true }
  selfEval: {},   // critère -> 0..3
  drills: { poule: { n: 0, ok: 0 } },
  pdfShas: {},    // chemin PDF -> empreinte téléchargée (mode hors-ligne)
  game: blankActivity(), // réponses par jour
});

function newSeed() {
  return Math.random().toString(36).slice(2, 10);
}

const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
const num = (x, d = 0) => (Number.isFinite(Number(x)) ? Number(x) : d);
const safeKey = (k) => k !== '__proto__' && k !== 'constructor' && k !== 'prototype';
/** Copie d'un objet sans clés dangereuses (protection contre la pollution de prototype). */
const clean = (o) => Object.fromEntries(Object.entries(isObj(o) ? o : {}).filter(([k]) => safeKey(k)));
const idOk = (id) => typeof id === 'string' && /^[\w.@-]{1,80}$/.test(id);

/**
 * Normalise des données lues (localStorage ou fichier importé) : seules les clés connues, avec le bon
 * type, sont gardées ; les nombres sont forcés et les identifiants contrôlés. Un fichier forgé ne peut
 * ainsi ni casser l'application ni injecter de contenu dans les pages.
 */
function normalize(data) {
  const base = blank();
  if (!isObj(data)) return base;
  const s = clean(data.settings);
  const settings = { ...base.settings };
  for (const k of ['level', 'ligue', 'theme', 'knowledge', 'seed']) if (typeof s[k] === 'string' && s[k].length < 40) settings[k] = s[k];
  if (typeof s.onboarded === 'boolean') settings.onboarded = s.onboarded;
  settings.dailyGoal = num(s.dailyGoal, base.settings.dailyGoal);
  settings.priorities = Object.fromEntries(Object.entries(clean(s.priorities))
    .filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.filter((x) => typeof x === 'string' && x.length < 20)]));
  settings.trainPrefs = Object.fromEntries(Object.entries(clean(s.trainPrefs))
    .map(([k, v]) => [k, { count: [10, 20, 40].includes(num(v?.count)) ? num(v.count) : 10, focus: typeof v?.focus === 'string' ? v.focus.slice(0, 20) : '' }]));
  settings.examOverrides = Object.fromEntries(Object.entries(clean(s.examOverrides)).map(([k, v]) => {
    const o = clean(v);
    return [k, { ...(o.questions != null && { questions: Math.max(5, Math.min(200, num(o.questions, 40))) }),
      ...(o.minutes != null && { minutes: Math.max(5, Math.min(240, num(o.minutes, 60))) }),
      ...(o.passPct != null && { passPct: Math.max(50, Math.min(100, num(o.passPct, 80))) }),
      ...(o.penalty != null && { penalty: Math.max(0, Math.min(1, num(o.penalty, 0))) }),
      ...(o.documents != null && { documents: !!o.documents }) }];
  }));
  if (isObj(s.scheduler) && Array.isArray(s.scheduler.tableaux)) settings.scheduler = JSON.parse(JSON.stringify(s.scheduler, (k, v) => (safeKey(k) ? (typeof v === 'string' ? v.replace(/[^\w :.-]/g, '').slice(0, 20) : v) : undefined)));
  const q = {};
  for (const [id, st] of Object.entries(clean(data.q))) {
    if (!idOk(id) || !isObj(st)) continue;
    q[id] = { b: Math.max(0, Math.min(5, num(st.b))), n: Math.max(0, num(st.n)), c: Math.max(0, num(st.c)), t: num(st.t), ...(st.last != null && { last: st.last ? 1 : 0 }), ...(st.f && { f: true }) };
  }
  const exams = (Array.isArray(data.exams) ? data.exams : []).slice(0, 100).filter((e) => isObj(e) && idOk(e.id)).map((e) => ({
    id: e.id, level: typeof e.level === 'string' ? e.level.slice(0, 10) : 'JALA', date: typeof e.date === 'string' ? e.date.slice(0, 40) : '',
    score: Math.max(0, Math.min(1, num(e.score))), good: num(e.good), total: num(e.total), passed: !!e.passed,
    passPct: num(e.passPct, 80), penalty: num(e.penalty), durationSec: num(e.durationSec),
    byTheme: Object.fromEntries(Object.entries(clean(e.byTheme)).filter(([k]) => idOk(k)).map(([k, v]) => [k, { good: num(v?.good), total: Math.max(1, num(v?.total, 1)) }])),
    answers: (Array.isArray(e.answers) ? e.answers : []).filter((a) => isObj(a) && idOk(a.id)).slice(0, 300)
      .map((a) => ({ id: a.id, ok: !!a.ok, sel: (Array.isArray(a.sel) ? a.sel : []).map((x) => num(x)).filter((x) => x >= 0 && x < 10) })),
  }));
  const cases = Object.fromEntries(Object.entries(clean(data.cases)).filter(([k, v]) => idOk(k) && isObj(v))
    .map(([k, v]) => [k, { best: Math.max(0, Math.min(1, num(v.best))), last: num(v.last), n: num(v.n), t: num(v.t) }]));
  const boolMap = (o) => Object.fromEntries(Object.entries(clean(o)).filter(([k]) => idOk(k)).map(([k, v]) => [k, isObj(v) ? Object.fromEntries(Object.entries(clean(v)).map(([a, b]) => [a, !!b])) : !!v]));
  const selfEval = Object.fromEntries(Object.entries(clean(data.selfEval)).filter(([k]) => idOk(k)).map(([k, v]) => [k, Math.max(0, Math.min(3, num(v)))]));
  const poule = clean(clean(data.drills).poule);
  return { ...base, version: 1, createdAt: typeof data.createdAt === 'string' ? data.createdAt.slice(0, 40) : base.createdAt,
    settings, q, exams, cases, checklists: boolMap(data.checklists), selfEval,
    drills: { poule: { n: num(poule.n), ok: num(poule.ok) } },
    pdfShas: Object.fromEntries(Object.entries(clean(data.pdfShas)).filter(([, v]) => typeof v === 'string')),
    game: cleanGame(data.game) };
}

/** Compteurs d'activité : nombres seulement, jours au format AAAA-MM-JJ. */
function cleanGame(g) {
  const src = clean(g);
  const days = Object.fromEntries(Object.entries(clean(src.days)).filter(([k]) => /^\d{4}-\d{2}-\d{2}$/.test(k))
    .slice(-400).map(([k, v]) => [k, { a: num(v?.a), g: num(v?.g) }]));
  const c = clean(src.counters);
  return { days, counters: { answers: num(c.answers), good: num(c.good) } };
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalize(JSON.parse(raw)) : blank();
  } catch (err) {
    console.warn('Progression illisible, réinitialisation', err);
    return blank();
  }
}

export const state = load();
// anciens grades (JALC, JAFA, JAFC) : parcours juge-arbitre
if (!LEVELS.includes(state.settings.level)) state.settings.level = 'JALA';

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
/** Réponse donnée en entraînement : répétition espacée et compteur du jour. */
export function recordAnswer(id, correct) {
  noteAnswer(state.game, correct);
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
  if (text.length > 5e6) throw new Error('Fichier trop volumineux');
  const parsed = JSON.parse(text);
  const data = isObj(parsed?.data) ? parsed.data : parsed;
  if (!isObj(data) || !isObj(data.settings)) throw new Error('Fichier de progression invalide');
  const next = normalize(data);
  if (!LEVELS.includes(next.settings.level)) next.settings.level = 'JALA';
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, next);
  save(true);
}

export function resetAll() {
  for (const k of Object.keys(state)) delete state[k];
  Object.assign(state, blank(), { settings: { ...blank().settings, onboarded: true } });
  save(true);
}
