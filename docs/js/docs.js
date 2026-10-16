// Bibliothèque des règlements, liseuse, fiches de synthèse, glossaire et recherche.
import { esc, fmtSize, fmtDate, richText, icons } from './ui.js';
import { getCatalog, getDocText, getFiches, getGlossary, getUpdates, getQuestions } from './data.js';
import { examBanner } from './quiz.js';
import { state, save } from './store.js';
import { refreshBadges } from './reward.js';

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function docLabel(d) {
  return d.id === 'REGLES' ? 'Règles' : d.code;
}

function docItem(d) {
  const meta = [d.edition ? `éd. ${d.edition}` : '', d.effective ? `en vigueur : ${d.effective}` : '', d.pages ? `${d.pages} p.` : '']
    .filter(Boolean).join(' · ');
  return `<a class="docitem" href="#/doc/${encodeURIComponent(d.id)}"><span class="code">${esc(docLabel(d))}</span>
    <span class="t">${esc(d.title)}<small>${esc(meta)}${d.upcoming ? ` · saison ${esc(d.season)}` : ''}</small></span></a>`;
}

export async function renderDocsHome(main) {
  const [cat, updates] = await Promise.all([getCatalog(), getUpdates()]);
  const current = cat.docs.filter((d) => !d.upcoming);
  const upcoming = cat.docs.filter((d) => d.upcoming);
  const folders = {};
  for (const d of current) (folders[d.folder || 'Autres'] ||= []).push(d);
  const order = Object.keys(folders).sort();
  const key = ['REGLES', '03.01', '07.04', '07.05', '06.02', '03.07', '03.02'];
  const last = updates.find((u) => u.changes?.length) || updates[0];
  main.innerHTML = `
    ${examBanner()}
    <h1>Règlements & documentation</h1>
    <div class="grid two">
      <a class="card tile" href="#/fiches"><span class="ico">${icons.star}</span><span><strong>Fiches de synthèse</strong><span class="small muted">Les chiffres et règles à connaître par cœur</span></span></a>
      <a class="card tile" href="#/glossaire"><span class="ico">${icons.book}</span><span><strong>Glossaire</strong><span class="small muted">JA, GEO, CLOT, CPPH, TdS, WO…</span></span></a>
      <a class="card tile" href="#/conditions"><span class="ico">${icons.target}</span><span><strong>Conditions d'examen</strong><span class="small muted">Ce que dit la filière juge-arbitrage</span></span></a>
      <a class="card tile" href="#/mises-a-jour"><span class="ico">${icons.news}</span><span><strong>Mises à jour</strong><span class="small muted">${last ? `Dernière détection : ${fmtDate(last.date)}` : 'Historique des nouvelles versions'}</span></span></a>
    </div>
    <h2>Guide du Badminton ${esc(cat.season || '')}</h2>
    <p class="small muted">${cat.count} documents officiels (${fmtSize(cat.totalSize)} en PDF), synchronisés automatiquement depuis <a href="https://gdb.ffbad.org" rel="noopener" target="_blank">gdb.ffbad.org</a>. Le texte est lisible hors ligne ; les PDF le sont après téléchargement du <a href="#/hors-ligne">pack hors-ligne</a>.</p>
    <div class="toolbar"><input type="search" id="filter" placeholder="Filtrer les documents (ex. forfait, tenue, 03.01)…" aria-label="Filtrer les documents"></div>
    <h3>Essentiels du juge-arbitre</h3>
    <div class="doclist" id="essentials">${key.map((k) => current.find((d) => d.id === k)).filter(Boolean).map(docItem).join('')}</div>
    <h3>Tous les documents</h3>
    <div id="folders">${order.map((f) => `<details class="folder"><summary>${esc(f)} <span class="badge">${folders[f].length}</span></summary><div class="doclist">${folders[f].map(docItem).join('')}</div></details>`).join('')}</div>
    ${upcoming.length ? `<h3>À venir (saison suivante)</h3><p class="small muted">Documents déjà publiés par la FFBaD pour la prochaine saison.</p><div class="doclist">${upcoming.map(docItem).join('')}</div>` : ''}`;
  const input = main.querySelector('#filter');
  input.oninput = () => {
    const v = norm(input.value);
    main.querySelectorAll('.docitem').forEach((a) => { a.classList.toggle('hide', v && !norm(a.textContent).includes(v)); });
    main.querySelectorAll('details.folder').forEach((d) => {
      const visible = d.querySelectorAll('.docitem:not(.hide)').length;
      d.classList.toggle('hide', v && !visible);
      if (v && visible) d.open = true;
    });
  };
}

function blockHtml([type, text], i) {
  const t = esc(text);
  if (type === 'li') return `<li data-i="${i}">${t}</li>`;
  if (/^h[1-4]$/.test(type)) {
    const lvl = Math.min(4, Math.max(2, Number(type[1])));
    return `<h${lvl} data-i="${i}">${t}</h${lvl}>`;
  }
  return `<p data-i="${i}">${t}</p>`;
}

