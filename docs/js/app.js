// Point d'entrée : routes, accueil (jauge de préparation), progression et réglages.
import { esc, fmtDate, pct, toast, icons } from './ui.js';
import { state, save, setting, LEVELS, LEVEL_NAMES, exportData, importData, resetAll } from './store.js';
import { getQuestions, getCases, getExams, getPractice, getUpdates, getCatalog } from './data.js';
import { route, fallback, onRouteChange, resolve, navigate } from './router.js';
import { readiness, ring, bar, WEIGHTS } from './gauge.js';
import { renderTrainSetup, renderTrainSession, renderExamSetup, renderExamSession, renderExamResult, startTraining, activeExam } from './quiz.js';
import { renderDocsHome, renderDoc, renderFiches, renderFiche, renderGlossary, renderUpdates, renderSearch, renderQuestion } from './docs.js';
import { renderPracticeHome, renderCases, renderCase, renderPouleDrill, renderScheduler, renderChecklists, renderSelfEval } from './practice.js';
import { initOffline, renderOffline, isStandalone } from './offline.js';

const main = document.getElementById('main');
const ic = (name, size = 24) => icons[name].replace('<svg', `<svg width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`);

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

function updateLevelPill() {
  document.getElementById('levelPill').textContent = state.settings.level;
}

async function bundle() {
  const [qdata, casesData, exams, practice] = await Promise.all([getQuestions(), getCases(), getExams(), getPractice()]);
  return { qdata, casesData, exams, practice };
}

// ------------------------------------------------------------------ accueil

