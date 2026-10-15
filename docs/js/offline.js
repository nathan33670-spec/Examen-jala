// Mode hors-ligne : service worker, installation, téléchargement du pack et mises à jour.
import { esc, fmtSize, toast, icons } from './ui.js';
import { state, save } from './store.js';
import { getCatalog } from './data.js';

let deferredPrompt = null;
let waitingWorker = null;
export const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function initOffline() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.dispatchEvent(new CustomEvent('installable'));
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; toast('Application installée'); });
  const net = document.getElementById('netStatus');
  const updateNet = () => { net.hidden = navigator.onLine; };
  window.addEventListener('online', updateNet);
  window.addEventListener('offline', updateNet);
  updateNet();

  if (!('serviceWorker' in navigator)) return;
  // Première visite : le service worker s'installe en silence. Une mise à jour n'est proposée
  // que si une version précédente contrôlait déjà la page.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const track = (worker) => {
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && hadController) showUpdate(worker);
      });
    };
    if (reg.waiting && hadController) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => track(reg.installing));
    // vérification périodique (application laissée ouverte)
    setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
  }).catch((err) => console.warn('Service worker non enregistré', err));
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (updateRequested) location.reload();
  });
}

let updateRequested = false;
function showUpdate(worker) {
  waitingWorker = worker;
  const banner = document.getElementById('updateBanner');
  banner.hidden = false;
  document.getElementById('updateBtn').onclick = () => {
    banner.hidden = true;
    updateRequested = true;
    waitingWorker?.postMessage('SKIP_WAITING');
  };
}

export async function checkForUpdate() {
  const reg = await navigator.serviceWorker?.getRegistration();
  if (!reg) return false;
  await reg.update();
  return !!reg.waiting || !!reg.installing;
}

async function precache() {
  const res = await fetch('data/precache.json', { cache: 'no-store' });
  return res.json();
}

async function cachedCount(urls, cacheName) {
  const cache = await caches.open(cacheName);
  let n = 0;
  for (const u of urls) {
    if (await cache.match(u, { ignoreSearch: true })) n += 1;
  }
  return n;
}

export async function offlineStatus() {
  const status = { sw: false, core: 0, coreTotal: 0, pdf: 0, pdfTotal: 0, pdfSize: 0, outdated: [], estimate: null, persisted: false };
  if ('serviceWorker' in navigator) status.sw = !!(await navigator.serviceWorker.getRegistration())?.active;
  try {
    const [man, cat] = await Promise.all([precache(), getCatalog()]);
    status.coreTotal = man.core.length;
    status.pdfTotal = man.pdf.length;
    status.pdfSize = man.pdfSize;
    status.coreSize = man.coreSize;
    if ('caches' in window) {
      status.core = await cachedCount(man.core, `core-${man.build}`);
      status.pdf = await cachedCount(man.pdf, 'pdf-v1');
    }
    for (const d of cat.docs) {
      const sha = state.pdfShas[d.pdf];
      if (sha && sha !== d.sha256) status.outdated.push(d);
    }
  } catch { /* hors ligne sans précache */ }
  if (navigator.storage?.estimate) status.estimate = await navigator.storage.estimate();
  if (navigator.storage?.persisted) status.persisted = await navigator.storage.persisted();
  return status;
}

export async function downloadPack(onProgress) {
  if (!('caches' in window)) throw new Error('Cache non disponible sur ce navigateur');
  if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false);
  const [man, cat] = await Promise.all([precache(), getCatalog()]);
  const shaByPdf = Object.fromEntries(cat.docs.map((d) => [d.pdf, d.sha256]));
  // les fichiers de l'application vont dans le cache de la version courante (même nom que le service worker)
  const core = await caches.open(`core-${man.build}`);
  const pdf = await caches.open('pdf-v1');
  const missingCore = [];
  for (const u of man.core) if (!(await core.match(u, { ignoreSearch: true }))) missingCore.push(u);
  const jobs = [
    ...missingCore.map((u) => ({ u, cache: core })),
    ...man.pdf.map((u) => ({ u, cache: pdf })),
  ];
  let done = 0;
  let failed = 0;
  const queue = jobs.slice();
  const worker = async () => {
    while (queue.length) {
      const job = queue.shift();
      try {
        const isPdf = job.cache === pdf;
        const already = isPdf && state.pdfShas[job.u] === shaByPdf[job.u] && await pdf.match(job.u);
        if (!already) {
          const res = await fetch(job.u, { cache: 'reload' });
          if (!res.ok) throw new Error(res.status);
          await job.cache.put(job.u, res);
          if (isPdf) state.pdfShas[job.u] = shaByPdf[job.u];
        }
      } catch {
        failed += 1;
      }
      done += 1;
      onProgress?.(done, jobs.length);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  // nettoyage des PDF qui ne sont plus au catalogue
  for (const req of await pdf.keys()) {
    const path = new URL(req.url).pathname.split('/reglements/pdf/')[1];
    if (path && !man.pdf.includes(`reglements/pdf/${path}`)) await pdf.delete(req);
  }
  state.offlinePackAt = new Date().toISOString();
  save(true);
  return { total: jobs.length, failed };
}

export async function clearCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((k) => !k.startsWith('core-')).map((k) => caches.delete(k)));
  state.pdfShas = {};
  state.offlinePackAt = null;
  save(true);
}

