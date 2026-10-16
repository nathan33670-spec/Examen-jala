// Choix des questions sans « tourner en rond » : on parcourt toute la banque dans un ordre propre
// à chaque utilisateur, et les questions déjà vues ne reviennent qu'à échéance (répétition espacée).
// Module sans dépendance au navigateur : testé avec `node --test tests/engine.test.mjs`.

export const MIN = 60 * 1000;
export const DAY = 24 * 60 * MIN;
/** Délai avant de revoir une question selon sa boîte de Leitner (0 = ratée). */
export const INTERVALS = [10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY];
/** Boîte à partir de laquelle une question est considérée comme acquise. */
export const MASTERED_BOX = 4;

/** Empreinte 32 bits (FNV-1a) d'une chaîne : ordre pseudo-aléatoire stable. */
export function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Générateur pseudo-aléatoire reproductible (xorshift32). */
export function rand(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function shuffleWith(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Date à partir de laquelle la question doit être revue (0 si jamais vue). */
export function dueAt(s) {
  if (!s || !s.n) return 0;
  const box = Math.min(INTERVALS.length - 1, Math.max(0, s.b || 0));
  return (s.t || 0) + (s.last === 0 ? INTERVALS[0] : INTERVALS[box]);
}

/**
 * État d'une question pour l'utilisateur :
 * new (jamais vue), review (à revoir maintenant), cooldown (ratée il y a moins de 10 min),
 * later (réussie, pas encore à échéance).
 */
export function classify(s, now) {
  if (!s || !s.n) return 'new';
  if (now >= dueAt(s)) return 'review';
  return s.last === 0 ? 'cooldown' : 'later';
}

export function summarize(pool, statOf, now) {
  const out = { total: pool.length, new: 0, review: 0, cooldown: 0, later: 0, seen: 0, mastered: 0, errors: 0 };
  for (const q of pool) {
    const s = statOf(q.id);
    out[classify(s, now)] += 1;
    if (s && s.n) {
      out.seen += 1;
      if ((s.b || 0) >= MASTERED_BOX) out.mastered += 1;
      if (s.last === 0 || (s.b || 0) <= 1) out.errors += 1;
    }
  }
  return out;
}

/**
 * Compose une série de `count` questions :
 * 1. une part (40 % par défaut) de questions à revoir, les ratées et les plus en retard d'abord ;
 * 2. des questions jamais vues, dans l'ordre propre à l'utilisateur (toute la banque y passe) ;
 * 3. à défaut, les questions vues il y a le plus longtemps, puis celles ratées à l'instant.
 * Le résultat est mélangé pour alterner révisions et découvertes.
 */
export function planSession(pool, statOf, { count = 10, now = Date.now(), seed = 'x', salt = '', reviewShare = 0.4 } = {}) {
  const b = { review: [], new: [], later: [], cooldown: [] };
  for (const q of pool) b[classify(statOf(q.id), now)].push(q);
  const urgency = (q) => {
    const s = statOf(q.id);
    const box = Math.min(INTERVALS.length - 1, Math.max(0, s.b || 0));
    return (s.last === 0 ? 1e6 : 0) + (now - dueAt(s)) / INTERVALS[box];
  };
  b.review.sort((x, y) => urgency(y) - urgency(x));
  const key = new Map(b.new.map((q) => [q.id, hash32(`${seed}|${q.id}`)]));
  b.new.sort((x, y) => key.get(x.id) - key.get(y.id));
  const lastSeen = (q) => statOf(q.id).t || 0;
  b.later.sort((x, y) => lastSeen(x) - lastSeen(y) || (statOf(x.id).b || 0) - (statOf(y.id).b || 0));
  b.cooldown.sort((x, y) => lastSeen(x) - lastSeen(y));

  const nReview = Math.min(b.review.length, b.new.length ? Math.round(count * reviewShare) : count);
  const picked = b.review.slice(0, nReview);
  const take = (list) => {
    for (const q of list) {
      if (picked.length >= count) return;
      if (!picked.includes(q)) picked.push(q);
    }
  };
  take(b.new);
  take(b.review);
  take(b.later);
  take(b.cooldown);
  return shuffleWith(picked, rand(hash32(`${seed}|${salt}|${now}`)));
}

/**
 * Sélection d'un examen blanc : quotas par thème (pondérations de l'examen), et dans chaque thème
 * les questions les moins souvent tombées aux examens précédents d'abord.
 */
export function examPick(pool, { want, weights = {}, examCounts = new Map(), rnd = Math.random }) {
  want = Math.min(want, pool.length);
  const byTheme = {};
  for (const q of pool) (byTheme[q.theme] ||= []).push(q);
  const themes = Object.keys(byTheme).filter((t) => (weights[t] ?? 1) > 0);
  const totalW = themes.reduce((s, t) => s + (weights[t] ?? 1), 0) || 1;
  const quota = themes.map((t) => {
    const exact = (want * (weights[t] ?? 1)) / totalW;
    return { t, n: Math.min(byTheme[t].length, Math.floor(exact)), frac: exact % 1 };
  });
  let left = want - quota.reduce((s, x) => s + x.n, 0);
  for (const x of quota.sort((a, b) => b.frac - a.frac)) {
    if (left <= 0) break;
    if (x.n < byTheme[x.t].length) { x.n += 1; left -= 1; }
  }
  const order = (list) => list
    .map((q) => ({ q, k: (examCounts.get(q.id) || 0) + rnd() }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.q);
  let picked = quota.flatMap((x) => order(byTheme[x.t]).slice(0, x.n));
  if (picked.length < want) {
    const chosen = new Set(picked);
    picked = picked.concat(order(pool.filter((q) => !chosen.has(q))).slice(0, want - picked.length));
  }
  return shuffleWith(picked, rnd);
}

/** Défi du jour : mêmes questions pour tous le même jour (par grade), thèmes variés. */
export function dailyPick(pool, day, level, n = 10) {
  const sorted = pool
    .map((q) => ({ q, k: hash32(`${day}|${level}|${q.id}`) }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.q);
  const perTheme = Math.max(2, Math.ceil(n / 4));
  const used = {};
  const out = [];
  for (const q of sorted) {
    if (out.length >= n) break;
    if ((used[q.theme] || 0) >= perTheme) continue;
    used[q.theme] = (used[q.theme] || 0) + 1;
    out.push(q);
  }
  for (const q of sorted) {
    if (out.length >= n) break;
    if (!out.includes(q)) out.push(q);
  }
  return out;
}

// ------------------------------------------------------------------ score en 3×15

/** État d'un set en 3×15 (15 points, 2 points d'écart à partir de 14-14, plafond 21). */
export function setState(a, b) {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  const over = (hi >= 15 && hi - lo >= 2) || hi === 21;
  return {
    over,
    winner: over ? (a > b ? 0 : 1) : null,
    deuce: !over && lo >= 14,
    golden: !over && a === 20 && b === 20,
    interval: hi === 8 && lo < 8,
  };
}

/** Le set est-il terminé sur ce score ? (pour les questions de score valides/invalides) */
export function isValidFinalScore(w, l) {
  if (w <= l) return false;
  if (w === 15) return l <= 13;
  if (w > 15 && w < 21) return w - l === 2;
  if (w === 21) return l === 19 || l === 20;
  return false;
}
