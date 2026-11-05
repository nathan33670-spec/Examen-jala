// Point d'entrée : routes, accueil, préférences du premier lancement, progression, ressources et réglages.
import { esc, pct, toast } from './ui.js';
import { state, save, setting, qStat, LEVELS, LEVEL_NAMES, LEVEL_SHORT, LIGUES, exportData, importData, resetAll } from './store.js';
import { getQuestions, getCases, getExams, getPractice, getCatalog, onDataUpdate } from './data.js';
import { route, fallback, onRouteChange, resolve, navigate } from './router.js';
import { readiness, bar } from './gauge.js';
import { renderExamSetup, renderExamSession, renderExamResult, activeExam } from './quiz.js';
import { renderPlaySession, startPlay, activePlay, FOCUS, levelPool, priorities, focusOf, trackSwitch, setLevel, seriesCount } from './play.js';
import { renderDocsHome, renderDoc, renderFiches, renderFiche, renderGlossary, renderUpdates, renderSearch, renderQuestion } from './docs.js';
import { renderCases, renderCase, renderPouleDrill, renderScheduler, renderChecklists, renderSelfEval } from './practice.js';
import { initOffline, renderOffline, isStandalone } from './offline.js';
import { summarize } from './engine.js';

const main = document.getElementById('main');

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

function updateLevelPill() {
  document.getElementById('levelPill').textContent = LEVEL_SHORT[state.settings.level] || '';
}

async function bundle() {
  const [qdata, casesData, exams, practice] = await Promise.all([getQuestions(), getCases(), getExams(), getPractice()]);
  return { qdata, casesData, exams, practice };
}

const KNOWLEDGE = {
  decouverte: ['Je découvre', 'Premières séries avec les questions les plus simples'],
  bases: ['J’ai des bases', 'Toutes les difficultés, révisions régulières'],
  revision: ['Je révise l’examen', 'Toutes les difficultés, davantage de révisions'],
};

// ------------------------------------------------------------------ accueil

async function renderHome() {
  if (!state.settings.onboarded) { renderOnboarding(); return; }
  const b = await bundle();
  const level = state.settings.level;
  const exam = activeExam();
  const play = activePlay();
  const prio = priorities(level);
  const count = seriesCount(level);
  const now = Date.now();
  const all = summarize(levelPool(b.qdata, level), qStat, now);
  const r = readiness(level, b);
  const rows = [
    ...(prio.length ? [{ id: 'prio', name: 'Mes priorités', tag: prio.map((id) => focusOf(level, id).name).join(' · ') }] : []),
    { id: '', name: 'Tout le programme', tag: LEVEL_NAMES[level] },
    ...FOCUS[level].filter((f) => f.id !== 'ligue' || levelPool(b.qdata, level, { focus: 'ligue' }).length),
  ];
  main.innerHTML = `
    ${trackSwitch(level)}
    ${exam ? `<div class="notice row between"><span>Examen blanc en cours.</span><a class="btn small" href="#/examen/session">Reprendre</a></div>` : ''}
    ${play ? `<div class="notice row between"><span>Série en cours (${play.idx + 1}/${play.ids.length}).</span><a class="btn small" href="#/entrainement/session">Reprendre</a></div>` : ''}
    <button class="btn block big" data-focus="${rows[0].id}">Commencer · ${count} questions${prio.length ? ' sur mes priorités' : ''}</button>
    <p class="small muted center">${all.seen} / ${all.total} questions vues · ${all.mastered} maîtrisées · <a href="#/progression">préparation ${Math.round(r.value * 100)} %</a></p>
    <h2>Choisir un domaine</h2>
    <div class="rows">${rows.map((f) => {
      const s = summarize(levelPool(b.qdata, level, { focus: f.id }), qStat, now);
      const p = s.total ? Math.round((s.mastered / s.total) * 100) : 0;
      return `<button class="row-item" data-focus="${f.id}"><span class="ri-main"><strong>${esc(f.name)}</strong><span class="small muted">${esc(f.tag)}</span></span>
        <span class="ri-side"><span class="small muted">${s.total} q. · ${p} %</span><span class="pbar"><i style="width:${p}%"></i></span></span></button>`;
    }).join('')}</div>
    <div class="rows">
      <button class="row-item" data-act="retry" ${all.errors ? '' : 'disabled'}><span class="ri-main"><strong>Mes erreurs</strong><span class="small muted">${all.errors ? `${all.errors} question(s) à revoir` : 'Aucune erreur en attente'}</span></span><span class="ri-side" aria-hidden="true">›</span></button>
      <a class="row-item" href="#/examen"><span class="ri-main"><strong>Examen blanc</strong><span class="small muted">${b.exams[level]?.sim.questions ?? 40} questions, chronométré, seuil ${b.exams[level]?.sim.passPct ?? 80} %</span></span><span class="ri-side" aria-hidden="true">›</span></a>
    </div>`;

  main.onclick = (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    if (btn.dataset.track) { setLevel(btn.dataset.track); renderHome(); return; }
    if (btn.dataset.act === 'retry') startPlay({ mode: 'retry', level, count: 20 });
    if (btn.dataset.focus !== undefined) startPlay({ mode: 'smart', level, count, focus: btn.dataset.focus });
  };
}

