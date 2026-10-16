// Tests du moteur de sélection et de la ludification : node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  planSession, examPick, dailyPick, summarize, classify, dueAt, INTERVALS, DAY, MIN,
  setState, isValidFinalScore,
} from '../docs/js/engine.js';
import {
  blankGame, noteAnswer, noteActivity, levelInfo, currentStreak, checkBadges, xpFloor, dayKey, addDays,
} from '../docs/js/game.js';

const THEMES = ['regles', 'rgc', 'sanctions', 'tenues'];
const bank = (n) => Array.from({ length: n }, (_, i) => ({ id: `q-${i}`, theme: THEMES[i % THEMES.length], difficulty: 1 + (i % 3) }));

function store() {
  const q = {};
  return {
    q,
    statOf: (id) => q[id] || { b: 0, n: 0, c: 0, t: 0 },
    answer(id, ok, t) {
      const s = { ...(q[id] || { b: 0, n: 0, c: 0, t: 0 }) };
      s.n += 1;
      if (ok) { s.c += 1; s.b = Math.min(5, s.b + 1); } else s.b = Math.max(0, s.b - 2);
      s.t = t; s.last = ok ? 1 : 0;
      q[id] = s;
    },
  };
}

test('aucune répétition tant que toute la banque n’a pas été vue', () => {
  const pool = bank(200);
  const st = store();
  let now = Date.UTC(2026, 9, 15, 8);
  const seen = new Set();
  for (let s = 0; s < 20; s += 1) {
    const plan = planSession(pool, st.statOf, { count: 10, now, seed: 'user-a', salt: String(s) });
    assert.equal(plan.length, 10);
    for (const q of plan) {
      assert.ok(!seen.has(q.id), `question répétée trop tôt : ${q.id} (série ${s})`);
      seen.add(q.id);
      st.answer(q.id, true, now);
    }
    now += 5 * MIN; // séries enchaînées le même jour
  }
  assert.equal(seen.size, 200);
});

test('les questions ratées reviennent après un court délai, en priorité', () => {
  const pool = bank(100);
  const st = store();
  const t0 = Date.UTC(2026, 9, 15, 8);
  const first = planSession(pool, st.statOf, { count: 10, now: t0, seed: 's' });
  first.forEach((q, i) => st.answer(q.id, i >= 3, t0)); // 3 erreurs
  const wrong = first.slice(0, 3).map((q) => q.id);
  const soon = planSession(pool, st.statOf, { count: 10, now: t0 + 2 * MIN, seed: 's', salt: '1' });
  assert.ok(wrong.every((id) => !soon.some((q) => q.id === id)), 'pas de reprise immédiate des erreurs');
  const later = planSession(pool, st.statOf, { count: 10, now: t0 + 11 * MIN, seed: 's', salt: '2' });
  assert.ok(wrong.every((id) => later.some((q) => q.id === id)), 'les erreurs reviennent après 10 min');
});

test('les questions réussies sont espacées selon leur boîte', () => {
  const s = { b: 2, n: 2, c: 2, t: 1000, last: 1 };
  assert.equal(dueAt(s), 1000 + INTERVALS[2]);
  assert.equal(classify(s, 1000 + INTERVALS[2] - 1), 'later');
  assert.equal(classify(s, 1000 + INTERVALS[2]), 'review');
  assert.equal(classify(undefined, 0), 'new');
  assert.equal(classify({ b: 0, n: 1, t: 0, last: 0 }, 5 * MIN), 'cooldown');
});

test('l’ordre de découverte diffère selon l’utilisateur', () => {
  const pool = bank(300);
  const a = planSession(pool, () => ({}), { count: 10, now: 0, seed: 'a' }).map((q) => q.id).sort();
  const b = planSession(pool, () => ({}), { count: 10, now: 0, seed: 'b' }).map((q) => q.id).sort();
  assert.notDeepEqual(a, b);
});

