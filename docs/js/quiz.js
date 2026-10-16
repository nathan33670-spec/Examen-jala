// Examens blancs : conditions d'examen, chronomètre, correction détaillée.
import { esc, toast, fmtDuration, icons } from './ui.js';
import { state, save, recordAnswer, recordExam, LEVELS, LEVEL_NAMES } from './store.js';
import { getQuestions, getExams } from './data.js';
import { navigate } from './router.js';
import { examPick } from './engine.js';
import { makeItem, isCorrect, refLink, choiceList, themeName } from './qcommon.js';
import { startPlay } from './play.js';
import { rewardActivity, flush } from './reward.js';
import { confetti } from './fx.js';

export { isCorrect };

const SESSION_KEY = 'prepa-ja-session';
let session = restore();
let timerHandle = null;
let justFinished = null;

function persist() {
  try {
    if (session) sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { /* stockage indisponible : la session reste en mémoire */ }
}
function restore() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
export const activeExam = () => (session && session.mode === 'exam' && !session.done ? session : null);

// ------------------------------------------------------------------ sélection

/** Nombre de fois où chaque question est tombée aux examens blancs de ce grade. */
function examCounts(level) {
  const counts = new Map();
  for (const e of state.exams) {
    if (e.level !== level) continue;
    for (const a of e.answers || []) counts.set(a.id, (counts.get(a.id) || 0) + 1);
  }
  return counts;
}

function examSelection(questions, level, sim) {
  const pool = questions.filter((q) => q.levels.includes(level));
  return examPick(pool, { want: sim.questions, weights: sim.themes || {}, examCounts: examCounts(level) });
}

// ------------------------------------------------------------------ examen blanc

export function examConfig(exams, level) {
  const base = exams[level];
  const over = state.settings.examOverrides?.[level] || {};
  return { ...base, sim: { ...base.sim, ...over } };
}

export async function renderExamSetup(main) {
  const [exams, qdata] = await Promise.all([getExams(), getQuestions()]);
  const level = state.settings.level;
  if (activeExam()) {
    main.innerHTML = `<h1>Examen en cours</h1><div class="notice warn">Un examen blanc ${esc(session.level)} est en cours.</div>
      <div class="btn-row" style="margin-top:12px"><a class="btn" href="#/examen/session">Reprendre</a><button class="btn danger" id="abandon">Abandonner</button></div>`;
    main.querySelector('#abandon').onclick = () => { session = null; persist(); renderExamSetup(main); };
    return;
  }
  const cfg = examConfig(exams, level);
  const sim = cfg.sim;
  const available = qdata.questions.filter((q) => q.levels.includes(level)).length;
  const maxErr = Math.floor(sim.questions * (1 - sim.passPct / 100) + 1e-9);
  const history = state.exams.filter((e) => e.level === level).slice(0, 5);
  main.innerHTML = `
    <h1>Examen blanc</h1>
    <div class="chips" style="margin-bottom:12px">${LEVELS.map((l) => `<button class="chip" aria-pressed="${l === level}" data-level="${l}">${l}</button>`).join('')}</div>
    <div class="card">
      <h2>${esc(level)} — ${esc(LEVEL_NAMES[level])}</h2>
      <p>${esc(cfg.official.summary)}</p>
      <ul>${cfg.official.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
      <p class="small muted">Sources : ${cfg.official.sources.map((s) => `<a href="#/doc/${encodeURIComponent(s.doc)}${s.art ? `?a=${encodeURIComponent(s.art)}` : ''}">${esc(s.label)}</a>`).join(' · ')}</p>
    </div>
    <div class="card" style="margin-top:12px">
      <h2>Conditions de la simulation</h2>
      <div class="kpis">
        <div class="kpi"><b>${sim.questions}</b><span>questions</span></div>
        <div class="kpi"><b>${sim.minutes} min</b><span>durée</span></div>
        <div class="kpi"><b>${sim.passPct} %</b><span>seuil de réussite</span></div>
        <div class="kpi"><b>${maxErr}</b><span>erreurs max. tolérées</span></div>
      </div>
      <p class="small">${sim.documents ? 'Documents autorisés : la bibliothèque des règlements reste accessible pendant l\'épreuve.' : 'Sans documents : la consultation des règlements est désactivée pendant l\'épreuve.'}
        Barème : +1 par bonne réponse${sim.penalty ? `, −${sim.penalty} par mauvaise réponse` : ', 0 pour une réponse fausse ou vide'} ; une question à réponses multiples n'est juste que si toutes les bonnes réponses (et elles seules) sont cochées.</p>
      <p class="small muted">${esc(sim.note || '')}</p>
      <details><summary class="small">Personnaliser (conditions communiquées par votre ligue)</summary>
        <div class="grid two" style="margin-top:8px">
          <div><label class="field" for="c-q">Nombre de questions</label><input id="c-q" type="number" min="5" max="${available}" value="${sim.questions}"></div>
          <div><label class="field" for="c-m">Durée (minutes)</label><input id="c-m" type="number" min="5" max="240" value="${sim.minutes}"></div>
          <div><label class="field" for="c-p">Seuil (%)</label><input id="c-p" type="number" min="50" max="100" value="${sim.passPct}"></div>
          <div><label class="field" for="c-n">Pénalité par mauvaise réponse</label><input id="c-n" type="number" min="0" max="1" step="0.25" value="${sim.penalty || 0}"></div>
        </div>
        <label class="switch"><input type="checkbox" id="c-d" ${sim.documents ? 'checked' : ''}> Documents autorisés</label>
        <div class="btn-row"><button class="btn small" id="saveCfg">Enregistrer</button><button class="btn small secondary" id="resetCfg">Valeurs par défaut</button></div>
      </details>
      <button class="btn block accent" id="go" style="margin-top:12px" ${available < 5 ? 'disabled' : ''}>Démarrer l'examen (${Math.min(sim.questions, available)} questions)</button>
    </div>
    ${history.length ? `<h2>Derniers examens ${esc(level)}</h2><div class="doclist">${history.map((h) => `
      <a class="docitem" href="#/examen/resultat/${h.id}"><span class="code">${Math.round(h.score * 100)}%</span>
      <span class="t">${h.passed ? '<span class="badge ok">Réussi</span>' : '<span class="badge ko">Échoué</span>'} ${h.good}/${h.total} · ${fmtDuration(h.durationSec)}<small>${new Date(h.date).toLocaleString('fr-FR')}</small></span></a>`).join('')}</div>` : ''}`;
  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.level) {
      state.settings.level = b.dataset.level; save();
      document.dispatchEvent(new CustomEvent('levelchange'));
      renderExamSetup(main);
    } else if (b.id === 'saveCfg') {
      state.settings.examOverrides[level] = {
        questions: Math.max(5, Math.min(available, Number(main.querySelector('#c-q').value) || sim.questions)),
        minutes: Math.max(5, Number(main.querySelector('#c-m').value) || sim.minutes),
        passPct: Math.max(50, Math.min(100, Number(main.querySelector('#c-p').value) || sim.passPct)),
        penalty: Math.max(0, Math.min(1, Number(main.querySelector('#c-n').value) || 0)),
        documents: main.querySelector('#c-d').checked,
      };
      save(); toast('Conditions enregistrées'); renderExamSetup(main);
    } else if (b.id === 'resetCfg') {
      delete state.settings.examOverrides[level]; save(); renderExamSetup(main);
    } else if (b.id === 'go') {
      const picked = examSelection(qdata.questions, level, sim);
      session = { mode: 'exam', level, items: picked.map(makeItem), idx: 0, startedAt: Date.now(),
        deadline: Date.now() + sim.minutes * 60000, sim, done: false };
      persist();
      navigate('#/examen/session');
    }
  };
}

