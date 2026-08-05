import * as db from './db.js';
import { colorsFromURL } from './color.js';
import { ocrImage } from './ocr.js';
import * as ai from './ai.js';
import * as fb from './firebase.js';
import { runSearch, serendipity, buildIndex } from './search.js';
import { renderGrid, renderRails, detailHTML, esc } from './ui.js';

const $ = (s) => document.querySelector(s);
const grid = $('#grid'), emptyEl = $('#empty');
let ITEMS = [];
let filters = { space: '__all', type: null, color: null, tag: null };
let query = '';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const now = () => Date.now();

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

let _fbInited = false;
function handleAuth(user) {
  const st = document.querySelector('#fbStatus');
  if (user) {
    if (st) st.textContent = 'Synced as ' + (user.email || 'account');
    mergeRemote().then(() => { for (const i of ITEMS) fb.push(i).catch(() => {}); });
  } else if (st) {
    st.textContent = 'Signed out — saving locally.';
  }
}
async function load() {
  ITEMS = await db.allItems();
  if (fb.getConfig()) { fb.init(handleAuth); _fbInited = true; }
  refresh();
}

async function mergeRemote() {
  try {
    const remote = await fb.pull();
    const map = new Map(ITEMS.map((i) => [i.id, i]));
    let added = 0;
    for (const r of remote) {
      const local = map.get(r.id);
      if (!local || (r.updated || 0) > (local.updated || 0)) {
        if (!local || r.updated > local.updated) { await db.putItem(r); added++; }
      }
    }
    if (added) { ITEMS = await db.allItems(); refresh(); toast(`Synced ${added} item${added > 1 ? 's' : ''}`); }
  } catch (e) { /* ignore */ }
}

function currentList() {
  let list = runSearch(ITEMS, query, filters);
  if (filters.space === '__serendipity') return serendipity(ITEMS, 12);
  return list;
}

async function refresh() {
  const list = currentList();
  emptyEl.classList.toggle('hidden', ITEMS.length !== 0);
  await renderGrid(grid, list);
  renderRails({
    items: ITEMS, typeList: $('#typeList'), colorList: $('#colorList'),
    tagList: $('#tagList'), spaceList: $('#spaceList'), spaces: getSpaces(),
  });
  syncActiveStates();
  renderSerendipity();
}

function getSpaces() {
  const set = new Set();
  ITEMS.forEach((i) => (i.spaces || []).forEach((s) => set.add(s)));
  return [...set].sort();
}

function syncActiveStates() {
  document.querySelectorAll('.rail .space').forEach((b) =>
    b.classList.toggle('active', b.dataset.space === filters.space));
  document.querySelectorAll('#typeList .chip').forEach((b) =>
    b.classList.toggle('active', b.dataset.type === filters.type));
  document.querySelectorAll('#tagList .chip').forEach((b) =>
    b.classList.toggle('active', b.dataset.tag === filters.tag));
  document.querySelectorAll('#colorList .swatch').forEach((b) =>
    b.classList.toggle('active', b.dataset.color === filters.color));
}

