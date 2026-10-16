// Questions générées à l'infini sur le score en 3×15, le service et les intervalles.
// Chaque réponse est calculée à partir des Règles officielles (règles 7, 8, 10, 11 et 16.2) :
// aucune variante ne peut être fausse. Module sans DOM, testé par tests/engine.test.mjs.
import { rand, hash32, shuffleWith, setState, isValidFinalScore } from './engine.js';

const NAMES = ['Alex', 'Camille', 'Sacha', 'Noa', 'Charlie', 'Lou', 'Eden', 'Maël', 'Robin', 'Andréa', 'Yaël', 'Morgan'];
const SETS = ['premier', 'deuxième', 'troisième'];

function q(id, data) {
  const order = shuffleWith(data.choices.map((_, i) => i), rand(hash32(id)));
  return {
    id: `gen-${id}`,
    generated: true,
    theme: 'regles',
    levels: ['JALA', 'JALC', 'JAFA', 'JAFC'],
    difficulty: data.difficulty || 2,
    q: data.q,
    choices: order.map((i) => data.choices[i]),
    answer: data.answer.map((a) => order.indexOf(a)).sort((x, y) => x - y),
    type: data.multi || data.answer.length > 1 ? 'multiple' : 'single',
    explain: data.explain,
    ref: { doc: 'REGLES', art: data.art },
  };
}

/** Statut d'un score de set : 'continue', 'over' (score final valide) ou 'impossible'. */
export function scoreStatus(a, b) {
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  if (hi > 21) return 'impossible';
  if (!setState(a, b).over) return 'continue';
  return isValidFinalScore(hi, lo) ? 'over' : 'impossible';
}

function setScoreQuestion(r) {
  const hi = 12 + Math.floor(r() * 11); // 12..22
  const lo = Math.max(0, hi - 1 - Math.floor(r() * 6));
  const [a, b] = r() < 0.5 ? [hi, lo] : [lo, hi];
  const st = scoreStatus(a, b);
  const choices = ['Le set est terminé', 'Le set continue', 'Ce score ne peut pas exister'];
  const answer = [{ over: 0, continue: 1, impossible: 2 }[st]];
  let explain;
  if (st === 'over') {
    explain = hi === 21 && lo === 20
      ? 'À 20-20, le côté qui marque le 21e point remporte le set (règle 7.5).'
      : hi === 15 ? 'Un set est remporté par le côté qui atteint en premier 15 points (règle 7.2), avec au moins 2 points d’écart si le score a atteint 14-14.'
        : `À partir de 14-14, le côté qui mène le premier de 2 points remporte le set (règle 7.4) : ${hi}-${lo} est un score final.`;
  } else if (st === 'continue') {
    explain = lo >= 14
      ? `À partir de 14-14, il faut 2 points d’écart (règle 7.4) et le set s’arrête au plus tard au 21e point (règle 7.5) : à ${a}-${b}, on continue.`
      : `Aucun côté n’a atteint 15 points (règle 7.2) : à ${a}-${b}, on continue.`;
  } else if (hi > 21 || lo >= 20) {
    explain = 'À 20-20, le côté qui marque le 21e point remporte le set (règle 7.5) : aucun score ne peut dépasser 21 points.';
  } else {
    const end = lo <= 13 ? 15 : lo + 2;
    explain = lo <= 13
      ? `Ce score ne peut pas être atteint : le set s’est terminé à ${end}-${lo}, le premier côté à 15 points remportant le set (règle 7.2).`
      : `Ce score ne peut pas être atteint : à partir de 14-14, le premier côté qui mène de 2 points gagne, donc le set s’est terminé à ${end}-${lo} (règle 7.4).`;
  }
  const art = hi > 21 || (hi === 21 && lo === 20) || lo >= 20 ? '7.5' : lo >= 14 || hi > 15 ? '7.4' : '7.2';
  return q(`set-${a}-${b}`, {
    q: `Score en 3×15 : le tableau d’affichage indique ${a}-${b} dans un set. Que constatez-vous ?`,
    choices, answer, explain, art, difficulty: st === 'impossible' ? 3 : 2,
  });
}

function singlesCourtQuestion(r) {
  const server = Math.floor(r() * 21);
  const other = Math.floor(r() * 21);
  if (scoreStatus(server, other) !== 'continue') return null;
  const name = NAMES[Math.floor(r() * NAMES.length)];
  const even = server % 2 === 0;
  return q(`sgl-${server}-${other}`, {
    q: `En simple, ${name} est au service avec ${server} point${server > 1 ? 's' : ''} ; son adversaire en a ${other}. De quelle zone de service le serveur doit-il servir ?`,
    choices: ['De sa zone de service droite', 'De sa zone de service gauche', 'De la zone de son choix'],
    answer: [even ? 0 : 1],
    explain: `En simple, on sert de la zone droite quand le serveur a 0 point ou un nombre pair de points, de la zone gauche quand il a un nombre impair (règles 10.1.1 et 10.1.2). Ici ${server} est ${even ? 'pair' : 'impair'}.`,
    art: even ? '10.1.1' : '10.1.2', difficulty: 1,
  });
}

