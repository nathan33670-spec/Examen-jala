// Point d'entrée : routes, accueil (progression ludique et jauge de préparation), progression et réglages.
import { esc, fmtDate, pct, toast, icons } from './ui.js';
import { state, save, setting, qStat, LEVELS, LEVEL_NAMES, exportData, importData, resetAll } from './store.js';
import { getQuestions, getCases, getExams, getPractice, getUpdates, getCatalog } from './data.js';
import { route, fallback, onRouteChange, resolve, navigate } from './router.js';
import { readiness, ring, bar, WEIGHTS } from './gauge.js';
import { renderExamSetup, renderExamSession, renderExamResult, activeExam } from './quiz.js';
import { renderPlayHub, renderPlaySession, startPlay, activePlay, MODES } from './play.js';
import { renderDocsHome, renderDoc, renderFiches, renderFiche, renderGlossary, renderUpdates, renderSearch, renderQuestion } from './docs.js';
import { renderPracticeHome, renderCases, renderCase, renderPouleDrill, renderScheduler, renderChecklists, renderSelfEval } from './practice.js';
import { initOffline, renderOffline, isStandalone } from './offline.js';
import { summarize } from './engine.js';
import { levelInfo, currentStreak, dayKey, addDays, BADGES } from './game.js';
import { refreshBadges } from './reward.js';

const main = document.getElementById('main');
const ic = (name, size = 24) => icons[name].replace('<svg', `<svg width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"`);

