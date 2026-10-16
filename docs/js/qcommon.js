// Éléments communs aux écrans de questions (entraînement, jeux, examen).
import { esc, shuffle } from './ui.js';
import { getCatalog } from './data.js';

/** Énoncé + illustration éventuelle (écran de logiciel, feuille de match…). */
export function questionHtml(q, style = '') {
  const img = q.img ? `<figure class="qimg"><img src="${esc(q.img.src)}" alt="${esc(q.img.alt || '')}" loading="lazy" decoding="async">${q.img.alt ? `<figcaption class="small muted">${esc(q.img.alt)}</figcaption>` : ''}</figure>` : '';
  return `<p class="question"${style ? ` style="${style}"` : ''}>${esc(q.q)}</p>${img}`;
}

export function makeItem(q) {
  return { id: q.id, order: shuffle(q.choices.map((_, i) => i)), selected: [], revealed: false, flagged: false };
}

export function isCorrect(q, selected) {
  const a = [...q.answer].sort().join(',');
  const s = [...selected].sort().join(',');
  return a === s;
}

export function themeName(qdata, t) {
  return qdata.themes?.[t] || t;
}

export async function refLink(ref) {
  if (!ref) return '';
  const cat = await getCatalog().catch(() => ({ docs: [] }));
  const doc = cat.docs.find((d) => d.id === ref.doc);
  const name = !doc ? ref.doc : doc.id === 'REGLES' ? 'Règles officielles du badminton' : `GdB ${doc.id} — ${doc.title}`;
  const art = ref.art ? ` · ${ref.art}` : '';
  const link = `#/doc/${encodeURIComponent(ref.doc)}${ref.art ? `?a=${encodeURIComponent(ref.art)}` : ''}`;
  return `<p class="ref muted">Référence : <a href="${link}">${esc(name)}${esc(art)}</a></p>`;
}

export function choiceList(q, item, { locked, showResult, fresh = false }) {
  const multi = q.type === 'multiple';
  return `<div class="choices" role="${multi ? 'group' : 'radiogroup'}">${item.order.map((ci, k) => {
    const sel = item.selected.includes(ci);
    let cls = '';
    if (showResult) {
      if (q.answer.includes(ci)) cls = sel || !multi ? 'correct' : 'correct missed';
      else if (sel) cls = 'wrong';
      else cls = 'dim';
      if (fresh && (cls === 'correct' || cls === 'wrong')) cls += ' anim';
    }
    return `<button class="choice ${cls}" data-choice="${ci}" role="${multi ? 'checkbox' : 'radio'}" aria-checked="${sel}" ${locked ? 'disabled' : ''}>
      <span class="key">${String.fromCharCode(65 + k)}</span><span>${esc(q.choices[ci])}</span></button>`;
  }).join('')}</div>`;
}

export const diffDots = (d = 1) => `<span class="diff" title="Difficulté ${d}/3" aria-label="Difficulté ${d} sur 3">${'●'.repeat(d)}${'○'.repeat(3 - d)}</span>`;
