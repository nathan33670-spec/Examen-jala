// Activité de l'utilisateur : réponses par jour (affichées sur l'accueil et dans la progression).

export const blankActivity = () => ({ days: {}, counters: { answers: 0, good: 0 } });

export function dayKey(date = new Date()) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + n, 12));
}

/** Compte une réponse du jour (les 400 derniers jours sont conservés). */
export function noteAnswer(act, correct, now = Date.now()) {
  const k = dayKey(now);
  const day = act.days[k] || { a: 0, g: 0 };
  day.a += 1;
  if (correct) day.g += 1;
  act.days[k] = day;
  act.counters.answers += 1;
  if (correct) act.counters.good += 1;
  const keys = Object.keys(act.days).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - 400))) delete act.days[old];
}
