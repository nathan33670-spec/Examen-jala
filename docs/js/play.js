// Entraînement ludique : série intelligente, défi du jour, match en 3×15, contre-la-montre,
// mort subite, mode oral, erreurs et favoris. Une seule mécanique de question pour tous les modes.
import { esc, toast, fmtDuration, shuffle } from './ui.js';
import { state, save, qStat, recordAnswer, toggleFavorite, LEVELS } from './store.js';
import { getQuestions } from './data.js';
import { navigate } from './router.js';
import { planSession, dailyPick, summarize, setState } from './engine.js';
import { dayKey, levelInfo, setRecord, stars } from './game.js';
import { makeItem, isCorrect, refLink, choiceList, themeName, diffDots } from './qcommon.js';
import { rewardAnswer, rewardActivity, flush } from './reward.js';
import { confetti } from './fx.js';
import { generateScoreQuiz } from './gen.js';

const KEY = 'prepa-ja-play';
const CHRONO_SEC = 90;
const CHRONO_PENALTY = 5;
const MATCH_Q_SEC = 30;
const LIVES = 3;

export const MODES = {
  smart: { icon: '🎯', name: 'Série intelligente', tag: 'Questions jamais vues + révisions au bon moment' },
  daily: { icon: '☀️', name: 'Défi du jour', tag: '10 questions, les mêmes pour tous aujourd’hui' },
  match: { icon: '🏸', name: 'Match en 3×15', tag: 'Bonne réponse = point pour vous. Gagnez le set !' },
  chrono: { icon: '⏱️', name: 'Contre-la-montre', tag: `${CHRONO_SEC} secondes, une erreur coûte ${CHRONO_PENALTY} s` },
  survival: { icon: '❤️', name: 'Mort subite', tag: `${LIVES} vies : jusqu’où irez-vous ?` },
  score: { icon: '🧮', name: 'Score & service', tag: 'Questions générées à l’infini sur le 3×15' },
  oral: { icon: '🎤', name: 'Mode oral', tag: 'Répondez à voix haute, puis vérifiez (oral JALC)' },
  retry: { icon: '🔁', name: 'Mes erreurs', tag: 'Retravailler les questions ratées' },
  fav: { icon: '⭐', name: 'Favoris', tag: 'Les questions que vous avez marquées' },
};

const PRAISE = ['Bien joué !', 'Exact !', 'Point gagné !', 'Bonne décision !', 'Dans le mille !', 'Parfait !', 'Volant gagnant !'];
const OOPS = ['Faute !', 'Volant dehors…', 'Raté, mais ça rentre !', 'Pas tout à fait', 'Presque…'];

let session = restore();
let ticker = null;
let autoNext = null;

function persist() {
  try {
    if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
    else sessionStorage.removeItem(KEY);
  } catch { /* stockage indisponible : la partie reste en mémoire */ }
}
function restore() {
  try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; }
}
export const activePlay = () => (session && !session.finished ? session : null);

const isError = (s) => s.n > 0 && (s.last === 0 || s.b <= 1);
const pick = (list, seed) => list[seed % list.length];

/** Thèmes hors programme JA : exclus des séries et des jeux sauf s'ils sont choisis explicitement. */
export const OPTIONAL_THEMES = ['arbitrage', 'jdl'];

function levelPool(qdata, level, themes = []) {
  return qdata.questions.filter((q) => q.levels.includes(level)
    && (themes.length ? themes.includes(q.theme) : !OPTIONAL_THEMES.includes(q.theme)));
}

// ------------------------------------------------------------------ lancement

/**
 * Démarre une partie. mode : smart | daily | match | chrono | survival | oral | retry | fav.
 * ids : liste imposée (ex. erreurs d'un examen blanc).
 */
