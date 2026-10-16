// Jauge locale de préparation (calculée uniquement à partir des données de l'appareil).
import { state, qStat } from './store.js';
import { esc } from './ui.js';

export const WEIGHTS = { knowledge: 0.55, exams: 0.25, practice: 0.2 };
const RATING_NEED = { '0': 0, '+': 1, '++': 2, '+++': 3 };

/** Maîtrise d'une question : boîte de Leitner 4 ou plus = acquise. */
export const mastery = (id) => Math.min(1, qStat(id).b / 4);

export function knowledge(level, qdata, examCfg) {
  const weights = examCfg?.sim?.themes || {};
  const byTheme = {};
  let seen = 0;
  let total = 0;
  for (const q of qdata.questions) {
    if (!q.levels.includes(level)) continue;
    total += 1;
    if (qStat(q.id).n > 0) seen += 1;
    (byTheme[q.theme] ||= { sum: 0, n: 0, correct: 0, tries: 0 });
    const t = byTheme[q.theme];
    t.sum += mastery(q.id);
    t.n += 1;
    t.correct += qStat(q.id).c;
    t.tries += qStat(q.id).n;
  }
  let num = 0;
  let den = 0;
  for (const [theme, t] of Object.entries(byTheme)) {
    const w = weights[theme] ?? 1;
    t.value = t.n ? t.sum / t.n : 0;
    t.accuracy = t.tries ? t.correct / t.tries : null;
    num += w * t.value;
    den += w;
  }
  return { value: den ? num / den : 0, byTheme, coverage: total ? seen / total : 0, total, seen };
}

export function examScore(level, examCfg) {
  const pass = (examCfg?.sim?.passPct ?? 80) / 100;
  const last = state.exams.filter((e) => e.level === level).slice(0, 3);
  if (!last.length) return { value: 0, count: 0, passed: false, last };
  const value = last.reduce((s, e) => s + Math.min(1, e.score / pass), 0) / last.length;
  return { value, count: last.length, passed: last.some((e) => e.passed), last };
}

export function practiceScore(level, casesData, practice) {
  const cases = (casesData?.cases || []).filter((c) => c.levels.includes(level));
  const done = cases.filter((c) => state.cases[c.id]);
  const target = Math.min(6, cases.length || 1);
  const caseAvg = done.length ? done.reduce((s, c) => s + state.cases[c.id].best, 0) / done.length : 0;
  const caseValue = caseAvg * Math.min(1, done.length / target);
  const crits = (practice?.criteria || []).flatMap((g) => g.items);
  let selfValue = 0;
  let rated = 0;
  if (crits.length) {
    let sum = 0;
    for (const c of crits) {
      const need = RATING_NEED[c.need?.[level] ?? '+'];
      const mine = state.selfEval[c.id];
      if (mine != null) rated += 1;
      if (need === 0) { sum += 1; continue; }
      sum += Math.min(1, (mine ?? 0) / need);
    }
    selfValue = rated ? sum / crits.length : 0;
  }
  return { value: 0.6 * caseValue + 0.4 * selfValue, caseValue, selfValue, done: done.length,
    total: cases.length, rated, criteria: crits.length };
}

export function readiness(level, { qdata, casesData, exams, practice }) {
  const cfg = exams?.[level];
  const k = knowledge(level, qdata, cfg);
  const e = examScore(level, cfg);
  const p = practiceScore(level, casesData, practice);
  const value = WEIGHTS.knowledge * k.value + WEIGHTS.exams * e.value + WEIGHTS.practice * p.value;
  return { level, value, knowledge: k, exams: e, practice: p, label: label(value, k, e) };
}

export function label(value, k, e) {
  if (value >= 0.85 && e.passed) return { text: 'Prêt pour l’examen', tone: 'ok' };
  if (value >= 0.65) return { text: 'Presque prêt', tone: 'info' };
  if (value >= 0.35) return { text: 'En progression', tone: 'warn' };
  if (k.seen === 0) return { text: 'À démarrer', tone: '' };
  return { text: 'Débutant', tone: 'ko' };
}

export function ring(value, { size = 160, stroke = 14, mini = false, caption = '' } = {}) {
  const r = 50 - stroke / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value || 0));
  const color = v >= 0.85 ? 'var(--ok)' : v >= 0.65 ? 'var(--primary-2)' : v >= 0.35 ? 'var(--warn)' : 'var(--ko)';
  return `<div class="gauge${mini ? ' mini' : ''}" style="width:${size}px;max-width:100%">
    <svg viewBox="0 0 100 100" role="img" aria-label="Préparation ${Math.round(v * 100)} %">
      <circle class="track" cx="50" cy="50" r="${r}" fill="none" stroke-width="${stroke}"/>
      <circle class="val" cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" ${v === 0 ? 'stroke-opacity="0"' : ''}
        stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - v)).toFixed(2)}"/>
    </svg>
    <div class="label"><div><b>${Math.round(v * 100)}%</b><span>${esc(caption)}</span></div></div>
  </div>`;
}

export function bar(labelText, value, extra = '') {
  const v = value == null ? 0 : Math.max(0, Math.min(1, value));
  const cls = v >= 0.8 ? 'high' : v >= 0.5 ? 'mid' : 'low';
  return `<div class="bar"><span>${esc(labelText)}</span><div class="meter"><i class="${cls}" style="width:${(v * 100).toFixed(0)}%"></i></div><span class="small muted">${value == null ? '—' : Math.round(v * 100) + '%'}${extra}</span></div>`;
}
