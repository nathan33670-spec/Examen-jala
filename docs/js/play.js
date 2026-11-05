// Entraînement : séries de questions (correction immédiate), apprentissage (réponse affichée)
// et révision des erreurs. Une seule mécanique de question pour les trois modes.
import { esc, toast } from './ui.js';
import { state, save, qStat, recordAnswer, LEVELS, LEVEL_SHORT, LIGUES, forMyLigue } from './store.js';
import { getQuestions } from './data.js';
import { navigate } from './router.js';
import { planSession } from './engine.js';
import { articleExcerpt, questionHtml, makeItem, isCorrect, refLink, choiceList, themeName } from './qcommon.js';

const KEY = 'prepa-ja-play';

export const MODES = {
  smart: { name: 'Entraînement', tag: 'Répondez, puis lisez la correction complète' },
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

// ------------------------------------------------------------------ réglages de série

/** Nombre de questions par série (réglages). */
export const seriesCount = (level = state.settings.level) => state.settings.trainPrefs?.[level]?.count || 10;

export function trackSwitch(level) {
  return `<div class="seg wide" role="group" aria-label="Parcours">${LEVELS.map((l) => `<button data-track="${l}" aria-pressed="${l === level}">${esc(LEVEL_SHORT[l])}</button>`).join('')}</div>`;
}

export function setLevel(level) {
  state.settings.level = level; save();
  document.dispatchEvent(new CustomEvent('levelchange'));
}

// ------------------------------------------------------------------ série en cours

export async function renderPlaySession(main) {
  if (!session) { navigate('#/', true); return; }
  if (session.finished) { renderEnd(main); return; }
  const qdata = await getQuestions();
  const index = new Map(qdata.questions.map((q) => [q.id, q]));
  let q = index.get(session.cur.id);
  while (!q && session.idx < session.ids.length - 1) { // banque mise à jour entre-temps
    session.idx += 1;
    session.cur = makeItem(index.get(session.ids[session.idx]) || { id: session.ids[session.idx], choices: [] });
    q = index.get(session.cur.id);
  }
  if (!q) { session = null; persist(); navigate('#/', true); return; }

  document.body.classList.add('in-play');
  const item = session.cur;
  const ok = item.revealed ? isCorrect(q, item.selected) : null;
  const n = session.ids.length;
  const last = session.idx + 1 >= n;

  let feedback = '';
  if (item.revealed) {
    // correction complète, seulement une fois la réponse donnée
    feedback = `<div class="feedback ${ok ? 'ok' : 'ko'}">
      <p class="fb-title">${ok ? 'Bonne réponse' : 'Réponse incorrecte'}</p>
      ${ok ? '' : `<p><strong>${q.answer.length > 1 ? 'Réponses attendues' : 'Réponse attendue'} :</strong> ${q.answer.map((i) => esc(q.choices[i])).join(' · ')}</p>`}
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
      ${q.type === 'multiple' ? '<p class="small muted">Plusieurs réponses possibles : cochez-les toutes, puis validez.</p>' : ''}
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
  await renderPlaySession(main);
  main.querySelector('.feedback')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function next(main) {
  if (!session) return;
  if (session.idx + 1 >= session.ids.length) {
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
  if (!session.answers.length) {
    session = null; persist();
    navigate('#/', true);
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
    const count = seriesCount(level);
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
