// Partie pratique : cas concrets, exercices et outils du juge-arbitre.
import { esc, shuffle, richText, icons, pct } from './ui.js';
import { state, save, recordCase, LEVELS } from './store.js';
import { getCases, getPractice } from './data.js';
import { isCorrect } from './qcommon.js';
import { rewardActivity } from './reward.js';
import { confetti } from './fx.js';
import { practiceScore } from './gauge.js';

const svg = (name) => icons[name].replace('<svg', '<svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"');

export async function renderPracticeHome(main) {
  const [casesData, practice] = await Promise.all([getCases(), getPractice()]);
  const level = state.settings.level;
  const p = practiceScore(level, casesData, practice);
  main.innerHTML = `
    <h1>Pratique du juge-arbitre</h1>
    <p class="muted">L'examen pratique se déroule sur une vraie compétition : préparation en amont, gestion le jour J, rapport après la compétition. Entraînez-vous sur des situations concrètes et vérifiez vos réflexes.</p>
    <div class="grid two">
      <a class="card tile" href="#/cas"><span class="ico">${svg('case')}</span><span><strong>Cas pratiques</strong><span class="small muted">${p.done}/${p.total} cas ${esc(level)} réalisés · situations réelles de compétition</span></span></a>
      <a class="card tile" href="#/exercice/poule"><span class="ico">${svg('table')}</span><span><strong>Classement de poule</strong><span class="small muted">Départager les égalités (RGC 3.4.1) — exercices générés à l'infini</span></span></a>
      <a class="card tile" href="#/outil/echeancier"><span class="ico">${svg('calc')}</span><span><strong>Dimensionner une compétition</strong><span class="small muted">Formats de tableaux, nombre de matchs, horaires de fin</span></span></a>
      <a class="card tile" href="#/checklists"><span class="ico">${svg('check')}</span><span><strong>Check-lists du JA</strong><span class="small muted">Avant, pendant et après la compétition</span></span></a>
      <a class="card tile" href="#/auto-evaluation"><span class="ico">${svg('grid')}</span><span><strong>Auto-évaluation</strong><span class="small muted">Grille des critères par grade (annexe 02 de la filière) · ${p.rated}/${p.criteria} critères évalués</span></span></a>
      <a class="card tile" href="#/entrainement"><span class="ico">${svg('mic')}</span><span><strong>Préparer l'oral</strong><span class="small muted">Activez le « mode oral » dans l'entraînement (JALC, JAFA)</span></span></a>
    </div>`;
}

// ------------------------------------------------------------------ cas pratiques

export async function renderCases(main) {
  const data = await getCases();
  const level = state.settings.level;
  const filter = state.settings.caseFilter || level;
  const list = data.cases.filter((c) => filter === 'tous' || c.levels.includes(filter));
  main.innerHTML = `
    <h1>Cas pratiques</h1>
    <p class="muted">Chaque cas décrit une situation de compétition. Prenez les décisions étape par étape : la correction cite le règlement applicable.</p>
    <div class="chips" style="margin-bottom:12px">${[...LEVELS, 'tous'].map((l) => `<button class="chip" aria-pressed="${filter === l}" data-f="${l}">${l === 'tous' ? 'Tous' : l}</button>`).join('')}</div>
    <div class="doclist">${list.map((c) => {
      const r = state.cases[c.id];
      return `<a class="docitem" href="#/cas/${c.id}"><span class="code">${r ? Math.round(r.best * 100) + '%' : '—'}</span>
        <span class="t">${esc(c.title)}<small>${esc(c.theme)} · ${c.steps.length} étape(s) · ${c.levels.join(', ')}</small></span></a>`;
    }).join('') || '<p class="empty">Aucun cas pour ce filtre.</p>'}</div>`;
  main.onclick = (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    state.settings.caseFilter = b.dataset.f; save();
    renderCases(main);
  };
}

