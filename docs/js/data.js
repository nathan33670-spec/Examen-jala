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

export const getQuestions = () => loadJSON('data/questions.json');
export const getCases = () => loadJSON('data/cases.json');
export const getExams = () => loadJSON('data/exams.json');
export const getCatalog = () => loadJSON('data/catalog.json');
export const getUpdates = () => loadJSON('data/updates.json').catch(() => []);
export const getFiches = () => loadJSON('data/fiches.json');
export const getGlossary = () => loadJSON('data/glossaire.json');
export const getPractice = () => loadJSON('data/pratique.json');
export const getDocText = (doc) => loadJSON(doc.text);

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