function applyTheme() {
  const t = state.settings.theme;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

function updateLevelPill() {
  document.getElementById('levelPill').textContent = state.settings.level;
  const streak = currentStreak(state.game);
  const pill = document.getElementById('streakPill');
  if (pill) {
    pill.querySelector('b').textContent = streak;
    pill.classList.toggle('cold', streak === 0);
    pill.setAttribute('aria-label', `Série : ${streak} jour${streak > 1 ? 's' : ''} d'entraînement`);
  }
}

async function bundle() {
  const [qdata, casesData, exams, practice] = await Promise.all([getQuestions(), getCases(), getExams(), getPractice()]);
  return { qdata, casesData, exams, practice };
}

const GOALS = [[10, 'Tranquille', '≈ 5 min'], [20, 'Régulier', '≈ 10 min'], [40, 'Intensif', '≈ 20 min']];

// ------------------------------------------------------------------ accueil

async function renderHome() {
  if (!state.settings.onboarded) { renderOnboarding(); return; }
  const b = await bundle();
  const level = state.settings.level;
  const r = readiness(level, b);
  const updates = await getUpdates().catch(() => []);
  const lastUpdate = updates.find((u) => u.changes?.length);
  const exam = activeExam();
  const play = activePlay();
  const pool = b.qdata.questions.filter((q) => q.levels.includes(level));
  const sum = summarize(pool, qStat, Date.now());
  const themes = Object.entries(r.knowledge.byTheme).sort((x, y) => x[1].value - y[1].value);
  const weakest = themes.slice(0, 2).map(([t]) => b.qdata.themes[t]).filter(Boolean);
  const g = state.game;
  const info = levelInfo(g.xp);
  const streak = currentStreak(g);
  const todayStats = g.days[dayKey()] || { a: 0, g: 0, xp: 0 };
  const goal = state.settings.dailyGoal || 20;
  const daily = g.daily[`${dayKey()}|${level}`];
  const count = state.settings.train?.count || 10;
  const nextCount = Math.min(count, sum.total);
  const nNew = Math.min(sum.new, Math.max(0, nextCount - Math.min(sum.review, Math.round(nextCount * 0.4))));
  const earned = BADGES.filter((x) => g.badges[x.id]).sort((x, y) => g.badges[y.id] - g.badges[x.id]);
  const hour = new Date().getHours();
  const hello = hour < 5 ? 'Bonsoir' : hour < 18 ? 'Bonjour' : 'Bonsoir';

  main.innerHTML = `
    ${exam ? `<div class="notice warn row between" style="margin-bottom:12px"><span>Un examen blanc ${esc(exam.level)} est en cours.</span><a class="btn small" href="#/examen/session">Reprendre</a></div>` : ''}
    ${play ? `<div class="notice warn row between" style="margin-bottom:12px"><span>${MODES[play.mode].icon} Partie « ${esc(MODES[play.mode].name)} » en cours.</span><a class="btn small" href="#/entrainement/session">Reprendre</a></div>` : ''}
    <section class="player-card">
      <div class="pc-top">
        <div class="avatar" aria-hidden="true">🏸</div>
        <div class="pc-id">
          <span class="small pc-hello">${hello} ! Objectif ${esc(level)}</span>
          <strong>Niv. ${info.level} · ${esc(info.title)}</strong>
          <div class="xpbar" title="${info.into}/${info.need} XP"><i style="width:${Math.round(info.progress * 100)}%"></i></div>
          <span class="small pc-xp">${g.xp} XP · encore ${info.need - info.into} XP pour le niveau ${info.level + 1}</span>
        </div>
        <a class="streak ${streak ? '' : 'cold'}" href="#/progression" aria-label="Série de ${streak} jour(s)"><span aria-hidden="true">🔥</span><b>${streak}</b><span class="small">jour${streak > 1 ? 's' : ''}</span></a>
      </div>
      <div class="goal">
        ${goalRing(todayStats.a, goal)}
        <div><strong>Objectif du jour : ${Math.min(todayStats.a, goal)}/${goal} questions</strong>
          <span class="small">${todayStats.a >= goal ? 'Objectif atteint, bravo ! 🎉' : todayStats.a ? `Plus que ${goal - todayStats.a} pour l’atteindre.` : streak ? 'Entraînez-vous aujourd’hui pour garder votre série 🔥' : 'Une petite série et c’est parti !'}</span></div>
      </div>
    </section>

    <button class="cta-continue" data-act="smart">
      <span class="cta-play" aria-hidden="true">▶</span>
      <span class="cta-text"><strong>${g.counters.answers ? 'Continuer ma préparation' : 'Commencer ma préparation'}</strong>
        <span class="small">${nextCount} questions · ${nNew} nouvelle${nNew > 1 ? 's' : ''}${sum.review ? `, ${Math.min(sum.review, nextCount - nNew)} à revoir` : ''}</span></span>
    </button>

    <button class="daily-card ${daily ? 'done' : ''}" data-act="daily">
      <span class="daily-sun" aria-hidden="true">☀️</span>
      <span class="daily-body"><strong>Défi du jour</strong>
        <span class="small">${daily ? `Fait : ${daily.good}/${daily.total} ${'★'.repeat(daily.stars)}${'☆'.repeat(3 - daily.stars)} — nouveau défi demain` : '10 questions, les mêmes pour tous aujourd’hui'}</span></span>
      <span class="daily-go" aria-hidden="true">${daily ? '✓' : '›'}</span>
    </button>

    <h2>Jouer</h2>
    <div class="modes">
      ${['match', 'chrono', 'survival'].map((m) => `<button class="mode-card m-${m}" data-mode="${m}"><span class="mode-emoji" aria-hidden="true">${MODES[m].icon}</span><strong>${esc(MODES[m].name)}</strong><span class="small">${esc(MODES[m].tag)}</span></button>`).join('')}
      <a class="mode-card m-exam" href="#/examen"><span class="mode-emoji" aria-hidden="true">📝</span><strong>Examen blanc ${esc(level)}</strong><span class="small">Conditions réelles, seuil ${b.exams[level]?.sim.passPct ?? 80} %</span></a>
    </div>

    <h2>Ma préparation</h2>
    <section class="card">
      <div class="chips" style="margin-bottom:12px" aria-label="Grade visé">${LEVELS.map((l) => `<button class="chip sm" aria-pressed="${l === level}" data-level="${l}">${l}</button>`).join('')}</div>
      <div class="readiness">
        ${ring(r.value, { size: 150, caption: 'préparation' })}
        <div>
          <h3 style="margin:0 0 4px">${esc(level)} · <span class="badge ${r.label.tone}">${esc(r.label.text)}</span></h3>
          <p class="small muted" style="margin-top:0">${esc(LEVEL_NAMES[level])}</p>
          <div class="bars">
            ${bar(`Connaissances (${Math.round(WEIGHTS.knowledge * 100)} %)`, r.knowledge.value)}
            ${bar(`Examens blancs (${Math.round(WEIGHTS.exams * 100)} %)`, r.exams.count ? r.exams.value : 0)}
            ${bar(`Pratique (${Math.round(WEIGHTS.practice * 100)} %)`, r.practice.value)}
          </div>
        </div>
      </div>
      <p class="small advice">💡 ${nextAdvice(r, weakest, sum.errors)}</p>
      <p class="small muted">${sum.seen}/${sum.total} questions vues · ${sum.mastered} acquises · ${r.exams.count ? `${r.exams.count} examen(s) blanc(s)` : 'aucun examen blanc'} · ${r.practice.done}/${r.practice.total} cas pratiques</p>
      <a class="small" href="#/progression">Statistiques, badges et calcul de la jauge →</a>
    </section>

    <h2>Badges <span class="badge">${earned.length}/${BADGES.length}</span></h2>
    <a class="card badge-strip" href="#/progression?voir=badges">
      ${earned.length ? earned.slice(0, 6).map((x) => `<span class="bdg" title="${esc(x.name)}">${x.icon}</span>`).join('') : '<span class="small muted">Répondez à votre première question pour débloquer « Premier volant » 🏸</span>'}
      ${earned.length ? '<span class="small muted" style="margin-left:auto">Voir tout →</span>' : ''}
    </a>

    <h2>Pour aller plus loin</h2>
    <div class="grid two">
      <a class="card tile" href="#/cas"><span class="ico emoji" aria-hidden="true">🧑‍⚖️</span><span><strong>Cas pratiques</strong><span class="small muted">Décisions de JA en situation réelle</span></span></a>
      <a class="card tile" href="#/fiches"><span class="ico emoji" aria-hidden="true">📝</span><span><strong>Fiches de synthèse</strong><span class="small muted">Nouveautés 2026-2027 : score en 3×15</span></span></a>
      ${sum.errors ? `<button class="card tile" data-act="retry" style="text-align:left;cursor:pointer"><span class="ico emoji" aria-hidden="true">🔁</span><span><strong>Revoir mes erreurs</strong><span class="small muted">${sum.errors} question(s) à retravailler</span></span></button>` : ''}
      ${isStandalone() ? '' : `<a class="card tile" href="#/hors-ligne"><span class="ico">${ic('wifi')}</span><span><strong>Installer l’application</strong><span class="small muted">Sur votre téléphone, utilisable hors ligne</span></span></a>`}
      ${lastUpdate ? `<a class="card tile" href="#/mises-a-jour"><span class="ico">${ic('news')}</span><span><strong>Règlements mis à jour le ${fmtDate(lastUpdate.date)}</strong><span class="small muted">${lastUpdate.changes.length} document(s) — saison ${esc(lastUpdate.season)}</span></span></a>` : ''}
    </div>`;

  main.onclick = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn.dataset.level) {
      state.settings.level = btn.dataset.level; save();
      updateLevelPill();
      renderHome();
    } else if (btn.dataset.act === 'smart') {
      startPlay({ mode: 'smart', level, count, themes: state.settings.train?.themes || [] });
    } else if (btn.dataset.act === 'daily') {
      startPlay({ mode: 'daily', level, replay: !!daily });
    } else if (btn.dataset.act === 'retry') {
      startPlay({ mode: 'retry', level, count: 20 });
    } else if (btn.dataset.mode) {
      startPlay({ mode: btn.dataset.mode, level, themes: state.settings.train?.themes || [] });
    }
  };
  if (r.value >= 0.85 && r.exams.passed) refreshBadges();
}