function blocksHtml(blocks) {
  const out = [];
  let inList = false;
  blocks.forEach((b, i) => {
    if (b[0] === 'li' && !inList) { out.push('<ul>'); inList = true; }
    if (b[0] !== 'li' && inList) { out.push('</ul>'); inList = false; }
    out.push(blockHtml(b, i));
  });
  if (inList) out.push('</ul>');
  return out.join('');
}

/** Trouve le bloc correspondant à un article (« 2.16 », « Instr. 3.5.4 », « règle 9.1.6 »). */
function findArticle(blocks, art) {
  const num = (art.match(/\d+(?:\.\d+)*/) || [])[0];
  if (!num) return -1;
  const instr = /instr/i.test(art);
  const startsWith = (s) => new RegExp(`^${num.replace(/\./g, '\\.')}\\.?(\\s|$)`).test(s);
  const candidates = blocks.map((b, i) => [i, b]).filter(([, b]) => startsWith(b[1]));
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

export async function renderDoc(main, id, query = {}) {
  const cat = await getCatalog();
  const doc = cat.docs.find((d) => d.id === id) || cat.docs.find((d) => d.code === id && !d.upcoming);
  if (!doc) {
    main.innerHTML = `<h1>Document introuvable</h1><p>Le document « ${esc(id)} » n'est pas (ou plus) dans le catalogue.</p><a class="btn" href="#/docs">Retour aux règlements</a>`;
    return;
  }
  main.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  const g = state.game;
  g.docsSeen ||= {};
  if (!g.docsSeen[doc.id]) {
    g.docsSeen[doc.id] = 1;
    g.counters.docs = Object.keys(g.docsSeen).length;
    save();
    refreshBadges();
  }
  let text;
  try {
    text = await getDocText(doc);
  } catch {
    text = null;
  }
  const meta = [
    doc.edition && `Édition ${doc.edition}`,
    doc.adoption && `Adoption : ${doc.adoption}`,
    doc.effective && `Entrée en vigueur : ${doc.effective}`,
    doc.replaces && `Remplace : ${doc.replaces}`,
  ].filter(Boolean);
  main.innerHTML = `
    ${examBanner()}
    <p class="small muted"><a href="#/docs">Règlements</a> › ${esc(doc.folder || '')}</p>
    <h1>${esc(doc.id === 'REGLES' ? '' : `${doc.code} — `)}${esc(doc.title)}</h1>
    <p class="small muted">${meta.map(esc).join(' · ')}${doc.updatedAt ? ` · récupéré le ${fmtDate(doc.updatedAt)}` : ''}</p>
    <div class="btn-row" style="margin-bottom:6px">
      <a class="btn small" href="${esc(doc.pdf)}" target="_blank" rel="noopener">${icons.download.replace('<svg', '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"')} PDF officiel (${fmtSize(doc.size)})</a>
      <a class="btn small secondary" href="${esc(doc.source)}" target="_blank" rel="noopener">Source FFBaD</a>
    </div>
    ${doc.id === 'REGLES' ? '<div class="notice small">Le PDF officiel signale les modifications (ancien texte barré en rouge, nouveau texte en bleu). Dans la version texte ci-dessous, les deux valeurs peuvent apparaître côte à côte : « 21 15 points » se lit <strong>15 points</strong> (système 3×15 appliqué par la FFBaD depuis le 1er septembre 2026).</div>' : ''}
    ${doc.upcoming ? `<div class="notice warn small">Document applicable à partir de la saison ${esc(doc.season)}.</div>` : ''}
    <div class="toolbar"><input type="search" id="find" placeholder="Rechercher dans ce document…" aria-label="Rechercher dans ce document" value="${esc(query.q || '')}"><span class="small muted" id="hits"></span></div>
    <article class="reader" id="reader">${text ? blocksHtml(text.blocks) : '<p class="empty">Texte indisponible hors ligne. Ouvrez le PDF ou reconnectez-vous.</p>'}</article>
    <p class="small muted">Version texte extraite automatiquement du PDF officiel pour la lecture et la recherche hors ligne ; en cas de doute (tableaux, schémas), le PDF fait foi.</p>`;
  if (!text) return;
  const reader = main.querySelector('#reader');
  const find = main.querySelector('#find');
  const hits = main.querySelector('#hits');
  const original = reader.innerHTML;
  const highlight = () => {
    const v = find.value.trim();
    reader.innerHTML = original;
    if (v.length < 2) { hits.textContent = ''; return; }
    const re = new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let count = 0;
    reader.querySelectorAll('p, li, h2, h3, h4').forEach((el) => {
      if (re.test(el.textContent)) {
        el.innerHTML = esc(el.textContent).replace(new RegExp(esc(v).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => { count += 1; return `<mark class="hit">${m}</mark>`; });
      }
      re.lastIndex = 0;
    });
    hits.textContent = count ? `${count} résultat(s)` : 'aucun résultat';
    reader.querySelector('.hit')?.scrollIntoView({ block: 'center' });
  };
  let deb;
  find.oninput = () => { clearTimeout(deb); deb = setTimeout(highlight, 200); };
  if (query.q) highlight();
  if (query.a) {
    const i = findArticle(text.blocks, query.a);
    const el = i >= 0 ? reader.querySelector(`[data-i="${i}"]`) : null;
    if (el) {
      el.classList.add('target');
      setTimeout(() => el.scrollIntoView({ block: 'center' }), 50);
    }
  }
}

// ------------------------------------------------------------------ fiches

export async function renderFiches(main) {
  const fiches = await getFiches();
  main.innerHTML = `${examBanner()}<h1>Fiches de synthèse</h1>
    <p class="muted">Résumés rédigés pour la préparation, avec renvoi aux articles officiels. En cas de divergence, le texte du Guide du Badminton fait foi.</p>
    <div class="grid two">${fiches.map((f) => `<a class="card" href="#/fiche/${f.id}"><strong>${esc(f.title)}</strong><p class="small muted">${esc(f.summary)}</p><span class="badge info">${f.levels.join(' · ')}</span></a>`).join('')}</div>`;
}

export async function renderFiche(main, id) {
  const fiches = await getFiches();
  const f = fiches.find((x) => x.id === id);
  if (!f) { main.innerHTML = '<p class="empty">Fiche introuvable.</p>'; return; }
  main.innerHTML = `${examBanner()}<p class="small muted"><a href="#/fiches">Fiches</a></p>
    <article class="fiche"><h1>${esc(f.title)}</h1>${f.html}
    ${f.refs?.length ? `<p class="small muted">Références : ${f.refs.map((r) => `<a href="#/doc/${encodeURIComponent(r.doc)}${r.art ? `?a=${encodeURIComponent(r.art)}` : ''}">${esc(r.label)}</a>`).join(' · ')}</p>` : ''}</article>
    <div class="btn-row" style="margin-top:14px"><a class="btn" href="#/entrainement">S'entraîner</a><a class="btn secondary" href="#/fiches">Toutes les fiches</a></div>`;
}

export async function renderGlossary(main) {
  const items = await getGlossary();
  main.innerHTML = `${examBanner()}<h1>Glossaire</h1>
    <div class="toolbar"><input type="search" id="g" placeholder="Rechercher un terme…" aria-label="Rechercher un terme"></div>
    <dl class="glossary" id="list">${items.map((it) => `<div data-k="${esc(norm(it.term + ' ' + it.def))}"><dt>${esc(it.term)}</dt><dd>${esc(it.def)}</dd></div>`).join('')}</dl>`;
  const g = main.querySelector('#g');
  g.oninput = () => {
    const v = norm(g.value);
    main.querySelectorAll('#list > div').forEach((d) => d.classList.toggle('hide', v && !d.dataset.k.includes(v)));
  };
}

export async function renderUpdates(main) {
  const [updates, cat] = await Promise.all([getUpdates(), getCatalog()]);
  main.innerHTML = `<h1>Mises à jour des règlements</h1>
    <p class="muted">Un robot vérifie chaque semaine le Guide du Badminton publié par la FFBaD et intègre automatiquement les nouvelles versions. Catalogue actuel : saison ${esc(cat.season)}, généré le ${fmtDate(cat.generatedAt)}.</p>
    ${updates.length ? updates.map((u) => `<div class="card" style="margin-bottom:10px"><h3>${fmtDate(u.date)} <span class="badge">${esc(u.season)}</span></h3>
      ${u.note ? `<p>${esc(u.note)}</p>` : ''}<ul>${u.changes.map((c) => `<li><span class="badge ${c.type === 'modifié' ? 'warn' : c.type === 'retiré' ? 'ko' : 'ok'}">${esc(c.type)}</span> <a href="#/doc/${encodeURIComponent(c.id)}">${esc(c.id)}</a> — ${esc(c.title || '')}${c.edition ? ` (éd. ${esc(c.edition)})` : ''}</li>`).join('')}</ul></div>`).join('') : '<p class="empty">Aucune mise à jour enregistrée.</p>'}`;
}

// ------------------------------------------------------------------ recherche globale

let corpus = null;
async function buildCorpus() {
  if (corpus) return corpus;
  const [cat, qdata, fiches, glossary] = await Promise.all([getCatalog(), getQuestions(), getFiches(), getGlossary()]);
  const docs = await Promise.all(cat.docs.map(async (d) => {
    try {
      const t = await getDocText(d);
      return t.blocks.map((b, i) => ({ kind: 'doc', doc: d, i, text: b[1], n: norm(b[1]) }));
    } catch { return []; }
  }));
  corpus = {
    blocks: docs.flat(),
    questions: qdata.questions.map((q) => ({ q, n: norm(`${q.q} ${q.choices.join(' ')} ${q.explain}`) })),
    fiches: fiches.map((f) => ({ f, n: norm(`${f.title} ${f.summary} ${f.html.replace(/<[^>]+>/g, ' ')}`) })),
    glossary: glossary.map((g) => ({ g, n: norm(`${g.term} ${g.def}`) })),
  };
  return corpus;
}

function snippet(text, terms) {
  const n = norm(text);
  const pos = Math.max(0, n.indexOf(terms[0]) - 60);
  let s = text.slice(pos, pos + 220);
  if (pos > 0) s = `…${s}`;
  if (pos + 220 < text.length) s += '…';
  let html = esc(s);
  for (const t of terms) {
    if (t.length < 2) continue;
    html = html.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
  }
  return html;
}

export async function renderSearch(main, query = {}) {
  main.innerHTML = `${examBanner()}<h1>Recherche</h1>
    <div class="toolbar"><input type="search" id="s" placeholder="Ex. : temps de repos, carton noir, 14-14, poussins…" value="${esc(query.q || '')}" aria-label="Rechercher" autofocus></div>
    <div id="res"><p class="small muted">La recherche porte sur les règlements, les fiches, le glossaire et les questions.</p></div>`;
  const input = main.querySelector('#s');
  const res = main.querySelector('#res');
  const run = async () => {
    const v = input.value.trim();
    history.replaceState(null, '', `#/recherche${v ? `?q=${encodeURIComponent(v)}` : ''}`);
    if (v.length < 2) return;
    res.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    const c = await buildCorpus();
    const terms = norm(v).split(/\s+/).filter(Boolean);
    const match = (n) => terms.every((t) => n.includes(t));
    const g = c.glossary.filter((x) => match(x.n)).slice(0, 10);
    const f = c.fiches.filter((x) => match(x.n)).slice(0, 10);
    const b = c.blocks.filter((x) => match(x.n)).slice(0, 60);
    const q = c.questions.filter((x) => match(x.n)).slice(0, 20);
    res.innerHTML = `
      ${g.length ? `<h2>Glossaire</h2><dl class="glossary">${g.map((x) => `<dt>${esc(x.g.term)}</dt><dd>${esc(x.g.def)}</dd>`).join('')}</dl>` : ''}
      ${f.length ? `<h2>Fiches</h2><div class="doclist">${f.map((x) => `<a class="docitem" href="#/fiche/${x.f.id}"><span class="t">${esc(x.f.title)}</span></a>`).join('')}</div>` : ''}
      <h2>Règlements (${b.length}${b.length === 60 ? '+' : ''})</h2>
      ${b.length ? `<div class="doclist">${b.map((x) => `<a class="docitem" href="#/doc/${encodeURIComponent(x.doc.id)}?q=${encodeURIComponent(v)}"><span class="code">${esc(docLabel(x.doc))}</span><span class="t small">${snippet(x.text, terms)}</span></a>`).join('')}</div>` : '<p class="muted">Aucun passage trouvé.</p>'}
      ${q.length ? `<h2>Questions</h2><div class="doclist">${q.map((x) => `<a class="docitem" href="#/question/${x.q.id}"><span class="code">${esc(x.q.levels[0])}</span><span class="t small">${snippet(x.q.q, terms)}</span></a>`).join('')}</div>` : ''}`;
  };
  let deb;
  input.oninput = () => { clearTimeout(deb); deb = setTimeout(run, 300); };
  if (query.q) run();
}

export async function renderQuestion(main, id) {
  const qdata = await getQuestions();
  const q = qdata.questions.find((x) => x.id === id);
  if (!q) { main.innerHTML = '<p class="empty">Question introuvable.</p>'; return; }
  main.innerHTML = `<h1>Question ${esc(q.id)}</h1><div class="card"><p class="question">${esc(q.q)}</p>
    <ul>${q.choices.map((c, i) => `<li>${q.answer.includes(i) ? '<strong>✔ ' : ''}${esc(c)}${q.answer.includes(i) ? '</strong>' : ''}</li>`).join('')}</ul>
    <div class="explain card flat ok">${richText(q.explain)}</div>
    ${q.ref ? `<p class="small muted">Référence : <a href="#/doc/${encodeURIComponent(q.ref.doc)}?a=${encodeURIComponent(q.ref.art)}">${esc(q.ref.doc)} ${esc(q.ref.art)}</a> · niveaux ${q.levels.join(', ')}</p>` : ''}</div>`;
}
