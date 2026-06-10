// Embeddings — ollama-if-present, else honestly absent.
//
// Zero-npm-dep rule holds: ollama is an OPTIONAL local service (default
// :11434), probed at call time. No keys, nothing leaves the machine. When it's
// absent, semantic search reports unavailable and lexical+graph carry the day —
// the vector tier is *earned*, not faked.

const BASE = process.env.OLLAMA_HOST || 'http://localhost:11434';
// small, common embedding models — first one present wins
const PREFERRED = ['nomic-embed-text', 'mxbai-embed-large', 'all-minilm'];

async function get(path, opts = {}) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(opts.timeout ?? 1500), ...opts });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

/** Probe ollama + pick an embedding model. Never throws. */
export async function detectEmbedder() {
  try {
    const tags = await get('/api/tags');
    const names = (tags.models ?? []).map((m) => String(m.name));
    const model = PREFERRED.map((p) => names.find((n) => n.startsWith(p))).find(Boolean);
    if (!model) return { available: false, reason: `ollama up, no embedding model (pull one of: ${PREFERRED.join(', ')})` };
    return { available: true, model };
  } catch {
    return { available: false, reason: 'ollama not reachable (optional — semantic search needs it)' };
  }
}

/** Embed one text → Float array. Throws on failure (callers decide policy). */
export async function embed(model, text) {
  const out = await get('/api/embeddings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, prompt: text }),
    timeout: 30_000,
  });
  if (!Array.isArray(out.embedding)) throw new Error('no embedding in response');
  return out.embedding;
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