function doublesCourtQuestion(r) {
  const serving = Math.floor(r() * 21);
  const other = Math.floor(r() * 21);
  if (scoreStatus(serving, other) !== 'continue') return null;
  const even = serving % 2 === 0;
  return q(`dbl-${serving}-${other}`, {
    q: `En double, le côté au service a ${serving} point${serving > 1 ? 's' : ''} et le côté à la réception ${other}. De quelle zone le serveur doit-il servir ?`,
    choices: ['De sa zone de service droite', 'De sa zone de service gauche', 'De la zone où il se trouvait à l’échange précédent, quel que soit le score'],
    answer: [even ? 0 : 1],
    explain: `En double, le serveur sert de sa zone droite quand son côté a 0 point ou un nombre pair de points, de sa zone gauche quand le nombre est impair (règles 11.1.1, 11.1.2 et 11.1.6). Ici ${serving} est ${even ? 'pair' : 'impair'}.`,
    art: even ? '11.1.1' : '11.1.2', difficulty: 2,
  });
}

function intervalQuestion(r) {
  const set = Math.floor(r() * 3);
  const leaderBefore = [7, 7, 7, 6, 8, 9, 10][Math.floor(r() * 7)];
  const trailing = Math.floor(r() * leaderBefore);
  const reaches8 = leaderBefore + 1 === 8;
  const third = set === 2;
  const choices = ['Un intervalle de 60 secondes au maximum', 'Un changement de demi-terrain', 'Un intervalle de 120 secondes au maximum', 'Rien de particulier : le jeu continue'];
  let answer;
  let explain;
  if (!reaches8) {
    answer = [3];
    explain = `L’intervalle de 60 s a lieu quand le côté qui mène atteint 8 points (règle 16.2.1)${third ? ', et c’est aussi à ce moment que l’on change de demi-terrain au troisième set (règle 8.1.3)' : ''}. Passer de ${leaderBefore} à ${leaderBefore + 1} ne déclenche rien.`;
  } else if (third) {
    answer = [0, 1];
    explain = 'Au troisième set, quand un côté atteint en premier 8 points, les joueurs changent de demi-terrain (règle 8.1.3) ; c’est aussi le moment de l’intervalle de 60 s au maximum (règle 16.2.1).';
  } else {
    answer = [0];
    explain = 'Dans chaque set, un intervalle de 60 s au maximum est accordé quand le côté qui mène atteint 8 points (règle 16.2.1). Le changement de demi-terrain en cours de set n’existe qu’au troisième set (règle 8.1.3).';
  }
  return q(`int-${set}-${leaderBefore}-${trailing}`, {
    q: `${SETS[set][0].toUpperCase()}${SETS[set].slice(1)} set : le côté qui mène passe de ${leaderBefore}-${trailing} à ${leaderBefore + 1}-${trailing}. Que se passe-t-il ?`,
    choices, answer, explain, art: third && reaches8 ? '8.1.3' : '16.2.1', difficulty: third ? 3 : 2, multi: true,
  });
}

function nextServerQuestion(r) {
  const [w, l] = (() => {
    const s = [[15, Math.floor(r() * 14)], [16, 14], [17, 15], [18, 16], [19, 17], [20, 18], [21, 19], [21, 20]];
    return s[Math.floor(r() * s.length)];
  })();
  const i = Math.floor(r() * NAMES.length);
  const a = NAMES[i];
  const b = NAMES[(i + 3) % NAMES.length];
  const set = 1 + Math.floor(r() * 2);
  return q(`nxt-${set}-${w}-${l}-${i}`, {
    q: `${a} remporte le ${SETS[set - 1]} set ${w}-${l} contre ${b}, qui servait sur le dernier échange. Qui sert en premier au ${SETS[set]} set ?`,
    choices: [a, b, 'Celui ou celle qui gagne un nouveau tirage au sort'],
    answer: [0],
    explain: 'Le côté qui remporte un set sert en premier dans le set suivant (règle 7.6).',
    art: '7.6', difficulty: 1,
  });
}

const MAKERS = [setScoreQuestion, setScoreQuestion, singlesCourtQuestion, doublesCourtQuestion, intervalQuestion, intervalQuestion, nextServerQuestion];

/** Série de n questions générées, sans doublon. */
export function generateScoreQuiz(n = 15, seed = 'x') {
  const r = rand(hash32(String(seed)));
  const out = [];
  const ids = new Set();
  let guard = 0;
  while (out.length < n && guard < n * 50) {
    guard += 1;
    const item = MAKERS[Math.floor(r() * MAKERS.length)](r);
    if (item && !ids.has(item.id)) {
      ids.add(item.id);
      out.push(item);
    }
  }
  return out;
}
