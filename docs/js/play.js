// Entraînement : séries de questions (correction immédiate), apprentissage (réponse affichée)
// et révision des erreurs. Une seule mécanique de question pour les trois modes.
import { esc, toast } from './ui.js';
import { state, save, qStat, recordAnswer, LEVELS, LEVEL_SHORT, LIGUES, forMyLigue } from './store.js';
import { getQuestions } from './data.js';
import { navigate } from './router.js';
import { planSession, summarize } from './engine.js';
import { articleExcerpt, questionHtml, makeItem, isCorrect, refLink, choiceList, themeName } from './qcommon.js';
import { rewardAnswer } from './reward.js';

const KEY = 'prepa-ja-play';

export const MODES = {
  smart: { name: 'Entraînement', tag: 'Répondez, puis lisez la correction' },
  learn: { name: 'Apprentissage', tag: 'Réponse et article affichés directement' },
  retry: { name: 'Mes erreurs', tag: 'Les questions ratées, jusqu’à les maîtriser' },
};

/** Domaines de travail par parcours (choisis comme priorités au premier lancement). */
export const FOCUS = {
  JALA: [
    { id: 'avant', name: 'Avant la compétition', tag: 'Règlement particulier, échéancier, tableaux', match: (q) => q.phase === 'avant' },
    { id: 'pendant', name: 'Pendant la compétition', tag: 'De l’arrivée au gymnase au départ', match: (q) => q.phase === 'pendant' },
    { id: 'apres', name: 'Après la compétition', tag: 'Rapport, résultats, suites', match: (q) => q.phase === 'apres' },
    { id: 'rgc', name: 'RGC', tag: 'Règlement général des compétitions et annexes', match: (q) => !!q.rgc },
    { id: 'badnet', name: 'BadNet', tag: 'Logiciel de compétition', match: (q) => q.theme === 'logiciel' },
    { id: 'ligue', name: 'Ma ligue', tag: 'Interclubs régionaux et règlements régionaux', match: (q) => !!q.ligue },
  ],
  ALA: [
    { id: 'regles', name: 'Règles du jeu', tag: 'Service, fautes, lets, score en 3×15', match: (q) => q.theme === 'regles' },
    { id: 'arbitrage', name: 'Arbitrage et annonces', tag: 'Instructions aux officiels, terminologie', match: (q) => q.theme === 'arbitrage' || q.theme === 'instructions' },
    { id: 'jdl', name: 'Juge de ligne', tag: 'Rôle et gestes du juge de ligne', match: (q) => q.theme === 'jdl' },
  ],
};
export const focusOf = (level, id) => FOCUS[level]?.find((f) => f.id === id);
/** Priorités valides pour un parcours (préférences du premier lancement). */
export const priorities = (level) => (state.settings.priorities?.[level] || []).filter((id) => focusOf(level, id));

let session = restore();

function persist() {
  try {
    if (session) sessionStorage.setItem(KEY, JSON.stringify(session));
    else sessionStorage.removeItem(KEY);
  } catch { /* stockage indisponible : la série reste en mémoire */ }
}
function restore() {
  try {
    const s = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return s && MODES[s.mode] ? s : null;
  } catch { return null; }
}
export const activePlay = () => (session && !session.finished ? session : null);

const isError = (s) => s.n > 0 && (s.last === 0 || s.b <= 1);

/**
 * Questions d'un parcours, limitées à un domaine (id de FOCUS), à « mes priorités » (focus = 'prio')
 * ou à une liste de thèmes.
 */
export function levelPool(qdata, level, { focus = '', themes = [] } = {}) {
  const ids = focus === 'prio' ? priorities(level) : focus ? [focus] : [];
  const matchers = ids.map((id) => focusOf(level, id)?.match).filter(Boolean);
  return qdata.questions.filter((q) => q.levels.includes(level) && forMyLigue(q)
    && (!themes.length || themes.includes(q.theme))
    && (!matchers.length || matchers.some((m) => m(q))));
}

/** Niveau de connaissance déclaré : un débutant commence par les questions les plus simples. */
function adaptToKnowledge(pool, count) {
  const k = state.settings.knowledge;
  if (k !== 'decouverte') return { pool, reviewShare: k === 'revision' ? 0.5 : 0.4 };
  const easy = pool.filter((q) => (q.difficulty || 1) <= 2 && !qStat(q.id).n);
  return { pool: easy.length >= count ? pool.filter((q) => (q.difficulty || 1) <= 2) : pool, reviewShare: 0.3 };
}

