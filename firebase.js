// Cross-device sync using your OWN Firebase project, with GOOGLE sign-in so the
// same account links every device (iPad <-> phone). Metadata syncs; image/audio
// blobs stay local for now. Data lives under users/{uid}/items — separate from
// the Habit Wheel's data in the same project.

let app = null, db = null, auth = null, authMod = null, fsMod = null;
let uid = null, enabled = false, inited = false, onAuthCb = null, userEmail = '', driveToken = '';

export function getEmail() { return userEmail; }
export function getDriveToken() { return driveToken; }

// Baked-in config so you never have to paste it. Same project as the Habit Wheel.
const DEFAULT_CONFIG = {
  apiKey: 'AIzaSyC8QeobLzF28etRiPZTpD6moCC6k1ITbXQ',
  authDomain: 'project-limitless-cc89c.firebaseapp.com',
  projectId: 'project-limitless-cc89c',
  appId: '1:579632921168:web:df44e846c7b6f393aa6f55',
};

export function isEnabled() { return enabled; }
export function getConfig() {
  const raw = localStorage.getItem('mind.fbConfig');
  try { return raw ? JSON.parse(raw) : DEFAULT_CONFIG; } catch { return DEFAULT_CONFIG; }
}
export function saveConfig(obj) { localStorage.setItem('mind.fbConfig', JSON.stringify(obj)); }

async function load(url) { return import(/* @vite-ignore */ url); }

// Initialise once. Attaches the auth listener and resumes any saved session
// (so if you signed in before, it reconnects silently on load). Does NOT force
// a sign-in prompt — that only happens from signIn() on a button tap.
export async function init(onAuth = () => {}) {
  onAuthCb = onAuth;
  if (inited) return;
  const cfg = getConfig();
  if (!cfg) return;
  try {
    const appMod = await load('https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js');
    authMod = await load('https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js');
    fsMod = await load('https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js');
    app = appMod.initializeApp(cfg);
    auth = authMod.getAuth(app);
    db = fsMod.getFirestore(app);
    inited = true;
    await authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {});
    // If a redirect sign-in just completed (mobile fallback), pick it up.
    authMod.getRedirectResult(auth).then((result) => {
      if (result) {
        const cred = authMod.GoogleAuthProvider.credentialFromResult(result);
        if (cred && cred.accessToken) driveToken = cred.accessToken;
      }
    }).catch(() => {});
    authMod.onAuthStateChanged(auth, (user) => {
      enabled = !!user;
      uid = user ? user.uid : null;
      userEmail = user ? (user.email || '') : '';
      if (onAuthCb) onAuthCb(user);
    });
  } catch (e) {
    console.warn('Firebase init failed:', e.message);
  }
}

// Interactive Google sign-in. Popup first; on mobile where popups are blocked,
// fall back to full-page redirect.
export async function signIn(onStatus = () => {}) {
  if (!inited) { onStatus('Not ready — check your config.'); return; }
  onStatus('Opening Google sign-in…');
  try {
    const provider = new authMod.GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/drive.file');
    const result = await authMod.signInWithPopup(auth, provider);
    const cred = authMod.GoogleAuthProvider.credentialFromResult(result);
    driveToken = (cred && cred.accessToken) || '';
    onStatus('Signed in. Syncing…');
  } catch (e) {
    const code = (e && e.code) || '';
    if (code.includes('popup-blocked') || code.includes('popup-closed') || code.includes('cancelled')) {
      try {
        const provider = new authMod.GoogleAuthProvider();
        provider.addScope('https://www.googleapis.com/auth/drive.file');
        await authMod.signInWithRedirect(auth, provider);
      } catch (e2) { onStatus('Sign-in failed: ' + e2.message); }
    } else if (code.includes('unauthorized-domain')) {
      onStatus('Add this site to Firebase → Authentication → Settings → Authorized domains.');
    } else {
      onStatus('Sign-in failed: ' + (e.message || code));
    }
  }
}

export async function signOutUser() {
  if (auth) { try { await authMod.signOut(auth); } catch {} }
  enabled = false; uid = null;
}

export async function push(item) {
  if (!enabled || !uid) return;
  const { blob, ...meta } = item; // never push the raw blob field
  const ref = fsMod.doc(db, 'users', uid, 'items', item.id);
  await fsMod.setDoc(ref, meta, { merge: true });
}

export async function pushDelete(id) {
  if (!enabled || !uid) return;
  await fsMod.deleteDoc(fsMod.doc(db, 'users', uid, 'items', id));
}

export async function pull() {
  if (!enabled || !uid) return [];
  const snap = await fsMod.getDocs(fsMod.collection(db, 'users', uid, 'items'));
  return snap.docs.map((d) => d.data());
}

// Realtime: fires cb(items[]) whenever the cloud copy changes (other device edits).
let _unsub = null;
export function subscribe(cb) {
  if (!enabled || !uid) return;
  if (_unsub) { _unsub(); _unsub = null; }
  _unsub = fsMod.onSnapshot(fsMod.collection(db, 'users', uid, 'items'), (snap) => {
    cb(snap.docs.map((d) => d.data()));
  }, () => {});
}
export function unsubscribe() { if (_unsub) { _unsub(); _unsub = null; } }