export async function renderExamSession(main) {
  if (!activeExam()) { navigate('#/examen', true); return; }
  const qdata = await getQuestions();
  const index = new Map(qdata.questions.map((q) => [q.id, q]));
  const n = session.items.length;
  const item = session.items[session.idx];
  const q = index.get(item.id);
  const answered = session.items.filter((it) => it.selected.length).length;
  main.innerHTML = `
    <div class="qhead"><span>Examen ${esc(session.level)} · question ${session.idx + 1}/${n}</span>
      <span class="timer" id="timer">--:--</span></div>
    <div class="progress"><i style="width:${(answered / n) * 100}%"></i></div>
    <p class="question">${esc(q.q)}</p>
    ${q.type === 'multiple' ? '<p class="small muted">Plusieurs réponses possibles.</p>' : ''}
    ${choiceList(q, item, { locked: false, showResult: false })}
    <div class="row between" style="margin-top:12px">
      <button class="btn ghost small" data-act="flag">${item.flagged ? '⚑ Marquée' : '⚐ Marquer pour revoir'}</button>
      ${session.sim.documents ? '<a class="btn ghost small" href="#/docs">Consulter les règlements</a>' : '<span class="small muted">Sans documents</span>'}
    </div>
    <details style="margin-top:10px"><summary class="small">Toutes les questions (${answered}/${n} répondues)</summary>
      <div class="qnav" style="margin-top:8px">${session.items.map((it, i) => `<button data-go="${i}" class="${it.selected.length ? 'answered' : ''} ${it.flagged ? 'flag' : ''} ${i === session.idx ? 'current' : ''}">${i + 1}</button>`).join('')}</div>
    </details>
    <div class="sticky-actions">
      <button class="btn secondary" data-act="prev" ${session.idx === 0 ? 'disabled' : ''}>Précédente</button>
      ${session.idx + 1 < n ? '<button class="btn" data-act="next">Suivante</button>' : '<button class="btn accent" data-act="submit">Terminer</button>'}
    </div>`;
  tick();
  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.choice != null) {
      const ci = Number(b.dataset.choice);
      if (q.type === 'multiple') {
        item.selected = item.selected.includes(ci) ? item.selected.filter((x) => x !== ci) : [...item.selected, ci];
      } else item.selected = item.selected[0] === ci ? [] : [ci];
      persist(); renderExamSession(main); return;
    }
    if (b.dataset.go != null) { session.idx = Number(b.dataset.go); persist(); renderExamSession(main); return; }
    switch (b.dataset.act) {
      case 'flag': item.flagged = !item.flagged; break;
      case 'prev': session.idx -= 1; window.scrollTo(0, 0); break;
      case 'next': session.idx += 1; window.scrollTo(0, 0); break;
      case 'submit': {
        const empty = n - answered;
        const flagged = session.items.filter((it) => it.flagged).length;
        const msg = `Terminer l'examen ?${empty ? `\n${empty} question(s) sans réponse.` : ''}${flagged ? `\n${flagged} question(s) marquée(s).` : ''}`;
        if (!window.confirm(msg)) return;
        finishExam();
        return;
      }
      default:
    }
    persist(); renderExamSession(main);
  };
}