// ------------------------------------------------------------------ préférences (premier lancement et réglages)

function ligueSelect(current) {
  return `<select id="ligue"><option value="">— Non renseignée —</option>${Object.entries(LIGUES)
    .map(([k, name]) => `<option value="${k}" ${k === current ? 'selected' : ''}>${esc(name)}</option>`).join('')}</select>`;
}

/** Formulaire de préférences (stockées uniquement sur l'appareil). */
function prefsForm(st) {
  const prioOf = (l) => st.priorities[l] || [];
  return `
    <fieldset class="field-group"><legend>Ce que vous préparez</legend>
      <div class="options">${LEVELS.map((l) => `<button type="button" class="option" data-level="${l}" aria-pressed="${st.level === l}"><strong>${esc(LEVEL_SHORT[l])}</strong><span class="small muted">${esc(LEVEL_NAMES[l])}</span></button>`).join('')}</div>
    </fieldset>
    <fieldset class="field-group"><legend>Votre niveau de connaissance</legend>
      <div class="options">${Object.entries(KNOWLEDGE).map(([k, [name, desc]]) => `<button type="button" class="option" data-knowledge="${k}" aria-pressed="${st.knowledge === k}"><strong>${name}</strong><span class="small muted">${desc}</span></button>`).join('')}</div>
    </fieldset>
    <fieldset class="field-group"><legend>Vos priorités <span class="small muted">(plusieurs choix possibles)</span></legend>
      <div class="options">${FOCUS[st.level].map((f) => `<button type="button" class="option check" data-prio="${f.id}" aria-pressed="${prioOf(st.level).includes(f.id)}"><strong>${esc(f.name)}</strong><span class="small muted">${esc(f.tag)}</span></button>`).join('')}</div>
    </fieldset>
    <fieldset class="field-group"><legend>Votre ligue</legend>
      ${ligueSelect(st.ligue)}
      <p class="small muted">Pour les questions sur les interclubs régionaux et les règlements de votre ligue.</p>
    </fieldset>`;
}

function prefsHandlers(st, redraw) {
  return {
    click(e) {
      const b = e.target.closest('button');
      if (!b) return false;
      if (b.dataset.level) { st.level = b.dataset.level; redraw(); return true; }
      if (b.dataset.knowledge) { st.knowledge = b.dataset.knowledge; redraw(); return true; }
      if (b.dataset.prio) {
        const list = st.priorities[st.level] || [];
        st.priorities = { ...st.priorities, [st.level]: list.includes(b.dataset.prio) ? list.filter((x) => x !== b.dataset.prio) : [...list, b.dataset.prio] };
        redraw();
        return true;
      }
      return false;
    },
    change(e) { if (e.target.id === 'ligue') st.ligue = e.target.value; },
  };
}

const currentPrefs = () => ({
  level: state.settings.level || 'JALA',
  knowledge: state.settings.knowledge || 'bases',
  priorities: { ...(state.settings.priorities || {}) },
  ligue: state.settings.ligue || '',
});

function storePrefs(st) {
  Object.assign(state.settings, { level: st.level, knowledge: st.knowledge, priorities: st.priorities, ligue: st.ligue });
  save(true);
  updateLevelPill();
}