async function renderHome() {
  const b = await bundle();
  const level = state.settings.level;
  const r = readiness(level, b);
  const others = LEVELS.map((l) => readiness(l, b));
  const updates = await getUpdates();
  const lastUpdate = updates.find((u) => u.changes?.length);
  const exam = activeExam();
  const errors = b.qdata.questions.filter((q) => q.levels.includes(level) && state.q[q.id]?.n > 0 && (state.q[q.id].last === 0 || state.q[q.id].b <= 1)).length;
  const themes = Object.entries(r.knowledge.byTheme).sort((x, y) => x[1].value - y[1].value);
  const weakest = themes.slice(0, 2).map(([t]) => b.qdata.themes[t]).filter(Boolean);

  if (!state.settings.onboarded) {
    main.innerHTML = `
      <h1>Bienvenue !</h1>
      <p>Cette application vous prépare aux examens de <strong>juge-arbitre de badminton</strong> de la FFBaD : contrôle de connaissances, oral et examen pratique.</p>
      <div class="card"><h2>Quel grade préparez-vous ?</h2>
        <div class="grid two">${LEVELS.map((l) => `<button class="card" style="text-align:left;cursor:pointer" data-onboard="${l}"><strong>${l}</strong><br><span class="small muted">${esc(LEVEL_NAMES[l])}</span></button>`).join('')}</div>
      </div>
      <p class="small muted">Tout fonctionne sans compte : votre progression reste sur cet appareil. Vous pourrez changer de grade à tout moment.</p>`;
    main.onclick = (e) => {
      const btn = e.target.closest('[data-onboard]');
      if (!btn) return;
      state.settings.level = btn.dataset.onboard;
      state.settings.onboarded = true;
      save(true);
      updateLevelPill();
      renderHome();
    };
    return;
  }

  main.innerHTML = `
    ${exam ? `<div class="notice warn row between" style="margin-bottom:12px"><span>Un examen blanc ${esc(exam.level)} est en cours.</span><a class="btn small" href="#/examen/session">Reprendre</a></div>` : ''}
    <div class="chips" style="margin-bottom:12px" aria-label="Grade visé">${LEVELS.map((l) => `<button class="chip" aria-pressed="${l === level}" data-level="${l}">${l}</button>`).join('')}</div>
    <section class="card">
      <div class="readiness">
        ${ring(r.value, { size: 160, caption: 'préparation' })}
        <div>
          <h1 style="margin:0 0 4px">${esc(level)} · <span class="badge ${r.label.tone}">${esc(r.label.text)}</span></h1>
          <p class="small muted" style="margin-top:0">${esc(LEVEL_NAMES[level])}</p>
          <div class="bars">
            ${bar(`Connaissances (${Math.round(WEIGHTS.knowledge * 100)} %)`, r.knowledge.value)}
            ${bar(`Examens blancs (${Math.round(WEIGHTS.exams * 100)} %)`, r.exams.count ? r.exams.value : 0, r.exams.count ? '' : '')}
            ${bar(`Pratique (${Math.round(WEIGHTS.practice * 100)} %)`, r.practice.value)}
          </div>
          <p class="small muted">${r.knowledge.seen}/${r.knowledge.total} questions vues · ${r.exams.count ? `${r.exams.count} examen(s) récent(s)${r.exams.passed ? ', au moins un réussi' : ''}` : 'aucun examen blanc'} · ${r.practice.done}/${r.practice.total} cas pratiques</p>
        </div>
      </div>
      <p class="small">${nextAdvice(r, weakest, errors)}</p>
      <a class="small" href="#/progression">Détail de la jauge et statistiques →</a>
    </section>
    <h2>Que faire maintenant ?</h2>
    <div class="grid two">
      <button class="card tile" data-act="quick" style="text-align:left;cursor:pointer"><span class="ico">${ic('play')}</span><span><strong>Série rapide (10 questions)</strong><span class="small muted">Sélection intelligente selon vos points faibles</span></span></button>
      <a class="card tile" href="#/examen"><span class="ico">${ic('clock')}</span><span><strong>Examen blanc ${esc(level)}</strong><span class="small muted">Conditions d'examen chronométrées, seuil ${b.exams[level]?.sim.passPct ?? 80} %</span></span></a>
      ${errors ? `<button class="card tile" data-act="errors" style="text-align:left;cursor:pointer"><span class="ico">${ic('redo')}</span><span><strong>Revoir mes erreurs</strong><span class="small muted">${errors} question(s) à retravailler</span></span></button>` : ''}
      <a class="card tile" href="#/cas"><span class="ico">${ic('case')}</span><span><strong>Cas pratiques</strong><span class="small muted">Décisions de JA en situation réelle</span></span></a>
      <a class="card tile" href="#/fiches"><span class="ico">${ic('star')}</span><span><strong>Fiches de synthèse</strong><span class="small muted">Nouveautés 2026-2027 : score en 3×15</span></span></a>
      <a class="card tile" href="#/hors-ligne"><span class="ico">${ic('wifi')}</span><span><strong>${isStandalone() ? 'Mode hors-ligne' : 'Installer et utiliser hors ligne'}</strong><span class="small muted">Télécharger le pack sur votre téléphone</span></span></a>
    </div>
    <h2>Préparation par grade</h2>
    <div class="grid three">${others.map((o) => `<button class="card center" data-level="${o.level}" style="cursor:pointer">${ring(o.value, { size: 90, stroke: 12, mini: true, caption: o.level })}<span class="small muted">${esc(o.label.text)}</span></button>`).join('')}</div>
    ${lastUpdate ? `<h2>Règlements</h2><a class="card tile" href="#/mises-a-jour"><span class="ico">${ic('news')}</span><span><strong>Mise à jour détectée le ${fmtDate(lastUpdate.date)}</strong><span class="small muted">${lastUpdate.changes.length} document(s) nouveau(x) ou modifié(s) — saison ${esc(lastUpdate.season)}</span></span></a>` : ''}`;
  main.onclick = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.level) {
      state.settings.level = btn.dataset.level; save();
      updateLevelPill();
      renderHome();
    } else if (btn.dataset.act === 'quick') {
      startTraining({ level, count: 10 });
    } else if (btn.dataset.act === 'errors') {
      startTraining({ level, filter: 'errors', count: 20 });
    }
  };
}

