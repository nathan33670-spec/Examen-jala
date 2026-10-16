// Ludification : points d'expérience, niveaux, série de jours, objectif quotidien et badges.
// Logique pure (sans DOM) appliquée à l'objet `state.game` ; testée par tests/engine.test.mjs.

export const ACTIVE_DAY_MIN = 5; // réponses nécessaires pour qu'une journée compte dans la série

export const blankGame = () => ({
  xp: 0,
  days: {},                         // 'AAAA-MM-JJ' -> { a: réponses, g: bonnes, xp }
  streak: { cur: 0, best: 0, last: null },
  badges: {},                       // id -> horodatage d'obtention
  daily: {},                        // 'AAAA-MM-JJ|GRADE' -> { good, total, stars }
  records: {},                      // 'chrono|JALA' -> meilleur score, 'survival|…', 'matchWins'…
  counters: { answers: 0, good: 0, combo: 0, bestCombo: 0, oral: 0, docs: 0, night: 0, early: 0 },
});

export function mergeGame(saved) {
  const base = blankGame();
  if (!saved || typeof saved !== 'object') return base;
  return {
    ...base, ...saved,
    streak: { ...base.streak, ...(saved.streak || {}) },
    counters: { ...base.counters, ...(saved.counters || {}) },
  };
}

// ------------------------------------------------------------------ niveaux

export const TITLES = [
  'Ramasseur de volants', 'Marqueur', 'Juge de ligne', 'Juge de service', 'Arbitre stagiaire',
  'Arbitre', 'Arbitre confirmé', 'Assistant du JA', 'JA stagiaire', 'Juge-arbitre',
  'JA confirmé', 'JA référent', 'JA principal', 'JA de championnat', 'Légende du volant',
];

/** XP nécessaire pour atteindre le niveau n (1 = départ) : 0, 100, 300, 600, 1000… */
export const xpFloor = (n) => 50 * n * (n - 1);

export function levelInfo(xp) {
  let n = 1;
  while (xpFloor(n + 1) <= xp) n += 1;
  const floor = xpFloor(n);
  const next = xpFloor(n + 1);
  return {
    level: n,
    title: TITLES[Math.min(n, TITLES.length) - 1],
    floor, next,
    into: xp - floor,
    need: next - floor,
    progress: (xp - floor) / (next - floor),
  };
}

// ------------------------------------------------------------------ jours et série

export function dayKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n, 12));
}

function today(game, now) {
  const key = dayKey(new Date(now));
  return (game.days[key] ||= { a: 0, g: 0, xp: 0 });
}

/** Série en cours (0 si la dernière journée active date d'avant-hier ou plus). */
export function currentStreak(game, now = Date.now()) {
  const key = dayKey(new Date(now));
  const { cur, last } = game.streak;
  if (!last) return 0;
  return last === key || last === addDays(key, -1) ? cur : 0;
}

function markActive(game, now) {
  const key = dayKey(new Date(now));
  const s = game.streak;
  if (s.last === key) return false;
  s.cur = s.last === addDays(key, -1) ? s.cur + 1 : 1;
  s.last = key;
  s.best = Math.max(s.best, s.cur);
  return true;
}

function prune(game, now) {
  const keys = Object.keys(game.days).sort();
  const limit = addDays(dayKey(new Date(now)), -120);
  for (const k of keys) if (k < limit) delete game.days[k];
}

// ------------------------------------------------------------------ points

export function xpForAnswer({ correct, difficulty = 1, combo = 0 }) {
  if (!correct) return 2;
  return 10 + 3 * (Math.max(1, difficulty) - 1) + (combo >= 5 ? 5 : 0);
}

export function addXp(game, amount, now = Date.now()) {
  const before = levelInfo(game.xp).level;
  game.xp += amount;
  today(game, now).xp += amount;
  const after = levelInfo(game.xp).level;
  return after > before ? after : 0;
}

/**
 * Enregistre une réponse : XP, combo, compteur du jour et série.
 * Retourne { xp, combo, levelUp, streakUp }.
 */