export async function renderCase(main, id) {
  const data = await getCases();
  const c = data.cases.find((x) => x.id === id);
  if (!c) { main.innerHTML = '<p class="empty">Cas introuvable.</p>'; return; }
  const run = { step: 0, answers: c.steps.map(() => ({ selected: [], done: false, ok: false })), order: c.steps.map((s) => shuffle(s.choices.map((_, i) => i))) };
  const draw = () => {
    const finished = run.step >= c.steps.length;
    const dots = `<div class="step-dots">${run.answers.map((a, i) => `<i class="${a.done ? (a.ok ? 'ok' : 'ko') : i === run.step ? 'done' : ''}"></i>`).join('')}</div>`;
    let body = '';
    if (!finished) {
      const s = c.steps[run.step];
      const a = run.answers[run.step];
      const multi = s.type === 'multiple';
      body = `<div class="card" style="margin-top:12px"><p class="question">${esc(s.q)}</p>
        ${multi ? '<p class="small muted">Plusieurs réponses possibles.</p>' : ''}
        <div class="choices">${run.order[run.step].map((ci, k) => {
          const sel = a.selected.includes(ci);
          const cls = a.done ? (s.answer.includes(ci) ? 'correct' : sel ? 'wrong' : '') : '';
          return `<button class="choice ${cls}" data-c="${ci}" aria-checked="${sel}" role="${multi ? 'checkbox' : 'radio'}" ${a.done ? 'disabled' : ''}><span class="key">${String.fromCharCode(65 + k)}</span><span>${esc(s.choices[ci])}</span></button>`;
        }).join('')}</div>
        ${a.done ? `<div class="card flat explain ${a.ok ? 'ok' : 'ko'}"><p><strong>${a.ok ? 'Bonne décision.' : 'Décision à revoir.'}</strong> ${esc(s.explain)}</p></div>` : ''}
        <div class="sticky-actions">${a.done ? `<button class="btn" data-act="next">${run.step + 1 < c.steps.length ? 'Étape suivante' : 'Voir le débrief'}</button>` : `<button class="btn" data-act="check" ${a.selected.length ? '' : 'disabled'}>Valider ma décision</button>`}</div></div>`;
    } else {
      const score = run.answers.filter((a) => a.ok).length / c.steps.length;
      body = `<div class="card center" style="margin-top:12px"><div class="score-big ${score >= 0.8 ? 'result-ok' : 'result-ko'}">${Math.round(score * 100)} %</div><p class="muted">${run.answers.filter((a) => a.ok).length}/${c.steps.length} bonnes décisions</p></div>
        <div class="card" style="margin-top:12px"><h2>Débrief</h2>${richText(c.debrief)}
        ${c.refs.length ? `<p class="small muted">Références : ${c.refs.map((r) => `<a href="#/doc/${encodeURIComponent(r.doc)}${r.art ? `?a=${encodeURIComponent(r.art)}` : ''}">${esc(r.doc === 'REGLES' ? 'Règles' : r.doc)} ${esc(r.art)}</a>`).join(' · ')}</p>` : ''}</div>
        <div class="btn-row" style="margin-top:12px"><button class="btn" data-act="restart">Recommencer</button><a class="btn secondary" href="#/cas">Autres cas</a></div>`;
    }
    main.innerHTML = `<p class="small muted"><a href="#/cas">Cas pratiques</a> · ${c.levels.join(', ')}</p>
      <h1>${esc(c.title)}</h1>${dots}
      <div class="card" style="margin-top:12px"><h3>Situation</h3><div class="case-context">${richText(c.context)}</div></div>${body}`;
  };
  draw();
  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const s = c.steps[run.step];
    const a = run.answers[run.step];
    if (b.dataset.c != null && a && !a.done) {
      const ci = Number(b.dataset.c);
      if (s.type === 'multiple') a.selected = a.selected.includes(ci) ? a.selected.filter((x) => x !== ci) : [...a.selected, ci];
      else a.selected = [ci];
      draw();
      return;
    }
    if (b.dataset.act === 'check') {
      a.done = true;
      a.ok = isCorrect(s, a.selected);
      draw();
    } else if (b.dataset.act === 'next') {
      run.step += 1;
      if (run.step >= c.steps.length) {
        const score = run.answers.filter((x) => x.ok).length / c.steps.length;
        const first = !state.cases[c.id];
        recordCase(c.id, score);
        if (score === 1) confetti(80);
        rewardActivity(Math.round(10 + 30 * score) + (first ? 10 : 0), { active: false });
      }
      draw();
      window.scrollTo(0, 0);
    } else if (b.dataset.act === 'restart') {
      renderCase(main, id);
    }
  };
}

