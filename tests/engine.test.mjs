// Tests du moteur de sélection et du suivi d'activité : node --test tests/engine.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { planSession, examPick, summarize, classify, dueAt, INTERVALS, DAY, MIN } from '../docs/js/engine.js';
import { blankActivity, noteAnswer, dayKey, addDays } from '../docs/js/activity.js';

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

test('activité : réponses comptées par jour', () => {
  const a = blankActivity();
  const d1 = new Date(2026, 9, 13, 10).getTime();
  noteAnswer(a, true, d1);
  noteAnswer(a, false, d1);
  assert.deepEqual(a.days['2026-10-13'], { a: 2, g: 1 });
  assert.equal(a.counters.answers, 2);
  assert.equal(a.counters.good, 1);
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(dayKey(new Date(2026, 0, 5, 12)), '2026-01-05');
});