function goalRing(done, goal) {
  const v = Math.min(1, done / goal);
  const r = 20;
  const c = 2 * Math.PI * r;
  return `<svg class="goal-ring" viewBox="0 0 50 50" width="56" height="56" role="img" aria-label="Objectif du jour : ${done} sur ${goal}">
    <circle cx="25" cy="25" r="${r}" fill="none" stroke-width="6" class="track"/>
    <circle cx="25" cy="25" r="${r}" fill="none" stroke-width="6" class="val ${v >= 1 ? 'full' : ''}" ${v === 0 ? 'stroke-opacity="0"' : ''} stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${(c * (1 - v)).toFixed(1)}" transform="rotate(-90 25 25)"/>
    <text x="25" y="29" text-anchor="middle">${v >= 1 ? '✓' : Math.round(v * 100) + '%'}</text></svg>`;
}

function renderOnboarding() {
  const st = { level: state.settings.level || 'JALA', goal: state.settings.dailyGoal || 20 };
  const draw = () => {
    main.innerHTML = `
      <section class="onboard">
        <div class="onboard-hero"><span aria-hidden="true">🏸</span></div>
        <h1>Bienvenue sur Prépa JA !</h1>
        <p>Préparez les examens de <strong>juge-arbitre de badminton</strong> (FFBaD) en jouant : questions corrigées, défis, matchs en 3×15, examens blancs et cas pratiques.</p>
        <h2>1. Quel grade préparez-vous ?</h2>
        <div class="grid two">${LEVELS.map((l) => `<button class="pick ${st.level === l ? 'on' : ''}" data-onboard="${l}" aria-pressed="${st.level === l}"><strong>${l}</strong><span class="small muted">${esc(LEVEL_NAMES[l])}</span></button>`).join('')}</div>
        <h2>2. Votre objectif quotidien</h2>
        <div class="grid three">${GOALS.map(([n, name, time]) => `<button class="pick ${st.goal === n ? 'on' : ''}" data-goal="${n}" aria-pressed="${st.goal === n}"><strong>${name}</strong><span class="small muted">${n} questions/jour · ${time}</span></button>`).join('')}</div>
        <button class="btn block big" id="go" style="margin-top:18px">C’est parti !</button>
        <p class="small muted center">Sans compte : votre progression reste sur cet appareil. Tout se modifie ensuite dans les réglages.</p>
      </section>`;
  };
  draw();
  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.onboard) { st.level = b.dataset.onboard; draw(); }
    if (b.dataset.goal) { st.goal = Number(b.dataset.goal); draw(); }
    if (b.id === 'go') {
      state.settings.level = st.level;
      state.settings.dailyGoal = st.goal;
      state.settings.onboarded = true;
      save(true);
      updateLevelPill();
      renderHome();
    }
  };
}