// ------------------------------------------------------------------ exercice : classement de poule

const NAMES = ['Alice', 'Bastien', 'Chloé', 'David', 'Emma', 'Farid', 'Gaëlle', 'Hugo', 'Inès', 'Jules', 'Katia', 'Léo', 'Manon', 'Nolan', 'Océane', 'Paul', 'Quentin', 'Rose', 'Sacha', 'Théo', 'Ulysse', 'Victor', 'Yanis', 'Zoé'];
const CLUBS = ['BCA', 'USV', 'ASB', 'VBM', 'BCT', 'LBC'];
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function setScore() {
  // système 3×15 : 15 points, prolongation à 14-14, plafond à 21
  if (Math.random() < 0.18) {
    const loser = rnd(14, 20);
    return [Math.min(21, loser + 2), loser];
  }
  return [15, rnd(2, 13)];
}

function playMatch() {
  const third = Math.random() < 0.38;
  const sets = [];
  if (third) {
    const lostFirst = Math.random() < 0.5;
    const [w1, l1] = setScore();
    const [w2, l2] = setScore();
    const [w3, l3] = setScore();
    sets.push(lostFirst ? [l1, w1] : [w1, l1], lostFirst ? [w2, l2] : [l2, w2], [w3, l3]);
  } else {
    sets.push(setScore(), setScore());
  }
  return sets; // du point de vue du vainqueur (dernier set gagné par le vainqueur)
}

export function rankPoule(players, matches) {
  const st = Object.fromEntries(players.map((p) => [p, { p, pts: 0, sf: 0, sa: 0, pf: 0, pa: 0 }]));
  for (const m of matches) {
    const a = st[m.a];
    const b = st[m.b];
    for (const [x, y] of m.sets) {
      a.pf += x; a.pa += y; b.pf += y; b.pa += x;
      if (x > y) { a.sf += 1; b.sa += 1; } else { b.sf += 1; a.sa += 1; }
    }
    if (m.winner === m.a) a.pts += 1; else b.pts += 1;
  }
  const direct = (x, y) => {
    const m = matches.find((mm) => (mm.a === x && mm.b === y) || (mm.a === y && mm.b === x));
    return m.winner === x ? [x, y] : [y, x];
  };
  const reasons = {};
  let draw = false;
  const partition = (group, key) => {
    const map = new Map();
    for (const p of group) {
      const v = key(st[p]);
      if (!map.has(v)) map.set(v, []);
      map.get(v).push(p);
    }
    return [...map.entries()].sort((u, v) => v[0] - u[0]).map((e) => e[1]);
  };
  const resolve = (group, stage) => {
    if (group.length === 1) return group;
    if (group.length === 2) {
      const order = direct(group[0], group[1]);
      order.forEach((p) => { reasons[p] = 'match direct'; });
      return order;
    }
    if (stage === 'sets') {
      return partition(group, (s) => s.sf - s.sa).flatMap((sub) => {
        if (sub.length === 1) { reasons[sub[0]] = 'différence de sets (égalité à 3 ou plus)'; return sub; }
        return resolve(sub, sub.length === 2 ? 'direct' : 'points');
      });
    }
    if (stage === 'points') {
      return partition(group, (s) => s.pf - s.pa).flatMap((sub) => {
        if (sub.length === 1) { reasons[sub[0]] = 'différence de points (égalité persistante à 3 ou plus)'; return sub; }
        if (sub.length === 2) return resolve(sub, 'direct');
        draw = true;
        sub.forEach((p) => { reasons[p] = 'tirage au sort'; });
        return sub;
      });
    }
    return resolve(group, 'sets');
  };
  const order = partition(players, (s) => s.pts).flatMap((g) => {
    if (g.length === 1) { reasons[g[0]] = 'nombre de victoires'; return g; }
    return resolve(g, 'sets');
  });
  return { order, stats: st, reasons, draw };
}