export async function startPlay({ mode = 'smart', level = state.settings.level, count = 10, themes = [], ids = null, replay = false } = {}) {
  const qdata = await getQuestions();
  const now = Date.now();
  const seed = state.settings.seed || 'prepa';
  const pool = levelPool(qdata, level, mode === 'daily' ? [] : themes);
  let list;
  if (ids) {
    const index = new Map(qdata.questions.map((q) => [q.id, q]));
    list = ids.map((id) => index.get(id)).filter(Boolean);
  } else if (mode === 'daily') {
    list = dailyPick(pool, dayKey(), level, 10);
  } else if (mode === 'score') {
    list = generateScoreQuiz(15, `${seed}|${now}`);
  } else if (mode === 'retry') {
    list = pool.filter((q) => isError(qStat(q.id))).sort((a, b) => qStat(b.id).t - qStat(a.id).t).slice(0, count);
  } else if (mode === 'fav') {
    list = shuffle(pool.filter((q) => qStat(q.id).f)).slice(0, count);
  } else if (['match', 'chrono', 'survival'].includes(mode)) {
    list = planSession(pool, qStat, { count: 60, now, seed, salt: mode });
  } else {
    list = planSession(pool, qStat, { count, now, seed, salt: String(now) });
  }
  if (!list.length) {
    toast(mode === 'retry' ? 'Aucune erreur à retravailler : bravo !' : mode === 'fav' ? 'Aucun favori pour l’instant (touchez ☆ sur une question).' : 'Aucune question disponible avec ces critères.');
    return false;
  }
  session = {
    mode, level, themes, replay,
    ids: list.map((q) => q.id), idx: 0, cur: makeItem(list[0]),
    extra: mode === 'score' ? Object.fromEntries(list.map((q) => [q.id, q])) : null,
    answers: [], good: 0, combo: 0, bestCombo: 0, xp: 0,
    startedAt: now, xpStart: state.game.xp,
    lives: LIVES, me: 0, opp: 0, server: 0, intervalDone: false, notice: '',
    deadline: mode === 'chrono' ? now + CHRONO_SEC * 1000 : null,
    qDeadline: mode === 'match' ? now + MATCH_Q_SEC * 1000 : null,
    finished: false,
  };
  persist();
  navigate('#/entrainement/session');
  return true;
}

// ------------------------------------------------------------------ écran d'accueil de l'entraînement