function tick() {
  clearInterval(timerHandle);
  const update = () => {
    const el = document.getElementById('timer');
    if (!activeExam()) { clearInterval(timerHandle); return; }
    const left = (session.deadline - Date.now()) / 1000;
    if (left <= 0) {
      clearInterval(timerHandle);
      toast('Temps écoulé : l\'examen est terminé.');
      finishExam();
      return;
    }
    if (el) {
      el.textContent = fmtDuration(left);
      el.classList.toggle('low', left < 120);
    }
  };
  update();
  timerHandle = setInterval(update, 1000);
}

/** Bandeau « examen en cours » affiché sur les autres pages (consultation des documents). */
export function examBanner() {
  const ex = activeExam();
  if (!ex) return '';
  const left = Math.max(0, (ex.deadline - Date.now()) / 1000);
  return `<div class="notice warn row between" style="margin-bottom:12px"><span>Examen ${esc(ex.level)} en cours · ${fmtDuration(left)} restantes</span><a class="btn small" href="#/examen/session">Retour à l'examen</a></div>`;
}

async function finishExam() {
  const qdata = await getQuestions();
  const index = new Map(qdata.questions.map((q) => [q.id, q]));
  const sim = session.sim;
  let good = 0;
  let wrong = 0;
  const byTheme = {};
  const answers = [];
  for (const it of session.items) {
    const q = index.get(it.id);
    const ok = isCorrect(q, it.selected);
    if (ok) good += 1; else if (it.selected.length) wrong += 1;
    const t = (byTheme[q.theme] ||= { good: 0, total: 0 });
    t.total += 1;
    if (ok) t.good += 1;
    recordAnswer(q.id, ok);
    answers.push({ id: q.id, sel: it.selected, ok });
  }
  const total = session.items.length;
  const points = Math.max(0, good - (sim.penalty || 0) * wrong);
  const score = total ? points / total : 0;
  const result = {
    id: `${Date.now().toString(36)}`,
    level: session.level,
    date: new Date().toISOString(),
    good, wrong, empty: total - good - wrong, total, points, score,
    passPct: sim.passPct,
    passed: score * 100 >= sim.passPct - 1e-9,
    durationSec: Math.min(sim.minutes * 60, (Date.now() - session.startedAt) / 1000),
    byTheme, answers, documents: sim.documents, penalty: sim.penalty || 0,
  };
  recordExam(result);
  session.done = true;
  session = null;
  persist();
  clearInterval(timerHandle);
  await rewardActivity(30 + Math.round(score * 20) + (result.passed ? 100 : 0), { now: false });
  justFinished = result.id;
  navigate(`#/examen/resultat/${result.id}`, true);
}

