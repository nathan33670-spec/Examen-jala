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

async function loadQuestions() {
  const res = await fetch(QUESTIONS);
  if (!res.ok) throw new Error(`${QUESTIONS} : HTTP ${res.status}`);
  const local = await res.json();
  const cache = await liveCache();
  const saved = cache && await cache.match(QUESTIONS).then((r) => r?.json()).catch(() => null);
  // la copie récupérée en ligne n'est gardée que tant que l'application elle-même n'a pas changé
  if (saved?.base === local.version && saved.data?.questions?.length) return saved.data;
  return local;
}

/** Cherche une version plus récente des questions (ignorée hors ligne ; au plus une fois par heure). */
export async function checkQuestionUpdate({ force = false } = {}) {
  if (!navigator.onLine || (!force && Date.now() - lastCheck < 3600e3)) return false;
  lastCheck = Date.now();
  try {
    const current = await getQuestions();
    const url = `${isNative() ? REMOTE_BASE : ''}${QUESTIONS}?fresh=${Date.now()}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return false;
    const fresh = await res.json();
    if (!Array.isArray(fresh.questions) || !fresh.questions.length || fresh.version === current.version) return false;
    const local = await fetch(QUESTIONS).then((r) => r.json()).catch(() => null);
    const cache = await liveCache();
    if (cache && local) {
      await cache.put(QUESTIONS, new Response(JSON.stringify({ base: local.version, data: fresh }), { headers: { 'Content-Type': 'application/json' } }));
    }
    memo.set(QUESTIONS, Promise.resolve(fresh));
    listeners.forEach((fn) => fn({ count: fresh.count || fresh.questions.length, version: fresh.version }));
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
  setTimeout(() => checkQuestionUpdate(), 1500);
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
