# mind — your private place to save everything

A local-first, installable PWA clone of the "save everything, find it by association" idea.
Capture anything with one tap; retrieve it by keyword, colour, date, type, or tag. No folders.
Optional AI (your own key) and optional cross-device sync (your own Firebase). Nothing leaves
your browser unless you turn those on.

Built to run straight off **GitHub Pages** — no build step, no bundler, plain ES modules.

---

## Quick start (local)

Because it uses ES modules and a service worker, open it over HTTP, not `file://`:

```bash
cd mind
python3 -m http.server 8080
# visit http://localhost:8080
```

## Deploy to GitHub Pages

1. Create a repo (e.g. `mind`) and push these files to `main`.
2. Repo → **Settings → Pages** → Source: `Deploy from a branch` → `main` / `root`.
3. Open `https://<your-user>.github.io/mind/`. Install it from the browser menu
   ("Add to Home Screen" on iPad/iPhone).

All paths are relative, so it works from a project subpath.

---

## What works with zero setup (offline)

- **Save anything** — paste a link, write a note, drop an image or PDF, quote text, record a voice note.
  Drag-and-drop and clipboard paste work anywhere in the window.
- **Storage** — everything lives in **IndexedDB** (images/audio stored as blobs).
- **Colour search** — dominant colours are extracted from every image on save, so "find the orange one" works.
- **OCR** — text inside screenshots is read on-device via Tesseract.js and becomes searchable.
- **Voice notes** — recorded audio + a best-effort on-device transcript (Web Speech API, where supported).
- **Associative search** — one bar handles keywords, colours ("blue"), types ("pdf"), years ("2026"), months ("august").
- **Rails** — filter by Space, Type, Colour, Tag.
- **Serendipity** — resurfaces older saves so nothing rots.
- **Reader view**, favourites, inline tag editing.
- **Export / import** — JSON and CSV.
- **Installable + offline** — service worker caches the app shell.

## Optional: AI (bring your own key)

Settings → paste an **Anthropic API key**. It's stored only in this browser (localStorage).
Enables: auto-tagging + one-line summaries on save, per-item "Auto-tag & summarise", and
**Ask your mind** (Shift+Enter in the search bar, or the `ask` button) — natural-language
questions answered from your saves.

> The key stays client-side and calls the API directly from the browser. Fine for personal use;
> for a shared deployment, put a tiny serverless proxy in front instead of exposing a key.

## Optional: Sync (bring your own Firebase)

Settings → paste your Firebase web config (JSON). Uses anonymous auth + Firestore to sync
**item metadata** across devices. (Image/audio blobs stay local by default to respect the free
tier — wire Firebase Storage later if you want full blob sync.)

Firestore rule suggestion (per-user isolation):

```
match /users/{uid}/items/{doc} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

---

## Honest coverage vs. the original

**~90%** of the core experience. Present: capture-everything, masonry grid, tags/spaces,
keyword/colour/date/type search, OCR, reader mode, serendipity, AI tagging/summaries/ask, sync,
export, PWA install.

The last ~10% is *reach and polish*, not core function:
- Browser extension + true iOS share-sheet + email-to-save (frictionless capture from anywhere) — separate pieces.
- Proper end-to-end encryption.
- Years of layout/animation refinement and rich link/product-card enrichment.
  (Client-side link previews are limited by CORS; links save with hostname + your notes/AI tags.)

---

## Structure

```
index.html            app shell
css/style.css         all styling
js/app.js             wiring: capture, search, filters, voice, sync, PWA
js/db.js              IndexedDB
js/ui.js              card + rail + detail rendering
js/search.js          associative query engine
js/color.js           dominant-colour extraction
js/ocr.js             Tesseract.js loader
js/ai.js              Anthropic API (your key)
js/firebase.js        optional sync (your project)
sw.js                 offline service worker
manifest.webmanifest  PWA manifest
icons/                app icons
```

Personal project. Use it however you like.