async function renderSerendipity() {
  const box = $('#serendipity');
  if (filters.space !== '__all' || query || ITEMS.length < 6) { box.classList.add('hidden'); return; }
  const picks = serendipity(ITEMS, 3);
  if (!picks.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  box.innerHTML = `<h4>Serendipity — worth another look</h4>
    <div class="grid" style="column-width:200px">${picks.map((p) =>
      `<article class="card" data-id="${p.id}"><div class="card-body">
        <div class="card-title">${esc(p.title || (p.text || '').slice(0, 60) || p.type)}</div>
        <div class="card-meta">${new Date(p.created).toLocaleDateString()}</div>
      </div></article>`).join('')}</div>`;
}

/* ---------------- Saving ---------------- */
async function saveItem(item, blob) {
  item.id ||= uid();
  item.created ||= now();
  item.updated = now();
  if (blob) { item.blobId = item.id; await db.putBlob(item.id, blob); }
  await db.putItem(item);
  ITEMS = await db.allItems();
  refresh();
  fb.push(item).catch(() => {});
  return item;
}

function detectType(text) {
  const t = text.trim();
  if (/^https?:\/\/\S+$/i.test(t)) return 'link';
  if (/^["“].+["”]$/.test(t)) return 'quote';
  return 'note';
}

async function quickSave(text) {
  text = text.trim();
  if (!text) return;
  const type = detectType(text);
  const item = { type };
  if (type === 'link') {
    item.url = text;
    try { item.title = new URL(text).hostname.replace(/^www\./, ''); } catch { item.title = text; }
  } else if (type === 'quote') {
    item.text = text.replace(/^["“]|["”]$/g, '');
  } else {
    item.text = text;
    item.title = text.split('\n')[0].slice(0, 80);
  }
  const saved = await saveItem(item);
  toast('Saved to your mind');
  maybeEnrich(saved);
}

async function saveImageFile(file) {
  const type = file.type === 'application/pdf' ? 'pdf' : 'image';
  const item = { type, title: file.name.replace(/\.[^.]+$/, '') };
  const saved = await saveItem(item, file);
  toast(type === 'pdf' ? 'PDF saved' : 'Image saved — reading it…');
  if (type === 'image') {
    const url = await db.blobURL(saved.blobId);
    // colours
    const { swatches, names } = await colorsFromURL(url);
    saved.colorSwatches = swatches; saved.colorNames = names;
    await db.putItem(saved); ITEMS = await db.allItems(); refresh();
    // OCR
    const text = await ocrImage(url);
    if (text) { saved.ocr = text; await db.putItem(saved); ITEMS = await db.allItems(); refresh(); }
    maybeEnrich(saved);
  } else {
    maybeEnrich(saved);
  }
}

async function maybeEnrich(item) {
  if (!ai.hasKey() || localStorage.getItem('mind.aiAuto') !== '1') return;
  try {
    const { tags, summary } = await ai.enrich(item);
    if (tags.length) item.tags = [...new Set([...(item.tags || []), ...tags])];
    if (summary && !item.summary) item.summary = summary;
    item.updated = now();
    await db.putItem(item); ITEMS = await db.allItems(); refresh();
    fb.push(item).catch(() => {});
  } catch (e) { console.warn(e.message); }
}

/* ---------------- Detail sheet ---------------- */
async function openDetail(id) {
  const item = ITEMS.find((i) => i.id === id);
  if (!item) return;
  if (!item.read) { item.read = true; db.putItem(item); }
  const panel = $('#sheetPanel');
  panel.innerHTML = await detailHTML(item);
  $('#sheet').classList.remove('hidden');

  panel.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => detailAction(btn.dataset.act, item));
  });
  // tag add
  const tagInput = panel.querySelector('#tagInput');
  tagInput?.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && e.target.value.trim()) {
      item.tags = [...new Set([...(item.tags || []), e.target.value.trim().toLowerCase()])];
      item.updated = now(); await db.putItem(item); ITEMS = await db.allItems();
      openDetail(id); refresh(); fb.push(item).catch(() => {});
    }
  });
  panel.querySelectorAll('#tagEdit .chip').forEach((c) => c.addEventListener('click', async () => {
    item.tags = (item.tags || []).filter((t) => t !== c.dataset.tag);
    item.updated = now(); await db.putItem(item); ITEMS = await db.allItems();
    openDetail(id); refresh();
  }));
  // inline PDF render
  const pdfPane = panel.querySelector('#pdfPane');
  if (pdfPane) renderPDF(pdfPane, pdfPane.dataset.blob);
}

let _pdfjs = null;
async function loadPdfJs() {
  if (_pdfjs) return _pdfjs;
  const lib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';
  _pdfjs = lib;
  return lib;
}
async function renderPDF(pane, blobId) {
  try {
    const url = await db.blobURL(blobId);
    if (!url) { pane.innerHTML = '<div class="pdf-loading">File not found.</div>'; return; }
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument(url).promise;
    pane.innerHTML = '';
    const max = Math.min(pdf.numPages, 20);
    for (let n = 1; n <= max; n++) {
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1.5 });
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width; canvas.height = viewport.height;
      pane.appendChild(canvas);
      await page.render({ canvasContext: ctx, viewport }).promise;
    }
    if (pdf.numPages > max) {
      const d = document.createElement('div');
      d.className = 'pdf-loading';
      d.textContent = `Showing first ${max} of ${pdf.numPages} pages — tap Full size for the rest.`;
      pane.appendChild(d);
    }
  } catch (e) {
    pane.innerHTML = `<div class="pdf-loading">Couldn't render inline (${e.message}). Tap Full size to open it.</div>`;
  }
}