// ------------------------------------------------------------------ lancement

export async function startPlay({ mode = 'smart', level = state.settings.level, count = 10, focus = '', ids = null } = {}) {
  const qdata = await getQuestions();
  const now = Date.now();
  const seed = state.settings.seed || 'prepa';
  const pool = levelPool(qdata, level, { focus });
  let list;
  if (ids) {
    const index = new Map(qdata.questions.map((q) => [q.id, q]));
    list = ids.map((id) => index.get(id)).filter(Boolean);
  } else if (mode === 'retry') {
    list = pool.filter((q) => isError(qStat(q.id))).sort((a, b) => qStat(b.id).t - qStat(a.id).t).slice(0, count);
  } else {
    const adapted = adaptToKnowledge(pool, count);
    list = planSession(adapted.pool, qStat, { count, now, seed, salt: `${mode}${now}`, reviewShare: adapted.reviewShare });
  }
  if (!list.length) {
    toast(mode === 'retry' ? 'Aucune erreur à revoir.' : 'Aucune question disponible pour ce choix.');
    return false;
  }
  session = { mode, level, focus, ids: list.map((q) => q.id), idx: 0, cur: makeItem(list[0]), answers: [], good: 0, startedAt: now, finished: false };
  persist();
  navigate('#/entrainement/session');
  return true;
}

// ------------------------------------------------------------------ accueil de l'entraînement

/** Ligne de domaine : nombre de questions et part maîtrisée. */
function focusRow(f, pool, selected) {
  const sum = summarize(pool, qStat, Date.now());
  const pctM = sum.total ? Math.round((sum.mastered / sum.total) * 100) : 0;
  return `<button class="row-item" data-focus="${f.id}" aria-pressed="${selected}">
    <span class="ri-main"><strong>${esc(f.name)}</strong><span class="small muted">${esc(f.tag)}</span></span>
    <span class="ri-side"><span class="small muted">${sum.total} q. · ${pctM} %</span><span class="pbar"><i style="width:${pctM}%"></i></span></span>
  </button>`;
}

export async function renderPlayHub(main) {
  const qdata = await getQuestions();
  const level = state.settings.level;
  const prio = priorities(level);
  const prefs = { count: 10, focus: prio.length ? 'prio' : '', ...(state.settings.trainPrefs?.[level] || {}) };
  if (prefs.focus && prefs.focus !== 'prio' && !focusOf(level, prefs.focus)) prefs.focus = '';
  if (prefs.focus === 'prio' && !prio.length) prefs.focus = '';
  const focusList = FOCUS[level].filter((f) => f.id !== 'ligue' || levelPool(qdata, level, { focus: 'ligue' }).length);
  const errors = levelPool(qdata, level).filter((q) => isError(qStat(q.id))).length;
  const live = activePlay();
  const savePrefs = () => { state.settings.trainPrefs = { ...(state.settings.trainPrefs || {}), [level]: prefs }; save(); };
  const all = levelPool(qdata, level);
  main.innerHTML = `
    <h1>Entraînement</h1>
    ${trackSwitch(level)}
    ${live ? `<div class="notice row between"><span>Série « ${esc(MODES[live.mode].name)} » en cours (${live.idx + 1}/${live.ids.length}).</span><a class="btn small" href="#/entrainement/session">Reprendre</a></div>` : ''}
    <section class="panel">
      <h2>Que voulez-vous travailler ?</h2>
      <div class="rows">
        ${prio.length ? focusRow({ id: 'prio', name: 'Mes priorités', tag: prio.map((id) => focusOf(level, id).name).join(' · ') }, levelPool(qdata, level, { focus: 'prio' }), prefs.focus === 'prio') : ''}
        ${focusRow({ id: '', name: 'Tout le programme', tag: level === 'JALA' ? 'Juge-arbitre' : 'Arbitre' }, all, !prefs.focus)}
        ${focusList.map((f) => focusRow(f, levelPool(qdata, level, { focus: f.id }), prefs.focus === f.id)).join('')}
      </div>
      ${level === 'JALA' ? `<p class="small muted">Ligue : ${esc(LIGUES[state.settings.ligue] || 'non renseignée')} · <a href="#/reglages">modifier</a></p>` : ''}
    </section>
    <section class="panel">
      <div class="row between">
        <span class="small muted">Questions par série</span>
        <div class="seg" role="group" aria-label="Questions par série">${[10, 20, 40].map((n) => `<button data-count="${n}" aria-pressed="${prefs.count === n}">${n}</button>`).join('')}</div>
      </div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn" style="flex:1" data-start="smart">S’entraîner</button>
        <button class="btn secondary" style="flex:1" data-start="learn">Apprendre</button>
      </div>
      <p class="small muted" style="margin-bottom:0">S’entraîner : vous répondez, puis la correction s’affiche. Apprendre : la bonne réponse et l’article sont affichés directement.</p>
    </section>
    <button class="row-item" data-start="retry" ${errors ? '' : 'disabled'}>
      <span class="ri-main"><strong>Mes erreurs</strong><span class="small muted">${errors ? `${errors} question(s) à revoir` : 'Aucune erreur en attente'}</span></span>
      <span class="ri-side" aria-hidden="true">›</span>
    </button>`;

  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if (b.dataset.track) { setLevel(b.dataset.track); renderPlayHub(main); return; }
    if (b.dataset.focus !== undefined) { prefs.focus = b.dataset.focus; savePrefs(); renderPlayHub(main); return; }
    if (b.dataset.count) {
      prefs.count = Number(b.dataset.count); savePrefs();
      main.querySelectorAll('[data-count]').forEach((x) => x.setAttribute('aria-pressed', x === b));
      return;
    }
    if (b.dataset.start) startPlay({ mode: b.dataset.start, level, count: b.dataset.start === 'retry' ? 20 : prefs.count, focus: prefs.focus });
  };
}

