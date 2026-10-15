// Entraînement, examens blancs et mode oral.
import { esc, shuffle, toast, fmtDuration, pct, icons } from './ui.js';
import { state, save, qStat, recordAnswer, recordExam, toggleFavorite, LEVELS, LEVEL_NAMES } from './store.js';
import { getQuestions, getExams, getCatalog } from './data.js';
import { navigate } from './router.js';

const SESSION_KEY = 'prepa-ja-session';
let session = restore();
let timerHandle = null;

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

function weight(q) {
  const s = qStat(q.id);
  let w = 1 + (5 - s.b) * 1.5;
  if (s.n === 0) w += 2;
  if (s.last === 0) w += 3;
  return w;
}

function weightedSample(pool, n) {
  const items = pool.map((q) => ({ q, w: weight(q) }));
  const out = [];
  while (out.length < n && items.length) {
    const total = items.reduce((s, it) => s + it.w, 0);
    let r = Math.random() * total;
    let i = 0;
    for (; i < items.length - 1; i += 1) {
      r -= items[i].w;
      if (r <= 0) break;
    }
    out.push(items.splice(i, 1)[0].q);
  }
  return out;
}

export function filterPool(questions, { level, themes, filter }) {
  return questions.filter((q) => {
    if (level && !q.levels.includes(level)) return false;
    if (themes?.length && !themes.includes(q.theme)) return false;
    const s = qStat(q.id);
    if (filter === 'new') return s.n === 0;
    if (filter === 'errors') return s.n > 0 && (s.last === 0 || s.b <= 1);
    if (filter === 'fav') return !!s.f;
    return true;
  });
}

function examSelection(questions, level, sim) {
  const pool = questions.filter((q) => q.levels.includes(level));
  const want = Math.min(sim.questions, pool.length);
  const weights = sim.themes || {};
  const byTheme = {};
  for (const q of pool) (byTheme[q.theme] ||= []).push(q);
  const themes = Object.keys(byTheme).filter((t) => (weights[t] ?? 1) > 0);
  const totalW = themes.reduce((s, t) => s + (weights[t] ?? 1), 0) || 1;
  const quota = themes.map((t) => {
    const exact = (want * (weights[t] ?? 1)) / totalW;
    return { t, n: Math.min(byTheme[t].length, Math.floor(exact)), frac: exact % 1 };
  });
  let left = want - quota.reduce((s, x) => s + x.n, 0);
  for (const x of quota.sort((a, b) => b.frac - a.frac)) {
    if (left <= 0) break;
    if (x.n < byTheme[x.t].length) { x.n += 1; left -= 1; }
  }
  let picked = quota.flatMap((x) => shuffle(byTheme[x.t]).slice(0, x.n));
  if (picked.length < want) {
    const rest = shuffle(pool.filter((q) => !picked.includes(q)));
    picked = picked.concat(rest.slice(0, want - picked.length));
  }
  return shuffle(picked);
}

function makeItem(q) {
  return { id: q.id, order: shuffle(q.choices.map((_, i) => i)), selected: [], revealed: false, flagged: false };
}

export function isCorrect(q, selected) {
  const a = [...q.answer].sort().join(',');
  const s = [...selected].sort().join(',');
  return a === s;
}

// ------------------------------------------------------------------ rendu commun

async function refLink(ref) {
  if (!ref) return '';
  const cat = await getCatalog().catch(() => ({ docs: [] }));
  const doc = cat.docs.find((d) => d.id === ref.doc);
  const name = !doc ? ref.doc : doc.id === 'REGLES' ? 'Règles officielles du badminton' : `GdB ${doc.id} — ${doc.title}`;
  const art = ref.art ? ` · ${ref.art}` : '';
  const link = `#/doc/${encodeURIComponent(ref.doc)}${ref.art ? `?a=${encodeURIComponent(ref.art)}` : ''}`;
  return `<p class="ref muted">Référence : <a href="${link}">${esc(name)}${esc(art)}</a></p>`;
}

function choiceList(q, item, { locked, showResult }) {
  const multi = q.type === 'multiple';
  return `<div class="choices" role="${multi ? 'group' : 'radiogroup'}">${item.order.map((ci, k) => {
    const sel = item.selected.includes(ci);
    let cls = '';
    if (showResult) {
      if (q.answer.includes(ci)) cls = 'correct';
      else if (sel) cls = 'wrong';
    }
    return `<button class="choice ${cls}" data-choice="${ci}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${sel}" ${locked ? 'disabled' : ''}>
      <span class="key">${String.fromCharCode(65 + k)}</span><span>${esc(q.choices[ci])}</span></button>`;
  }).join('')}</div>`;
}

function themeName(qdata, t) {
  return qdata.themes?.[t] || t;
}

// ------------------------------------------------------------------ entraînement

