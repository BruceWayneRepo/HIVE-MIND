// Extract a small palette of dominant colours from an image, and map to named buckets
// so the colour-search rail ("find the orange one") works with zero AI.

const NAMED = [
  ['red',     [200, 55, 55]],
  ['orange',  [220, 130, 50]],
  ['yellow',  [225, 200, 70]],
  ['green',   [90, 175, 95]],
  ['teal',    [70, 180, 175]],
  ['blue',    [70, 120, 220]],
  ['purple',  [150, 90, 200]],
  ['pink',    [225, 120, 175]],
  ['brown',   [120, 85, 55]],
  ['black',   [25, 25, 28]],
  ['white',   [235, 235, 235]],
  ['grey',    [130, 130, 135]],
];

function nearestName(r, g, b) {
  let best = 'grey', bd = Infinity;
  for (const [name, [nr, ng, nb]] of NAMED) {
    const d = (r - nr) ** 2 + (g - ng) ** 2 + (b - nb) ** 2;
    if (d < bd) { bd = d; best = name; }
  }
  return best;
}

export function extractColors(imgEl, max = 4) {
  try {
    const c = document.createElement('canvas');
    const scale = 60 / Math.max(imgEl.naturalWidth || imgEl.width, 1);
    c.width = Math.max(1, Math.round((imgEl.naturalWidth || imgEl.width) * scale));
    c.height = Math.max(1, Math.round((imgEl.naturalHeight || imgEl.height) * scale));
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(imgEl, 0, 0, c.width, c.height);
    const data = ctx.getImageData(0, 0, c.width, c.height).data;

    const buckets = new Map(); // quantized rgb -> {count,r,g,b}
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 125) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
      const cur = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      cur.count++; cur.r += r; cur.g += g; cur.b += b;
      buckets.set(key, cur);
    }
    const sorted = [...buckets.values()].sort((a, b) => b.count - a.count).slice(0, max);
    const swatches = [], names = new Set();
    for (const s of sorted) {
      const r = Math.round(s.r / s.count), g = Math.round(s.g / s.count), b = Math.round(s.b / s.count);
      swatches.push(`rgb(${r},${g},${b})`);
      names.add(nearestName(r, g, b));
    }
    return { swatches, names: [...names] };
  } catch (e) {
    return { swatches: [], names: [] };
  }
}

// helper: load a blob URL into an <img> and extract
export function colorsFromURL(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(extractColors(img));
    img.onerror = () => resolve({ swatches: [], names: [] });
    img.src = url;
  });
}
