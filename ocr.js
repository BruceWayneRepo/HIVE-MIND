// Lazy-load Tesseract.js only when an image is saved, so text inside screenshots
// becomes searchable — no server, no AI key required.
let _tessPromise = null;

function loadTesseract() {
  if (_tessPromise) return _tessPromise;
  _tessPromise = new Promise((resolve, reject) => {
    if (window.Tesseract) return resolve(window.Tesseract);
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => reject(new Error('Could not load OCR engine (offline?)'));
    document.head.appendChild(s);
  });
  return _tessPromise;
}

export async function ocrImage(url, onProgress) {
  try {
    const Tesseract = await loadTesseract();
    const { data } = await Tesseract.recognize(url, 'eng', {
      logger: (m) => { if (onProgress && m.status === 'recognizing text') onProgress(m.progress); },
    });
    return (data.text || '').trim();
  } catch (e) {
    console.warn('OCR failed:', e.message);
    return '';
  }
}
