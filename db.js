// Minimal IndexedDB layer. Stores items (metadata) and blobs (images/audio/pdf).
const DB_NAME = 'mind-db';
const VERSION = 1;

let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('items')) {
        const s = db.createObjectStore('items', { keyPath: 'id' });
        s.createIndex('created', 'created');
        s.createIndex('type', 'type');
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}

export async function putItem(item) {
  const s = await tx('items', 'readwrite');
  return new Promise((res, rej) => {
    const r = s.put(item);
    r.onsuccess = () => res(item);
    r.onerror = () => rej(r.error);
  });
}

export async function getItem(id) {
  const s = await tx('items');
  return new Promise((res, rej) => {
    const r = s.get(id);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function allItems() {
  const s = await tx('items');
  return new Promise((res, rej) => {
    const r = s.getAll();
    r.onsuccess = () => res((r.result || []).sort((a, b) => b.created - a.created));
    r.onerror = () => rej(r.error);
  });
}

export async function deleteItem(id) {
  const s = await tx('items', 'readwrite');
  await new Promise((res, rej) => { const r = s.delete(id); r.onsuccess = res; r.onerror = () => rej(r.error); });
  const b = await tx('blobs', 'readwrite');
  return new Promise((res) => { const r = b.delete(id); r.onsuccess = res; r.onerror = res; });
}

export async function putBlob(id, blob) {
  const s = await tx('blobs', 'readwrite');
  return new Promise((res, rej) => {
    const r = s.put({ id, blob });
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

export async function getBlob(id) {
  const s = await tx('blobs');
  return new Promise((res, rej) => {
    const r = s.get(id);
    r.onsuccess = () => res(r.result ? r.result.blob : null);
    r.onerror = () => rej(r.error);
  });
}

// object-URL cache so we don't leak
const urlCache = new Map();
export async function blobURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const blob = await getBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}