export async function renderPlayHub(main) {
  const qdata = await getQuestions();
  const level = state.settings.level;
  const prefs = { themes: [], count: 10, ...(state.settings.train || {}) };
  prefs.themes = (prefs.themes || []).filter((t) => qdata.themes[t]);
  const all = levelPool(qdata, level);
  const pool = levelPool(qdata, level, prefs.themes);
  const now = Date.now();
  const sum = summarize(pool, qStat, now);
  const allSum = prefs.themes.length ? summarize(all, qStat, now) : sum;
  const favs = all.filter((q) => qStat(q.id).f).length;
  const daily = state.game.daily[`${dayKey()}|${level}`];
  const rec = (k) => state.game.records[`${k}|${level}`] || 0;
  const live = activePlay();
  const themeLabel = prefs.themes.length ? prefs.themes.map((t) => qdata.themes[t]).join(', ') : 'tous les thèmes';
  main.innerHTML = `
    <div class="row between" style="margin-bottom:12px"><h1 style="margin:0">S’entraîner</h1>
      <div class="chips" aria-label="Grade">${LEVELS.map((l) => `<button class="chip sm" aria-pressed="${l === level}" data-level="${l}">${l}</button>`).join('')}</div></div>
    ${live ? `<div class="notice warn row between" style="margin-bottom:12px"><span>${MODES[live.mode].icon} Partie « ${esc(MODES[live.mode].name)} » en cours.</span><a class="btn small" href="#/entrainement/session">Reprendre</a></div>` : ''}
    <section class="hero-card">
      <div class="hero-top"><span class="hero-emoji" aria-hidden="true">🎯</span>
        <div><h2>Série intelligente</h2><p class="small">Vous découvrez toute la banque sans revoir les mêmes questions, et vos erreurs reviennent au bon moment.</p></div></div>
      <div class="deck-stats">
        <span><b>${sum.new}</b>nouvelles</span><span><b>${sum.review + sum.cooldown}</b>à revoir</span><span><b>${sum.mastered}</b>acquises</span><span><b>${sum.total}</b>au total</span>
      </div>
      <div class="deck-bar" title="${sum.seen} vues sur ${sum.total}"><i class="seen" style="width:${sum.total ? (sum.seen / sum.total) * 100 : 0}%"></i><i class="mastered" style="width:${sum.total ? (sum.mastered / sum.total) * 100 : 0}%"></i></div>
      <div class="row" style="margin-top:12px">
        <span class="small muted">Questions par série :</span>
        <div class="chips" role="group" aria-label="Nombre de questions par série">${[10, 20, 40].map((n) => `<button class="chip sm" aria-pressed="${prefs.count === n}" data-count="${n}">${n}</button>`).join('')}</div>
      </div>
      <button class="btn block big" data-start="smart">C’est parti !</button>
      <details class="themes-pick"><summary class="small">Thèmes : <strong>${esc(themeLabel)}</strong> (modifier)</summary>
        <div class="chips" style="margin-top:8px">${Object.entries(qdata.themes).map(([t, name]) => {
          const n = qdata.questions.filter((q) => q.theme === t && q.levels.includes(level)).length;
          return n ? `<button class="chip sm" aria-pressed="${prefs.themes.includes(t)}" data-theme="${t}">${esc(name)} <span class="muted">${n}</span></button>` : '';
        }).join('')}</div>
        <p class="small muted">Les thèmes choisis s’appliquent aussi au mode oral et aux jeux.</p>
      </details>
    </section>

    <button class="daily-card ${daily ? 'done' : ''}" data-start="daily">
      <span class="daily-sun" aria-hidden="true">☀️</span>
      <span class="daily-body"><strong>Défi du jour</strong>
        <span class="small">${daily ? `Fait : ${daily.good}/${daily.total} ${'★'.repeat(daily.stars)}${'☆'.repeat(3 - daily.stars)} · rejouer pour s’entraîner` : '10 questions, les mêmes pour tous aujourd’hui · +50 XP si 10/10'}</span></span>
      <span class="daily-go" aria-hidden="true">${daily ? '✓' : '›'}</span>
    </button>

    <h2>Jeux</h2>
    <div class="modes">
      ${modeCard('match', `Sets gagnés : ${state.game.records.matchWins || 0}`)}
      ${modeCard('chrono', rec('chrono') ? `Record : ${rec('chrono')}` : 'Pas encore de record')}
      ${modeCard('survival', rec('survival') ? `Record : ${rec('survival')}` : 'Pas encore de record')}
      ${modeCard('score', 'Variantes illimitées')}
      <a class="mode-card m-exam" href="#/examen"><span class="mode-emoji" aria-hidden="true">📝</span><strong>Examen blanc ${esc(level)}</strong><span class="small">Conditions réelles, chronométré</span><span class="mode-rec">${state.exams.filter((e) => e.level === level && e.passed).length} réussi(s)</span></a>
    </div>

    <h2>Réviser autrement</h2>
    <div class="grid two">
      ${tile('retry', allSum.errors ? `${allSum.errors} question(s) à retravailler` : 'Aucune erreur en attente', !allSum.errors)}
      ${tile('oral', 'Flashcards : réponse libre puis auto-évaluation')}
      ${tile('fav', favs ? `${favs} question(s) marquée(s)` : 'Touchez ☆ pendant une question', !favs)}
      <a class="card tile" href="#/fiches"><span class="ico emoji" aria-hidden="true">📝</span><span><strong>Fiches de synthèse</strong><span class="small muted">L’essentiel à relire avant l’examen</span></span></a>
    </div>`;

  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.level) {
      state.settings.level = b.dataset.level; save();
      document.dispatchEvent(new CustomEvent('levelchange'));
      renderPlayHub(main);
      return;
    }
    if (b.dataset.count) {
      prefs.count = Number(b.dataset.count);
      state.settings.train = prefs; save();
      main.querySelectorAll('[data-count]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      return;
    }
    if (b.dataset.theme) {
      const t = b.dataset.theme;
      prefs.themes = prefs.themes.includes(t) ? prefs.themes.filter((x) => x !== t) : [...prefs.themes, t];
      state.settings.train = prefs; save();
      renderPlayHub(main).then(() => { const d = main.querySelector('.themes-pick'); if (d) d.open = true; });
      return;
    }
    if (b.dataset.start) {
      const mode = b.dataset.start;
      startPlay({ mode, level, count: mode === 'smart' || mode === 'oral' ? prefs.count : 20, themes: prefs.themes, replay: mode === 'daily' && !!daily });
    }
  };
}

function modeCard(mode, sub) {
  const m = MODES[mode];
  return `<button class="mode-card m-${mode}" data-start="${mode}"><span class="mode-emoji" aria-hidden="true">${m.icon}</span><strong>${esc(m.name)}</strong><span class="small">${esc(m.tag)}</span><span class="mode-rec">${esc(sub)}</span></button>`;
}