function renderOnboarding() {
  const st = currentPrefs();
  const draw = () => {
    main.innerHTML = `
      <section class="onboard">
        <h1>Bienvenue</h1>
        <p class="muted">Quelques réglages pour adapter les séries à votre préparation. Ils restent sur cet appareil et se modifient à tout moment dans les réglages.</p>
        ${prefsForm(st)}
        <button class="btn block" id="go">Commencer</button>
      </section>`;
  };
  draw();
  const h = prefsHandlers(st, draw);
  main.onchange = h.change;
  main.onclick = (e) => {
    if (h.click(e)) return;
    if (e.target.closest('#go')) {
      storePrefs(st);
      state.settings.onboarded = true;
      save(true);
      renderHome();
    }
  };
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
    <h1>Progression · ${esc(LEVEL_SHORT[level])}</h1>
    <div class="stats panel">
      <div><b>${Math.round(r.value * 100)} %</b><span>préparation</span></div>
      <div><b>${totalAnswers}</b><span>réponses</span></div>
      <div><b>${totalAnswers ? pct(totalGood / totalAnswers) : '—'}</b><span>de réussite</span></div>
    </div>
    <h2>Par thème</h2>
    <div class="panel bars">${Object.entries(r.knowledge.byTheme).sort((x, y) => x[1].value - y[1].value)
      .map(([t, v]) => bar(b.qdata.themes[t] || t, v.value, v.accuracy != null ? ` <span title="taux de réussite">(${Math.round(v.accuracy * 100)} %)</span>` : '')).join('') || '<p class="muted">Pas encore de réponse.</p>'}</div>
    <h2>Calcul de la jauge</h2>
    <div class="panel small">
      <p><strong>Connaissances (${Math.round(r.weights.knowledge * 100)} %)</strong> : maîtrise moyenne des ${r.knowledge.total} questions du parcours, pondérée par l'importance de chaque thème à l'examen. Une question est maîtrisée après plusieurs bonnes réponses espacées dans le temps ; une erreur la fait redescendre.</p>
      <p><strong>Examens blancs (${Math.round(r.weights.exams * 100)} %)</strong> : moyenne des 3 derniers examens blancs rapportée au seuil de réussite.</p>
      ${r.weights.practice ? `<p><strong>Pratique (${Math.round(r.weights.practice * 100)} %)</strong> : cas pratiques réussis et auto-évaluation des critères d'examen.</p>` : ''}
    </div>
    <h2>Examens blancs</h2>
    ${exams.length ? `<div class="doclist">${exams.slice(0, 20).map((h) => `<a class="docitem" href="#/examen/resultat/${encodeURIComponent(h.id)}"><span class="code">${Math.round(h.score * 100)}%</span><span class="t">${h.passed ? '<span class="badge ok">Réussi</span>' : '<span class="badge ko">Échoué</span>'} ${Number(h.good)}/${Number(h.total)}<small>${new Date(h.date).toLocaleString('fr-FR')}</small></span></a>`).join('')}</div>` : '<p class="muted">Aucun examen blanc pour ce parcours.</p>'}`;
}

// ------------------------------------------------------------------ ressources

function renderResources() {
  const item = (href, title, sub) => `<a class="row-item" href="${href}"><span class="ri-main"><strong>${title}</strong><span class="small muted">${sub}</span></span><span class="ri-side" aria-hidden="true">›</span></a>`;
  main.innerHTML = `
    <h1>Ressources</h1>
    <h2>Textes</h2>
    <div class="rows">
      ${item('#/docs', 'Règlements', 'Guide du Badminton, Règles officielles, règlements de votre ligue')}
      ${item('#/fiches', 'Fiches de synthèse', 'L’essentiel à connaître')}
      ${item('#/glossaire', 'Glossaire', 'Sigles et vocabulaire')}
      ${item('#/conditions', 'Conditions d’examen', 'Ce que disent les filières d’arbitrage et de juge-arbitrage')}
      ${item('#/mises-a-jour', 'Mises à jour des règlements', 'Historique des nouvelles versions')}
    </div>
    ${isStandalone() ? '' : `<h2>Application</h2><div class="rows">${item('#/hors-ligne', 'Installer et utiliser hors ligne', 'Sur téléphone ou ordinateur')}${item('#/reglages', 'Réglages', 'Préférences, questions par série, apparence, données')}</div>`}
    <h2>Pratique du juge-arbitre</h2>
    <div class="rows">
      ${item('#/cas', 'Cas pratiques', 'Situations de compétition, décisions étape par étape')}
      ${item('#/exercice/poule', 'Classement de poule', 'Départager les égalités (RGC 3.4.1)')}
      ${item('#/outil/echeancier', 'Dimensionner une compétition', 'Formats, nombre de matchs, heure de fin')}
      ${item('#/checklists', 'Check-lists', 'Avant, pendant et après la compétition')}
      ${item('#/auto-evaluation', 'Auto-évaluation', 'Grille des critères JALA')}
    </div>`;
}

// ------------------------------------------------------------------ conditions d'examen

async function renderConditions() {
  const exams = await getExams();
  main.innerHTML = `
    <h1>Conditions d'examen</h1>
    <p class="muted">Synthèse des chapitres 06.01 (filière arbitrage) et 06.02 (filière juge-arbitrage) du Guide du Badminton, édition 2026/1, et de leurs annexes. Les modalités précises (nombre de questions, durée) sont fixées par FormaBad et votre ligue : renseignez-vous auprès de votre CLOT.</p>
    ${LEVELS.map((l) => {
      const c = exams[l];
      return `<div class="panel"><h2>${esc(LEVEL_NAMES[l])}</h2>
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
  const st = currentPrefs();
  const draw = () => {
    main.innerHTML = `
      <h1>Réglages</h1>
      <section class="panel">
        <h2>Préférences</h2>
        ${prefsForm(st)}
        <button class="btn" id="savePrefs">Enregistrer</button>
      </section>
      <section class="panel">
        <h2>Questions par série</h2>
        <div class="seg" role="group" aria-label="Questions par série">${[10, 20, 40].map((n) => `<button data-count="${n}" aria-pressed="${seriesCount(st.level) === n}">${n}</button>`).join('')}</div>
      </section>
      <section class="panel">
        <h2>Apparence</h2>
        <div class="seg" role="group" aria-label="Apparence">${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, t]) => `<button data-theme="${k}" aria-pressed="${state.settings.theme === k}">${t}</button>`).join('')}</div>
      </section>
      <section class="panel">
        <h2>Données</h2>
        <p class="small muted">Préférences et progression restent sur cet appareil (aucun compte, aucun serveur). Exportez-les pour les sauvegarder ou les transférer.</p>
        <div class="btn-row">
          <button class="btn secondary" data-act="export">Exporter</button>
          <label class="btn secondary" for="importFile">Importer</label><input type="file" id="importFile" accept="application/json,.json" hidden>
          <button class="btn danger" data-act="reset">Tout effacer</button>
        </div>
      </section>
      <section class="panel">
        <h2>Contenu</h2>
        <p class="small muted">${Number(q.count)} questions${q.version ? ` (version ${esc(q.version)})` : ''} · ${cat ? `${Number(cat.count)} documents (saison ${esc(cat.season)})` : ''}. Les questions sont mises à jour automatiquement dès qu'une connexion est disponible.</p>
        <a class="btn secondary" href="#/hors-ligne">Mode hors ligne</a>
      </section>
      <section class="panel small">
        <h2>À propos</h2>
        <p>Application indépendante de préparation aux examens d'officiel technique, non éditée par la Fédération Française de Badminton. Les règlements proviennent du Guide du Badminton (<a href="https://gdb.ffbad.org" target="_blank" rel="noopener">gdb.ffbad.org</a>) et des sites des ligues ; seul le texte officiel fait foi.</p>
        <p><a href="confidentialite.html" target="_blank" rel="noopener">Règles de confidentialité</a></p>
      </section>`;
    main.querySelector('#importFile').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        importData(await file.text());
        applyTheme(); updateLevelPill();
        toast('Données importées');
        renderSettings();
      } catch (err) {
        toast(`Import impossible : ${err.message}`);
      }
    };
  };
  draw();
  const h = prefsHandlers(st, draw);
  main.onchange = h.change;
  main.onclick = (e) => {
    if (h.click(e)) return;
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.id === 'savePrefs') { storePrefs(st); toast('Préférences enregistrées'); }
    if (btn.dataset.theme) { setting('theme', btn.dataset.theme); applyTheme(); draw(); }
    if (btn.dataset.count) {
      const lv = state.settings.level;
      state.settings.trainPrefs = { ...(state.settings.trainPrefs || {}), [lv]: { ...(state.settings.trainPrefs?.[lv] || {}), count: Number(btn.dataset.count) } };
      save(); draw();
    }
    if (btn.dataset.act === 'export') {
      const blob = new Blob([exportData()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `prepa-ja-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    if (btn.dataset.act === 'reset' && window.confirm('Effacer toutes les données (préférences, réponses, examens) ?')) {
      resetAll(); applyTheme(); updateLevelPill(); toast('Données effacées'); renderHome();
    }
  };
}