function nextAdvice(r, weakest, errors) {
  if (r.knowledge.seen === 0) return 'Commencez par une série rapide pour évaluer votre niveau, puis lisez les fiches de synthèse.';
  if (r.knowledge.coverage < 0.5) return `Continuez à découvrir les questions (${pct(r.knowledge.coverage)} vues).${weakest.length ? ` Points faibles : ${weakest.join(', ')}.` : ''}`;
  if (errors > 10) return `Retravaillez vos ${errors} questions ratées avant de tenter un examen blanc.`;
  if (!r.exams.count) return 'Vous êtes prêt à tenter un premier examen blanc dans les conditions de l’examen.';
  if (!r.exams.passed) return `Visez le seuil de réussite en examen blanc.${weakest.length ? ` Thèmes à consolider : ${weakest.join(', ')}.` : ''}`;
  if (r.practice.done < 3) return 'Complétez la préparation avec les cas pratiques et l’auto-évaluation : l’examen pratique compte autant que la théorie.';
  return 'Maintenez le niveau : un examen blanc par semaine et une relecture des nouveautés réglementaires.';
}

// ------------------------------------------------------------------ progression

async function renderProgress() {
  const b = await bundle();
  const level = state.settings.level;
  const r = readiness(level, b);
  const exams = state.exams.filter((e) => e.level === level);
  const totalAnswers = Object.values(state.q).reduce((s, x) => s + x.n, 0);
  const totalGood = Object.values(state.q).reduce((s, x) => s + x.c, 0);
  main.innerHTML = `
    <h1>Progression ${esc(level)}</h1>
    <div class="kpis">
      <div class="kpi"><b>${Math.round(r.value * 100)} %</b><span>préparation</span></div>
      <div class="kpi"><b>${totalAnswers}</b><span>réponses données</span></div>
      <div class="kpi"><b>${totalAnswers ? pct(totalGood / totalAnswers) : '—'}</b><span>taux de réussite global</span></div>
      <div class="kpi"><b>${exams.length}</b><span>examens blancs ${esc(level)}</span></div>
    </div>
    <h2>Comment la jauge est calculée</h2>
    <div class="card small">
      <p><strong>Connaissances (${Math.round(WEIGHTS.knowledge * 100)} %)</strong> — maîtrise moyenne des ${r.knowledge.total} questions du niveau, pondérée par l'importance de chaque thème à l'examen. Une question est « acquise » après plusieurs bonnes réponses successives ; une erreur la fait redescendre.</p>
      <p><strong>Examens blancs (${Math.round(WEIGHTS.exams * 100)} %)</strong> — moyenne des 3 derniers examens blancs rapportée au seuil de réussite (atteindre le seuil = 100 %).</p>
      <p><strong>Pratique (${Math.round(WEIGHTS.practice * 100)} %)</strong> — cas pratiques réussis (60 %) et auto-évaluation des critères d'examen (40 %).</p>
      <p>« Prêt pour l'examen » exige au moins 85 % et un examen blanc réussi récemment. Calcul effectué uniquement sur cet appareil.</p>
    </div>
    <h2>Par thème</h2>
    <div class="card bars">${Object.entries(r.knowledge.byTheme).sort((x, y) => x[1].value - y[1].value)
      .map(([t, v]) => bar(b.qdata.themes[t] || t, v.value, v.accuracy != null ? ` <span title="taux de réussite">(${Math.round(v.accuracy * 100)}%)</span>` : '')).join('')}</div>
    <h2>Examens blancs</h2>
    ${exams.length ? `<div class="doclist">${exams.slice(0, 20).map((h) => `<a class="docitem" href="#/examen/resultat/${h.id}"><span class="code">${Math.round(h.score * 100)}%</span><span class="t">${h.passed ? '<span class="badge ok">Réussi</span>' : '<span class="badge ko">Échoué</span>'} ${h.good}/${h.total}<small>${new Date(h.date).toLocaleString('fr-FR')}</small></span></a>`).join('')}</div>` : '<p class="muted">Aucun examen blanc pour ce grade.</p>'}
    <h2>Pratique</h2>
    <p>${r.practice.done}/${r.practice.total} cas pratiques réalisés · ${r.practice.rated}/${r.practice.criteria} critères auto-évalués · exercice de poule : ${state.drills.poule.ok}/${state.drills.poule.n} réussis.</p>`;
}