async function detailAction(act, item) {
  if (act === 'fullsize') {
    const url = await db.blobURL(item.blobId);
    if (url) window.open(url, '_blank');
    return;
  }
  if (act === 'delete') {
    if (!confirm('Delete this from your mind?')) return;
    await db.deleteItem(item.id); fb.pushDelete(item.id).catch(() => {});
    ITEMS = await db.allItems(); closeSheets(); refresh(); toast('Deleted');
  } else if (act === 'fav') {
    item.fav = !item.fav; item.updated = now(); await db.putItem(item);
    ITEMS = await db.allItems(); openDetail(item.id); refresh();
  } else if (act === 'edit') {
    const panel = $('#sheetPanel');
    const ta = document.createElement('textarea');
    ta.className = 'editable'; ta.value = item.text || '';
    const content = panel.querySelector('.detail-content');
    (content || panel).replaceChildren(ta); ta.focus();
    ta.addEventListener('blur', async () => {
      item.text = ta.value; item.updated = now(); await db.putItem(item);
      ITEMS = await db.allItems(); refresh(); openDetail(item.id);
    });
  } else if (act === 'enrich') {
    if (!ai.hasKey()) { toast('Add an AI key in Settings first'); return; }
    toast('Thinking…');
    try {
      const { tags, summary } = await ai.enrich(item);
      if (tags.length) item.tags = [...new Set([...(item.tags || []), ...tags])];
      if (summary) item.summary = summary;
      item.updated = now(); await db.putItem(item); ITEMS = await db.allItems();
      openDetail(item.id); refresh(); toast('Tagged & summarised');
    } catch (e) { toast(e.message); }
  }
}

function closeSheets() {
  $('#sheet').classList.add('hidden');
  $('#settings').classList.add('hidden');
}

/* ---------------- Ask your mind ---------------- */
async function askMind() {
  const q = $('#search').value.trim();
  if (!q) { toast('Type a question first'); return; }
  if (!ai.hasKey()) { toast('Add an AI key in Settings to ask'); return; }
  toast('Searching your mind…');
  try {
    const { answer, ids } = await ai.askMind(q, buildIndex(ITEMS));
    const panel = $('#sheetPanel');
    const hits = ids.map((id) => ITEMS.find((i) => i.id === id)).filter(Boolean);
    panel.innerHTML = `<div class="detail-type">ask your mind</div>
      <h1 class="detail-title">${esc(q)}</h1>
      <div class="detail-summary">${esc(answer)}</div>
      <div class="grid" style="column-width:200px">${
        (await Promise.all(hits.map(async (h) =>
          `<article class="card" data-id="${h.id}"><div class="card-body">
            <div class="card-title">${esc(h.title || (h.text || '').slice(0, 50) || h.type)}</div>
          </div></article>`))).join('')}</div>`;
    $('#sheet').classList.remove('hidden');
    panel.querySelectorAll('.card').forEach((c) =>
      c.addEventListener('click', () => openDetail(c.dataset.id)));
  } catch (e) { toast(e.message); }
}

/* ---------------- Voice ---------------- */
let mediaRec = null, chunks = [], recognizer = null, liveText = '';
async function toggleVoice() {
  if (mediaRec && mediaRec.state === 'recording') {
    mediaRec.stop();
    if (recognizer) recognizer.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = []; liveText = '';
    mediaRec = new MediaRecorder(stream);
    mediaRec.ondataavailable = (e) => chunks.push(e.data);
    mediaRec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: 'audio/webm' });
      const item = { type: 'voice', title: 'Voice note', text: liveText.trim() };
      const saved = await saveItem(item, blob);
      toast('Voice note saved'); maybeEnrich(saved);
    };
    // live transcription via Web Speech API (best-effort, on-device)
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      recognizer = new SR();
      recognizer.continuous = true; recognizer.interimResults = true;
      recognizer.onresult = (e) => {
        liveText = '';
        for (let i = 0; i < e.results.length; i++) liveText += e.results[i][0].transcript;
      };
      recognizer.start();
    }
    mediaRec.start();
    toast('Recording… tap ◉ again to stop');
    $('#newVoice').style.color = 'var(--pdf)';
    const restore = () => { $('#newVoice').style.color = ''; };
    mediaRec.addEventListener('stop', restore, { once: true });
  } catch (e) { toast('Mic unavailable'); }
}

/* ---------------- Export / import ---------------- */
async function exportJSON() {
  const data = JSON.stringify(ITEMS, null, 2);
  download('mind-export.json', new Blob([data], { type: 'application/json' }));
}
function exportCSV() {
  const cols = ['id', 'type', 'title', 'url', 'text', 'summary', 'tags', 'created'];
  const rows = ITEMS.map((i) => cols.map((c) => {
    let v = i[c]; if (Array.isArray(v)) v = v.join('|');
    if (c === 'created') v = new Date(i.created).toISOString();
    return `"${String(v ?? '').replace(/"/g, '""')}"`;
  }).join(','));
  download('mind-export.csv', new Blob([[cols.join(','), ...rows].join('\n')], { type: 'text/csv' }));
}
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
async function importJSON(file) {
  try {
    const arr = JSON.parse(await file.text());
    for (const it of arr) { delete it.blob; await db.putItem(it); }
    ITEMS = await db.allItems(); refresh(); toast(`Imported ${arr.length} items`);
  } catch (e) { toast('Import failed'); }
}

