// Éléments communs aux écrans de questions (entraînement, jeux, examen).
import { esc, shuffle } from './ui.js';
import { getCatalog, getDocText } from './data.js';

/** Énoncé + illustration éventuelle (écran de logiciel, feuille de match…). */
export function questionHtml(q, style = '') {
  const img = q.img ? `<figure class="qimg"><a href="${esc(q.img.src)}" target="_blank" rel="noopener" title="Agrandir l’écran"><img src="${esc(q.img.src)}" alt="${esc(q.img.alt || '')}" loading="lazy" decoding="async"></a><figcaption class="small muted">Touchez l’écran pour l’agrandir.</figcaption></figure>` : '';
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
  if (doc?.external) {
    const page = doc.pages?.[ref.art];
    return `<p class="ref muted">Référence : <a href="${esc(page?.url || doc.source)}" target="_blank" rel="noopener">Documentation BadNet${page ? ` — ${esc(page.title)}` : ''}</a></p>`;
  }
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

/** Trouve le bloc correspondant à un article (« 2.16 », « Instr. 3.5.4 », « règle 9.1.6 »). */
export function findArticle(blocks, art) {
  // « Annexe 4 7.2 » : chercher l'article à l'intérieur de l'annexe (après son titre)
  const annex = art.match(/^\s*annexe\s+(\d+)\s*(.*)$/i);
  if (annex) {
    const start = blocks.findIndex((b) => new RegExp(`^ANNEXE\\s+${annex[1]}\\b`, 'i').test(b[1]));
    if (start >= 0) {
      if (!annex[2].trim()) return start;
      const i = findArticle(blocks.slice(start + 1), annex[2]);
      return i >= 0 ? start + 1 + i : start;
    }
  }
  const num = (art.match(/\d+(?:\.\d+)*/) || [])[0];
  if (!num) return -1;
  const instr = /instr/i.test(art);
  const startsWith = (s) => new RegExp(`^${num.replace(/\./g, '\\.')}\\.?(\\s|$)`).test(s);
  const toc = (t) => /_{5,}|\.{5,}/.test(t); // lignes de sommaire
  const candidates = blocks.map((b, i) => [i, b]).filter(([, b]) => startsWith(b[1]) && !toc(b[1]));
  if (!candidates.length) {
    const i = blocks.findIndex((b) => b[1].includes(num));
    return i;
  }
  if (instr && candidates.length > 1) {
    // les instructions aux officiels techniques suivent les règles du jeu dans le document
    const split = blocks.findIndex((b) => /INSTRUCTIONS AUX OFFICIELS/i.test(b[1]));
    const after = candidates.find(([i]) => i > split);
    if (after) return after[0];
  }
  if (!instr && candidates.length > 1 && /r[eè]gle/i.test(art)) return candidates[0][0];
  return candidates[0][0];
}

/**
 * Extrait de l'article cité (mode apprentissage) : le bloc trouvé et la suite jusqu'au titre suivant.
 * Renvoie '' si le document n'est pas disponible (hors ligne sans cache, article introuvable…).
 */
export async function articleExcerpt(ref, maxChars = 1400) {
  if (!ref?.art) return '';
  try {
    const cat = await getCatalog();
    const doc = cat.docs.find((d) => d.id === ref.doc);
    if (!doc?.text) return '';
    const { blocks } = await getDocText(doc);
    const i = findArticle(blocks, ref.art);
    if (i < 0) return '';
    const isHead = (b) => /^h\d$/.test(b[0]);
    const out = [];
    let size = 0;
    for (let k = i; k < blocks.length; k += 1) {
      const [type, text] = blocks[k];
      if (k > i && isHead(blocks[k])) break;
      if (k > i && type === 'p' && /^\d+(\.\d+)+\.?\s/.test(text) && !isHead(blocks[i])) break; // article suivant
      out.push(type === 'li' ? `<p>• ${esc(text)}</p>` : `<p class="${isHead(blocks[k]) ? 'art-title' : ''}">${esc(text)}</p>`);
      size += text.length;
      if (size > maxChars) { out.push('<p class="muted">…</p>'); break; }
    }
    return `<div class="article-excerpt"><p class="small muted">Texte officiel</p>${out.join('')}</div>`;
  } catch {
    return '';
  }
}
