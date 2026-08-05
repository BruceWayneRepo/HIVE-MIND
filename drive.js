// File sync via the user's OWN Google Drive (free, no Firebase Storage / Blaze).
// Uses the Google OAuth access token obtained during Firebase Google sign-in
// (with the drive.file scope). Blobs (images, PDFs, audio) are uploaded to a
// "mind-app" folder in the user's Drive; the returned file id is stored on the
// item and synced via Firestore, so any device can download the file on demand.
//
// Scope is drive.file — the least-privilege Drive scope: the app can ONLY see
// and touch files it created, never the rest of your Drive.

let accessToken = null;
let folderId = null;

export function setToken(t) {
  accessToken = t || null;
  if (t) sessionStorage.setItem('mind.driveToken', t);
  else sessionStorage.removeItem('mind.driveToken');
}
export function getToken() { return accessToken || sessionStorage.getItem('mind.driveToken'); }
export function hasToken() { return !!getToken(); }

async function api(url, opts = {}) {
  const token = getToken();
  if (!token) throw new Error('No Drive access — sign in with Google again.');
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, ...(opts.headers || {}) },
  });
  if (res.status === 401) { setToken(null); throw new Error('Drive session expired — reconnect.'); }
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
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'mind-app', mimeType: 'application/vnd.google-apps.folder' }),
  });
  const cj = await cr.json();
  folderId = cj.id;
  return folderId;
}

// Upload a blob; returns the Drive file id. Uses multipart/related (the format
// Drive's uploadType=multipart requires) built as a Blob so binary is preserved.
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
    method: 'POST',
    headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
    body,
  });
  const j = await r.json();
  return j.id;
}

export async function downloadBlob(fileId) {
  const r = await api('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media');
  return await r.blob();
}