export async function renderTrainSetup(main) {
  const qdata = await getQuestions();
  const level = state.settings.level;
  const prefs = state.settings.train || { themes: [], count: 10, filter: 'mix', oral: false };
  const themes = Object.entries(qdata.themes);
  const countFor = (t) => qdata.questions.filter((q) => q.theme === t && q.levels.includes(level)).length;
  main.innerHTML = `
    <h1>Entraînement</h1>
    <p class="muted">Correction immédiate après chaque question, avec l'explication et la référence au règlement. Les questions ratées reviennent plus souvent (répétition espacée).</p>
    <div class="card stack">
      <div><label class="field">Niveau</label>
        <div class="chips" data-group="level">${LEVELS.map((l) => `<button class="chip" aria-pressed="${l === level}" data-level="${l}">${l}</button>`).join('')}</div></div>
      <div><label class="field">Thèmes <span class="muted small">(aucun = tous)</span></label>
        <div class="chips" data-group="themes">${themes.map(([t, name]) => {
          const n = countFor(t);
          return n ? `<button class="chip" aria-pressed="${prefs.themes.includes(t)}" data-theme="${t}">${esc(name)} <span class="muted">${n}</span></button>` : '';
        }).join('')}</div></div>
      <div><label class="field">Questions</label>
        <div class="chips" data-group="filter">${[['mix', 'Mélange intelligent'], ['new', 'Jamais vues'], ['errors', 'À revoir'], ['fav', 'Favoris']]
          .map(([k, l]) => `<button class="chip" aria-pressed="${prefs.filter === k}" data-filter="${k}">${l}</button>`).join('')}</div></div>
      <div><label class="field">Nombre</label>
        <div class="chips" data-group="count">${[5, 10, 20, 40].map((n) => `<button class="chip" aria-pressed="${prefs.count === n}" data-count="${n}">${n}</button>`).join('')}</div></div>
      <label class="switch"><input type="checkbox" id="oral" ${prefs.oral ? 'checked' : ''}> Mode oral (flashcards : réponse libre puis auto-évaluation, idéal pour l'oral JALC)</label>
      <p class="small muted" id="poolInfo"></p>
      <button class="btn block" id="start">${icons.play.replace('<svg', '<svg width="18" height="18" fill="currentColor"')} Commencer</button>
    </div>`;
  const updateInfo = () => {
    const pool = filterPool(qdata.questions, { level: state.settings.level, themes: prefs.themes, filter: prefs.filter });
    main.querySelector('#poolInfo').textContent = `${pool.length} question(s) disponible(s) avec ces critères.`;
    main.querySelector('#start').disabled = pool.length === 0;
  };
  updateInfo();
  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.level) {
      state.settings.level = b.dataset.level; save();
      document.dispatchEvent(new CustomEvent('levelchange'));
      renderTrainSetup(main);
      return;
    }
    if (b.dataset.theme) {
      const t = b.dataset.theme;
      prefs.themes = prefs.themes.includes(t) ? prefs.themes.filter((x) => x !== t) : [...prefs.themes, t];
      b.setAttribute('aria-pressed', prefs.themes.includes(t));
    }
    if (b.dataset.filter) {
      prefs.filter = b.dataset.filter;
      main.querySelectorAll('[data-filter]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    }
    if (b.dataset.count) {
      prefs.count = Number(b.dataset.count);
      main.querySelectorAll('[data-count]').forEach((x) => x.setAttribute('aria-pressed', x === b));
    }
    state.settings.train = prefs; save();
    updateInfo();
    if (b.id === 'start') {
      prefs.oral = main.querySelector('#oral').checked;
      state.settings.train = prefs; save();
      startTraining({ level: state.settings.level, themes: prefs.themes, filter: prefs.filter, count: prefs.count, oral: prefs.oral });
    }
  };
}

export async function startTraining({ level, themes = [], filter = 'mix', count = 10, oral = false, ids = null }) {
  const qdata = await getQuestions();
  let picked;
  if (ids) {
    const index = new Map(qdata.questions.map((q) => [q.id, q]));
    picked = ids.map((id) => index.get(id)).filter(Boolean);
  } else {
    picked = weightedSample(filterPool(qdata.questions, { level, themes, filter }), count);
  }
  if (!picked.length) { toast('Aucune question disponible avec ces critères.'); return; }
  session = { mode: oral ? 'oral' : 'train', level, items: picked.map(makeItem), idx: 0, startedAt: Date.now(), good: 0 };
  persist();
  navigate('#/entrainement/session');
}