// ------------------------------------------------------------------ conditions d'examen

async function renderConditions() {
  const exams = await getExams();
  main.innerHTML = `
    <h1>Conditions d'examen</h1>
    <p class="muted">Synthèse du chapitre 06.02 du Guide du Badminton (filière juge-arbitrage, édition 2026/1, en vigueur au 1er septembre 2026) et de ses annexes. Les modalités précises (nombre de questions, durée) sont fixées par FormaBad et votre ligue : renseignez-vous auprès de votre CLOT.</p>
    ${LEVELS.map((l) => {
      const c = exams[l];
      return `<div class="card" style="margin-bottom:12px"><h2>${l} — ${esc(LEVEL_NAMES[l])}</h2>
        <p>${esc(c.official.summary)}</p><ul>${c.official.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>
        <h3>Ce que l'application simule</h3>
        <p class="small">${c.sim.questions} questions · ${c.sim.minutes} min · seuil ${c.sim.passPct} % · ${c.sim.documents ? 'avec documents' : 'sans documents'}. ${esc(c.sim.note || '')}</p>
        <p class="small muted">Sources : ${c.official.sources.map((s) => `<a href="#/doc/${encodeURIComponent(s.doc)}${s.art ? `?a=${encodeURIComponent(s.art)}` : ''}">${esc(s.label)}</a>`).join(' · ')}</p></div>`;
    }).join('')}`;
}

// ------------------------------------------------------------------ réglages

async function renderSettings() {
  const cat = await getCatalog().catch(() => null);
  const q = await getQuestions();
  main.innerHTML = `
    <h1>Réglages</h1>
    <div class="card stack">
      <div><label class="field">Grade préparé</label><div class="chips">${LEVELS.map((l) => `<button class="chip" aria-pressed="${l === state.settings.level}" data-level="${l}">${l}</button>`).join('')}</div></div>
      <div><label class="field">Apparence</label><div class="chips">${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, t]) => `<button class="chip" aria-pressed="${state.settings.theme === k}" data-theme="${k}">${t}</button>`).join('')}</div></div>
    </div>
    <div class="card stack" style="margin-top:12px">
      <h2>Ma progression</h2>
      <p class="small muted">Les données restent sur cet appareil (aucun compte, aucun serveur). Exportez-les pour les sauvegarder ou les transférer.</p>
      <div class="btn-row">
        <button class="btn secondary" data-act="export">Exporter (fichier)</button>
        <label class="btn secondary" for="importFile">Importer</label><input type="file" id="importFile" accept="application/json,.json" hidden>
        <button class="btn danger" data-act="reset">Tout réinitialiser</button>
      </div>
    </div>
    <div class="card stack" style="margin-top:12px">
      <h2>Hors-ligne et mises à jour</h2>
      <a class="btn secondary" href="#/hors-ligne">Gérer le mode hors-ligne</a>
      <p class="small muted">${q.count} questions · ${cat ? `${cat.count} documents officiels (saison ${esc(cat.season)})` : ''}</p>
    </div>
    <div class="card small" style="margin-top:12px">
      <h2>À propos</h2>
      <p>Application indépendante de préparation aux examens de juge-arbitre, non éditée par la Fédération Française de Badminton. Les règlements proviennent du Guide du Badminton publié par la FFBaD (<a href="https://gdb.ffbad.org" target="_blank" rel="noopener">gdb.ffbad.org</a>) et sont mis à jour automatiquement ; seul le texte officiel fait foi.</p>
      <p>Les questions et cas pratiques sont rédigés à partir de ces textes. Une erreur ? Signalez-la sur le dépôt GitHub du projet.</p>
    </div>`;
  main.onclick = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.level) { state.settings.level = btn.dataset.level; save(); updateLevelPill(); renderSettings(); }
    if (btn.dataset.theme) { setting('theme', btn.dataset.theme); applyTheme(); renderSettings(); }
    if (btn.dataset.act === 'export') {
      const blob = new Blob([exportData()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `prepa-ja-progression-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    if (btn.dataset.act === 'reset' && window.confirm('Effacer toute la progression (réponses, examens, cas pratiques) ?')) {
      resetAll(); applyTheme(); updateLevelPill(); toast('Progression réinitialisée'); renderSettings();
    }
  };
  main.querySelector('#importFile').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      importData(await file.text());
      applyTheme(); updateLevelPill();
      toast('Progression importée');
      renderSettings();
    } catch (err) {
      toast(`Import impossible : ${err.message}`);
    }
  };
}

// ------------------------------------------------------------------ démarrage

const TABS = { home: 'home', train: 'train', exam: 'exam', practice: 'practice', docs: 'docs' };
onRouteChange((meta, path) => {
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === meta.tab));
  document.getElementById('backBtn').hidden = path === '/' || !meta.back;
  main.onclick = null; main.oninput = null; main.onchange = null;
  window.scrollTo(0, 0);
});

const wrap = (fn) => async (args) => {
  try {
    await fn(args);
  } catch (err) {
    console.error(err);
    main.innerHTML = `<h1>Oups…</h1><p>Impossible d'afficher cette page${navigator.onLine ? '' : ' hors ligne'}.</p><p class="small muted">${esc(err.message)}</p><a class="btn" href="#/">Accueil</a>`;
  }
};

route('/', wrap(renderHome), { tab: TABS.home });
route('/progression', wrap(renderProgress), { tab: TABS.home, back: true });
route('/entrainement', wrap(() => renderTrainSetup(main)), { tab: TABS.train });
route('/entrainement/session', wrap(() => renderTrainSession(main)), { tab: TABS.train });
route('/examen', wrap(() => renderExamSetup(main)), { tab: TABS.exam });
route('/examen/session', wrap(() => renderExamSession(main)), { tab: TABS.exam });
route('/examen/resultat/:id', wrap(({ id }) => renderExamResult(main, id)), { tab: TABS.exam, back: true });
route('/pratique', wrap(() => renderPracticeHome(main)), { tab: TABS.practice });
route('/cas', wrap(() => renderCases(main)), { tab: TABS.practice, back: true });
route('/cas/:id', wrap(({ id }) => renderCase(main, id)), { tab: TABS.practice, back: true });
route('/exercice/poule', wrap(() => renderPouleDrill(main)), { tab: TABS.practice, back: true });
route('/outil/echeancier', wrap(() => renderScheduler(main)), { tab: TABS.practice, back: true });
route('/checklists', wrap(() => renderChecklists(main)), { tab: TABS.practice, back: true });
route('/auto-evaluation', wrap(() => renderSelfEval(main)), { tab: TABS.practice, back: true });
route('/docs', wrap(() => renderDocsHome(main)), { tab: TABS.docs });
route('/doc/:id', wrap(({ id, query }) => renderDoc(main, id, query)), { tab: TABS.docs, back: true });
route('/fiches', wrap(() => renderFiches(main)), { tab: TABS.docs, back: true });
route('/fiche/:id', wrap(({ id }) => renderFiche(main, id)), { tab: TABS.docs, back: true });
route('/glossaire', wrap(() => renderGlossary(main)), { tab: TABS.docs, back: true });
route('/conditions', wrap(renderConditions), { tab: TABS.docs, back: true });
route('/mises-a-jour', wrap(() => renderUpdates(main)), { tab: TABS.docs, back: true });
route('/recherche', wrap(({ query }) => renderSearch(main, query)), { back: true });
route('/question/:id', wrap(({ id }) => renderQuestion(main, id)), { back: true });
route('/hors-ligne', wrap(() => renderOffline(main)), { back: true });
route('/reglages', wrap(renderSettings), { back: true });
fallback(() => navigate('#/', true));

document.getElementById('backBtn').addEventListener('click', () => {
  if (history.length > 1) history.back(); else navigate('#/');
});
document.addEventListener('levelchange', updateLevelPill);

applyTheme();
updateLevelPill();
initOffline();
resolve();
