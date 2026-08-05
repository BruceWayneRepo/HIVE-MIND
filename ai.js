// Anthropic API — paste-your-own-key. Key lives only in localStorage on this device.
// Uses the browser-direct access header. Powers auto-tagging, summaries, and
// natural-language "ask your mind" search. (Voice transcription is handled on-device
// via the Web Speech API in app.js, since the messages API doesn't take audio.)

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

export function hasKey() { return !!localStorage.getItem('mind.aiKey'); }
export function getKey() { return localStorage.getItem('mind.aiKey') || ''; }
export function setKey(k) { k ? localStorage.setItem('mind.aiKey', k) : localStorage.removeItem('mind.aiKey'); }

async function call(messages, { max = 1024, system } = {}) {
  const key = getKey();
  if (!key) throw new Error('No API key set');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: max, system, messages }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`AI error ${res.status}: ${t.slice(0, 160)}`);
  }
  const data = await res.json();
  return (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
}

function parseJSON(text) {
  const clean = text.replace(/```json|```/g, '').trim();
  try { return JSON.parse(clean); } catch { return null; }
}

// Auto-tag + summarise a single item. Returns {tags:[], summary:''}
export async function enrich(item) {
  const parts = [];
  const sys = 'You organise a personal "save everything" archive. Respond ONLY with JSON, no prose, no markdown fences.';
  let content = `Item type: ${item.type}\n`;
  if (item.title) content += `Title: ${item.title}\n`;
  if (item.url) content += `URL: ${item.url}\n`;
  if (item.text) content += `Text: ${item.text.slice(0, 4000)}\n`;
  if (item.ocr) content += `Text found in image: ${item.ocr.slice(0, 2000)}\n`;
  content += `\nReturn JSON: {"tags":["3-6 short lowercase tags"],"summary":"one plain sentence, max 25 words"}`;
  parts.push({ type: 'text', text: content });
  const out = await call([{ role: 'user', content: parts }], { system: sys, max: 400 });
  const j = parseJSON(out) || {};
  return { tags: Array.isArray(j.tags) ? j.tags.slice(0, 6) : [], summary: j.summary || '' };
}

// Reader-style summary for a long article/PDF text.
export async function summarise(text) {
  const out = await call(
    [{ role: 'user', content: `Summarise this in 2-3 sentences, plain and neutral:\n\n${text.slice(0, 8000)}` }],
    { max: 300 }
  );
  return out.trim();
}

// Ask-your-mind: given the archive index + a question, return {answer, ids:[]}
export async function askMind(question, index) {
  const sys = 'You are the search brain of a personal archive. Given the items and a question, answer briefly using only these items, and list the ids you drew from. Respond ONLY with JSON: {"answer":"...","ids":["..."]}';
  const compact = index.slice(0, 120).map((i) =>
    `[${i.id}] (${i.type}) ${i.title || ''} — ${(i.snippet || '').slice(0, 160)} ${i.tags?.length ? '#' + i.tags.join(' #') : ''}`
  ).join('\n');
  const out = await call(
    [{ role: 'user', content: `Items:\n${compact}\n\nQuestion: ${question}` }],
    { system: sys, max: 700 }
  );
  const j = parseJSON(out) || {};
  return { answer: j.answer || 'No clear answer from your saves.', ids: Array.isArray(j.ids) ? j.ids : [] };
}
