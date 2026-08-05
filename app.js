import * as db from './db.js';
import { colorsFromURL } from './color.js';
import { ocrImage } from './ocr.js';
import * as ai from './ai.js';
import * as fb from './firebase.js';
import * as drive from './drive.js';
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
function updateSyncUI(user) {
  const connect = document.querySelector('#fbConnect');
  const signed = document.querySelector('#fbSignedIn');
  const email = document.querySelector('#fbEmail');
  if (user) {
    if (connect) connect.classList.add('hidden');
    if (signed) signed.classList.remove('hidden');
    if (email) email.textContent = user.email || 'Signed in';
  } else {
    if (connect) connect.classList.remove('hidden');
    if (signed) signed.classList.add('hidden');
  }
}
function handleAuth(user) {
  const st = document.querySelector('#fbStatus');
  updateSyncUI(user);
  if (user) {
    if (st) st.textContent = 'Synced as ' + (user.email || 'account');
    const t = fb.getDriveToken();
    if (t) drive.setToken(t);
    mergeRemote().then(() => {
      for (const i of ITEMS) fb.push(i).catch(() => {});
      uploadPendingFiles();
      // live updates from other devices
      fb.subscribe(async (remote) => {
        await applyRemoteItems(remote);
      });
    });
  } else {
    if (st) st.textContent = 'Signed out — saving locally.';
    fb.unsubscribe && fb.unsubscribe();
  }
}
// Upload any files that have a local blob but no Drive id yet.
async function uploadPendingFiles() {
  if (!drive.hasToken()) return;
  for (const item of ITEMS) {
    if (item.blobId && !item.driveId) {
      try {
        const blob = await db.getBlob(item.blobId);
        if (!blob) continue;
        const ext = item.type === 'image' ? 'img' : item.type === 'pdf' ? 'pdf' : 'audio';
        const id = await drive.uploadBlob(blob, `${item.id}.${ext}`);
        item.driveId = id; item.updated = now();
        await db.putItem(item); fb.push(item).catch(() => {});
      } catch (e) { /* token issue or offline — try later */ break; }
    }
  }
}
// Ensure a file item's blob exists locally; if not, pull it from Drive.
async function ensureBlob(item) {
  if (!item.blobId) {
    const existing = await db.getBlob(item.id);
    if (existing) { item.blobId = item.id; return true; }
  } else {
    const existing = await db.getBlob(item.blobId);
    if (existing) return true;
  }
  if (item.driveId && drive.hasToken()) {
    try {
      const blob = await drive.downloadBlob(item.driveId);
      await db.putBlob(item.id, blob);
      item.blobId = item.id;
      await db.putItem(item);
      return true;
    } catch (e) { return false; }
  }
  return false;
}
async function applyRemoteItems(remote) {
  let changed = 0;
  const map = new Map(ITEMS.map((i) => [i.id, i]));
  for (const r of remote) {
    const local = map.get(r.id);
    if (!local || (r.updated || 0) > (local.updated || 0)) { await db.putItem(r); changed++; }
  }
  if (changed) { ITEMS = await db.allItems(); refresh(); }
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
  // upload the file to the user's Drive so other devices can pull it
  if (blob && drive.hasToken()) {
    (async () => {
      try {
        const ext = item.type === 'image' ? 'img' : item.type === 'pdf' ? 'pdf' : 'audio';
        const driveId = await drive.uploadBlob(blob, `${item.id}.${ext}`);
        item.driveId = driveId; item.updated = now();
        await db.putItem(item); fb.push(item).catch(() => {});
      } catch (e) { /* offline or token expired — uploadPendingFiles will retry next sign-in */ }
    })();
  }
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
  if (type === 'link') fetchLinkPreview(saved);
  maybeEnrich(saved);
}

// Rich link previews via microlink's free API (CORS-friendly). Fills title,
// description and a preview image so link cards stop showing a bare hostname.
async function fetchLinkPreview(item) {
  try {
    const res = await fetch('https://api.microlink.io/?url=' + encodeURIComponent(item.url));
    if (!res.ok) return;
    const j = await res.json();
    const d = (j && j.data) || {};
    if (d.title) item.title = d.title;
    if (d.description) item.summary = d.description;
    if (d.image && d.image.url) item.previewImage = d.image.url;
    if (d.logo && d.logo.url) item.favicon = d.logo.url;
    item.updated = now();
    await db.putItem(item); ITEMS = await db.allItems(); refresh();
    fb.push(item).catch(() => {});
  } catch (e) { /* offline or blocked — keep the hostname fallback */ }
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
    // PDF: pull text so search reaches inside the document
    extractPdfText(saved);
    maybeEnrich(saved);
  }
}