export async function renderTrainSession(main) {
  if (!session || (session.mode !== 'train' && session.mode !== 'oral')) { navigate('#/entrainement', true); return; }
  const qdata = await getQuestions();
  const index = new Map(qdata.questions.map((q) => [q.id, q]));
  const item = session.items[session.idx];
  const q = index.get(item?.id);
  if (!q) { session = null; persist(); navigate('#/entrainement', true); return; }
  const n = session.items.length;
  const oral = session.mode === 'oral';
  const fav = qStat(q.id).f;
  let body;
  if (oral && !item.revealed) {
    body = `<div class="notice small">${icons.mic.replace('<svg', '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"')} Répondez à voix haute ou mentalement, comme à l'oral, puis affichez la réponse.</div>`;
  } else if (oral) {
    body = `<div class="card flat explain"><p><strong>Réponse :</strong></p><ul>${q.answer.map((i) => `<li>${esc(q.choices[i])}</li>`).join('')}</ul><p>${esc(q.explain)}</p>${await refLink(q.ref)}</div>`;
  } else {
    body = choiceList(q, item, { locked: item.revealed, showResult: item.revealed });
    if (item.revealed) {
      const ok = isCorrect(q, item.selected);
      body += `<div class="card flat explain ${ok ? 'ok' : 'ko'}"><p><strong>${ok ? 'Bonne réponse' : 'Mauvaise réponse'}.</strong> ${esc(q.explain)}</p>${await refLink(q.ref)}</div>`;
    }
  }
  let actions;
  if (oral) {
    actions = item.revealed
      ? `<button class="btn danger" data-act="oral-ko">Je ne savais pas</button><button class="btn" data-act="oral-ok">Je savais</button>`
      : `<button class="btn block" data-act="reveal">Afficher la réponse</button>`;
  } else {
    actions = item.revealed
      ? `<button class="btn" data-act="next">${session.idx + 1 < n ? 'Question suivante' : 'Voir le bilan'}</button>`
      : `<button class="btn" data-act="validate" ${item.selected.length ? '' : 'disabled'}>Valider</button>`;
  }
  main.innerHTML = `
    <div class="qhead"><span>${oral ? 'Mode oral' : 'Entraînement'} · ${esc(session.level)} · ${session.idx + 1}/${n}</span>
      <span class="badge info">${esc(themeName(qdata, q.theme))}</span></div>
    <div class="progress"><i style="width:${((session.idx) / n) * 100}%"></i></div>
    <p class="question">${esc(q.q)}</p>
    ${q.type === 'multiple' && !oral ? '<p class="small muted">Plusieurs réponses possibles.</p>' : ''}
    ${body}
    <div class="row between small" style="margin-top:10px">
      <button class="btn ghost small" data-act="fav">${fav ? '★ Favori' : '☆ Ajouter aux favoris'}</button>
      <button class="btn ghost small" data-act="quit">Arrêter</button>
    </div>
    <div class="sticky-actions">${actions}</div>`;
  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.choice != null && !item.revealed) {
      const ci = Number(b.dataset.choice);
      if (q.type === 'multiple') {
        item.selected = item.selected.includes(ci) ? item.selected.filter((x) => x !== ci) : [...item.selected, ci];
      } else {
        item.selected = [ci];
      }
      persist();
      renderTrainSession(main);
      return;
    }
    switch (b.dataset.act) {
      case 'validate': {
        item.revealed = true;
        const ok = isCorrect(q, item.selected);
        if (ok) session.good += 1;
        recordAnswer(q.id, ok);
        persist();
        renderTrainSession(main);
        break;
      }
      case 'reveal':
        item.revealed = true; persist(); renderTrainSession(main); break;
      case 'oral-ok':
      case 'oral-ko': {
        const ok = b.dataset.act === 'oral-ok';
        item.selected = ok ? [...q.answer] : [];
        if (ok) session.good += 1;
        recordAnswer(q.id, ok);
        next();
        break;
      }
      case 'next': next(); break;
      case 'fav': toggleFavorite(q.id); renderTrainSession(main); break;
      case 'quit': session.idx = session.items.length; finishTraining(main); break;
      default:
    }
  };
  function next() {
    session.idx += 1;
    persist();
    if (session.idx >= session.items.length) finishTraining(main);
    else { renderTrainSession(main); window.scrollTo(0, 0); }
  }
}

async function finishTraining(main) {
  const done = session.items.filter((it) => it.revealed);
  const good = session.good;
  const wrongIds = [];
  const qdata = await getQuestions();
  const index = new Map(qdata.questions.map((q) => [q.id, q]));
  for (const it of done) if (!isCorrect(index.get(it.id), it.selected)) wrongIds.push(it.id);
  const level = session.level;
  const mode = session.mode;
  session = null;
  persist();
  const ratio = done.length ? good / done.length : 0;
  main.innerHTML = `
    <h1>Bilan de la série</h1>
    <div class="card center">
      <div class="score-big ${ratio >= 0.8 ? 'result-ok' : 'result-ko'}">${good}/${done.length}</div>
      <p class="muted">${done.length ? pct(ratio) : ''} de bonnes réponses · seuil d'examen visé : 80 %</p>
    </div>
    <div class="btn-row" style="margin-top:14px">
      ${wrongIds.length ? `<button class="btn accent" data-act="retry">${icons.redo.replace('<svg', '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"')} Revoir mes ${wrongIds.length} erreur(s)</button>` : ''}
      <button class="btn" data-act="again">Nouvelle série</button>
      <a class="btn secondary" href="#/">Accueil</a>
    </div>`;
  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'retry') startTraining({ level, ids: wrongIds, oral: mode === 'oral' });
    if (b.dataset.act === 'again') navigate('#/entrainement');
  };
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
  if (retry) retry.onclick = () => startTraining({ level: result.level, ids: wrongIds });
  main.onclick = null;
}