function tile(mode, sub, disabled = false) {
  const m = MODES[mode];
  return `<button class="card tile" data-start="${mode}" ${disabled ? 'aria-disabled="true"' : ''} style="text-align:left;cursor:pointer"><span class="ico emoji" aria-hidden="true">${m.icon}</span><span><strong>${esc(m.name)}</strong><span class="small muted">${esc(sub)}</span></span></button>`;
}

// ------------------------------------------------------------------ partie en cours

export async function renderPlaySession(main) {
  clearTimeout(autoNext);
  if (!session) { navigate('#/entrainement', true); return; }
  if (session.finished) { await renderEnd(main); return; }
  const qdata = await getQuestions();
  const index = new Map(qdata.questions.map((q) => [q.id, q]));
  for (const g of Object.values(session.extra || {})) index.set(g.id, g);
  let q = index.get(session.cur.id);
  while (!q && session.idx < session.ids.length - 1) { // banque mise à jour entre-temps
    session.idx += 1;
    session.cur = makeItem(index.get(session.ids[session.idx]) || { id: session.ids[session.idx], choices: [] });
    q = index.get(session.cur.id);
  }
  if (!q) { session = null; persist(); navigate('#/entrainement', true); return; }
  if (session.mode === 'chrono' && Date.now() >= session.deadline) { await finish(main); return; }

  document.body.classList.add('in-play');
  const item = session.cur;
  const mode = session.mode;
  const oral = mode === 'oral';
  const ok = item.revealed ? isCorrect(q, item.selected) : null;
  const fav = qStat(q.id).f;
  const fresh = item.fresh;
  item.fresh = false;

  let body;
  if (oral && !item.revealed) {
    body = '<div class="notice small">🎤 Répondez à voix haute ou mentalement, comme à l’oral, puis affichez la réponse.</div>';
  } else if (oral) {
    body = `<div class="feedback info"><p><strong>Réponse :</strong></p><ul>${q.answer.map((i) => `<li>${esc(q.choices[i])}</li>`).join('')}</ul><p>${esc(q.explain)}</p>${await refLink(q.ref)}</div>`;
  } else {
    body = choiceList(q, item, { locked: item.revealed, showResult: item.revealed, fresh });
  }

  let feedback = '';
  if (item.revealed && !oral) {
    const seed = session.answers.length;
    const title = ok ? (session.combo >= 5 ? `Série de ${session.combo} ! 🔥` : pick(PRAISE, seed)) : item.timeout ? 'Temps écoulé !' : pick(OOPS, seed);
    feedback = `<div class="feedback ${ok ? 'ok' : 'ko'} ${fresh ? 'anim' : ''}">
      <div class="fb-head"><span class="fb-icon" aria-hidden="true">${ok ? '✓' : '✗'}</span><strong>${esc(title)}</strong>${session.lastXp ? `<span class="fb-xp">+${session.lastXp} XP</span>` : ''}</div>
      ${mode === 'chrono' ? '' : `<p>${esc(q.explain)}</p>${await refLink(q.ref)}`}
      ${fresh && session.newBadges?.length ? `<p class="fb-badge">Badge débloqué : ${esc(session.newBadges.join(' · '))}</p>` : ''}
    </div>`;
  }

  const n = session.ids.length;
  const last = session.idx + 1 >= n;
  let actions;
  if (oral) {
    actions = item.revealed
      ? '<button class="btn danger" data-act="oral-ko">Je ne savais pas</button><button class="btn ok primary-act" data-act="oral-ok">Je savais</button>'
      : '<button class="btn block primary-act" data-act="reveal">Afficher la réponse</button>';
  } else if (item.revealed) {
    actions = mode === 'chrono' ? '' : `<button class="btn block primary-act" data-act="next">${endReached() || (last && finiteMode()) ? 'Voir le bilan' : 'Continuer'}</button>`;
  } else if (q.type === 'multiple') {
    actions = `<button class="btn block primary-act" data-act="validate" ${item.selected.length ? '' : 'disabled'}>Valider</button>`;
  } else {
    actions = '<p class="tap-hint small muted">Touchez la bonne réponse</p>';
  }

  main.innerHTML = `
    ${hud(n)}
    ${session.notice ? `<div class="notice small play-notice">${esc(session.notice)}</div>` : ''}
    <article class="qcard ${item.revealed && !oral ? (ok ? 'is-ok' : 'is-ko') : ''} ${fresh && item.revealed && !ok && !oral ? 'shake' : ''}">
      <div class="qmeta"><span class="badge info">${esc(themeName(qdata, q.theme))}</span>${diffDots(q.difficulty)}
        ${q.generated ? '<span class="badge">générée</span>' : `<button class="fav-btn" data-act="fav" aria-pressed="${!!fav}" aria-label="${fav ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${fav ? '★' : '☆'}</button>`}</div>
      <p class="question">${esc(q.q)}</p>
      ${q.type === 'multiple' && !oral ? '<p class="small multi-hint">Plusieurs réponses possibles : cochez-les toutes, puis validez.</p>' : ''}
      ${body}
    </article>
    ${feedback}
    <div class="sticky-actions">${actions}</div>`;
  session.notice = '';

  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.choice != null && !item.revealed) {
      const ci = Number(b.dataset.choice);
      if (q.type === 'multiple') {
        item.selected = item.selected.includes(ci) ? item.selected.filter((x) => x !== ci) : [...item.selected, ci];
        persist();
        renderPlaySession(main);
      } else {
        item.selected = [ci];
        answer(main, q, b);
      }
      return;
    }
    switch (b.dataset.act) {
      case 'validate': answer(main, q, b); break;
      case 'reveal': item.revealed = true; persist(); renderPlaySession(main); break;
      case 'oral-ok':
      case 'oral-ko':
        item.selected = b.dataset.act === 'oral-ok' ? [...q.answer] : [];
        answer(main, q, b).then(() => next(main));
        break;
      case 'next': next(main); break;
      case 'fav': toggleFavorite(q.id); renderPlaySession(main); break;
      case 'quit': quit(main); break;
      default:
    }
  };
  startTicker(main, q);
  if (fresh && item.revealed && mode !== 'chrono') main.querySelector('.feedback')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  if (item.revealed && mode === 'chrono') autoNext = setTimeout(() => { if (onSession()) next(main); }, ok ? 650 : 1400);
}

const finiteMode = () => ['smart', 'daily', 'oral', 'retry', 'fav', 'score'].includes(session.mode);
const onSession = () => location.hash.startsWith('#/entrainement/session') && session && !session.finished;

function endReached() {
  if (!session) return true;
  if (session.mode === 'match') return setState(session.me, session.opp).over;
  if (session.mode === 'survival') return session.lives <= 0;
  return false;
}

function hud(n) {
  const m = MODES[session.mode];
  const quit = '<button class="hud-quit" data-act="quit" aria-label="Arrêter la partie">✕</button>';
  const combo = session.combo >= 3 ? `<span class="combo" title="Bonnes réponses d’affilée">🔥 ${session.combo}</span>` : '';
  const xp = `<span class="hud-xp">⭐ ${session.xp}</span>`;
  if (session.mode === 'match') {
    const st = setState(session.me, session.opp);
    const serverScore = session.server === 0 ? session.me : session.opp;
    const tag = st.golden ? 'Point décisif à 20-20 !' : st.deuce ? 'Prolongation : 2 points d’écart' : `Service ${session.server === 0 ? 'vous' : 'adversaire'} · zone ${serverScore % 2 === 0 ? 'droite' : 'gauche'}`;
    return `<div class="hud match" id="hud">${quit}
      <div class="scoreboard" aria-live="polite">
        <div class="side ${session.server === 0 ? 'serving' : ''}"><span class="who">Vous</span><b>${session.me}</b></div>
        <div class="vs"><span class="shuttle" aria-hidden="true">🏸</span><span class="small">${esc(tag)}</span></div>
        <div class="side ${session.server === 1 ? 'serving' : ''}"><span class="who">Adversaire</span><b>${session.opp}</b></div>
      </div>
      <div class="qtimer"><i id="qbar"></i></div></div>`;
  }
  if (session.mode === 'chrono') {
    return `<div class="hud" id="hud">${quit}<span class="hud-title">${m.icon} ${esc(m.name)}</span>
      <span class="clock" id="clock">${fmtDuration(Math.max(0, (session.deadline - Date.now()) / 1000))}</span>
      <span class="hud-score">✔ ${session.good}</span>${combo}<div class="qtimer wide"><i id="cbar"></i></div></div>`;
  }
  if (session.mode === 'survival') {
    return `<div class="hud" id="hud">${quit}<span class="hud-title">${m.icon} ${esc(m.name)}</span>
      <span class="hearts" aria-label="${session.lives} vie(s)">${'❤️'.repeat(session.lives)}${'🤍'.repeat(LIVES - session.lives)}</span>
      <span class="hud-score">✔ ${session.good}</span>${combo}</div>`;
  }
  return `<div class="hud" id="hud">${quit}<span class="hud-title">${m.icon} ${esc(m.name)}</span>
    <span class="hud-count">${Math.min(session.idx + 1, n)}/${n}</span>${combo}${xp}
    <div class="progress wide"><i style="width:${(session.answers.length / n) * 100}%"></i></div></div>`;
}

async function answer(main, q, anchor) {
  const item = session.cur;
  if (item.answered) return; // double appui
  item.answered = true;
  const ok = isCorrect(q, item.selected);
  item.revealed = true;
  item.fresh = true;
  session.answers.push({ id: q.id, sel: item.selected, ok });
  if (!q.generated) recordAnswer(q.id, ok);
  if (ok) { session.good += 1; session.combo += 1; } else session.combo = 0;
  session.bestCombo = Math.max(session.bestCombo, session.combo);
  if (session.mode === 'match') {
    session.qDeadline = null;
    if (ok) { session.me += 1; session.server = 0; } else { session.opp += 1; session.server = 1; }
    if (!session.intervalDone && Math.max(session.me, session.opp) === 8) {
      session.intervalDone = true;
      session.notice = '⏸️ Intervalle : un côté vient d’atteindre 8 points. En 3×15, pause de 60 s (règle 16.2.1).';
    }
  }
  if (session.mode === 'chrono' && !ok) session.deadline -= CHRONO_PENALTY * 1000;
  if (session.mode === 'survival' && !ok) session.lives -= 1;
  persist();
  const r = await rewardAnswer(q, ok, { oral: session.mode === 'oral', anchor });
  session.xp += r.xp;
  session.lastXp = r.xp;
  session.newBadges = r.badges.map((b) => `${b.icon} ${b.name}`);
  persist();
  if (session.mode !== 'oral' && onSession()) await renderPlaySession(main);
}

async function next(main) {
  clearTimeout(autoNext);
  if (!session || session.finished) return;
  if (endReached()) { await finish(main); return; }
  session.idx += 1;
  if (session.idx >= session.ids.length) {
    if (finiteMode()) { await finish(main); return; }
    const qdata = await getQuestions();
    const done = new Set(session.ids);
    const more = planSession(levelPool(qdata, session.level, session.themes).filter((q) => !done.has(q.id)), qStat,
      { count: 40, now: Date.now(), seed: state.settings.seed || 'prepa', salt: `${session.mode}${session.idx}` });
    if (!more.length) { await finish(main); return; }
    session.ids.push(...more.map((q) => q.id));
  }
  const qdata = await getQuestions();
  const q = qdata.questions.find((x) => x.id === session.ids[session.idx]) || session.extra?.[session.ids[session.idx]];
  session.cur = makeItem(q || { id: session.ids[session.idx], choices: [] });
  if (session.mode === 'match') session.qDeadline = Date.now() + MATCH_Q_SEC * 1000;
  persist();
  window.scrollTo(0, 0);
  await renderPlaySession(main);
}

function quit(main) {
  if (session.answers.length === 0) {
    session = null;
    persist();
    stopTicker();
    navigate('#/entrainement', true);
    return;
  }
  if (['match', 'chrono', 'survival'].includes(session.mode) && !window.confirm('Arrêter la partie ? Le score obtenu sera conservé.')) return;
  finish(main);
}

// ------------------------------------------------------------------ chronomètres

function stopTicker() {
  clearInterval(ticker);
  ticker = null;
}

function startTicker(main, q) {
  stopTicker();
  if (!session || !['chrono', 'match'].includes(session.mode)) return;
  const update = () => {
    if (!onSession() || !document.getElementById('hud')) { stopTicker(); return; }
    const now = Date.now();
    if (session.mode === 'chrono') {
      const left = (session.deadline - now) / 1000;
      const clock = document.getElementById('clock');
      const bar = document.getElementById('cbar');
      if (clock) { clock.textContent = fmtDuration(Math.max(0, Math.ceil(left))); clock.classList.toggle('low', left < 15); }
      if (bar) bar.style.width = `${Math.max(0, Math.min(100, (left / CHRONO_SEC) * 100))}%`;
      if (left <= 0) { stopTicker(); finish(main); }
    } else if (session.qDeadline && !session.cur.revealed) {
      const left = (session.qDeadline - now) / 1000;
      const bar = document.getElementById('qbar');
      if (bar) { bar.style.width = `${Math.max(0, (left / MATCH_Q_SEC) * 100)}%`; bar.classList.toggle('low', left < 8); }
      if (left <= 0) {
        stopTicker();
        session.cur.selected = [];
        session.cur.timeout = true;
        answer(main, q, document.getElementById('hud'));
      }
    }
  };
  update();
  ticker = setInterval(update, 200);
}

// ------------------------------------------------------------------ fin de partie

async function finish(main) {
  stopTicker();
  clearTimeout(autoNext);
  if (!session || session.finished) { if (session) await renderEnd(main); return; }
  const s = session;
  const total = s.answers.length;
  const ratio = total ? s.good / total : 0;
  const result = { stars: 0, record: false, won: null, bonus: 0, title: '', big: '', icon: '🏸', good: s.good, total };
  const game = state.game;
  switch (s.mode) {
    case 'match': {
      const st = setState(s.me, s.opp);
      result.won = st.over ? st.winner === 0 : null;
      if (result.won) {
        game.records.matchWins = (game.records.matchWins || 0) + 1;
        if (s.me === 21 && s.opp === 20) game.records.golden = 1;
        if (s.opp === 0) game.records.shutout = 1;
      }
      result.bonus = result.won ? 50 : st.over ? 10 : 0;
      result.icon = result.won ? '🏆' : st.over ? '💪' : '⏸️';
      result.title = result.won ? 'Set gagné !' : st.over ? 'Set perdu… revanche ?' : 'Match interrompu';
      result.big = `${s.me} – ${s.opp}`;
      break;
    }
    case 'chrono':
      result.record = s.good > 0 && setRecord(game, `chrono|${s.level}`, s.good);
      result.bonus = s.good * 2;
      result.icon = '⏱️';
      result.title = result.record ? 'Nouveau record !' : 'Temps écoulé !';
      result.big = `${s.good} bonne${s.good > 1 ? 's' : ''} réponse${s.good > 1 ? 's' : ''}`;
      break;
    case 'survival':
      result.record = s.good > 0 && setRecord(game, `survival|${s.level}`, s.good);
      result.bonus = s.good * 2;
      result.icon = s.lives > 0 ? '⏸️' : '💔';
      result.title = result.record ? 'Nouveau record !' : s.lives > 0 ? 'Partie arrêtée' : 'Plus de vies !';
      result.big = `${s.good} bonne${s.good > 1 ? 's' : ''} réponse${s.good > 1 ? 's' : ''}`;
      break;
    default: {
      result.stars = stars(ratio);
      result.title = ratio >= 0.8 ? (ratio === 1 ? 'Sans faute !' : 'Excellent !') : ratio >= 0.5 ? 'Bien, continuez !' : 'On progresse en se trompant';
      result.icon = ratio === 1 ? '🌟' : ratio >= 0.8 ? '🎉' : ratio >= 0.5 ? '👍' : '💪';
      result.big = `${s.good}/${total}`;
      if (s.mode === 'daily' && total) {
        const key = `${dayKey()}|${s.level}`;
        if (!game.daily[key] && !s.replay) {
          game.daily[key] = { good: s.good, total, stars: result.stars };
          result.bonus = 20 + (s.good === total ? 30 : 0);
          result.dailyFirst = true;
        }
      } else if (total >= 5) result.bonus = 5 + result.stars * 5;
    }
  }
  if (result.bonus) {
    const r = await rewardActivity(result.bonus, { now: false, active: s.mode === 'daily' && result.dailyFirst });
    s.xp += r.xp;
  } else save();
  s.result = result;
  s.finished = true;
  persist();
  await renderEnd(main);
  const great = result.won || result.record || (result.stars >= 2 && total >= 5);
  if (great) confetti();
  setTimeout(flush, great ? 900 : 200);
}

async function renderEnd(main) {
  document.body.classList.remove('in-play');
  const s = session;
  const r = s.result;
  const qdata = await getQuestions();
  const index = new Map(qdata.questions.map((q) => [q.id, q]));
  for (const g of Object.values(s.extra || {})) index.set(g.id, g);
  const wrong = s.answers.filter((a) => !a.ok);
  const info = levelInfo(state.game.xp);
  const mode = MODES[s.mode];
  const reviews = [];
  for (const a of wrong.slice(0, 30)) {
    const q = index.get(a.id);
    if (!q) continue;
    reviews.push(`<details class="card flat review"><summary>${esc(q.q.slice(0, 140))}${q.q.length > 140 ? '…' : ''}</summary>
      <p class="question">${esc(q.q)}</p>
      ${choiceList(q, { order: q.choices.map((_, k) => k), selected: a.sel }, { locked: true, showResult: true })}
      <div class="feedback ko"><p>${esc(q.explain)}</p>${await refLink(q.ref)}</div></details>`);
  }
  main.innerHTML = `
    <section class="end-card ${r.won === false || (r.stars === 0 && !r.record && s.mode !== 'match') ? 'meh' : ''}">
      <div class="end-icon" aria-hidden="true">${r.icon}</div>
      <p class="small end-mode">${mode.icon} ${esc(mode.name)} · ${esc(s.level)}</p>
      <h1>${esc(r.title)}</h1>
      ${['match', 'chrono', 'survival'].includes(s.mode) ? '' : `<div class="stars" aria-label="${r.stars} étoile(s) sur 3">${[0, 1, 2].map((i) => `<span class="${i < r.stars ? 'on' : ''}">★</span>`).join('')}</div>`}
      <div class="end-big">${esc(r.big)}</div>
      <div class="end-kpis">
        <div><b>+${s.xp}</b><span>XP gagnés</span></div>
        <div><b>🔥 ${s.bestCombo}</b><span>meilleure série</span></div>
        <div><b>${r.total ? Math.round((r.good / r.total) * 100) : 0} %</b><span>réussite</span></div>
      </div>
      ${r.dailyFirst ? '<p class="small">☀️ Défi du jour validé : revenez demain pour un nouveau défi !</p>' : ''}
      <div class="xp-line"><span>Niv. ${info.level} · ${esc(info.title)}</span><div class="xpbar"><i style="width:${Math.round(info.progress * 100)}%"></i></div><span class="small muted">${info.into}/${info.need} XP</span></div>
    </section>
    <div class="btn-row end-actions">
      <button class="btn big" data-act="again">${s.mode === 'daily' ? 'Série intelligente' : 'Rejouer'}</button>
      ${wrong.length && s.mode !== 'score' ? `<button class="btn accent" data-act="retry">🔁 Revoir mes ${wrong.length} erreur${wrong.length > 1 ? 's' : ''}</button>` : ''}
      <a class="btn secondary" href="#/">Accueil</a>
    </div>
    ${reviews.length ? `<h2>À retenir</h2>${reviews.join('')}` : ''}`;
  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const { mode, level, themes } = s;
    const ids = wrong.map((a) => a.id);
    if (b.dataset.act === 'again') {
      session = null; persist();
      startPlay({ mode: ['daily', 'retry', 'fav'].includes(mode) ? 'smart' : mode, level, themes, count: state.settings.train?.count || 10 });
    } else if (b.dataset.act === 'retry') {
      session = null; persist();
      startPlay({ mode: 'retry', level, ids });
    }
  };
}

// ------------------------------------------------------------------ clavier (ordinateur)

document.addEventListener('keydown', (e) => {
  if (!onSession() || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
  const k = e.key.toLowerCase();
  const idx = '12345'.indexOf(k) >= 0 ? '12345'.indexOf(k) : 'abcde'.indexOf(k);
  if (idx >= 0) {
    const btn = document.querySelectorAll('.qcard .choice')[idx];
    if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
  } else if (k === 'enter') {
    const btn = document.querySelector('.sticky-actions .primary-act');
    if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
  }
});