export async function renderExamResult(main, id) {
  const result = state.exams.find((e) => e.id === id);
  if (!result) { navigate('#/examen', true); return; }
  const qdata = await getQuestions();
  const index = new Map(qdata.questions.map((q) => [q.id, q]));
  const maxErr = Math.floor(result.total * (1 - result.passPct / 100) + 1e-9);
  const errors = result.total - result.good;
  const reviews = [];
  for (const [i, a] of result.answers.entries()) {
    const q = index.get(a.id);
    if (!q) continue;
    reviews.push(`<details class="card flat" style="margin-bottom:8px" ${a.ok ? '' : ''}>
      <summary><span class="badge ${a.ok ? 'ok' : 'ko'}">${a.ok ? 'Juste' : a.sel.length ? 'Faux' : 'Vide'}</span> Q${i + 1}. ${esc(q.q.slice(0, 120))}${q.q.length > 120 ? '…' : ''}</summary>
      <p class="question" style="font-size:1rem">${esc(q.q)}</p>
      ${choiceList(q, { order: q.choices.map((_, k) => k), selected: a.sel }, { locked: true, showResult: true })}
      <div class="card flat explain ${a.ok ? 'ok' : 'ko'}"><p>${esc(q.explain)}</p>${await refLink(q.ref)}</div>
    </details>`);
  }
  const wrongIds = result.answers.filter((a) => !a.ok).map((a) => a.id);
  main.innerHTML = `
    <h1>Résultat — examen blanc ${esc(result.level)}</h1>
    <div class="card center">
      <div class="end-icon" aria-hidden="true">${result.passed ? '🎓' : '📚'}</div>
      <div class="score-big ${result.passed ? 'result-ok' : 'result-ko'}">${Math.round(result.score * 100)} %</div>
      <p><strong>${result.passed ? 'Réussi' : 'Non réussi'}</strong> — seuil ${result.passPct} % · ${result.good} bonne(s) réponse(s) sur ${result.total}</p>
      <p class="small muted">${errors} erreur(s) ou absence(s) de réponse pour ${maxErr} tolérée(s)${result.penalty ? ` · pénalité ${result.penalty}/mauvaise réponse` : ''} · durée ${fmtDuration(result.durationSec)}</p>
    </div>
    <h2>Par thème</h2>
    <div class="card bars">${Object.entries(result.byTheme).sort((a, b) => a[1].good / a[1].total - b[1].good / b[1].total)
      .map(([t, v]) => `<div class="bar"><span>${esc(themeName(qdata, t))}</span><div class="meter"><i class="${v.good / v.total >= 0.8 ? 'high' : v.good / v.total >= 0.5 ? 'mid' : 'low'}" style="width:${(v.good / v.total) * 100}%"></i></div><span class="small muted">${v.good}/${v.total}</span></div>`).join('')}</div>
    <div class="btn-row" style="margin:14px 0">
      ${wrongIds.length ? '<button class="btn accent" id="retry">Retravailler mes erreurs</button>' : ''}
      <a class="btn secondary" href="#/examen">Nouvel examen</a>
    </div>
    <h2>Correction détaillée</h2>
    ${reviews.join('')}`;
  const retry = main.querySelector('#retry');
  if (retry) retry.onclick = () => startPlay({ mode: 'retry', level: result.level, ids: wrongIds });
  main.onclick = null;
  if (justFinished === id) {
    justFinished = null;
    if (result.passed) confetti(160);
    setTimeout(flush, result.passed ? 900 : 200);
  }
}
