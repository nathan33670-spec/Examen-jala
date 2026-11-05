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
  const q = qdata.questions.find((x) => x.id === s.cur.id) || s.extra?.[s.cur.id];
  const targets = good ? q.answer : [q.choices.findIndex((_, i) => !q.answer.includes(i))];
  for (const ci of targets) await page.locator(`.qcard .choice[data-choice="${ci}"]`).click();
  if (q.type === 'multiple') await page.locator('[data-act="validate"]').click();
  await page.locator('.feedback').waitFor();
}

await step('premier lancement : préférences enregistrées sur l’appareil', async () => {
  await page.goto(base);
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload();
  await page.getByText('Votre niveau de connaissance').waitFor();
  await page.locator('[data-level="ALA"]').click();
  await page.locator('[data-level="JALA"]').click();
  await page.locator('[data-knowledge="decouverte"]').click();
  await page.locator('[data-prio="apres"]').click();
  await page.locator('[data-prio="rgc"]').click();
  await page.locator('#ligue').selectOption('NAQ');
  await page.locator('#go').click();
  await page.locator('button.btn.big').waitFor();
  if ((await page.textContent('#levelPill')).trim() !== 'Juge-arbitre') throw new Error('parcours non mémorisé');
  const st = (await store()).settings;
  if (st.knowledge !== 'decouverte' || st.ligue !== 'NAQ') throw new Error('préférences non mémorisées');
  if (st.priorities.JALA.join() !== 'apres,rgc') throw new Error(`priorités non mémorisées : ${st.priorities.JALA}`);
});

await step('série sur les priorités : correction, bilan', async () => {
  await page.locator('button.btn.big').click();
  await page.locator('.qcard').waitFor();
  const s = await play();
  const qdata = await page.evaluate(() => fetch('data/questions.json').then((r) => r.json()));
  const off = s.ids.map((id) => qdata.questions.find((q) => q.id === id)).filter((q) => q.phase !== 'apres' && !q.rgc);
  if (off.length) throw new Error(`questions hors priorités : ${off.map((q) => q.id).join(', ')}`);
  const hard = s.ids.map((id) => qdata.questions.find((q) => q.id === id)).filter((q) => q.difficulty > 2);
  if (hard.length) throw new Error('niveau « Je découvre » : questions difficiles proposées');
  await answer(true);
  await page.locator('.feedback .ref').waitFor();
  await page.waitForTimeout(400);
  if (Object.keys((await store()).q).length !== 1) throw new Error('réponse non enregistrée');
  await page.locator('[data-act="next"]').click();
  for (let i = 1; i < 10; i += 1) {
    await answer(i % 3 !== 0);
    await page.locator('[data-act="next"]').click();
  }
  await page.getByText('Bilan de la série').waitFor();
  await page.getByText('À retenir').waitFor();
});

await step('pas de répétition entre deux séries', async () => {
  await page.locator('[data-act="again"]').click();
  for (let i = 0; i < 10; i += 1) {
    await answer(true);
    await page.locator('[data-act="next"]').click();
  }
  await page.getByText('Bilan de la série').waitFor();
  await page.waitForTimeout(400);
  const seen = Object.keys((await store()).q).length;
  if (seen !== 20) throw new Error(`questions répétées : ${seen} questions distinctes sur 20 réponses`);
});

await step('mes erreurs', async () => {
  await go('#/');
  await page.locator('[data-act="retry"]').click();
  await answer(true);
  await page.locator('[data-act="quit"]').click();
  await page.getByText('Bilan de la série').waitFor();
});

await step('domaine en un appui : ligue de l’utilisateur', async () => {
  await go('#/');
  await page.locator('.rows [data-focus="ligue"]').click();
  await page.locator('.qcard').waitFor();
  const s = await play();
  const qdata = await page.evaluate(() => fetch('data/questions.json').then((r) => r.json()));
  const bad = s.ids.map((id) => qdata.questions.find((q) => q.id === id)).filter((q) => q.ligue !== 'NAQ');
  if (bad.length) throw new Error(`questions hors ligue Nouvelle-Aquitaine : ${bad.map((q) => q.id).join(', ')}`);
  await page.locator('[data-act="quit"]').click();
});

await step('entraînement : aucune réponse avant de répondre, correction complète après', async () => {
  await go('#/');
  await page.locator('.rows [data-focus="rgc"]').click();
  let excerpts = 0;
  for (let i = 0; i < 6; i += 1) {
    await page.locator('.qcard .choice').first().waitFor();
    const early = await page.locator('.choice.correct, .choice.wrong, .feedback, .article-excerpt').count();
    if (early) throw new Error('la correction apparaît avant la réponse');
    await answer(false);
    await page.locator('.feedback.ko').waitFor();
    if (!(await page.locator('.feedback').getByText(/Réponses? attendues? :/).count())) throw new Error('réponse attendue non indiquée');
    if (!(await page.locator('.qcard .choice.correct').count())) throw new Error('bonne réponse non surlignée');
    if (!(await page.locator('.feedback .ref').count())) throw new Error('référence absente');
    excerpts += await page.locator('.feedback .article-excerpt').count();
    await page.locator('[data-act="next"]').click();
  }
  if (!excerpts) throw new Error('aucun extrait d’article dans la correction');
  await page.locator('[data-act="quit"]').click();
});