export function trackSwitch(level) {
  return `<div class="seg wide" role="group" aria-label="Parcours">${LEVELS.map((l) => `<button data-track="${l}" aria-pressed="${l === level}">${esc(LEVEL_SHORT[l])}</button>`).join('')}</div>`;
}

export function setLevel(level) {
  state.settings.level = level; save();
  document.dispatchEvent(new CustomEvent('levelchange'));
}

// ------------------------------------------------------------------ série en cours

export async function renderPlaySession(main) {
  if (!session) { navigate('#/entrainement', true); return; }
  if (session.finished) { renderEnd(main); return; }
  const qdata = await getQuestions();
  const index = new Map(qdata.questions.map((q) => [q.id, q]));
  let q = index.get(session.cur.id);
  while (!q && session.idx < session.ids.length - 1) { // banque mise à jour entre-temps
    session.idx += 1;
    session.cur = makeItem(index.get(session.ids[session.idx]) || { id: session.ids[session.idx], choices: [] });
    q = index.get(session.cur.id);
  }
  if (!q) { session = null; persist(); navigate('#/entrainement', true); return; }

  document.body.classList.add('in-play');
  const item = session.cur;
  const learn = session.mode === 'learn';
  if (learn && !item.revealed) { item.revealed = true; item.selected = [...q.answer]; persist(); }
  const ok = item.revealed && !learn ? isCorrect(q, item.selected) : null;
  const n = session.ids.length;
  const last = session.idx + 1 >= n;

  let feedback = '';
  if (item.revealed) {
    const head = learn ? (q.answer.length > 1 ? 'Bonnes réponses' : 'Bonne réponse') : ok ? 'Bonne réponse' : 'Réponse incorrecte';
    feedback = `<div class="feedback ${learn ? 'info' : ok ? 'ok' : 'ko'}">
      <p class="fb-title">${head}</p>
      <p>${esc(q.explain)}</p>${await refLink(q.ref)}${await articleExcerpt(q.ref)}
    </div>`;
  }
  let actions;
  if (item.revealed) actions = `<button class="btn block primary-act" data-act="next">${last ? 'Terminer' : 'Question suivante'}</button>`;
  else if (q.type === 'multiple') actions = `<button class="btn block primary-act" data-act="validate" ${item.selected.length ? '' : 'disabled'}>Valider</button>`;
  else actions = '';

  main.innerHTML = `
    <div class="session-head">
      <button class="icon-btn quit" data-act="quit" aria-label="Arrêter la série"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      <span class="small muted">${esc(MODES[session.mode].name)}</span>
      <span class="small muted">${session.idx + 1} / ${n}</span>
    </div>
    <div class="progress"><i style="width:${((session.idx + (item.revealed ? 1 : 0)) / n) * 100}%"></i></div>
    <article class="qcard">
      <p class="small muted qtheme">${esc(themeName(qdata, q.theme))}${q.ligue ? ` · ${esc(LIGUES[q.ligue] || q.ligue)}` : ''}</p>
      ${questionHtml(q)}
      ${q.type === 'multiple' && !learn ? '<p class="small muted">Plusieurs réponses possibles : cochez-les toutes, puis validez.</p>' : ''}
      ${choiceList(q, item, { locked: item.revealed, showResult: item.revealed })}
    </article>
    ${feedback}
    <div class="sticky-actions">${actions}</div>`;

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
        answer(main, q);
      }
      return;
    }
    if (b.dataset.act === 'validate') answer(main, q);
    else if (b.dataset.act === 'next') next(main);
    else if (b.dataset.act === 'quit') quit(main);
  };
}

