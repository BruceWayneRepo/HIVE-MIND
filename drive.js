// File sync via the user's OWN Google Drive, using Google Identity Services (GIS)
// token client. This fixes the core flaw: the OAuth access token is obtained and
// SILENTLY REFRESHED independently of Firebase Auth, and survives reloads — so
// files keep syncing instead of dying ~1h after sign-in.
//
// Requires a Google OAuth *Web* Client ID (created once in Google Cloud →
// Credentials, with your GitHub Pages origin allowed). Paste it in Settings.
// Scope is drive.file — the app only ever touches files it created.

let accessToken = sessionStorage.getItem('mind.driveTok') || null;
let tokenExp = +(sessionStorage.getItem('mind.driveExp') || 0);
let tokenClient = null, gisReady = null, folderId = null;

export function getClientId() { return localStorage.getItem('mind.gisClientId') || ''; }
export function setClientId(id) { id ? localStorage.setItem('mind.gisClientId', id) : localStorage.removeItem('mind.gisClientId'); tokenClient = null; }
export function hasClientId() { return !!getClientId(); }

// legacy seed (Firebase-provided token) — used only as a fallback if no client id
export function setToken(t) {
  if (!t) return;
  accessToken = t; tokenExp = Date.now() + 55 * 60000;
  sessionStorage.setItem('mind.driveTok', t);
  sessionStorage.setItem('mind.driveExp', String(tokenExp));
}
export function hasToken() { return !!accessToken && Date.now() < tokenExp - 60000; }

function loadGis() {
  if (gisReady) return gisReady;
  gisReady = new Promise((res, rej) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) return res();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = () => res();
    s.onerror = () => rej(new Error('Could not load Google sign-in'));
    document.head.appendChild(s);
  });
  return gisReady;
}

async function initClient() {
  const clientId = getClientId();
  if (!clientId) throw new Error('Add your Google Client ID in Settings → Sync ✎.');
  await loadGis();
  if (!tokenClient) {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: () => {},
    });
  }
  return tokenClient;
}

// Get a valid token; refresh silently (prompt:'') when possible, or prompt
// interactively (prompt:'consent') the first time / when asked.
export async function ensureToken(interactive = false) {
  if (!interactive && hasToken()) return accessToken;
  const client = await initClient();
  return new Promise((resolve, reject) => {
    client.callback = (resp) => {
      if (resp && resp.access_token) {
        accessToken = resp.access_token;
        tokenExp = Date.now() + ((resp.expires_in ? resp.expires_in : 3600) * 1000);
        sessionStorage.setItem('mind.driveTok', accessToken);
        sessionStorage.setItem('mind.driveExp', String(tokenExp));
        resolve(accessToken);
      } else { reject(new Error((resp && resp.error) || 'Drive authorisation failed')); }
    };
    try { client.requestAccessToken({ prompt: interactive ? 'consent' : '' }); }
    catch (e) { reject(e); }
  });
}

async function api(url, opts = {}) {
  let token = hasToken() ? accessToken : await ensureToken(false).catch(() => null);
  if (!token) throw new Error('Google not connected — open Settings and Connect.');
  const doFetch = (tk) => fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + tk, ...(opts.headers || {}) } });
  let res = await doFetch(token);
  if (res.status === 401) {
    accessToken = null; tokenExp = 0;
    token = await ensureToken(false).catch(() => null);
    if (token) res = await doFetch(token);
  }
  if (!res.ok) throw new Error('Drive error ' + res.status);
  return res;
}

async function ensureFolder() {
  if (folderId) return folderId;
  const q = encodeURIComponent("name='mind-app' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const r = await api('https://www.googleapis.com/drive/v3/files?q=' + q + '&fields=files(id,name)&spaces=drive');
  const j = await r.json();
  if (j.files && j.files.length) { folderId = j.files[0].id; return folderId; }
  const cr = await api('https://www.googleapis.com/drive/v3/files?fields=id', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'mind-app', mimeType: 'application/vnd.google-apps.folder' }),
  });
  folderId = (await cr.json()).id;
  return folderId;
}

export async function uploadBlob(blob, name) {
  const parent = await ensureFolder();
  const boundary = '----mind' + Date.now();
  const meta = { name, parents: [parent] };
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(meta),
    `\r\n--${boundary}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`,
    blob,
    `\r\n--${boundary}--`,
  ], { type: 'multipart/related; boundary=' + boundary });
  const r = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body,
  });
  return (await r.json()).id;
}

export async function downloadBlob(fileId) {
  const r = await api('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media');
  return await r.blob();
}