export function noteAnswer(game, { correct, difficulty = 1, oral = false }, now = Date.now()) {
  const c = game.counters;
  c.answers += 1;
  if (correct) { c.good += 1; c.combo += 1; } else c.combo = 0;
  c.bestCombo = Math.max(c.bestCombo, c.combo);
  if (oral) c.oral += 1;
  const hour = new Date(now).getHours();
  if (hour >= 22 || hour < 2) c.night += 1;
  if (hour >= 5 && hour < 7) c.early += 1;
  const xp = xpForAnswer({ correct, difficulty, combo: c.combo });
  const day = today(game, now);
  day.a += 1;
  if (correct) day.g += 1;
  const levelUp = addXp(game, xp, now);
  const streakUp = day.a >= ACTIVE_DAY_MIN ? markActive(game, now) : false;
  prune(game, now);
  return { xp, combo: c.combo, levelUp, streakUp };
}

/** Bonus de fin d'activité ; une activité « longue » (examen, défi du jour) compte aussi pour la série. */
export function noteActivity(game, xp, now = Date.now(), active = true) {
  const levelUp = addXp(game, xp, now);
  const streakUp = active ? markActive(game, now) : false;
  return { xp, levelUp, streakUp };
}

export function setRecord(game, key, value) {
  const prev = game.records[key] ?? 0;
  if (value > prev) { game.records[key] = value; return true; }
  return false;
}

export const stars = (ratio) => (ratio >= 1 ? 3 : ratio >= 0.8 ? 2 : ratio >= 0.5 ? 1 : 0);

// ------------------------------------------------------------------ badges

/**
 * Chaque badge lit un « contexte » : { game, state, qdata, casesTotal }.
 * Les conditions ne dépendent que des données enregistrées : on peut les réévaluer à tout moment.
 */
