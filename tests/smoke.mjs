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

await step('accueil et choix du grade', async () => {
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByText('Quel grade préparez-vous ?').waitFor();
  await page.locator('[data-onboard="JALC"]').click();
  await page.locator('.readiness').waitFor();
  if ((await page.textContent('#levelPill')).trim() !== 'JALC') throw new Error('grade non mémorisé');
});

await step('entraînement : répondre à une question', async () => {
  await go('#/entrainement');
  await page.locator('#start').click();
  await page.locator('.choice').first().waitFor();
  await page.locator('.choice').first().click();
  await page.locator('[data-act="validate"]').click();
  await page.locator('.explain').waitFor();
  await page.waitForTimeout(300);
  const stats = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('prepa-ja-v1')).q).length);
  if (stats !== 1) throw new Error(`réponse non enregistrée (${stats})`);
  await page.locator('[data-act="quit"]').click();
  await page.getByText('Bilan de la série').waitFor();
});

await step('mode oral', async () => {
  await go('#/entrainement');
  await page.locator('#oral').check();
  await page.locator('#start').click();
  await page.locator('[data-act="reveal"]').click();
  await page.locator('[data-act="oral-ok"]').click();
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
  const exams = await page.evaluate(() => JSON.parse(localStorage.getItem('prepa-ja-v1')).exams.length);
  if (exams !== 1) throw new Error('examen non enregistré');
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
  await page.locator('#start').waitFor();
  await context.setOffline(false);
});

await browser.close();
if (errors.length) {
  console.error(`\n${errors.length} erreur(s) :\n${errors.join('\n')}`);
  process.exit(1);
}
console.log('\nTous les tests de bout en bout sont passés.');
