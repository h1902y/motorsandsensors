// The Knowledge index — SQLite (node:sqlite, zero-dep), fully DERIVED from the
// item files and regenerable at any time: files are truth, this is the
// search/query plane ("pin definitions, observe data").
//
// Triple search on one store (the Apache-AGE pattern — graph inside relational —
// plus a vector column):
//   relational: SQL over items/attrs            (type/attribute filters)
//   graph:      recursive CTEs over rels        (neighbors/paths; Cypher syntax
//                                                arrives at the real AGE rung)
//   semantic:   vecs + cosine                   (populated when an embedding
//                                                source exists — see embed.mjs)

import { join, dirname } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { allItems } from './items.mjs';

const require = createRequire(import.meta.url);
export const indexPath = (mnsDir) => join(mnsDir, 'knowledge', '.index.db');

function open(mnsDir, { readOnly = false } = {}) {
  const { DatabaseSync } = require('node:sqlite');
  const path = indexPath(mnsDir);
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path, readOnly && existsSync(path) ? { readOnly: true } : {});
  return db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, type TEXT, text TEXT, created_at TEXT, status TEXT);
CREATE TABLE IF NOT EXISTS attrs(item TEXT, key TEXT, value TEXT, PRIMARY KEY(item, key));
CREATE TABLE IF NOT EXISTS rels(src TEXT, type TEXT, dst TEXT, PRIMARY KEY(src, type, dst));
CREATE TABLE IF NOT EXISTS vecs(item TEXT PRIMARY KEY, model TEXT, vec BLOB);
CREATE INDEX IF NOT EXISTS attrs_kv ON attrs(key, value);
CREATE INDEX IF NOT EXISTS rels_dst ON rels(dst);
`;

function ensureSchema(db) {
  db.exec(SCHEMA);
}

/** Upsert one item into the index (keeps any existing vector). */
export function upsertItem(mnsDir, item) {
  const db = open(mnsDir);
  try {
    ensureSchema(db);
    db.prepare('INSERT OR REPLACE INTO items(id,type,text,created_at,status) VALUES(?,?,?,?,?)').run(
      item.id, item.type, item.body ?? '', item.created_at ?? '', item.status ?? 'active');
    db.prepare('DELETE FROM attrs WHERE item=?').run(item.id);
    for (const [k, v] of Object.entries(item.attributes ?? {}))
      db.prepare('INSERT OR REPLACE INTO attrs(item,key,value) VALUES(?,?,?)').run(item.id, k, String(v));
    db.prepare('DELETE FROM rels WHERE src=?').run(item.id);
    for (const r of item.relations ?? [])
      db.prepare('INSERT OR REPLACE INTO rels(src,type,dst) VALUES(?,?,?)').run(item.id, r.type, r.target);
  } finally {
    db.close();
  }
}

/** Full rebuild from the item files. Deterministic. Returns counts. */
export function reindex(mnsDir) {
  const { items, errors } = allItems(mnsDir);
  const db = open(mnsDir);
  try {
    ensureSchema(db);
    db.exec('DELETE FROM items; DELETE FROM attrs; DELETE FROM rels;'); // vecs kept (re-embedding is separate)
    const insI = db.prepare('INSERT INTO items(id,type,text,created_at,status) VALUES(?,?,?,?,?)');
    const insA = db.prepare('INSERT OR REPLACE INTO attrs(item,key,value) VALUES(?,?,?)');
    const insR = db.prepare('INSERT OR REPLACE INTO rels(src,type,dst) VALUES(?,?,?)');
    for (const it of items) {
      insI.run(it.id, it.type, it.body ?? '', it.created_at ?? '', it.status ?? 'active');
      for (const [k, v] of Object.entries(it.attributes ?? {})) insA.run(it.id, k, String(v));
      for (const r of it.relations ?? []) insR.run(it.id, r.type, r.target);
    }
    // prune vectors for items that no longer exist
    db.exec('DELETE FROM vecs WHERE item NOT IN (SELECT id FROM items)');
    return { indexed: items.length, parseErrors: errors };
  } finally {
    db.close();
  }
}

/**
 * Lexical + relational search (Notes-style scoring: id hit +10, attribute hit +5,
 * body occurrences ×2 capped at 8). Filters: type, attribute k=v.
 */
export function search(mnsDir, query, { type = null, attr = null, limit = 10 } = {}) {
  if (!existsSync(indexPath(mnsDir))) return [];
  const db = open(mnsDir, { readOnly: true });
  try {
    ensureSchema(db);
    let rows = db.prepare('SELECT id, type, text, status FROM items').all();
    if (type) rows = rows.filter((r) => r.type === type);
    if (attr) {
      const [k, v] = attr;
      const ids = new Set(db.prepare('SELECT item FROM attrs WHERE key=? AND value=?').all(k, v).map((r) => r.item));
      rows = rows.filter((r) => ids.has(r.id));
    }
    const attrRows = db.prepare('SELECT item, key, value FROM attrs').all();
    const attrText = new Map();
    for (const a of attrRows) attrText.set(a.item, (attrText.get(a.item) ?? '') + ' ' + a.key + ' ' + a.value);
    const terms = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const scored = rows.map((r) => {
      let score = 0;
      const id = r.id.toLowerCase();
      const body = (r.text ?? '').toLowerCase();
      const attrs = (attrText.get(r.id) ?? '').toLowerCase();
      for (const t of terms) {
        if (id.includes(t)) score += 10;
        if (attrs.includes(t)) score += 5;
        const hits = body.split(t).length - 1;
        score += Math.min(hits * 2, 8);
      }
      return { ...r, score };
    });
    return scored
      .filter((r) => (terms.length ? r.score > 0 : true))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  } finally {
    db.close();
  }
}

/**
 * Graph traversal: items within `depth` hops of `id` (optionally one relation
 * type), via a recursive CTE — both directions (relations are conceptually
 * bidirectional; inverses live in the registry).
 */
export function neighbors(mnsDir, id, { relType = null, depth = 1 } = {}) {
  if (!existsSync(indexPath(mnsDir))) return [];
  const db = open(mnsDir, { readOnly: true });
  try {
    ensureSchema(db);
    const typeCond = relType ? 'AND r.type = ?' : '';
    const params = relType ? [id, relType, relType, depth] : [id, depth];
    const sql = `
      WITH RECURSIVE walk(node, via, hop) AS (
        SELECT CASE WHEN r.src = ? THEN r.dst ELSE r.src END, r.type, 1
        FROM rels r WHERE (r.src = walk_start() OR r.dst = walk_start()) ${typeCond}
        UNION
        SELECT CASE WHEN r.src = w.node THEN r.dst ELSE r.src END, r.type, w.hop + 1
        FROM rels r JOIN walk w ON (r.src = w.node OR r.dst = w.node) ${typeCond ? 'AND r.type = ?' : ''}
        WHERE w.hop < ?
      ) SELECT DISTINCT node, via, MIN(hop) AS hop FROM walk GROUP BY node, via`;
    // node:sqlite has no custom functions; inline the start id instead of walk_start()
    const inlined = sql.replaceAll('walk_start()', '?');
    // param order: src-case ?, (start, start), [relType], [relType], depth
    const finalParams = relType ? [id, id, id, relType, relType, depth] : [id, id, id, depth];
    const rows = db.prepare(inlined).all(...finalParams);
    return rows.filter((r) => r.node !== id);
  } finally {
    db.close();
  }
}

/** Store / fetch embedding vectors (Float32 LE blobs). */
export function putVector(mnsDir, itemId, model, floats) {
  const db = open(mnsDir);
  try {
    ensureSchema(db);
    const buf = Buffer.from(new Float32Array(floats).buffer);
    db.prepare('INSERT OR REPLACE INTO vecs(item,model,vec) VALUES(?,?,?)').run(itemId, model, buf);
  } finally {
    db.close();
  }
}

export function allVectors(mnsDir) {
  if (!existsSync(indexPath(mnsDir))) return [];
  const db = open(mnsDir, { readOnly: true });
  try {
    ensureSchema(db);
    return db.prepare('SELECT item, model, vec FROM vecs').all().map((r) => ({
      item: r.item,
      model: r.model,
      vec: new Float32Array(r.vec.buffer, r.vec.byteOffset, r.vec.byteLength / 4),
    }));
  } finally {
    db.close();
  }
}

/** Items in the index but lacking a vector (embedding backlog). */
export function unembedded(mnsDir) {
  if (!existsSync(indexPath(mnsDir))) return [];
  const db = open(mnsDir, { readOnly: true });
  try {
    ensureSchema(db);
    return db.prepare('SELECT id, type, text FROM items WHERE id NOT IN (SELECT item FROM vecs)').all();
  } finally {
    db.close();
  }
}