// ------------------------------------------------------------------ démarrage

const TABS = { home: 'home', exam: 'exam', res: 'res' };
onRouteChange((meta, path) => {
  document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.tab === meta.tab));
  document.getElementById('backBtn').hidden = path === '/' || !meta.back;
  document.body.classList.toggle('in-play', path === '/entrainement/session');
  main.onclick = null; main.oninput = null; main.onchange = null;
  updateLevelPill();
  window.scrollTo(0, 0);
});

const wrap = (fn) => async (args) => {
  try {
    await fn(args);
  } catch (err) {
    console.error(err);
    main.innerHTML = `<h1>Page indisponible</h1><p>Impossible d'afficher cette page${navigator.onLine ? '' : ' hors ligne'}.</p><p class="small muted">${esc(err.message)}</p><a class="btn" href="#/">Accueil</a>`;
  }
};

route('/', wrap(renderHome), { tab: TABS.home });
route('/progression', wrap(renderProgress), { tab: TABS.home, back: true });
route('/entrainement', () => navigate('#/', true));
route('/ala', () => { setLevel('ALA'); navigate('#/', true); });
route('/entrainement/session', wrap(() => renderPlaySession(main)), { tab: TABS.home });
route('/examen', wrap(() => renderExamSetup(main)), { tab: TABS.exam });
route('/examen/session', wrap(() => renderExamSession(main)), { tab: TABS.exam });
route('/examen/resultat/:id', wrap(({ id }) => renderExamResult(main, id)), { tab: TABS.exam, back: true });
route('/ressources', wrap(renderResources), { tab: TABS.res });
route('/pratique', () => navigate('#/ressources', true));
route('/cas', wrap(() => renderCases(main)), { tab: TABS.res, back: true });
route('/cas/:id', wrap(({ id }) => renderCase(main, id)), { tab: TABS.res, back: true });
route('/exercice/poule', wrap(() => renderPouleDrill(main)), { tab: TABS.res, back: true });
route('/outil/echeancier', wrap(() => renderScheduler(main)), { tab: TABS.res, back: true });
route('/checklists', wrap(() => renderChecklists(main)), { tab: TABS.res, back: true });
route('/auto-evaluation', wrap(() => renderSelfEval(main)), { tab: TABS.res, back: true });
route('/docs', wrap(() => renderDocsHome(main)), { tab: TABS.res, back: true });
route('/doc/:id', wrap(({ id, query }) => renderDoc(main, id, query)), { tab: TABS.res, back: true });
route('/fiches', wrap(() => renderFiches(main)), { tab: TABS.res, back: true });
route('/fiche/:id', wrap(({ id }) => renderFiche(main, id)), { tab: TABS.res, back: true });
route('/glossaire', wrap(() => renderGlossary(main)), { tab: TABS.res, back: true });
route('/conditions', wrap(renderConditions), { tab: TABS.res, back: true });
route('/mises-a-jour', wrap(() => renderUpdates(main)), { tab: TABS.res, back: true });
route('/recherche', wrap(({ query }) => renderSearch(main, query)), { back: true });
route('/question/:id', wrap(({ id }) => renderQuestion(main, id)), { back: true });
route('/hors-ligne', wrap(() => renderOffline(main)), { back: true });
route('/reglages', wrap(renderSettings), { back: true });
fallback(() => navigate('#/', true));

document.getElementById('backBtn').addEventListener('click', () => {
  if (history.length > 1) history.back(); else navigate('#/');
});
document.addEventListener('levelchange', updateLevelPill);
// questions mises à jour en arrière-plan : l'écran courant est réaffiché (sauf pendant une série ou un examen)
onDataUpdate((info) => {
  toast(`Questions mises à jour (${info.count} questions)`);
  if (!/^#\/(entrainement\/session|examen\/session)/.test(location.hash)) resolve();
});

applyTheme();
updateLevelPill();
initOffline();
resolve();