function nextAdvice(r, weakest, errors) {
  if (r.knowledge.seen === 0) return 'Lancez une première série : elle vous fera découvrir les questions et calibrera la jauge.';
  if (r.knowledge.coverage < 0.5) return `Continuez à découvrir la banque (${pct(r.knowledge.coverage)} vues).${weakest.length ? ` Points faibles : ${weakest.join(', ')}.` : ''}`;
  if (errors > 15) return `Retravaillez vos ${errors} questions ratées avant de tenter un examen blanc.`;
  if (!r.exams.count) return 'Vous êtes prêt à tenter un premier examen blanc dans les conditions de l’examen.';
  if (!r.exams.passed) return `Visez le seuil de réussite en examen blanc.${weakest.length ? ` Thèmes à consolider : ${weakest.join(', ')}.` : ''}`;
  if (r.practice.done < 3) return 'Complétez avec les cas pratiques et l’auto-évaluation : l’examen pratique compte autant que la théorie.';
  return 'Maintenez le niveau : un défi par jour, un examen blanc par semaine et une relecture des nouveautés.';
}

// ------------------------------------------------------------------ progression

function activityChart(days, goal) {
  const today = dayKey();
  const keys = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  const vals = keys.map((k) => days[k] || { a: 0, g: 0, xp: 0 });
  const max = Math.max(goal, ...vals.map((v) => v.a), 1);
  const top = Math.ceil(max / 10) * 10;
  const H = 120;
  const fmt = (k) => new Date(`${k}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const total = vals.reduce((s, v) => s + v.a, 0);
  return `<figure class="activity" aria-label="Questions répondues par jour sur 14 jours">
    <figcaption class="small muted">Questions répondues par jour (14 derniers jours) · ${total} au total</figcaption>
    <div class="act-plot" style="height:${H}px">
      <span class="act-axis small muted" style="bottom:${H - 8}px">${top}</span>
      <span class="act-goal" style="bottom:${(goal / top) * H}px"><span class="small">objectif ${goal}</span></span>
      ${vals.map((v, i) => `<div class="act-col" tabindex="0" data-tip="${esc(`${fmt(keys[i])} : ${v.a} réponse${v.a > 1 ? 's' : ''}${v.a ? `, ${v.g} juste${v.g > 1 ? 's' : ''}` : ''}`)}">
        <i style="height:${v.a ? Math.max(3, (v.a / top) * H) : 0}px"></i></div>`).join('')}
    </div>
    <div class="act-days small muted"><span>${fmt(keys[0])}</span><span>aujourd’hui</span></div>
    <table class="sr-only"><caption>Questions répondues par jour</caption><tr><th>Jour</th><th>Réponses</th><th>Justes</th></tr>
      ${vals.map((v, i) => `<tr><td>${fmt(keys[i])}</td><td>${v.a}</td><td>${v.g}</td></tr>`).join('')}</table>
  </figure>`;
}

async function renderProgress() {
  const b = await bundle();
  const level = state.settings.level;
  const r = readiness(level, b);
  const g = state.game;
  const info = levelInfo(g.xp);
  const exams = state.exams.filter((e) => e.level === level);
  const totalAnswers = Object.values(state.q).reduce((s, x) => s + x.n, 0);
  const totalGood = Object.values(state.q).reduce((s, x) => s + x.c, 0);
  const streak = currentStreak(g);
  main.innerHTML = `
    <h1>Progression</h1>
    <section class="player-card compact">
      <div class="pc-top">
        <div class="avatar" aria-hidden="true">🏸</div>
        <div class="pc-id"><strong>Niv. ${info.level} · ${esc(info.title)}</strong>
          <div class="xpbar"><i style="width:${Math.round(info.progress * 100)}%"></i></div>
          <span class="small pc-xp">${g.xp} XP au total · ${info.into}/${info.need} XP vers le niveau ${info.level + 1}</span></div>
        <div class="streak ${streak ? '' : 'cold'}"><span aria-hidden="true">🔥</span><b>${streak}</b><span class="small">record ${g.streak.best}</span></div>
      </div>
    </section>
    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><b>${Math.round(r.value * 100)} %</b><span>préparation ${esc(level)}</span></div>
      <div class="kpi"><b>${totalAnswers}</b><span>réponses données</span></div>
      <div class="kpi"><b>${totalAnswers ? pct(totalGood / totalAnswers) : '—'}</b><span>taux de réussite</span></div>
      <div class="kpi"><b>🔥 ${g.counters.bestCombo}</b><span>meilleure série de bonnes réponses</span></div>
    </div>
    <h2>Activité</h2>
    <div class="card">${activityChart(g.days, state.settings.dailyGoal || 20)}</div>
    <h2 id="badges">Badges <span class="badge">${BADGES.filter((x) => g.badges[x.id]).length}/${BADGES.length}</span></h2>
    <div class="badge-grid">${BADGES.map((x) => {
      const at = g.badges[x.id];
      return `<div class="bdg-card ${at ? 'got' : ''}"><span class="bdg-icon" aria-hidden="true">${at ? x.icon : '🔒'}</span><strong>${esc(x.name)}</strong><span class="small muted">${esc(x.desc)}</span>${at ? `<span class="small bdg-date">${new Date(at).toLocaleDateString('fr-FR')}</span>` : ''}</div>`;
    }).join('')}</div>
    <h2>Par thème (${esc(level)})</h2>
    <div class="card bars">${Object.entries(r.knowledge.byTheme).sort((x, y) => x[1].value - y[1].value)
      .map(([t, v]) => bar(b.qdata.themes[t] || t, v.value, v.accuracy != null ? ` <span title="taux de réussite">(${Math.round(v.accuracy * 100)}%)</span>` : '')).join('')}</div>
    <h2>Comment la jauge est calculée</h2>
    <div class="card small">
      <p><strong>Connaissances (${Math.round(WEIGHTS.knowledge * 100)} %)</strong> — maîtrise moyenne des ${r.knowledge.total} questions du niveau, pondérée par l'importance de chaque thème à l'examen. Une question est « acquise » après plusieurs bonnes réponses espacées dans le temps ; une erreur la fait redescendre.</p>
      <p><strong>Examens blancs (${Math.round(WEIGHTS.exams * 100)} %)</strong> — moyenne des 3 derniers examens blancs rapportée au seuil de réussite (atteindre le seuil = 100 %).</p>
      <p><strong>Pratique (${Math.round(WEIGHTS.practice * 100)} %)</strong> — cas pratiques réussis (60 %) et auto-évaluation des critères d'examen (40 %).</p>
      <p>« Prêt pour l'examen » exige au moins 85 % et un examen blanc réussi récemment. L'XP et les badges motivent mais n'entrent pas dans la jauge. Calcul effectué uniquement sur cet appareil.</p>
    </div>
    <h2>Examens blancs ${esc(level)}</h2>
    ${exams.length ? `<div class="doclist">${exams.slice(0, 20).map((h) => `<a class="docitem" href="#/examen/resultat/${h.id}"><span class="code">${Math.round(h.score * 100)}%</span><span class="t">${h.passed ? '<span class="badge ok">Réussi</span>' : '<span class="badge ko">Échoué</span>'} ${h.good}/${h.total}<small>${new Date(h.date).toLocaleString('fr-FR')}</small></span></a>`).join('')}</div>` : '<p class="muted">Aucun examen blanc pour ce grade.</p>'}
    <h2>Pratique</h2>
    <p>${r.practice.done}/${r.practice.total} cas pratiques réalisés · ${r.practice.rated}/${r.practice.criteria} critères auto-évalués · exercice de poule : ${state.drills.poule.ok}/${state.drills.poule.n} réussis.</p>`;
  if (location.hash.includes('voir=badges')) document.getElementById('badges')?.scrollIntoView();
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
  const st = state.settings;
  const onOff = (key, val, label) => `<button class="chip" aria-pressed="${st[key] === val}" data-set="${key}" data-val="${val}">${label}</button>`;
  main.innerHTML = `
    <h1>Réglages</h1>
    <div class="card stack">
      <div><label class="field">Grade préparé</label><div class="chips">${LEVELS.map((l) => `<button class="chip" aria-pressed="${l === st.level}" data-level="${l}">${l}</button>`).join('')}</div></div>
      <div><label class="field">Objectif quotidien</label><div class="chips">${GOALS.map(([n, name]) => `<button class="chip" aria-pressed="${(st.dailyGoal || 20) === n}" data-goal="${n}">${name} · ${n} questions</button>`).join('')}</div></div>
      <div><label class="field">Apparence</label><div class="chips">${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, t]) => `<button class="chip" aria-pressed="${st.theme === k}" data-theme="${k}">${t}</button>`).join('')}</div></div>
      <div><label class="field">Sons</label><div class="chips">${onOff('sound', true, '🔊 Activés')}${onOff('sound', false, '🔇 Coupés')}</div></div>
      <div><label class="field">Vibrations (téléphone)</label><div class="chips">${onOff('haptics', true, 'Activées')}${onOff('haptics', false, 'Désactivées')}</div></div>
    </div>
    <div class="card stack" style="margin-top:12px">
      <h2>Ma progression</h2>
      <p class="small muted">Les données restent sur cet appareil (aucun compte, aucun serveur). Exportez-les pour les sauvegarder ou les transférer sur un autre appareil.</p>
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
    if (btn.dataset.goal) { setting('dailyGoal', Number(btn.dataset.goal)); renderSettings(); }
    if (btn.dataset.theme) { setting('theme', btn.dataset.theme); applyTheme(); renderSettings(); }
    if (btn.dataset.set) { setting(btn.dataset.set, btn.dataset.val === 'true'); renderSettings(); }
    if (btn.dataset.act === 'export') {
      const blob = new Blob([exportData()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `prepa-ja-progression-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
    if (btn.dataset.act === 'reset' && window.confirm('Effacer toute la progression (réponses, examens, cas pratiques, XP et badges) ?')) {
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
    main.innerHTML = `<h1>Oups…</h1><p>Impossible d'afficher cette page${navigator.onLine ? '' : ' hors ligne'}.</p><p class="small muted">${esc(err.message)}</p><a class="btn" href="#/">Accueil</a>`;
  }
};

route('/', wrap(renderHome), { tab: TABS.home });
route('/progression', wrap(renderProgress), { tab: TABS.home, back: true });
route('/entrainement', wrap(() => renderPlayHub(main)), { tab: TABS.train });
route('/entrainement/session', wrap(() => renderPlaySession(main)), { tab: TABS.train });
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
