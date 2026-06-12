// Knowledge CLI: `mns remember` (human-direct write — the human IS the gate),
// `mns recall` (one command, three search modes), `mns knowledge reindex|audit`.

import { paths } from '../store.mjs';
import { loadRegistry, validateItem } from '../knowledge/registry.mjs';
import { slugify, writeItem, readItem, allItems } from '../knowledge/items.mjs';
import { upsertItem, reindex, search, neighbors, indexPath, putVector, allVectors, unembedded } from '../knowledge/index.mjs';
import { detectEmbedder, embed, cosine } from '../knowledge/embed.mjs';

const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
const parsePair = (s) => {
  const i = String(s).indexOf('=');
  if (i < 1) throw new Error(`expected key=value, got: ${s}`);
  return [s.slice(0, i), s.slice(i + 1)];
};

/** Empty-result copy for recall: distinguish "no items" from "no match". */
export function recallEmptyMessage({ itemCount, query }) {
  if (!itemCount) return '(no knowledge yet — add facts with `zuzuu remember`)';
  return `(no matches for "${query}" — try other terms, or \`zuzuu knowledge reindex\`)`;
}

/** mns remember "text" [--type t] [--id slug] [--attr k=v]... [--rel type=target]... */
export function remember(args) {
  const text = args._.join(' ').trim();
  if (!text) {
    console.error('usage: zuzuu remember "the fact, in prose" [--type fact|entity|command|decision] [--attr k=v] [--rel type=target]');
    process.exit(1);
  }
  const mnsDir = paths().dir;
  const registry = loadRegistry(mnsDir);
  const item = {
    id: args.id || slugify(text),
    type: args.type || 'fact',
    created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    status: 'active',
    attributes: Object.fromEntries(asArray(args.attr).map(parsePair)),
    relations: asArray(args.rel).map((r) => {
      const [type, target] = parsePair(r);
      return { type, target };
    }),
    provenance: [{ session: 'manual', ref: 'mns remember' }],
    body: text,
  };
  if (readItem(mnsDir, item.id)) {
    console.error(`item '${item.id}' already exists — pick --id, or evolve it via the proposal flow`);
    process.exit(1);
  }
  const v = validateItem(registry, item);
  const unknown = [...v.unknownKeys.attributes, ...v.unknownKeys.relations];
  if (!v.ok || unknown.length) {
    for (const e of v.errors) console.error(`  ✗ ${e}`);
    for (const k of unknown) console.error(`  ✗ unregistered key: ${k} (register it in agent/knowledge/registry/ first)`);
    process.exit(1);
  }
  const path = writeItem(mnsDir, item);
  upsertItem(mnsDir, item);
  console.log(`remembered → ${path}`);
  console.log(`  id: ${item.id}  type: ${item.type}${item.relations.length ? `  relations: ${item.relations.length}` : ''}`);
}

/** mns recall "query" [--type t] [--attr k=v] [--related-to id [--depth n]] [--semantic] */
export async function recall(args) {
  const mnsDir = paths().dir;
  const query = args._.join(' ').trim();

  if (args['related-to']) {
    const rows = neighbors(mnsDir, args['related-to'], { relType: args.rel || null, depth: Number(args.depth || 1) });
    if (!rows.length) return console.log('(no related items)');
    for (const r of rows) console.log(`  ${r.node}  ←${r.via}→  (${r.hop} hop${r.hop > 1 ? 's' : ''})`);
    return;
  }

  if (args.semantic) {
    const e = await detectEmbedder();
    if (!e.available) {
      console.error(`semantic search unavailable: ${e.reason}`);
      process.exit(2);
    }
    const qv = await embed(e.model, query);
    const vecs = allVectors(mnsDir);
    if (!vecs.length) {
      console.error('no embedded items yet — run `zuzuu knowledge reindex` with ollama up');
      process.exit(2);
    }
    const ranked = vecs.map((v) => ({ item: v.item, sim: cosine(qv, v.vec) })).sort((a, b) => b.sim - a.sim).slice(0, Number(args.limit || 5));
    for (const r of ranked) {
      const it = readItem(mnsDir, r.item);
      console.log(`  ${r.sim.toFixed(3)}  ${r.item}  ${it ? '— ' + it.body.slice(0, 60) : ''}`);
    }
    return;
  }

  const rows = search(mnsDir, query, {
    type: args.type || null,
    attr: args.attr ? parsePair(asArray(args.attr)[0]) : null,
    limit: Number(args.limit || 10),
  });
  if (!rows.length) {
    const { items } = allItems(mnsDir);
    return console.log(recallEmptyMessage({ itemCount: items.length, query }));
  }
  for (const r of rows) console.log(`  [${String(r.score).padStart(3)}] ${r.id}  (${r.type})  ${r.text.slice(0, 70).replace(/\n/g, ' ')}`);
}

/** mns knowledge reindex|audit */
export async function knowledge(args) {
  const sub = args._[0];
  const mnsDir = paths().dir;
  if (sub === 'reindex') {
    const r = reindex(mnsDir);
    console.log(`indexed ${r.indexed} item(s) → ${indexPath(mnsDir)}`);
    for (const e of r.parseErrors) console.log(`  ✗ ${e.file}: ${e.error}`);
    // embed what we can, if an embedder exists
    const e = await detectEmbedder();
    if (e.available) {
      const todo = unembedded(mnsDir);
      for (const it of todo) {
        try {
          putVector(mnsDir, it.id, e.model, await embed(e.model, `${it.id}\n${it.text}`));
        } catch (err) {
          console.log(`  ✗ embed ${it.id}: ${err.message}`);
        }
      }
      if (todo.length) console.log(`  embedded ${todo.length} item(s) via ollama/${e.model}`);
    } else {
      console.log(`  (vectors skipped — ${e.reason})`);
    }
    return;
  }
  if (sub === 'audit') {
    const registry = loadRegistry(mnsDir);
    const { items, errors } = allItems(mnsDir);
    let problems = 0;
    if (!registry.ok) { console.log('  ✗ registry file unparseable'); problems++; }
    for (const e of errors) { console.log(`  ✗ ${e.file}: ${e.error}`); problems++; }
    const ids = new Set(items.map((i) => i.id));
    for (const it of items) {
      const v = validateItem(registry, it);
      for (const err of v.errors) { console.log(`  ✗ ${it.id}: ${err}`); problems++; }
      for (const k of v.unknownKeys.attributes) console.log(`  ⚠ ${it.id}: unregistered attribute '${k}'`);
      for (const k of v.unknownKeys.relations) console.log(`  ⚠ ${it.id}: unregistered relation '${k}'`);
      for (const r of it.relations ?? []) if (!ids.has(r.target)) console.log(`  ⚠ ${it.id}: dangling relation → ${r.target}`);
    }
    const e = await detectEmbedder();
    console.log(`  embeddings: ${e.available ? `available (ollama/${e.model})` : e.reason}`);
    console.log(problems ? `${problems} problem(s)` : `audit clean — ${items.length} item(s)`);
    process.exit(problems ? 1 : 0);
  }
  console.error('usage: zuzuu knowledge reindex|audit');
  process.exit(1);
}