export async function renderOffline(main) {
  main.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  const st = await offlineStatus();
  const ready = st.sw && st.core >= st.coreTotal && st.coreTotal > 0;
  const pdfOk = st.pdfTotal > 0 && st.pdf >= st.pdfTotal && !st.outdated.length;
  const ios = isIOS();
  main.innerHTML = `
    <h1>Mode hors-ligne</h1>
    <div class="card">
      <h2>1. Installer l'application</h2>
      ${isStandalone() ? '<p class="notice ok">L\'application est installée sur cet appareil.</p>' : ios
        ? `<p>Sur iPhone / iPad (Safari) : touchez <strong>Partager</strong> <span aria-hidden="true">⎋</span> puis <strong>« Sur l'écran d'accueil »</strong>.</p>`
        : `<p>Ajoutez l'application à l'écran d'accueil pour l'ouvrir comme une application, même sans réseau.</p>
           <button class="btn" id="install" ${deferredPrompt ? '' : 'disabled'}>Installer l'application</button>
           ${deferredPrompt ? '' : '<p class="small muted">Si le bouton reste grisé : menu du navigateur ⋮ → « Installer l\'application » ou « Ajouter à l\'écran d\'accueil ».</p>'}`}
    </div>
    <div class="card" style="margin-top:12px">
      <h2>2. Télécharger le contenu</h2>
      <p>${ready ? '<span class="badge ok">Prêt</span>' : '<span class="badge warn">Incomplet</span>'} Application, ${esc(String(st.coreTotal))} fichiers (questions, cas pratiques, texte des règlements) : ${st.core}/${st.coreTotal} en cache (${fmtSize(st.coreSize)}).</p>
      <p>${pdfOk ? '<span class="badge ok">Prêt</span>' : st.pdf ? '<span class="badge warn">Partiel</span>' : '<span class="badge">Non téléchargé</span>'} PDF officiels du Guide du Badminton : ${st.pdf}/${st.pdfTotal} (${fmtSize(st.pdfSize)}).</p>
      ${st.outdated.length ? `<p class="notice warn small">${st.outdated.length} PDF ont été mis à jour par la FFBaD depuis votre téléchargement : relancez le téléchargement.</p>` : ''}
      <div class="progress hide" id="prog" style="margin:10px 0"><i style="width:0"></i></div>
      <p class="small muted" id="progTxt"></p>
      <div class="btn-row">
        <button class="btn accent" id="dl">${icons.download.replace('<svg', '<svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"')} ${pdfOk ? 'Mettre à jour le pack' : `Télécharger le pack complet (${fmtSize((st.coreSize || 0) + (st.pdfSize || 0))})`}</button>
        <button class="btn secondary" id="upd">Vérifier les mises à jour</button>
      </div>
      <p class="small muted">Le texte des règlements, les questions et les cas pratiques sont mis en cache automatiquement dès la première visite. Le pack complet ajoute les PDF officiels.</p>
    </div>
    <div class="card" style="margin-top:12px">
      <h2>Stockage</h2>
      <p class="small">${st.estimate ? `Utilisé : ${fmtSize(st.estimate.usage)} sur ${fmtSize(st.estimate.quota)} disponibles.` : 'Informations de stockage indisponibles.'}
      ${st.persisted ? 'Stockage persistant accordé (le navigateur ne l\'effacera pas automatiquement).' : 'Stockage non persistant : le navigateur peut libérer l\'espace s\'il manque de place.'}</p>
      <p class="small muted">Votre progression (jauge, examens, réponses) reste uniquement sur cet appareil. Pensez à l'exporter depuis les <a href="#/reglages">réglages</a> avant de changer de téléphone.</p>
      <button class="btn small danger" id="clear">Supprimer les PDF téléchargés</button>
    </div>`;
  main.querySelector('#install')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => null);
    deferredPrompt = null;
    renderOffline(main);
  });
  main.querySelector('#dl').onclick = async (e) => {
    e.target.disabled = true;
    const prog = main.querySelector('#prog');
    const txt = main.querySelector('#progTxt');
    prog.classList.remove('hide');
    try {
      const r = await downloadPack((d, t) => {
        prog.firstElementChild.style.width = `${(d / t) * 100}%`;
        txt.textContent = `${d}/${t} fichiers`;
      });
      toast(r.failed ? `${r.failed} fichier(s) non téléchargé(s) : réessayez avec une meilleure connexion.` : 'Pack hors-ligne prêt !');
    } catch (err) {
      toast(`Échec : ${err.message}`);
    }
    renderOffline(main);
  };
  main.querySelector('#upd').onclick = async () => {
    const found = await checkForUpdate().catch(() => false);
    toast(found ? 'Nouvelle version en cours de téléchargement…' : 'Vous avez la dernière version.');
  };
  main.querySelector('#clear').onclick = async () => {
    if (!window.confirm('Supprimer les PDF téléchargés ? Le texte des règlements reste disponible hors ligne.')) return;
    await clearCaches();
    renderOffline(main);
  };
}