async function extractPdfText(item) {
  try {
    const url = await db.blobURL(item.blobId);
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument(url).promise;
    const max = Math.min(pdf.numPages, 30);
    let text = '';
    for (let n = 1; n <= max; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      text += content.items.map((i) => i.str).join(' ') + '\n';
    }
    if (text.trim()) {
      item.ocr = text.trim();
      item.updated = now();
      await db.putItem(item); ITEMS = await db.allItems(); refresh();
      fb.push(item).catch(() => {});
    }
  } catch (e) { /* scanned PDF or offline — search still works on the title */ }
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
  // if this is a file synced from another device, pull it from Drive first
  if ((item.type === 'image' || item.type === 'pdf' || item.type === 'voice') && item.driveId) {
    const hasLocal = item.blobId && await db.getBlob(item.blobId);
    if (!hasLocal) {
      $('#sheet').classList.remove('hidden');
      panel.innerHTML = '<div class="pdf-loading">Fetching file from your Drive…</div>';
      const ok = await ensureBlob(item);
      if (!ok) { panel.innerHTML = '<div class="pdf-loading">Couldn\'t fetch the file. Open Settings → reconnect Google, then retry.</div>'; return; }
    }
  }
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
  // image zoom
  const zImg = panel.querySelector('#zoomImg');
  if (zImg) {
    let scale = 1;
    const apply = () => { zImg.style.transform = `scale(${scale})`; };
    panel.querySelectorAll('[data-zoom]').forEach((b) => b.addEventListener('click', () => {
      const z = b.dataset.zoom;
      if (z === 'in') scale = Math.min(5, scale + 0.25);
      else if (z === 'out') scale = Math.max(0.5, scale - 0.25);
      else scale = 1;
      apply();
    }));
    // double-tap to toggle zoom
    let lastTap = 0;
    zImg.addEventListener('click', () => {
      const t = Date.now();
      if (t - lastTap < 300) { scale = scale > 1 ? 1 : 2; apply(); }
      lastTap = t;
    });
  }
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
let mediaRec = null, chunks = [], recognizer = null, liveText = '', recMime = '';
function pickAudioMime() {
  // iOS Safari can't play webm — prefer mp4/aac; fall back sensibly.
  const prefs = ['audio/mp4', 'audio/mp4;codecs=mp4a.40.2', 'audio/aac', 'audio/webm;codecs=opus', 'audio/webm'];
  for (const m of prefs) { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; }
  return '';
}
async function toggleVoice() {
  if (mediaRec && mediaRec.state === 'recording') {
    mediaRec.stop();
    if (recognizer) { try { recognizer.stop(); } catch {} }
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = []; liveText = '';
    recMime = pickAudioMime();
    mediaRec = recMime ? new MediaRecorder(stream, { mimeType: recMime }) : new MediaRecorder(stream);
    mediaRec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    mediaRec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const type = (mediaRec.mimeType || recMime || 'audio/mp4').split(';')[0];
      const blob = new Blob(chunks, { type });
      const item = { type: 'voice', title: 'Voice note', text: liveText.trim(), audioType: type };
      const saved = await saveItem(item, blob);
      toast(liveText.trim() ? 'Voice note + transcript saved' : 'Voice note saved');
      maybeEnrich(saved);
    };
    // live transcription via Web Speech API (best-effort; strong on Chrome, limited on iOS Safari)
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
      recognizer = new SR();
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.maxAlternatives = 1;
      recognizer.lang = navigator.language || 'en-US';
      let finalText = '';
      recognizer.onresult = (e) => {
        let interim = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const t = e.results[i][0].transcript;
          if (e.results[i].isFinal) finalText += t + ' '; else interim += t;
        }
        liveText = (finalText + interim).trim();
      };
      recognizer.onend = () => { if (mediaRec && mediaRec.state === 'recording') { try { recognizer.start(); } catch {} } };
      try { recognizer.start(); } catch {}
    }
    mediaRec.start();
    toast('Recording… tap ◉ again to stop');
    $('#newVoice').style.color = 'var(--pdf)';
    mediaRec.addEventListener('stop', () => { $('#newVoice').style.color = ''; }, { once: true });
  } catch (e) { toast('Mic unavailable — allow microphone access'); }
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
  // mobile filter drawer
  const rail = document.querySelector('.rail');
  const scrim = $('#railScrim');
  const openRail = () => { rail.classList.add('open'); scrim.classList.add('show'); };
  const closeRail = () => { rail.classList.remove('open'); scrim.classList.remove('show'); };
  $('#menuBtn').addEventListener('click', openRail);
  scrim.addEventListener('click', closeRail);
  rail.addEventListener('click', (e) => { if (e.target.closest('[data-space],[data-type],[data-tag],[data-color]')) closeRail(); });
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
  $('#fbConfig').value = ''; // baked-in config; box is only an override
  const signedIn = fb.isEnabled();
  $('#fbStatus').textContent = signedIn ? ('Synced as ' + (fb.getEmail() || 'account')) : '';
  updateSyncUI(signedIn ? { email: fb.getEmail() } : null);
  $('#settings').classList.remove('hidden');
}
function bindSettings() {
  $('#aiKey').addEventListener('change', (e) => { ai.setKey(e.target.value.trim()); toast('AI key saved'); });
  $('#aiAuto').addEventListener('change', (e) => localStorage.setItem('mind.aiAuto', e.target.checked ? '1' : '0'));
  $('#fbSignOut').addEventListener('click', async () => {
    await fb.signOutUser();
    updateSyncUI(null);
    $('#fbStatus').textContent = 'Signed out — saving locally.';
    toast('Signed out');
  });
}
async function connectFirebase() {
  const raw = $('#fbConfig').value.trim();
  if (raw) { try { fb.saveConfig(JSON.parse(raw)); } catch { toast('Config is not valid JSON'); return; } }
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