function generatePoule() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const n = [3, 4, 4, 5][rnd(0, 3)];
    const names = shuffle(NAMES).slice(0, n).map((nm) => `${nm} (${CLUBS[rnd(0, CLUBS.length - 1)]})`);
    const matches = [];
    for (let i = 0; i < n; i += 1) {
      for (let j = i + 1; j < n; j += 1) {
        const sets = playMatch();
        const aWins = Math.random() < 0.5;
        matches.push({ a: names[i], b: names[j], winner: aWins ? names[i] : names[j], sets: aWins ? sets : sets.map(([x, y]) => [y, x]) });
      }
    }
    const res = rankPoule(names, matches);
    if (res.draw) continue;
    const wins = Object.values(res.stats).map((s) => s.pts);
    const hasTie = new Set(wins).size < wins.length;
    const threeWay = Object.values(res.reasons).some((r) => r.startsWith('différence'));
    if ((attempt < 120 && !threeWay) || (attempt < 160 && !hasTie)) continue;
    return { names, matches, res };
  }
  return null;
}

export function renderPouleDrill(main) {
  const g = generatePoule();
  const order = shuffle(g.names);
  const fmtSets = (m, who) => m.sets.map(([x, y]) => (who === m.a ? `${x}-${y}` : `${y}-${x}`)).join(' ');
  const draw = (checked = false) => {
    const right = g.res.order;
    const ok = checked && order.every((p, i) => p === right[i]);
    main.innerHTML = `
      <p class="small muted"><a href="#/pratique">Pratique</a></p>
      <h1>Classement de poule</h1>
      <p class="muted">Poule de ${g.names.length} joueurs, matchs en deux sets gagnants de 15 points. Classez les joueurs selon l'article 3.4.1 du RGC. Réussites : ${state.drills.poule.ok}/${state.drills.poule.n}.</p>
      <div class="card"><h3>Résultats</h3><div class="table-wrap"><table class="matrix"><thead><tr><th></th>${g.names.map((_, i) => `<th>${i + 1}</th>`).join('')}</tr></thead><tbody>
        ${g.names.map((p, i) => `<tr><th style="text-align:left">${i + 1}. ${esc(p)}</th>${g.names.map((q, j) => {
          if (i === j) return '<td class="self"></td>';
          const m = g.matches.find((mm) => (mm.a === p && mm.b === q) || (mm.a === q && mm.b === p));
          return `<td class="${m.winner === p ? '' : 'muted'}">${m.winner === p ? '<strong>V</strong>' : 'D'}<br><span class="small">${fmtSets(m, p)}</span></td>`;
        }).join('')}</tr>`).join('')}
      </tbody></table></div><p class="small muted">Lecture : ligne = joueur, score de son point de vue.</p></div>
      <div class="card" style="margin-top:12px"><h3>Votre classement</h3>
        <ol class="order-list">${order.map((p, i) => `<li><span class="pos">${i + 1}</span><span class="name">${esc(p)}</span>
          <button class="btn small secondary" data-up="${i}" ${i === 0 || checked ? 'disabled' : ''} aria-label="Monter">▲</button>
          <button class="btn small secondary" data-down="${i}" ${i === order.length - 1 || checked ? 'disabled' : ''} aria-label="Descendre">▼</button></li>`).join('')}</ol>
        <div class="btn-row" style="margin-top:12px">${checked ? '<button class="btn" data-act="new">Nouvelle poule</button>' : '<button class="btn" data-act="check">Vérifier</button>'}</div>
      </div>
      ${checked ? `<div class="card explain ${ok ? 'ok' : 'ko'}" style="margin-top:12px"><h3>${ok ? 'Exact !' : 'Classement correct'}</h3>
        <div class="table-wrap"><table class="data"><thead><tr><th>Rang</th><th>Joueur</th><th>Victoires</th><th>Sets ±</th><th>Points ±</th><th>Départagé par</th></tr></thead><tbody>
        ${right.map((p, i) => { const s = g.res.stats[p]; return `<tr><td>${i + 1}</td><td>${esc(p)}</td><td>${s.pts}</td><td>${s.sf - s.sa >= 0 ? '+' : ''}${s.sf - s.sa}</td><td>${s.pf - s.pa >= 0 ? '+' : ''}${s.pf - s.pa}</td><td>${esc(g.res.reasons[p])}</td></tr>`; }).join('')}
        </tbody></table></div>
        <p class="small">Méthode (RGC 3.4.1) : 1) nombre de victoires (forfait = −1) ; 2) égalité à deux : match direct ; 3) égalité à trois ou plus : différence de sets, puis s'il reste deux joueurs à égalité, match direct ; 4) si l'égalité persiste à trois ou plus : différence de points, puis match direct ; 5) en dernier ressort : tirage au sort par le juge-arbitre.</p>
        <p class="small"><a href="#/doc/03.01?a=3.4.1">Lire l'article 3.4.1 du RGC</a></p></div>` : ''}`;
  };
  draw();
  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.up != null) { const i = Number(b.dataset.up); [order[i - 1], order[i]] = [order[i], order[i - 1]]; draw(); }
    if (b.dataset.down != null) { const i = Number(b.dataset.down); [order[i + 1], order[i]] = [order[i], order[i + 1]]; draw(); }
    if (b.dataset.act === 'check') {
      const ok = order.every((p, i) => p === g.res.order[i]);
      state.drills.poule.n += 1;
      if (ok) state.drills.poule.ok += 1;
      save();
      draw(true);
      if (ok) confetti(60);
      rewardActivity(ok ? 15 : 3, { active: false });
    }
    if (b.dataset.act === 'new') renderPouleDrill(main);
  };
}