export const BADGES = [
  { id: 'first', icon: '🏸', name: 'Premier volant', desc: 'Répondre à une première question.', test: ({ game }) => game.counters.answers >= 1 },
  { id: 'q100', icon: '💯', name: 'Centurion', desc: '100 réponses données.', test: ({ game }) => game.counters.answers >= 100 },
  { id: 'q500', icon: '🎯', name: 'Assidu', desc: '500 réponses données.', test: ({ game }) => game.counters.answers >= 500 },
  { id: 'q1000', icon: '🏅', name: 'Mille volants', desc: '1 000 réponses données.', test: ({ game }) => game.counters.answers >= 1000 },
  { id: 'combo10', icon: '🔥', name: 'En feu', desc: '10 bonnes réponses d’affilée.', test: ({ game }) => game.counters.bestCombo >= 10 },
  { id: 'combo25', icon: '⚡', name: 'Inarrêtable', desc: '25 bonnes réponses d’affilée.', test: ({ game }) => game.counters.bestCombo >= 25 },
  { id: 'streak3', icon: '📅', name: 'Régulier', desc: '3 jours d’entraînement de suite.', test: ({ game }) => game.streak.best >= 3 },
  { id: 'streak7', icon: '🗓️', name: 'Semaine parfaite', desc: '7 jours de suite.', test: ({ game }) => game.streak.best >= 7 },
  { id: 'streak30', icon: '🏆', name: 'Mois de feu', desc: '30 jours de suite.', test: ({ game }) => game.streak.best >= 30 },
  { id: 'daily', icon: '☀️', name: 'Défi relevé', desc: 'Terminer un défi du jour.', test: ({ game }) => Object.keys(game.daily).length >= 1 },
  { id: 'dailyPerfect', icon: '🌟', name: 'Sans faute', desc: '10/10 au défi du jour.', test: ({ game }) => Object.values(game.daily).some((d) => d.total && d.good === d.total) },
  { id: 'examPass', icon: '🎓', name: 'Reçu !', desc: 'Réussir un examen blanc.', test: ({ state }) => state.exams.some((e) => e.passed) },
  { id: 'examPerfect', icon: '👑', name: 'Copie parfaite', desc: '100 % à un examen blanc.', test: ({ state }) => state.exams.some((e) => e.total >= 10 && e.good === e.total) },
  { id: 'examAll', icon: '🧭', name: 'Polyvalent', desc: 'Réussir un examen blanc dans deux grades différents.', test: ({ state }) => new Set(state.exams.filter((e) => e.passed).map((e) => e.level)).size >= 2 },
  { id: 'match', icon: '🥇', name: 'Premier set', desc: 'Gagner un set en mode Match 3×15.', test: ({ game }) => (game.records.matchWins || 0) >= 1 },
  { id: 'match21', icon: '😅', name: 'Point en or', desc: 'Gagner un set 21-20.', test: ({ game }) => !!game.records.golden },
  { id: 'shutout', icon: '🧱', name: 'Set blanc', desc: 'Gagner un set 15-0.', test: ({ game }) => !!game.records.shutout },
  { id: 'chrono', icon: '⏱️', name: 'Éclair', desc: '15 bonnes réponses en contre-la-montre.', test: ({ game }) => Object.entries(game.records).some(([k, v]) => k.startsWith('chrono|') && v >= 15) },
  { id: 'survival', icon: '❤️', name: 'Survivant', desc: '25 bonnes réponses en mort subite.', test: ({ game }) => Object.entries(game.records).some(([k, v]) => k.startsWith('survival|') && v >= 25) },
  { id: 'oral', icon: '🎤', name: 'À l’oral', desc: '20 questions en mode oral.', test: ({ game }) => game.counters.oral >= 20 },
  { id: 'cases5', icon: '🧑‍⚖️', name: 'Sur le terrain', desc: 'Résoudre 5 cas pratiques.', test: ({ state }) => Object.keys(state.cases).length >= 5 },
  { id: 'casesAll', icon: '📋', name: 'Tous les cas', desc: 'Résoudre tous les cas pratiques.', test: ({ state, casesTotal }) => casesTotal > 0 && Object.keys(state.cases).length >= casesTotal },
  { id: 'poule', icon: '🧮', name: 'Maître des poules', desc: '10 classements de poule réussis.', test: ({ state }) => (state.drills?.poule?.ok || 0) >= 10 },
  { id: 'reader', icon: '📖', name: 'Rat de bibliothèque', desc: 'Ouvrir 10 documents officiels.', test: ({ game }) => game.counters.docs >= 10 },
  { id: 'night', icon: '🦉', name: 'Oiseau de nuit', desc: 'S’entraîner après 22 h.', test: ({ game }) => game.counters.night >= 1 },
  { id: 'early', icon: '🐓', name: 'Lève-tôt', desc: 'S’entraîner avant 7 h.', test: ({ game }) => game.counters.early >= 1 },
  { id: 'theme', icon: '📚', name: 'Spécialiste', desc: 'Acquérir 80 % des questions d’un thème.', test: ({ state, qdata }) => themeMastered(state, qdata) },
  { id: 'level5', icon: '🎽', name: 'Arbitre stagiaire', desc: 'Atteindre le niveau 5.', test: ({ game }) => levelInfo(game.xp).level >= 5 },
  { id: 'level10', icon: '🎖️', name: 'Juge-arbitre', desc: 'Atteindre le niveau 10.', test: ({ game }) => levelInfo(game.xp).level >= 10 },
];

function themeMastered(state, qdata) {
  if (!qdata) return false;
  const by = {};
  for (const q of qdata.questions) {
    const t = (by[q.theme] ||= { n: 0, ok: 0 });
    t.n += 1;
    if ((state.q[q.id]?.b || 0) >= 4) t.ok += 1;
  }
  return Object.values(by).some((t) => t.n >= 10 && t.ok / t.n >= 0.8);
}

/** Attribue les badges nouvellement mérités et les retourne. */
export function checkBadges(ctx, now = Date.now()) {
  const earned = [];
  for (const b of BADGES) {
    if (ctx.game.badges[b.id]) continue;
    let ok = false;
    try { ok = b.test(ctx); } catch { ok = false; }
    if (ok) {
      ctx.game.badges[b.id] = now;
      earned.push(b);
    }
  }
  return earned;
}
