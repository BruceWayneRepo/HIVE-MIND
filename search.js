// Associative search over the local archive: keyword, colour, date, type, tag.
// Everything runs offline; the AI "ask" path lives in ai.js.

const COLOR_WORDS = ['red','orange','yellow','green','teal','blue','purple','pink','brown','black','white','grey','gray'];
const TYPE_WORDS  = ['note','link','image','pdf','voice','quote','article'];
const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

export function parseQuery(q) {
  const out = { text: [], colors: [], types: [], year: null, month: null };
  for (const raw of q.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (COLOR_WORDS.includes(raw)) out.colors.push(raw === 'gray' ? 'grey' : raw);
    else if (TYPE_WORDS.includes(raw)) out.types.push(raw === 'article' ? 'link' : raw);
    else if (/^(19|20)\d{2}$/.test(raw)) out.year = +raw;
    else if (MONTHS.includes(raw)) out.month = MONTHS.indexOf(raw);
    else out.text.push(raw);
  }
  return out;
}

function haystack(item) {
  return [item.title, item.text, item.summary, item.url, item.ocr, (item.tags || []).join(' ')]
    .filter(Boolean).join(' ').toLowerCase();
}

export function runSearch(items, q, filters = {}) {
  let list = items;

  // rail filters
  if (filters.type) list = list.filter((i) => i.type === filters.type);
  if (filters.color) list = list.filter((i) => (i.colorNames || []).includes(filters.color));
  if (filters.tag) list = list.filter((i) => (i.tags || []).includes(filters.tag));
  if (filters.space && !filters.space.startsWith('__')) list = list.filter((i) => (i.spaces || []).includes(filters.space));
  if (filters.space === '__unread') list = list.filter((i) => !i.read);

  // free text query
  if (q && q.trim()) {
    const p = parseQuery(q);
    if (p.colors.length) list = list.filter((i) => p.colors.some((c) => (i.colorNames || []).includes(c)));
    if (p.types.length)  list = list.filter((i) => p.types.includes(i.type));
    if (p.year != null)  list = list.filter((i) => new Date(i.created).getFullYear() === p.year);
    if (p.month != null) list = list.filter((i) => new Date(i.created).getMonth() === p.month);
    if (p.text.length) {
      list = list.filter((i) => {
        const h = haystack(i);
        return p.text.every((t) => h.includes(t));
      });
    }
  }
  return list;
}

export function serendipity(items, n = 4) {
  const old = items.filter((i) => Date.now() - i.created > 3 * 24 * 3600 * 1000);
  const pool = old.length >= n ? old : items;
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

// build a compact index for AI ask
export function buildIndex(items) {
  return items.map((i) => ({
    id: i.id, type: i.type, title: i.title || '',
    snippet: (i.summary || i.text || i.ocr || i.url || '').slice(0, 200),
    tags: i.tags || [],
  }));
}