// ------------------------------------------------------------------ outil : dimensionner une compétition

const A12 = {
  3: [[3]], 4: [[4]], 5: [[5]],
  6: [[3, 3], [6]], 7: [[3, 4], [7]], 8: [[4, 4]], 9: [[3, 3, 3], [4, 5]], 10: [[3, 3, 4], [5, 5]],
  11: [[3, 4, 4], [5, 6]], 12: [[4, 4, 4], [3, 3, 3, 3], [6, 6]],
};

function splitPools(entries, size) {
  const p = Math.max(1, Math.round(entries / size));
  const base = Math.floor(entries / p);
  const extra = entries % p;
  return Array.from({ length: p }, (_, i) => base + (i < extra ? 1 : 0)).sort((a, b) => a - b);
}

export function analyseTableau(t) {
  const out = { name: t.name, entries: t.entries, warnings: [], matches: 0, maxPerPlayer: 0, desc: '' };
  const n = t.entries;
  if (n < 3) { out.warnings.push('Moins de 3 inscrits : le tableau ne peut pas être constitué (RGC 3.2.1.2) et doit être annulé, droits remboursés.'); return out; }
  if (t.format === 'ED') {
    if (n < 8) out.warnings.push('Élimination directe : 8 joueurs/paires minimum en principe (RGC 3.2.1.2).');
    out.matches = n - 1;
    out.maxPerPlayer = Math.ceil(Math.log2(n));
    const size = 2 ** Math.ceil(Math.log2(n));
    out.desc = `Élimination directe (tableau de ${size}${size > n ? `, ${size - n} exemption(s)` : ''})`;
    return out;
  }
  if (n >= 33) out.warnings.push('33 inscrits ou plus : l\'élimination directe est obligatoire (annexe 12 du RGC).');
  let pools = n <= 5 ? [n] : splitPools(n, t.poolSize);
  if (n <= 12 && A12[n] && !A12[n].some((cfg) => cfg.join() === pools.join())) {
    out.warnings.push(`Configuration ${pools.join(' + ')} non prévue par l'annexe 12 pour ${n} inscrits. Possibles : ${A12[n].map((c) => c.join(' + ')).join(' ou ')}.`);
  }
  if (pools.length > 10) out.warnings.push('Plus de 10 poules : non autorisé (annexe 12 du RGC).');
  if (Math.max(...pools) - Math.min(...pools) > 1) out.warnings.push('Écart de plus d\'un joueur entre les poules (RGC 3.2.2.5).');
  if (pools.length > 1 && n < 6) out.warnings.push('Phase de poules : 6 joueurs/paires minimum (RGC 3.2.1.2).');
  const poolMatches = pools.reduce((s, k) => s + (k * (k - 1)) / 2, 0);
  const single = pools.length === 1;
  const qualified = single ? 0 : pools.length * t.qualifiers;
  const finalMatches = qualified >= 2 ? qualified - 1 : 0;
  if (!single && qualified && (qualified & (qualified - 1)) !== 0) out.warnings.push(`${qualified} qualifiés : le tableau final n'est pas complet (2, 4, 8, 16…) — ajuster le nombre de poules ou de sortants si possible (RGC 3.2.2.4).`);
  if (!single && ![1, 2].includes(t.qualifiers)) out.warnings.push('1 ou 2 qualifiés par poule seulement (RGC 3.2.2.3).');
  out.matches = poolMatches + finalMatches;
  out.maxPerPlayer = Math.max(...pools) - 1 + (qualified >= 2 ? Math.ceil(Math.log2(qualified)) : 0);
  out.desc = single ? `Poule unique de ${n}` : `${pools.length} poules (${pools.join(', ')}) + tableau final de ${qualified}`;
  return out;
}