test('quand tout a été vu, on reprend les questions les plus anciennes', () => {
  const pool = bank(30);
  const st = store();
  pool.forEach((q, i) => st.answer(q.id, true, 1000 + i));
  const plan = planSession(pool, st.statOf, { count: 5, now: 2000, seed: 'z' });
  assert.deepEqual(plan.map((q) => q.id).sort(), ['q-0', 'q-1', 'q-2', 'q-3', 'q-4']);
});

test('examen blanc : quotas par thème et rotation des questions', () => {
  const pool = bank(400);
  const weights = { regles: 2, rgc: 2, sanctions: 1, tenues: 0 };
  const counts = new Map();
  const ids = new Set();
  for (let e = 0; e < 4; e += 1) {
    const exam = examPick(pool, { want: 40, weights, examCounts: counts });
    assert.equal(exam.length, 40);
    assert.equal(exam.filter((q) => q.theme === 'tenues').length, 0);
    assert.equal(exam.filter((q) => q.theme === 'regles').length, 16);
    for (const q of exam) {
      assert.ok(!ids.has(q.id), 'question déjà tombée à un examen précédent');
      ids.add(q.id);
      counts.set(q.id, (counts.get(q.id) || 0) + 1);
    }
  }
});

test('défi du jour : identique pour une même date, différent le lendemain', () => {
  const pool = bank(300);
  const a = dailyPick(pool, '2026-10-15', 'JALA').map((q) => q.id);
  const b = dailyPick(pool, '2026-10-15', 'JALA').map((q) => q.id);
  const c = dailyPick(pool, '2026-10-16', 'JALA').map((q) => q.id);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(new Set(a).size, 10);
});

test('résumé de la banque', () => {
  const pool = bank(10);
  const st = store();
  st.answer('q-0', false, 0);
  st.answer('q-1', true, 0);
  const s = summarize(pool, st.statOf, 1 * MIN);
  assert.equal(s.new, 8);
  assert.equal(s.cooldown, 1);
  assert.equal(s.later, 1);
  assert.equal(s.seen, 2);
});

test('score en 3×15', () => {
  assert.equal(setState(15, 13).over, true);
  assert.equal(setState(15, 14).over, false);
  assert.equal(setState(14, 14).deuce, true);
  assert.equal(setState(16, 14).winner, 0);
  assert.equal(setState(20, 20).golden, true);
  assert.equal(setState(20, 21).winner, 1);
  assert.equal(setState(8, 5).interval, true);
  for (const [w, l, ok] of [[15, 0, true], [15, 13, true], [15, 14, false], [16, 14, true], [16, 13, false],
    [20, 18, true], [21, 19, true], [21, 20, true], [22, 20, false], [21, 18, false], [17, 15, true]]) {
    assert.equal(isValidFinalScore(w, l), ok, `${w}-${l}`);
  }
});

test('niveaux et XP', () => {
  assert.equal(xpFloor(1), 0);
  assert.equal(xpFloor(2), 100);
  assert.equal(levelInfo(0).level, 1);
  assert.equal(levelInfo(99).level, 1);
  assert.equal(levelInfo(100).level, 2);
  assert.equal(levelInfo(4500).level, 10);
  assert.ok(levelInfo(150).progress > 0 && levelInfo(150).progress < 1);
});

