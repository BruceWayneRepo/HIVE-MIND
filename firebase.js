// Optional cross-device sync using the user's OWN Firebase project.
// Paste config in Settings. Uses anonymous auth + Firestore. Metadata only by
// default (blobs stay local) to keep it within free-tier limits; a full-blob
// sync would need Firebase Storage which the user can wire later.

let app = null, db = null, auth = null, uid = null, enabled = false;

export function isEnabled() { return enabled; }
export function getConfig() {
  const raw = localStorage.getItem('mind.fbConfig');
  try { return raw ? JSON.parse(raw) : null; } catch { return null; }
}
export function saveConfig(obj) { localStorage.setItem('mind.fbConfig', JSON.stringify(obj)); }

async function load(url) {
  return import(/* @vite-ignore */ url);
}

export async function connect(onStatus = () => {}) {
  const cfg = getConfig();
  if (!cfg) { onStatus('No config — running locally.'); return false; }
  try {
    const appMod = await load('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
    const authMod = await load('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
    const fsMod = await load('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    app = appMod.initializeApp(cfg);
    auth = authMod.getAuth(app);
    db = fsMod.getFirestore(app);
    const cred = await authMod.signInAnonymously(auth);
    uid = cred.user.uid;
    enabled = true;
    window.__fs = fsMod; // stash module for push/pull
    onStatus('Connected. Syncing metadata.');
    return true;
  } catch (e) {
    onStatus('Connection failed: ' + e.message);
    enabled = false;
    return false;
  }
}

export async function push(item) {
  if (!enabled) return;
  const fs = window.__fs;
  const { blob, ...meta } = item; // never push raw blob field
  const ref = fs.doc(db, 'users', uid, 'items', item.id);
  await fs.setDoc(ref, meta, { merge: true });
}

export async function pushDelete(id) {
  if (!enabled) return;
  const fs = window.__fs;
  await fs.deleteDoc(fs.doc(db, 'users', uid, 'items', id));
}

export async function pull() {
  if (!enabled) return [];
  const fs = window.__fs;
  const snap = await fs.getDocs(fs.collection(db, 'users', uid, 'items'));
  return snap.docs.map((d) => d.data());
}
