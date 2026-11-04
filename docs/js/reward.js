// Statistiques d'activité (réponses du jour, examens, cas pratiques), enregistrées sans effet visuel.
import { state, save } from './store.js';
import { noteAnswer, noteActivity } from './game.js';

/** Réponse donnée en entraînement : compteurs du jour. */
export function rewardAnswer(q, correct) {
  noteAnswer(state.game, { correct, difficulty: q.difficulty || 1 });
  save();
}

/** Activité terminée (examen blanc, cas pratique) : comptée comme journée d'entraînement. */
export function rewardActivity(xp = 0, { active = true } = {}) {
  noteActivity(state.game, xp, Date.now(), active);
  save();
}

export function refreshBadges() {}
export function flush() {}
