// Chargement (mis en mémoire) des données JSON de l'application.
const memo = new Map();

export function loadJSON(path) {
  if (!memo.has(path)) {
    memo.set(path, fetch(path).then((res) => {
      if (!res.ok) throw new Error(`${path} : HTTP ${res.status}`);
      return res.json();
    }).catch((err) => {
      memo.delete(path);
      throw err;
    }));
  }
  return memo.get(path);
}

// ------------------------------------------------------------------ mise à jour des questions
// Les questions locales (cache hors ligne ou fichiers embarqués dans l'appli Android) s'affichent
// tout de suite ; dès qu'une connexion est disponible, la dernière version publiée est récupérée en
// arrière-plan, conservée sur l'appareil (cache « live ») et utilisée à la place.

const QUESTIONS = 'data/questions.json';
const LIVE_CACHE = 'live-data-v1';
/** Site publié : source des mises à jour pour l'application Android (contenu embarqué sinon). */
export const REMOTE_BASE = 'https://nathan33670-spec.github.io/Examen-jala/';
const isNative = () => !!window.Capacitor?.isNativePlatform?.();
const listeners = new Set();
export const onDataUpdate = (fn) => listeners.add(fn);
let lastCheck = 0;

async function liveCache() {
  try { return 'caches' in window ? await caches.open(LIVE_CACHE) : null; } catch { return null; }
}

let localVersion = null; // version embarquée (cache hors ligne ou appli Android)
let localCount = 0;

async function loadQuestions() {
  const res = await fetch(QUESTIONS);
  if (!res.ok) throw new Error(`${QUESTIONS} : HTTP ${res.status}`);
  const local = await res.json();
  localVersion = local.version;
  localCount = local.questions?.length || 0;
  const cache = await liveCache();
  const saved = cache && await cache.match(QUESTIONS).then((r) => r?.json()).catch(() => null);
  // la copie récupérée en ligne n'est gardée que tant que l'application elle-même n'a pas changé
  if (saved?.base === local.version && validQuestions(saved.data)) return saved.data;
  return local;
}

const isStr = (x) => typeof x === 'string';
/** Contrôle de forme d'une banque téléchargée : une réponse invalide ou hostile est ignorée. */
export function validQuestions(d) {
  if (!d || !isStr(d.version) || !/^[\w-]{1,40}$/.test(d.version) || !d.themes || typeof d.themes !== 'object'
    || !Array.isArray(d.questions) || d.questions.length < 100 || d.questions.length > 20000) return false;
  return d.questions.every((q) => q && isStr(q.id) && /^[\w.@-]{1,80}$/.test(q.id) && isStr(q.q) && isStr(q.theme) && isStr(q.explain)
    && Array.isArray(q.levels) && q.levels.every(isStr)
    && Array.isArray(q.choices) && q.choices.length >= 2 && q.choices.length <= 6 && q.choices.every(isStr)
    && Array.isArray(q.answer) && q.answer.length >= 1 && q.answer.every((i) => Number.isInteger(i) && i >= 0 && i < q.choices.length)
    && (!q.img || (isStr(q.img.src) && /^img\/[\w./-]+\.(svg|png|jpe?g|webp)$/.test(q.img.src) && !q.img.src.includes('..'))));
}

/**
 * Cherche une version plus récente des questions (ignorée hors ligne ; au plus une fois par heure).
 * Seul le petit fichier version.json est téléchargé tant que rien n'a changé.
 */
export async function checkQuestionUpdate({ force = false } = {}) {
  if (!navigator.onLine || (!force && Date.now() - lastCheck < 3600e3)) return false;
  lastCheck = Date.now();
  try {
    const current = await getQuestions();
    const base = isNative() ? REMOTE_BASE : '';
    const stamp = `fresh=${Date.now()}`;
    const v = await fetch(`${base}data/version.json?${stamp}`, { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (v && v.version === current.version) return false;
    const res = await fetch(`${base}${QUESTIONS}?${stamp}`, { cache: 'no-store' });
    if (!res.ok) return false;
    const text = await res.text();
    if (text.length > 15e6) return false; // taille anormale
    const fresh = JSON.parse(text);
    if (!validQuestions(fresh) || fresh.version === current.version) return false;
    // pas de retour en arrière : une banque publiée plus petite que celle embarquée est ignorée
    if (localCount && fresh.questions.length < localCount * 0.95) return false;
    const cache = await liveCache();
    if (cache && localVersion) {
      await cache.put(QUESTIONS, new Response(JSON.stringify({ base: localVersion, data: fresh }), { headers: { 'Content-Type': 'application/json' } }));
    }
    memo.set(QUESTIONS, Promise.resolve(fresh));
    listeners.forEach((fn) => fn({ count: fresh.questions.length, version: fresh.version }));
    return true;
  } catch {
    return false;
  }
}

export const getQuestions = () => {
  if (!memo.has(QUESTIONS)) {
    memo.set(QUESTIONS, loadQuestions().catch((err) => { memo.delete(QUESTIONS); throw err; }));
  }
  return memo.get(QUESTIONS);
};
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => checkQuestionUpdate({ force: true }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkQuestionUpdate(); });
  setTimeout(() => checkQuestionUpdate(), 4000);
}
export const getCases = () => loadJSON('data/cases.json');
export const getExams = () => loadJSON('data/exams.json');
/** Règlements synchronisés par le bot + sources externes (documentation BadNet…). */
export const getCatalog = () => Promise.all([loadJSON('data/catalog.json'), loadJSON('data/external.json').catch(() => ({ docs: [] }))])
  .then(([cat, ext]) => (cat.docs.some((d) => d.external) ? cat : Object.assign(cat, { docs: [...cat.docs, ...ext.docs] })));
export const getUpdates = () => loadJSON('data/updates.json').catch(() => []);
export const getFiches = () => loadJSON('data/fiches.json');
export const getGlossary = () => loadJSON('data/glossaire.json');
export const getPractice = () => loadJSON('data/pratique.json');
export const getDocText = (doc) => (doc?.text ? loadJSON(doc.text) : Promise.reject(new Error(`${doc?.id} : pas de texte hors ligne`)));

export async function questionIndex() {
  const data = await getQuestions();
  if (!data._index) data._index = new Map(data.questions.map((q) => [q.id, q]));
  return data._index;
}

/** Retrouve l'entrée du catalogue correspondant à une référence (« 03.01 », « REGLES »). */
export async function findDoc(code) {
  const cat = await getCatalog();
  return cat.docs.find((d) => d.id === code) || cat.docs.find((d) => d.code === code && !d.upcoming);
}