async function answer(main, q) {
  const item = session.cur;
  if (item.answered) return; // double appui
  item.answered = true;
  item.revealed = true;
  const ok = isCorrect(q, item.selected);
  session.answers.push({ id: q.id, ok });
  recordAnswer(q.id, ok);
  if (ok) session.good += 1;
  persist();
  rewardAnswer(q, ok); // statistiques du jour (sans effet visuel)
  await renderPlaySession(main);
  main.querySelector('.feedback')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function next(main) {
  if (!session) return;
  if (session.idx + 1 >= session.ids.length) {
    if (session.mode === 'learn') {
      session = null; persist();
      toast('Série terminée. Lancez « S’entraîner » pour vous tester.');
      navigate('#/entrainement', true);
      return;
    }
    session.finished = true; persist();
    renderEnd(main);
    return;
  }
  session.idx += 1;
  const qdata = await getQuestions();
  const q = qdata.questions.find((x) => x.id === session.ids[session.idx]);
  session.cur = makeItem(q || { id: session.ids[session.idx], choices: [] });
  persist();
  window.scrollTo(0, 0);
  await renderPlaySession(main);
}

function quit(main) {
  if (!session.answers.length || session.mode === 'learn') {
    session = null; persist();
    navigate('#/entrainement', true);
    return;
  }
  session.finished = true; persist();
  renderEnd(main);
}

async function renderEnd(main) {
  document.body.classList.remove('in-play');
  const s = session;
  const qdata = await getQuestions();
  const index = new Map(qdata.questions.map((q) => [q.id, q]));
  const total = s.answers.length;
  const wrong = s.answers.filter((a) => !a.ok).map((a) => index.get(a.id)).filter(Boolean);
  const pctOk = total ? Math.round((s.good / total) * 100) : 0;
  main.innerHTML = `
    <h1>Bilan de la série</h1>
    <section class="panel">
      <p class="score">${s.good} / ${total} <span class="small muted">· ${pctOk} %</span></p>
      <div class="pbar big"><i style="width:${pctOk}%"></i></div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn" data-act="again">Nouvelle série</button>
        ${wrong.length ? `<button class="btn secondary" data-act="retry">Revoir les ${wrong.length} erreur(s)</button>` : ''}
        <a class="btn ghost" href="#/">Accueil</a>
      </div>
    </section>
    ${wrong.length ? `<h2>À retenir</h2>${wrong.map((q) => `<details class="panel review"><summary>${esc(q.q)}</summary>
      <p><strong>${q.answer.length > 1 ? 'Réponses' : 'Réponse'} :</strong> ${q.answer.map((i) => esc(q.choices[i])).join(' · ')}</p>
      <p class="small">${esc(q.explain)}</p></details>`).join('')}` : ''}`;
  for (const [i, q] of wrong.entries()) {
    const el = main.querySelectorAll('details.review')[i];
    el?.insertAdjacentHTML('beforeend', await refLink(q.ref));
  }
  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const { level, focus } = s;
    const count = state.settings.trainPrefs?.[level]?.count || 10;
    if (b.dataset.act === 'again') { session = null; persist(); startPlay({ mode: 'smart', level, focus, count }); }
    if (b.dataset.act === 'retry') { session = null; persist(); startPlay({ mode: 'retry', level, ids: wrong.map((q) => q.id) }); }
  };
}

// ------------------------------------------------------------------ clavier (ordinateur)

const onSession = () => location.hash.startsWith('#/entrainement/session') && session && !session.finished;
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