test('série de jours, combo et badges', () => {
  const g = blankGame();
  const d1 = new Date(2026, 9, 13, 10).getTime();
  for (let i = 0; i < 5; i += 1) noteAnswer(g, { correct: true }, d1);
  assert.equal(g.streak.cur, 1);
  const d2 = new Date(2026, 9, 14, 10).getTime();
  for (let i = 0; i < 6; i += 1) noteAnswer(g, { correct: true }, d2);
  assert.equal(g.streak.cur, 2);
  assert.equal(g.counters.bestCombo, 11);
  assert.equal(currentStreak(g, new Date(2026, 9, 15, 9).getTime()), 2, 'la série tient jusqu’au lendemain');
  assert.equal(currentStreak(g, new Date(2026, 9, 16, 9).getTime()), 0, 'série perdue après un jour sans activité');
  noteAnswer(g, { correct: false }, d2);
  assert.equal(g.counters.combo, 0);
  const state = { exams: [], cases: {}, q: {}, drills: { poule: { ok: 0 } } };
  const earned = checkBadges({ game: g, state, qdata: null, casesTotal: 35 }).map((b) => b.id);
  assert.ok(earned.includes('first'));
  assert.ok(earned.includes('combo10'));
  assert.ok(!earned.includes('q100'));
  assert.equal(checkBadges({ game: g, state, qdata: null, casesTotal: 35 }).length, 0, 'badge attribué une seule fois');
  const r = noteActivity(g, 50, new Date(2026, 9, 17, 10).getTime());
  assert.equal(g.streak.cur, 1);
  assert.equal(r.xp, 50);
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(dayKey(new Date(2026, 0, 5, 12)), '2026-01-05');
});

// ------------------------------------------------------------------ questions générées (score 3×15)
import { generateScoreQuiz, scoreStatus } from '../docs/js/gen.js';

test('statut d’un score : vérification exhaustive par simulation des échanges', () => {
  // états atteignables depuis 0-0 en ajoutant un point à l'un ou l'autre côté, sans dépasser la fin du set
  const reach = new Set(['0-0']);
  const over = (a, b) => { const hi = Math.max(a, b); const lo = Math.min(a, b); return (hi >= 15 && hi - lo >= 2) || hi === 21; };
  const queue = [[0, 0]];
  while (queue.length) {
    const [a, b] = queue.shift();
    if (over(a, b)) continue;
    for (const [x, y] of [[a + 1, b], [a, b + 1]]) {
      if (!reach.has(`${x}-${y}`)) { reach.add(`${x}-${y}`); queue.push([x, y]); }
    }
  }
  for (let a = 0; a <= 24; a += 1) {
    for (let b = 0; b <= 24; b += 1) {
      const expected = !reach.has(`${a}-${b}`) ? 'impossible' : over(a, b) ? 'over' : 'continue';
      assert.equal(scoreStatus(a, b), expected, `${a}-${b}`);
    }
  }
});

test('questions générées : bien formées, sans doublon, réponses cohérentes', () => {
  for (const seed of ['a', 'b', 'c', 'd', 'e']) {
    const list = generateScoreQuiz(40, seed);
    assert.equal(list.length, 40);
    assert.equal(new Set(list.map((q) => q.id)).size, 40);
    for (const q of list) {
      assert.ok(q.answer.length >= 1 && q.answer.every((i) => i >= 0 && i < q.choices.length), q.id);
      assert.equal(new Set(q.choices).size, q.choices.length, q.id);
      assert.ok(q.explain.length > 30, q.id);
      if (q.id.startsWith('gen-set-')) {
        const [, , a, b] = q.id.split('-').map(Number);
        const label = { over: 'Le set est terminé', continue: 'Le set continue', impossible: 'Ce score ne peut pas exister' }[scoreStatus(a, b)];
        assert.equal(q.choices[q.answer[0]], label, q.id);
      }
      if (q.id.startsWith('gen-sgl-') || q.id.startsWith('gen-dbl-')) {
        const pts = Number(q.id.split('-')[2]);
        assert.match(q.choices[q.answer[0]], pts % 2 === 0 ? /droite/ : /gauche/, q.id);
      }
      if (q.id.startsWith('gen-int-')) {
        const [, , set, before] = q.id.split('-').map(Number);
        const got = q.answer.map((i) => q.choices[i]).sort();
        const expected = before + 1 !== 8 ? ['Rien de particulier : le jeu continue']
          : set === 2 ? ['Un changement de demi-terrain', 'Un intervalle de 60 secondes au maximum'] : ['Un intervalle de 60 secondes au maximum'];
        assert.deepEqual(got, expected.sort(), q.id);
      }
    }
  }
});
