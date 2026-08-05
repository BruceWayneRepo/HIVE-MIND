import { blobURL } from './db.js';

const TYPE_COLORS = {
  note: 'var(--note)', link: 'var(--link)', image: 'var(--image)',
  pdf: 'var(--pdf)', voice: 'var(--voice)', quote: 'var(--quote)',
};

export function esc(s = '') {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

export async function cardHTML(item) {
  const dot = `<span class="type-dot" style="background:${TYPE_COLORS[item.type] || 'var(--faint)'}"></span>`;
  const typeLabel = item.type === 'link' ? (host(item.url) || 'link') : item.type;
  let media = '';
  if (item.type === 'image' && item.blobId) {
    const url = await blobURL(item.blobId);
    if (url) media = `<img class="card-media" loading="lazy" src="${url}" alt="">`;
  }

  let bodyMain = '';
  if (item.type === 'quote') {
    bodyMain = `<div class="card-quote">"${esc((item.text || '').slice(0, 240))}"</div>`;
  } else if (item.type === 'note') {
    bodyMain = `<div class="card-serif">${esc((item.title || item.text || '').slice(0, 120))}</div>
      ${item.text && item.title ? `<div class="card-snip">${esc(item.text.slice(0, 180))}</div>` : ''}`;
  } else if (item.type === 'link') {
    bodyMain = `<div class="card-title">${esc(item.title || item.url || 'Link')}</div>
      ${item.summary ? `<div class="card-snip">${esc(item.summary)}</div>` : ''}`;
  } else if (item.type === 'voice') {
    bodyMain = `<div class="card-title">◉ Voice note</div>
      ${item.text ? `<div class="card-snip">${esc(item.text.slice(0, 160))}</div>` : ''}`;
  } else if (item.type === 'pdf') {
    bodyMain = `<div class="card-title">▤ ${esc(item.title || 'PDF')}</div>
      ${item.summary ? `<div class="card-snip">${esc(item.summary)}</div>` : ''}`;
  } else {
    bodyMain = `<div class="card-title">${esc(item.title || '')}</div>`;
  }

  const tags = (item.tags || []).slice(0, 4)
    .map((t) => `<span class="card-tag">${esc(t)}</span>`).join('');

  return `<article class="card" data-id="${item.id}">
    ${media}
    <div class="card-body">
      <div class="card-type">${dot}${esc(typeLabel)}</div>
      ${bodyMain}
      ${tags ? `<div class="card-tags">${tags}</div>` : ''}
      <div class="card-meta">${fmtDate(item.created)}</div>
    </div>
  </article>`;
}

export async function renderGrid(gridEl, items) {
  if (!items.length) { gridEl.innerHTML = ''; return; }
  const html = await Promise.all(items.map(cardHTML));
  gridEl.innerHTML = html.join('');
}

export function renderRails({ items, typeList, colorList, tagList, spaceList, spaces }) {
  // types
  const typeCounts = {};
  const colorCounts = {};
  const tagCounts = {};
  for (const i of items) {
    typeCounts[i.type] = (typeCounts[i.type] || 0) + 1;
    for (const c of i.colorNames || []) colorCounts[c] = (colorCounts[c] || 0) + 1;
    for (const t of i.tags || []) tagCounts[t] = (tagCounts[t] || 0) + 1;
  }
  typeList.innerHTML = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<button class="chip" data-type="${t}">${t} ${n}</button>`).join('') ||
    '<span class="hint">—</span>';

  const SW = { red:'#c83737',orange:'#dc8232',yellow:'#e1c846',green:'#5aaf5f',teal:'#46b4af',
    blue:'#4678dc',purple:'#965ac8',pink:'#e178af',brown:'#785537',black:'#191a1c',white:'#ececec',grey:'#82828a' };
  colorList.innerHTML = Object.entries(colorCounts).sort((a, b) => b[1] - a[1])
    .map(([c]) => `<button class="swatch" data-color="${c}" title="${c}" style="background:${SW[c] || '#666'}"></button>`).join('') ||
    '<span class="hint">—</span>';

  tagList.innerHTML = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]).slice(0, 24)
    .map(([t]) => `<button class="chip" data-tag="${esc(t)}">${esc(t)}</button>`).join('') ||
    '<span class="hint">—</span>';

  spaceList.innerHTML = spaces
    .map((s) => `<button class="space" data-space="${esc(s)}">${esc(s)}</button>`).join('') ||
    '<span class="hint" style="padding:0 6px">No spaces yet</span>';
}

export async function detailHTML(item) {
  const canFull = (item.type === 'image' || item.type === 'pdf') && item.blobId;
  const fullBtn = canFull
    ? `<button class="preview-full" data-act="fullsize" title="Open full size">⤢ Full size</button>` : '';
  let preview = '';
  if (item.type === 'image' && item.blobId) {
    const url = await blobURL(item.blobId);
    if (url) preview = `<div class="preview-wrap">${fullBtn}<img class="detail-media" src="${url}" alt=""></div>`;
  } else if (item.type === 'pdf' && item.blobId) {
    preview = `<div class="preview-wrap">${fullBtn}<div id="pdfPane" class="detail-pdf" data-blob="${item.blobId}"><div class="pdf-loading">Rendering PDF…</div></div></div>`;
  } else if (item.type === 'voice' && item.blobId) {
    const url = await blobURL(item.blobId);
    if (url) preview = `<audio class="detail-media" controls src="${url}"></audio>`;
  }
  const media = preview, audio = '';
  const readerClass = (item.type === 'link') ? 'detail-reader' : '';
  const body = item.text
    ? `<div class="detail-content ${readerClass}">${esc(item.text)}</div>`
    : (item.ocr ? `<div class="detail-content" style="color:var(--muted)">${esc(item.ocr)}</div>` : '');

  const link = item.url ? `<a href="${esc(item.url)}" target="_blank" rel="noopener">Open link ↗</a>` : '';

  return `
    ${media}${audio}
    <div class="detail-type">${esc(item.type)}${item.url ? ' · ' + esc(host(item.url)) : ''}</div>
    ${item.title ? `<h1 class="detail-title">${esc(item.title)}</h1>` : ''}
    ${item.summary ? `<div class="detail-summary">${esc(item.summary)}</div>` : ''}
    ${body}
    <div class="tag-edit" id="tagEdit">
      ${(item.tags || []).map((t) => `<span class="chip active" data-tag="${esc(t)}">${esc(t)} ✕</span>`).join('')}
      <input id="tagInput" placeholder="add tag…" />
    </div>
    <div class="detail-actions">
      ${link}
      <button data-act="enrich">✦ Auto-tag & summarise</button>
      <button data-act="edit">Edit text</button>
      <button data-act="fav">${item.fav ? '★ Favourited' : '☆ Favourite'}</button>
      <button data-act="delete" class="danger">Delete</button>
    </div>
  `;
}
