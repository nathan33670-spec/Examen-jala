// Test de bout en bout : parcourt les écrans principaux et échoue à la moindre erreur JavaScript.
// Usage : node tests/smoke.mjs [url]   (serveur statique sur docs/ requis, ex. python -m http.server -d docs 8765)
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:8765/';
const errors = [];
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
page.on('dialog', (d) => d.accept());

const step = async (name, fn) => {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (err) {
    errors.push(`${name}: ${err.message}`);
    console.log(`FAIL ${name}: ${err.message}`);
  }
};
const go = async (hash) => {
  await page.goto(base + hash);
  await page.waitForTimeout(400);
};

const store = () => page.evaluate(() => JSON.parse(localStorage.getItem('prepa-ja-v1')));
const play = () => page.evaluate(() => JSON.parse(sessionStorage.getItem('prepa-ja-play') || 'null'));

/** Répond à la question affichée : juste (good = true) ou fausse, d'après la banque de questions. */
async function answer(good = true) {
  await page.locator('.qcard .choice').first().waitFor();
  const s = await play();
  const qdata = await page.evaluate(() => fetch('data/questions.json').then((r) => r.json()));
  const q = qdata.questions.find((x) => x.id === s.cur.id);
  const targets = good ? q.answer : [q.choices.findIndex((_, i) => !q.answer.includes(i))];
  for (const ci of targets) await page.locator(`.qcard .choice[data-choice="${ci}"]`).click();
  if (q.type === 'multiple') await page.locator('[data-act="validate"]').click();
  await page.locator('.feedback').waitFor();
}

await step('premier lancement : grade et objectif quotidien', async () => {
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.getByText('Quel grade préparez-vous ?').waitFor();
  await page.locator('[data-onboard="JALC"]').click();
  await page.locator('[data-goal="10"]').click();
  await page.locator('#go').click();
  await page.locator('.player-card').waitFor();
  await page.locator('.readiness').waitFor();
  if ((await page.textContent('#levelPill')).trim() !== 'JALC') throw new Error('grade non mémorisé');
  if ((await store()).settings.dailyGoal !== 10) throw new Error('objectif non mémorisé');
});

await step('série intelligente : réponse, XP, badge, bilan', async () => {
  await page.locator('.cta-continue').click();
  await answer(true);
  await page.waitForTimeout(400);
  const st = await store();
  if (Object.keys(st.q).length !== 1) throw new Error('réponse non enregistrée');
  if (!(st.game.xp > 0)) throw new Error('XP non attribuée');
  if (!st.game.badges.first) throw new Error('badge « Premier volant » non attribué');
  await page.locator('[data-act="next"]').click();
  for (let i = 1; i < 10; i += 1) {
    await answer(i % 3 !== 0);
    await page.locator('[data-act="next"]').click();
  }
  await page.locator('.end-card').waitFor();
  await page.locator('.celebrate button').click({ timeout: 3000 }).catch(() => {});
  if ((await store()).game.streak.cur !== 1) throw new Error('journée non comptée dans la série');
});

await step('pas de répétition entre deux séries', async () => {
  await go('#/entrainement');
  await page.locator('[data-start="smart"]').click();
  for (let i = 0; i < 10; i += 1) {
    await answer(true);
    await page.locator('[data-act="next"]').click();
  }
  await page.locator('.end-card').waitFor();
  await page.locator('.celebrate button').click({ timeout: 3000 }).catch(() => {});
  const seen = Object.keys((await store()).q).length;
  if (seen !== 20) throw new Error(`questions répétées : ${seen} questions distinctes sur 20 réponses`);
});

await step('revoir mes erreurs', async () => {
  await page.locator('[data-act="retry"]').click({ timeout: 3000 }).catch(async () => {
    await go('#/entrainement');
    await page.locator('[data-start="retry"]').click();
  });
  await answer(true);
  await page.locator('[data-act="quit"]').click();
  await page.locator('.end-card').waitFor();
});

await step('mode oral', async () => {
  await go('#/entrainement');
  await page.locator('[data-start="oral"]').click();
  await page.locator('[data-act="reveal"]').click();
  await page.locator('[data-act="oral-ok"]').click();
  await page.locator('[data-act="reveal"]').waitFor();
  await page.waitForTimeout(400);
  if ((await store()).game.counters.oral !== 1) throw new Error('réponse orale non comptée');
});

await step('défi du jour', async () => {
  await go('#/entrainement');
  await page.locator('[data-start="daily"]').click();
  for (let i = 0; i < 10; i += 1) {
    await answer(true);
    await page.locator('[data-act="next"]').click();
  }
  await page.locator('.end-card').waitFor();
  await page.locator('.celebrate button').click({ timeout: 3000 }).catch(() => {});
  const st = await store();
  const d = Object.values(st.game.daily)[0];
  if (!d || d.good !== 10) throw new Error('défi du jour non enregistré');
  if (!st.game.badges.dailyPerfect) throw new Error('badge « Sans faute » manquant');
});

await step('match en 3×15 : score, intervalle, victoire', async () => {
  await go('#/entrainement');
  await page.locator('[data-start="match"]').click();
  await page.locator('.scoreboard').waitFor();
  await answer(false);
  await page.locator('[data-act="next"]').click();
  for (let i = 0; i < 15; i += 1) {
    await answer(true);
    if (i === 7 && !(await page.getByText('Intervalle').count())) throw new Error('intervalle à 8 points non signalé');
    await page.locator('[data-act="next"]').click();
  }
  await page.getByText('Set gagné !').waitFor();
  await page.locator('.celebrate button').click({ timeout: 3000 }).catch(() => {});
  const st = await store();
  if (st.game.records.matchWins !== 1) throw new Error('victoire non enregistrée');
});

