// Lien entre la logique de ludification (game.js), l'état local et les effets visuels.
import { state, save } from './store.js';
import { getQuestions, getCases } from './data.js';
import { noteAnswer, noteActivity, checkBadges, levelInfo, BADGES } from './game.js';
import { toast } from './ui.js';
import { celebrate, confetti, floatText, sound, vibrate } from './fx.js';

const pending = [];

async function context() {
  const [qdata, cases] = await Promise.all([getQuestions().catch(() => null), getCases().catch(() => null)]);
  return { game: state.game, state, qdata, casesTotal: cases?.cases?.length || 0 };
}

async function badges() {
  return checkBadges(await context());
}

/** Réponse donnée dans un mode d'entraînement : XP, combo, série, badges. */
export async function rewardAnswer(q, correct, { oral = false, anchor = null } = {}) {
  const r = noteAnswer(state.game, { correct, difficulty: q.difficulty || 1, oral });
  if (correct) {
    sound('good');
    vibrate(12);
  } else {
    sound('bad');
    vibrate([40, 30, 40]);
  }
  floatText(anchor, `+${r.xp} XP`, correct ? 'good' : 'bad');
  const earned = await badges();
  save();
  queue(r.levelUp, earned);
  for (const b of earned) toast(`${b.icon} Badge débloqué : ${b.name}`);
  return { ...r, badges: earned };
}

/** Activité terminée (examen, défi, cas pratique, partie) : bonus d'XP et badges. */
export async function rewardActivity(xp, { now = true, active = true } = {}) {
  const r = noteActivity(state.game, xp, Date.now(), active);
  const earned = await badges();
  save();
  queue(r.levelUp, earned);
  if (now) flush();
  return { ...r, badges: earned };
}

/** Réévalue les badges (après un cas pratique, un document consulté…). */
export async function refreshBadges({ now = true } = {}) {
  const earned = await badges();
  if (earned.length) {
    save();
    queue(0, earned);
    if (now) flush();
  }
  return earned;
}

function queue(levelUp, earned) {
  if (levelUp) pending.push({ kind: 'level', level: levelUp });
  for (const b of earned) pending.push({ kind: 'badge', badge: b });
}

/** Affiche les célébrations en attente (une fenêtre à la fois, niveau d'abord). */
export function flush() {
  if (!pending.length) return;
  const items = pending.splice(0);
  const level = items.filter((x) => x.kind === 'level').pop();
  const got = items.filter((x) => x.kind === 'badge').map((x) => x.badge);
  if (level) {
    const info = levelInfo(state.game.xp);
    celebrate({ icon: '⭐', title: `Niveau ${info.level} !`, text: `Vous êtes maintenant « ${info.title} ».${got.length ? ` Et ${got.length} badge${got.length > 1 ? 's' : ''} : ${got.map((b) => b.icon).join(' ')}` : ''}` });
  } else if (got.length === 1) {
    celebrate({ icon: got[0].icon, title: `Badge « ${got[0].name} »`, text: got[0].desc });
  } else if (got.length > 1) {
    celebrate({ icon: got.map((b) => b.icon).slice(0, 3).join(''), title: `${got.length} nouveaux badges`, text: got.map((b) => b.name).join(', ') });
  }
}

export function hasPending() {
  return pending.length > 0;
}

export { BADGES, confetti };