const toMin = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const toHHMM = (min) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}h${String(Math.round(min % 60)).padStart(2, '0')}`;

export function renderScheduler(main) {
  const cfg = state.settings.scheduler || {
    courts: 7, start: '09:00', duration: 30, margin: 10, limit: '19:00', perPlayer: 2,
    tableaux: [
      { name: 'SH R', entries: 20, format: 'poules', poolSize: 4, qualifiers: 2 },
      { name: 'DD D', entries: 9, format: 'poules', poolSize: 3, qualifiers: 2 },
      { name: 'DMx P', entries: 12, format: 'poules', poolSize: 4, qualifiers: 1 },
    ],
  };
  const draw = () => {
    const results = cfg.tableaux.map(analyseTableau);
    const total = results.reduce((s, r) => s + r.matches, 0);
    const rotations = Math.ceil(total / Math.max(1, cfg.courts));
    const minutes = rotations * cfg.duration * (1 + cfg.margin / 100);
    const end = toMin(cfg.start) + minutes;
    const limit = toMin(cfg.limit);
    const capacity = Math.floor(((limit - toMin(cfg.start)) * cfg.courts) / (cfg.duration * (1 + cfg.margin / 100)));
    const busiest = results.map((r) => r.maxPerPlayer).sort((a, b) => b - a).slice(0, cfg.perPlayer).reduce((s, x) => s + x, 0);
    main.innerHTML = `
      <p class="small muted"><a href="#/pratique">Pratique</a></p>
      <h1>Dimensionner une compétition</h1>
      <p class="muted">Estimation rapide pour vérifier qu'un tournoi tient dans la journée. Durées moyennes (annexe 07 du RGC, matchs en 2 sets gagnants de 15 points) : National 30-37 min, Régional 26-33 min, Départemental 26 min, Promotion 22 min.</p>
      <div class="card"><div class="grid three">
        <div><label class="field" for="courts">Terrains</label><input id="courts" type="number" min="1" max="40" value="${cfg.courts}"></div>
        <div><label class="field" for="start">Début</label><input id="start" type="time" value="${cfg.start}"></div>
        <div><label class="field" for="limit">Fin au plus tard</label><select id="limit">
          <option value="19:00" ${cfg.limit === '19:00' ? 'selected' : ''}>19h00 (ouverte hors ligue ou jeunes)</option>
          <option value="21:00" ${cfg.limit === '21:00' ? 'selected' : ''}>21h00 (limitée à une ligue)</option>
          <option value="23:00" ${cfg.limit === '23:00' ? 'selected' : ''}>23h00 (veille de jour férié, dernier match)</option></select></div>
        <div><label class="field" for="duration">Durée moyenne (min)</label><input id="duration" type="number" min="10" max="60" value="${cfg.duration}"></div>
        <div><label class="field" for="margin">Marge temps morts (%)</label><input id="margin" type="number" min="0" max="50" value="${cfg.margin}"></div>
        <div><label class="field" for="perPlayer">Tableaux par joueur</label><input id="perPlayer" type="number" min="1" max="3" value="${cfg.perPlayer}"></div>
      </div></div>
      <h2>Tableaux</h2>
      ${cfg.tableaux.map((t, i) => `<div class="card" style="margin-bottom:10px"><div class="grid three">
        <div><label class="field">Nom</label><input type="text" data-i="${i}" data-k="name" value="${esc(t.name)}"></div>
        <div><label class="field">Inscrits (joueurs ou paires)</label><input type="number" min="0" max="128" data-i="${i}" data-k="entries" value="${t.entries}"></div>
        <div><label class="field">Format</label><select data-i="${i}" data-k="format"><option value="poules" ${t.format === 'poules' ? 'selected' : ''}>Poules + tableau</option><option value="ED" ${t.format === 'ED' ? 'selected' : ''}>Élimination directe</option></select></div>
        ${t.format === 'poules' ? `<div><label class="field">Taille des poules</label><select data-i="${i}" data-k="poolSize">${[3, 4, 5, 6].map((s) => `<option ${t.poolSize === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
        <div><label class="field">Sortants par poule</label><select data-i="${i}" data-k="qualifiers">${[1, 2].map((s) => `<option ${t.qualifiers === s ? 'selected' : ''}>${s}</option>`).join('')}</select></div>` : ''}
        </div><p class="small"><strong>${esc(results[i].desc)}</strong> · ${results[i].matches} matchs · jusqu'à ${results[i].maxPerPlayer} matchs par joueur</p>
        ${results[i].warnings.map((w) => `<p class="notice warn small">${esc(w)}</p>`).join('')}
        <button class="btn small ghost" data-del="${i}">Supprimer</button></div>`).join('')}
      <button class="btn secondary" data-act="add">+ Ajouter un tableau</button>
      <h2>Bilan</h2>
      <div class="kpis"><div class="kpi"><b>${total}</b><span>matchs</span></div><div class="kpi"><b>${rotations}</b><span>rotations</span></div>
        <div class="kpi"><b>${toHHMM(end)}</b><span>fin estimée</span></div><div class="kpi"><b>${capacity}</b><span>matchs possibles avant ${toHHMM(limit)}</span></div></div>
      <div class="stack" style="margin-top:10px">
        ${end > limit ? `<p class="notice ko small">La compétition dépasse l'horaire limite (${toHHMM(limit)}) de ${Math.round(end - limit)} min : réduire le nombre d'inscrits, changer de format (poules de 3, un sortant…), ajouter des terrains ou étaler sur deux jours (RGC 2.16).</p>` : '<p class="notice ok small">La compétition tient dans l\'horaire limite.</p>'}
        ${busiest > 8 ? `<p class="notice ko small">Un joueur inscrit dans ${cfg.perPlayer} tableaux pourrait disputer jusqu'à ${busiest} matchs dans la journée : maximum 8 par jour (RGC 2.16).</p>` : `<p class="notice small">Au plus ${busiest} matchs par joueur et par jour estimés (maximum autorisé : 8).</p>`}
        <p class="small muted">Rappels : premier match pas avant 8h00, aucun match ne débute après 23h00 (RGC 2.16) ; temps de repos de 20 à 30 minutes entre deux matchs d'un même joueur ; échéancier et tableaux publiés au moins une heure avant le début.</p>
      </div>`;
  };
  draw();
  const persist = () => { state.settings.scheduler = cfg; save(); };
  main.oninput = (e) => {
    const el = e.target;
    if (el.dataset.i != null) {
      const t = cfg.tableaux[Number(el.dataset.i)];
      const k = el.dataset.k;
      t[k] = ['entries', 'poolSize', 'qualifiers'].includes(k) ? Number(el.value) : el.value;
      persist();
      return;
    }
    if (['courts', 'duration', 'margin', 'perPlayer'].includes(el.id)) cfg[el.id] = Math.max(1, Number(el.value) || 1);
    if (el.id === 'margin') cfg.margin = Math.max(0, Number(el.value) || 0);
    if (['start', 'limit'].includes(el.id)) cfg[el.id] = el.value;
    persist();
  };
  main.onchange = () => draw();
  main.onclick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.act === 'add') { cfg.tableaux.push({ name: `Tableau ${cfg.tableaux.length + 1}`, entries: 8, format: 'poules', poolSize: 4, qualifiers: 2 }); persist(); draw(); }
    if (b.dataset.del != null) { cfg.tableaux.splice(Number(b.dataset.del), 1); persist(); draw(); }
  };
}

// ------------------------------------------------------------------ check-lists et auto-évaluation

export async function renderChecklists(main) {
  const practice = await getPractice();
  main.innerHTML = `<p class="small muted"><a href="#/pratique">Pratique</a></p><h1>Check-lists du juge-arbitre</h1>
    <p class="muted">À utiliser pour préparer une compétition réelle ou votre journée d'examen. Les cases cochées sont mémorisées sur cet appareil.</p>
    ${practice.checklists.map((l) => {
      const done = state.checklists[l.id] || {};
      const n = l.items.filter((it) => done[it.id]).length;
      return `<details class="folder" ${n < l.items.length ? 'open' : ''}><summary>${esc(l.title)} <span class="badge ${n === l.items.length ? 'ok' : ''}">${n}/${l.items.length}</span></summary>
        <div style="padding:6px 14px"><ul class="checklist">${l.items.map((it) => `<li><input type="checkbox" id="${l.id}-${it.id}" data-l="${l.id}" data-it="${it.id}" ${done[it.id] ? 'checked' : ''}>
          <label for="${l.id}-${it.id}">${esc(it.text)}${it.ref ? `<span class="ref small">${esc(it.ref)}</span>` : ''}</label></li>`).join('')}</ul>
        <button class="btn small ghost" data-reset="${l.id}">Tout décocher</button></div></details>`;
    }).join('')}`;
  main.onchange = (e) => {
    const el = e.target;
    if (!el.dataset.l) return;
    (state.checklists[el.dataset.l] ||= {})[el.dataset.it] = el.checked;
    save();
  };
  main.onclick = (e) => {
    const b = e.target.closest('[data-reset]');
    if (!b) return;
    state.checklists[b.dataset.reset] = {};
    save();
    renderChecklists(main);
  };
}

const RATINGS = ['0', '+', '++', '+++'];
export async function renderSelfEval(main) {
  const practice = await getPractice();
  const level = state.settings.level;
  const crits = practice.criteria.flatMap((g) => g.items);
  const need = (c) => RATINGS.indexOf(c.need?.[level] ?? '+');
  const meets = crits.filter((c) => (state.selfEval[c.id] ?? -1) >= need(c)).length;
  main.innerHTML = `<p class="small muted"><a href="#/pratique">Pratique</a></p><h1>Auto-évaluation ${esc(level)}</h1>
    <p class="muted">Grille issue de l'annexe 02 de la filière juge-arbitrage (critères observés par l'évaluateur). Positionnez-vous honnêtement : le niveau requis pour ${esc(level)} est indiqué pour chaque critère.</p>
    <div class="notice small"><strong>0</strong> en acquisition · <strong>+</strong> maîtrise satisfaisante (guidage léger) · <strong>++</strong> maîtrise solide · <strong>+++</strong> maîtrise complète. Critères atteints : <strong>${meets}/${crits.length}</strong> (${pct(crits.length ? meets / crits.length : 0)}).</div>
    ${practice.criteria.map((g) => `<h2>${esc(g.group)}</h2><div class="criteria">${g.items.map((c) => {
      const mine = state.selfEval[c.id];
      const ok = (mine ?? -1) >= need(c);
      return `<div class="criterion"><div class="row between"><span>${esc(c.text)}</span>${mine != null ? `<span class="badge ${ok ? 'ok' : 'warn'}">${ok ? 'atteint' : 'à travailler'}</span>` : ''}</div>
        <div class="need">Requis ${esc(level)} : ${esc(c.need?.[level] ?? '+')} · ${LEVELS.map((l) => `${l} ${esc(c.need?.[l] ?? '')}`).join(' · ')}</div>
        <div class="seg" role="group" aria-label="Votre niveau">${RATINGS.map((r, i) => `<button data-c="${c.id}" data-r="${i}" aria-pressed="${mine === i}">${r}</button>`).join('')}</div></div>`;
    }).join('')}</div>`).join('')}`;
  main.onclick = (e) => {
    const b = e.target.closest('[data-c]');
    if (!b) return;
    state.selfEval[b.dataset.c] = Number(b.dataset.r);
    save();
    const y = window.scrollY;
    renderSelfEval(main).then(() => window.scrollTo(0, y));
  };
}