/* ---------------- Events ---------------- */
function wire() {
  // search
  $('#search').addEventListener('input', (e) => { query = e.target.value; refresh(); });
  $('#search').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.shiftKey) askMind(); });
  $('#askBtn').addEventListener('click', askMind);

  // capture
  $('#saveQuick').addEventListener('click', () => { quickSave($('#pastebar').value); $('#pastebar').value = ''; });
  $('#pastebar').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { quickSave($('#pastebar').value); $('#pastebar').value = ''; }
  });
  $('#newNote').addEventListener('click', () => { $('#pastebar').focus(); });
  $('#newImage').addEventListener('click', () => $('#fileInput').click());
  $('#newVoice').addEventListener('click', toggleVoice);
  $('#fileInput').addEventListener('change', (e) => {
    [...e.target.files].forEach(saveImageFile); e.target.value = '';
  });

  // grid + serendipity click
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card && card.dataset.id) openDetail(card.dataset.id);
  });

  // rails
  $('#spaceList').addEventListener('click', railFilter);
  document.querySelector('.rail .spaces').addEventListener('click', railFilter);
  $('#typeList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-type]'); if (!b) return;
    filters.type = filters.type === b.dataset.type ? null : b.dataset.type; refresh();
  });
  $('#tagList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tag]'); if (!b) return;
    filters.tag = filters.tag === b.dataset.tag ? null : b.dataset.tag; refresh();
  });
  $('#colorList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]'); if (!b) return;
    filters.color = filters.color === b.dataset.color ? null : b.dataset.color; refresh();
  });
  $('#addSpace').addEventListener('click', async () => {
    const name = prompt('New space name'); if (!name) return;
    // spaces are created by assigning; make an empty marker by tagging nothing.
    toast(`Add items to "${name}" from their detail view`); // simple v1
  });

  // settings
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#brandBtn').addEventListener('click', () => toast('mind — your private place to save everything'));
  document.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeSheets));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheets(); });

  $('#exportBtn').addEventListener('click', exportJSON);
  $('#syncBtn').addEventListener('click', openSettings);
  $('#exportJson').addEventListener('click', exportJSON);
  $('#exportCsv').addEventListener('click', exportCSV);
  $('#importBtn').addEventListener('click', () => $('#importInput').click());
  $('#importInput').addEventListener('change', (e) => { if (e.target.files[0]) importJSON(e.target.files[0]); });
  $('#fbConnect').addEventListener('click', connectFirebase);

  // drag & drop anywhere
  const app = $('#app');
  ['dragover', 'dragenter'].forEach((ev) => app.addEventListener(ev, (e) => {
    e.preventDefault(); app.classList.add('dragging');
  }));
  ['dragleave', 'drop'].forEach((ev) => app.addEventListener(ev, (e) => {
    e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget) return; app.classList.remove('dragging');
  }));
  app.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files || [])];
    files.filter((f) => /image|pdf/.test(f.type)).forEach(saveImageFile);
    const text = e.dataTransfer?.getData('text');
    if (text && !files.length) quickSave(text);
  });

  // global paste
  window.addEventListener('paste', (e) => {
    if (document.activeElement && ['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
    const file = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image'));
    if (file) { saveImageFile(file.getAsFile()); return; }
    const text = e.clipboardData?.getData('text');
    if (text) quickSave(text);
  });
}

function railFilter(e) {
  const b = e.target.closest('[data-space]'); if (!b) return;
  filters = { space: b.dataset.space, type: null, color: null, tag: null };
  query = ''; $('#search').value = ''; refresh();
}

/* ---------------- Settings ---------------- */
function openSettings() {
  $('#aiKey').value = ai.getKey();
  $('#aiAuto').checked = localStorage.getItem('mind.aiAuto') === '1';
  const cfg = fb.getConfig();
  $('#fbConfig').value = cfg ? JSON.stringify(cfg, null, 2) : '';
  $('#fbStatus').textContent = fb.isEnabled() ? 'Connected.' : '';
  $('#settings').classList.remove('hidden');
}
function bindSettings() {
  $('#aiKey').addEventListener('change', (e) => { ai.setKey(e.target.value.trim()); toast('AI key saved'); });
  $('#aiAuto').addEventListener('change', (e) => localStorage.setItem('mind.aiAuto', e.target.checked ? '1' : '0'));
}
async function connectFirebase() {
  const raw = $('#fbConfig').value.trim();
  if (!raw) { toast('Paste your Firebase config'); return; }
  try { fb.saveConfig(JSON.parse(raw)); } catch { toast('Config is not valid JSON'); return; }
  if (!_fbInited) { await fb.init(handleAuth); _fbInited = true; }
  fb.signIn((s) => { $('#fbStatus').textContent = s; });
}

/* ---------------- PWA ---------------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

wire();
bindSettings();
load();