await step('contre-la-montre : fin du temps et record', async () => {
  await go('#/entrainement');
  await page.locator('[data-start="chrono"]').click();
  await page.locator('#clock').waitFor();
  await answer(true);
  await page.waitForTimeout(900);
  await answer(true);
  await page.evaluate(() => {
    const s = JSON.parse(sessionStorage.getItem('prepa-ja-play'));
    s.deadline = Date.now() - 1000;
    sessionStorage.setItem('prepa-ja-play', JSON.stringify(s));
  });
  await page.reload();
  await page.getByText('Nouveau record !').waitFor();
  await page.locator('.celebrate button').click({ timeout: 3000 }).catch(() => {});
  const rec = Object.entries((await store()).game.records).find(([k]) => k.startsWith('chrono|'));
  if (!rec || rec[1] < 2) throw new Error('record non enregistré');
});

await step('mort subite : trois vies', async () => {
  await go('#/entrainement');
  await page.locator('[data-start="survival"]').click();
  await answer(true);
  for (let i = 0; i < 3; i += 1) {
    await page.locator('[data-act="next"]').click();
    await answer(false);
  }
  await page.locator('[data-act="next"]').click();
  await page.locator('.end-card').waitFor();
  await page.getByText('1 bonne réponse').waitFor();
});

await step('examen blanc : démarrer, répondre, terminer', async () => {
  await go('#/examen');
  await page.locator('#go').click();
  await page.locator('#timer').waitFor();
  for (let i = 0; i < 3; i += 1) {
    await page.locator('.choice').first().click();
    await page.locator('[data-act="next"]').click();
  }
  await page.evaluate(() => { location.hash = '#/examen/session'; });
  await page.locator('details summary').click();
  const total = await page.locator('.qnav button').count();
  await page.locator(`.qnav button >> nth=${total - 1}`).click();
  await page.locator('[data-act="submit"]').click();
  await page.getByText('Correction détaillée').waitFor();
  const st = await store();
  if (st.exams.length !== 1) throw new Error('examen non enregistré');
});

await step('cas pratique complet', async () => {
  await go('#/cas');
  await page.locator('.docitem').first().click();
  for (let i = 0; i < 6; i += 1) {
    if (await page.getByText('Débrief').count()) break;
    await page.locator('.choice').first().click();
    await page.locator('[data-act="check"]').click();
    await page.locator('[data-act="next"]').click();
  }
  await page.getByText('Débrief').waitFor();
});

await step('exercice de poule', async () => {
  await go('#/exercice/poule');
  await page.locator('[data-act="check"]').click();
  await page.locator('table.data').waitFor();
});

await step('outil échéancier', async () => {
  await go('#/outil/echeancier');
  await page.getByText('fin estimée').waitFor();
  await page.locator('[data-act="add"]').click();
});

await step('auto-évaluation et check-lists', async () => {
  await go('#/auto-evaluation');
  await page.locator('.seg button').nth(2).click();
  await go('#/checklists');
  await page.locator('.checklist input').first().check();
});

await step('règlements : liste, lecture et article ciblé', async () => {
  await go('#/docs');
  await page.locator('#filter').fill('cartons');
  await go('#/doc/03.01?a=2.16');
  await page.locator('.reader .target').waitFor();
  await go('#/doc/REGLES?a=Instr.%203.5.4');
  await page.locator('.reader .target').waitFor();
});

await step('fiches, glossaire, recherche', async () => {
  await go('#/fiches');
  await page.locator('a.card').first().click();
  await page.locator('article.fiche').waitFor();
  await go('#/glossaire');
  await page.locator('#g').fill('JIFF');
  await go('#/recherche?q=temps%20de%20repos');
  await page.getByText('Règlements (').waitFor({ timeout: 15000 });
});

await step('progression, conditions, réglages, hors-ligne', async () => {
  await go('#/progression');
  await page.getByText('Comment la jauge est calculée').waitFor();
  await page.locator('.bdg-card.got').first().waitFor();
  await page.locator('.act-col').first().waitFor();
  await go('#/conditions');
  await go('#/reglages');
  await go('#/hors-ligne');
  await page.getByText('Mode hors-ligne').waitFor();
});

await step('service worker actif et cache rempli', async () => {
  await page.goto(base);
  await page.waitForFunction(() => navigator.serviceWorker?.controller || navigator.serviceWorker?.ready, null, { timeout: 15000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const core = keys.find((k) => k.startsWith('core-'));
    return core ? (await (await caches.open(core)).keys()).length : 0;
  });
  if (cached < 50) throw new Error(`cache incomplet (${cached} fichiers)`);
});

await step('fonctionnement hors ligne', async () => {
  await page.reload();
  await page.waitForTimeout(500);
  await context.setOffline(true);
  await page.goto(base + '#/doc/07.04');
  await page.locator('.reader p').first().waitFor();
  await go('#/entrainement');
  await page.locator('[data-start="smart"]').click();
  await page.locator('.qcard .choice').first().waitFor();
  await context.setOffline(false);
});

await browser.close();
if (errors.length) {
  console.error(`\n${errors.length} erreur(s) :\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('\nTous les tests de bout en bout sont passés.');