await step('mise à jour des questions malgré le cache', async () => {
  // contexte sans service worker : Playwright n'intercepte pas les requêtes émises par le service worker
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const p2 = await ctx.newPage();
  p2.on('pageerror', (e) => errors.push(`pageerror (maj): ${e.message}`));
  await p2.addInitScript(() => localStorage.setItem('prepa-ja-v1', JSON.stringify({ settings: { onboarded: true, level: 'JALA' } })));
  await p2.goto(base);
  await p2.locator('button.btn.big').waitFor();
  const current = await p2.evaluate(() => fetch('data/questions.json').then((r) => r.json()));
  const fresh = { ...current, version: 'test-maj', count: current.count + 1,
    questions: [...current.questions, { ...current.questions[0], id: 'maj-001', q: 'Question ajoutée par la mise à jour' }] };
  await p2.route(/data\/questions\.json\?fresh=/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(fresh) }));
  await p2.route(/data\/version\.json\?fresh=/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ version: fresh.version, count: fresh.count }) }));
  await p2.evaluate(async () => (await import('./js/data.js')).checkQuestionUpdate({ force: true }));
  await p2.getByText(`Questions mises à jour (${fresh.count} questions)`).waitFor();
  await p2.unroute(/data\/questions\.json\?fresh=/);
  await p2.unroute(/data\/version\.json\?fresh=/);
  await p2.route(/\?fresh=/, (r) => r.abort());
  await p2.reload();
  await p2.locator('button.btn.big').waitFor();
  const kept = await p2.evaluate(async () => (await (await import('./js/data.js')).getQuestions()).version);
  if (kept !== 'test-maj') throw new Error(`version mise à jour non conservée après rechargement (${kept})`);
  await ctx.close();
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

await step('parcours arbitre : questions et examen dédiés', async () => {
  await go('#/');
  await page.locator('[data-track="ALA"]').click();
  await page.waitForTimeout(300);
  if ((await page.textContent('#levelPill')).trim() !== 'Arbitre') throw new Error('parcours arbitre non activé');
  if (await page.locator('[data-focus="rgc"]').count()) throw new Error('domaines JA affichés pour l’arbitre');
  await page.locator('.rows [data-focus="regles"]').click();
  await page.locator('.qcard').waitFor();
  const s = await play();
  const qdata = await page.evaluate(() => fetch('data/questions.json').then((r) => r.json()));
  const bad = s.ids.map((id) => qdata.questions.find((q) => q.id === id)).filter((q) => !q.levels.includes('ALA') || q.theme !== 'regles');
  if (bad.length) throw new Error(`questions hors parcours arbitre : ${bad.map((q) => q.id).join(', ')}`);
  await page.locator('[data-act="quit"]').click();
  await go('#/examen');
  await page.getByText('Arbitre de ligue accrédité (ALA)').first().waitFor();
  await go('#/');
  await page.locator('[data-track="JALA"]').click();
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
  await page.getByText('Calcul de la jauge').waitFor();
  await go('#/ressources');
  await page.getByText('Cas pratiques').waitFor();
  await go('#/conditions');
  await go('#/reglages');
  await page.locator('[data-knowledge="revision"]').click();
  await page.locator('#savePrefs').click();
  if ((await store()).settings.knowledge !== 'revision') throw new Error('réglages non enregistrés');
  await go('#/hors-ligne');
  await page.getByText('Mode hors-ligne').waitFor();
});

await step('sécurité : import d’un fichier forgé', async () => {
  const evil = '"><meta http-equiv="refresh" content="0;url=https://example.com"><img src=x>';
  const file = JSON.stringify({ data: {
    __proto__: { hacked: true },
    settings: { onboarded: true, level: 'JALA', priorities: { JALA: 'pas une liste' }, examOverrides: { JALA: { questions: evil } }, scheduler: { courts: evil } },
    q: null, pdfShas: null,
    exams: [{ id: evil, level: 'JALA', score: 0.5, good: evil, total: 2, answers: [], byTheme: { regles: { good: evil, total: 1 } } }, { id: 'ok1', level: 'JALA', score: 1, good: 2, total: 2, passed: true, answers: [] }],
    game: { days: { [new Date().toISOString().slice(0, 10)]: { a: evil } }, counters: { answers: evil } },
  } });
  await go('#/reglages');
  await page.locator('#importFile').setInputFiles({ name: 'forge.json', mimeType: 'application/json', buffer: Buffer.from(file) });
  await page.getByText('Données importées').waitFor();
  for (const h of ['#/', '#/progression', '#/examen', '#/entrainement', '#/outil/echeancier']) {
    await go(h);
    if (!page.url().startsWith(base)) throw new Error(`redirection après import (${h})`);
    if (await page.locator('main meta, main img[src="x"]').count()) throw new Error(`contenu injecté dans ${h}`);
  }
  const st = await store();
  if (st.exams.length !== 1 || st.exams[0].id !== 'ok1') throw new Error('examen forgé conservé');
  if (({}).hacked) throw new Error('pollution de prototype');
  await page.evaluate(() => localStorage.clear());
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
  await go('#/');
  await page.locator('button.btn.big').click();
  await page.locator('.qcard .choice').first().waitFor();
  await context.setOffline(false);
});

await browser.close();
if (errors.length) {
  console.error(`\n${errors.length} erreur(s) :\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('\nTous les tests de bout en bout sont passés.');
