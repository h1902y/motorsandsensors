// zuzuu/commands/migrations/items.mjs — the Module Standard migrator (W24):
// legacy per-module shapes → one envelope. knowledge/memory frontmatter keys
// standardised, rules.json exploded into guardrails/items/, action.json+SKILL.md
// → ACTION.md, instructions/project.md → items/steering.md. Idempotent,
// fail-soft per item. Auto-runs from `zuzuu init` when old shapes are detected.
//
// NOTE: this migrator predates the faculty→module noun rename. An "envelope" is
// detected by EITHER the legacy `faculty:` key OR the current `module:` key —
// either way the file is already a standard envelope (the noun rename itself is
// handled by the `--modules` migrator). New envelopes this migrator writes carry
// the current `module:` key.

import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serializeEnvelope, deriveTitle } from '../../module/envelope.mjs';
import { serializeItem } from '../../knowledge/items.mjs';
import { MODULES } from '../../module/contract.mjs';
import { BUILTIN_MODULES } from '../../module/registry.mjs';

/** Does this file's frontmatter already carry the envelope (a `module:`/legacy
 *  `faculty:` key)? Either marks it as already-standard (skip). */
function isEnvelopeText(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return !!m && /^(module|faculty):/m.test(m[1]);
}

const unquoteLegacy = (s) => {
  const t = String(s).trim();
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t;
};

/**
 * Parse the PRE-standard knowledge/memory frontmatter grammar (top-level
 * scalars; ONE nested map `attributes`/`provenance`; arrays of flat maps).
 * Kept here (and only here) — the live parsers are envelope-only (clean break).
 * Throws on violations; the caller fail-softs per item.
 */
function parseLegacyFrontmatter(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) throw new Error('no frontmatter block');
  const [, fm, body] = m;
  const item = { scalars: {}, maps: {}, lists: {}, body: body.trim() };
  let section = null;   // current nested key
  let mode = null;      // 'map' | 'list'
  let current = null;
  for (const raw of fm.split('\n')) {
    if (!raw.trim()) continue;
    const indent = raw.match(/^ */)[0].length;
    const line = raw.trim();
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (indent === 0) {
      current = null;
      if (!kv) throw new Error(`bad line: ${line}`);
      const [, key, val] = kv;
      if (val === '') { section = key; mode = null; }
      else { section = null; item.scalars[key] = unquoteLegacy(val); }
    } else if (section) {
      if (line.startsWith('- ')) {
        mode = mode ?? 'list';
        if (!item.lists[section]) item.lists[section] = [];
        const ekv = line.slice(2).match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
        if (ekv) { current = { [ekv[1]]: unquoteLegacy(ekv[2]) }; item.lists[section].push(current); }
        else { current = null; item.lists[section].push(unquoteLegacy(line.slice(2))); }
      } else if (current && kv) {
        current[kv[1]] = unquoteLegacy(kv[2]);
      } else if (kv) {
        mode = mode ?? 'map';
        if (!item.maps[section]) item.maps[section] = {};
        item.maps[section][kv[1]] = unquoteLegacy(kv[2]);
      } else {
        throw new Error(`bad nested line: ${line}`);
      }
    } else {
      throw new Error(`unexpected indented line: ${line}`);
    }
  }
  return item;
}

/** Parse a legacy inline list: `[a, b]` or an already-array value. */
function legacyList(v) {
  if (Array.isArray(v)) return v.map(String);
  const t = String(v ?? '').trim();
  if (t.startsWith('[') && t.endsWith(']')) {
    return t.slice(1, -1).split(',').map((s) => unquoteLegacy(s)).filter(Boolean);
  }
  return t ? [t] : [];
}

/** knowledge/items/*.md: legacy keys → envelope (ids unchanged). */
function migrateKnowledgeItems(agentDir, out) {
  const dir = join(agentDir, 'knowledge', 'items');
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const path = join(dir, f);
    try {
      const text = readFileSync(path, 'utf8');
      if (isEnvelopeText(text)) { out.skipped++; continue; }
      const legacy = parseLegacyFrontmatter(text);
      const item = {
        id: legacy.scalars.id || f.replace(/\.md$/, ''),
        type: legacy.scalars.type,
        created_at: legacy.scalars.created_at,
        updated_at: legacy.scalars.updated_at,
        status: legacy.scalars.status ?? 'active',
        attributes: legacy.maps.attributes ?? {},
        relations: (legacy.lists.relations ?? []).filter((r) => typeof r === 'object'),
        provenance: (legacy.lists.provenance ?? []).filter((r) => typeof r === 'object'),
        body: legacy.body,
      };
      if (!item.type) throw new Error('item missing type');
      writeFileSync(path, serializeItem(item)); // envelope via the knowledge wrapper
      out.knowledge++;
    } catch (e) {
      out.errors.push({ file: `knowledge/items/${f}`, error: e.message });
    }
  }
}

/** memory/entries/*.md: legacy episode keys → envelope (kind: episode). */
function migrateMemoryEntries(agentDir, out) {
  const dir = join(agentDir, 'memory', 'entries');
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const path = join(dir, f);
    try {
      const text = readFileSync(path, 'utf8');
      if (isEnvelopeText(text)) { out.skipped++; continue; }
      const legacy = parseLegacyFrontmatter(text);
      const id = legacy.scalars.id || f.replace(/\.md$/, '');
      const payload = {};
      const prov = legacy.maps.provenance ?? {};
      const sessions = legacyList(prov.sessions ?? legacy.scalars.sessions ?? '');
      const hosts = legacyList(prov.hosts ?? legacy.scalars.hosts ?? '');
      const tags = legacyList(legacy.scalars.tags ?? '');
      if (sessions.length) payload.sessions = sessions;
      if (hosts.length) payload.hosts = hosts;
      if (tags.length) payload.tags = tags;
      writeFileSync(path, serializeEnvelope({
        id,
        module: 'memory',
        kind: 'episode',
        title: legacy.scalars.title ?? deriveTitle(legacy.body, id),
        status: 'active', // curated/proposed lifecycles fold into active
        created_at: legacy.scalars.date ?? legacy.scalars.created_at,
        payload,
        body: legacy.body,
      }));
      out.memory++;
    } catch (e) {
      out.errors.push({ file: `memory/entries/${f}`, error: e.message });
    }
  }
}

/** guardrails/rules.json: EXPLODE into items/<id>.md, then delete rules.json. */
function migrateGuardrails(agentDir, out) {
  const rulesPath = join(agentDir, 'guardrails', 'rules.json');
  if (!existsSync(rulesPath)) return;
  let data;
  try {
    data = JSON.parse(readFileSync(rulesPath, 'utf8'));
  } catch (e) {
    out.errors.push({ file: 'guardrails/rules.json', error: e.message });
    return; // unreadable → leave the file for the human, never destroy it
  }
  const rules = Array.isArray(data?.rules) ? data.rules : [];
  const itemsDir = join(agentDir, 'guardrails', 'items');
  let failed = 0;
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i] ?? {};
    try {
      const id = String(r.id ?? `rule-${i}`);
      mkdirSync(itemsDir, { recursive: true });
      writeFileSync(join(itemsDir, `${id}.md`), serializeEnvelope({
        id,
        module: 'guardrails',
        kind: 'rule',
        title: deriveTitle(r.reason, id),
        status: 'active',
        created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
        payload: { action: r.action, tool: r.tool || '*', pattern: String(r.pattern ?? ''), reason: String(r.reason ?? '') },
        body: '',
      }));
      out.guardrails++;
    } catch (e) {
      failed++;
      out.errors.push({ file: `guardrails/rules.json#${r.id ?? i}`, error: e.message });
    }
  }
  // rules.json goes away only when every rule landed as an item (fail-soft)
  if (failed === 0) {
    try { rmSync(rulesPath, { force: true }); } catch { /* fail-soft */ }
  }
}

/** One action dir: action.json (+SKILL.md) → ACTION.md; legacy files removed on success. */
function migrateActionDir(dir, slug, out) {
  const actionMd = join(dir, 'ACTION.md');
  if (existsSync(actionMd)) { out.skipped++; return; }
  const manPath = join(dir, 'action.json');
  const skillPath = join(dir, 'SKILL.md');
  if (!existsSync(manPath) && !existsSync(skillPath)) return; // not an action dir
  try {
    let man = {};
    if (existsSync(manPath)) man = JSON.parse(readFileSync(manPath, 'utf8'));
    let skillFm = {};
    let skillBody = '';
    if (existsSync(skillPath)) {
      const text = readFileSync(skillPath, 'utf8');
      const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      if (m) {
        for (const line of m[1].split('\n')) {
          const kv = line.match(/^(\w+):\s*(.*)$/);
          if (kv) skillFm[kv[1]] = kv[2].trim();
        }
        skillBody = m[2].trim();
      } else {
        skillBody = text.trim();
      }
    }
    const isScript = existsSync(join(dir, 'run.mjs'));
    const payload = {};
    if (isScript) payload.exec = 'run.mjs';
    // default_args survive as payload.args (flat scalars only — the envelope grammar)
    const args = {};
    for (const [k, v] of Object.entries(man.default_args ?? {})) {
      if (v == null || typeof v === 'object') continue;
      args[k] = String(v);
    }
    if (Object.keys(args).length) payload.args = args;
    const snippet = man.promptSnippet ?? man.description ?? skillFm.description ?? slug;
    const bodyParts = [snippet];
    if (man.description && man.description !== snippet) bodyParts.push('', man.description);
    if (skillBody) bodyParts.push('', skillBody);
    writeFileSync(actionMd, serializeEnvelope({
      id: slug,
      module: 'actions',
      kind: isScript ? 'script' : 'runbook',
      title: man.title ?? skillFm.name ?? slug,
      status: 'active',
      created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      payload,
      body: bodyParts.join('\n'),
    }));
    // legacy files leave only after ACTION.md landed
    rmSync(manPath, { force: true });
    rmSync(skillPath, { force: true });
    out.actions++;
  } catch (e) {
    out.errors.push({ file: `actions/${slug}`, error: e.message });
  }
}

/** All action dirs: active + inbox (proposed) — same conversion. */
function migrateActions(agentDir, out) {
  for (const base of [join(agentDir, 'actions'), join(agentDir, 'actions', 'inbox')]) {
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      if (name === 'inbox' || name === 'proposals' || name === '_rolledback') continue;
      const dir = join(base, name);
      let isDir = false;
      try { isDir = statSync(dir).isDirectory(); } catch { continue; }
      if (isDir) migrateActionDir(dir, name, out);
    }
  }
}

/** instructions/project.md → items/steering.md. A customized steering item is
 *  never clobbered — project.md then stays put for the human to reconcile. */
function migrateInstructions(agentDir, out) {
  const projPath = join(agentDir, 'instructions', 'project.md');
  if (!existsSync(projPath)) return;
  const steeringPath = join(agentDir, 'instructions', 'items', 'steering.md');
  try {
    const existing = existsSync(steeringPath) ? readFileSync(steeringPath, 'utf8') : null;
    const placeholder = existing != null && existing.includes('<!-- Fill in:');
    if (existing != null && !placeholder) {
      out.errors.push({ file: 'instructions/project.md', error: 'a customized steering item already exists — merge by hand, then delete project.md' });
      return;
    }
    const body = readFileSync(projPath, 'utf8').trim();
    mkdirSync(join(agentDir, 'instructions', 'items'), { recursive: true });
    writeFileSync(steeringPath, serializeEnvelope({
      id: 'steering',
      module: 'instructions',
      kind: 'steering',
      title: 'Project steering',
      status: 'active',
      created_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
      payload: { scope: 'project' },
      body,
    }));
    out.instructions++;
    rmSync(projPath, { force: true });
  } catch (e) {
    out.errors.push({ file: 'instructions/project.md', error: e.message });
  }
}

/** Seed missing <module>/module.json manifests into an existing home (the
 *  Module contract, 2026-06-13). Only modules whose dir exists get one — a
 *  migrator repairs, it never scaffolds. A home still carrying the legacy
 *  `faculty.json` is left for the `--modules` migrator (we don't double-seed).
 *  Idempotent, fail-soft. */
function seedModuleManifests(agentDir, out) {
  for (const f of MODULES) {
    try {
      const dir = join(agentDir, f);
      if (!existsSync(dir)) continue;
      const p = join(dir, 'module.json');
      if (existsSync(p) || existsSync(join(dir, 'faculty.json'))) continue;
      writeFileSync(p, JSON.stringify(BUILTIN_MODULES[f].manifest, null, 2) + '\n');
      out.manifests++;
    } catch (e) {
      out.errors.push({ file: `${f}/module.json`, error: e.message });
    }
  }
}

/**
 * Are pre-standard shapes present? Cheap checks gate the init auto-run.
 */
export function needsItemsMigration(agentDir) {
  for (const f of MODULES) {
    if (existsSync(join(agentDir, f)) && !existsSync(join(agentDir, f, 'module.json')) && !existsSync(join(agentDir, f, 'faculty.json'))) return true;
  }
  if (existsSync(join(agentDir, 'guardrails', 'rules.json'))) return true;
  if (existsSync(join(agentDir, 'instructions', 'project.md'))) return true;
  for (const base of [join(agentDir, 'actions'), join(agentDir, 'actions', 'inbox')]) {
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      if (name === 'inbox' || name === 'proposals' || name === '_rolledback') continue;
      const dir = join(base, name);
      try { if (!statSync(dir).isDirectory()) continue; } catch { continue; }
      if (existsSync(join(dir, 'ACTION.md'))) continue;
      if (existsSync(join(dir, 'action.json')) || existsSync(join(dir, 'SKILL.md'))) return true;
    }
  }
  for (const seg of [['knowledge', 'items'], ['memory', 'entries']]) {
    const dir = join(agentDir, ...seg);
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
      try {
        if (!isEnvelopeText(readFileSync(join(dir, f), 'utf8'))) return true;
      } catch { /* unreadable file never forces a migration */ }
    }
  }
  return false;
}

/**
 * One-shot Module Standard migration for a home. Idempotent (already-envelope
 * files are skipped) and fail-soft per item (an unconvertible item is reported,
 * never fatal; its legacy source is left in place).
 * @returns {{knowledge:number, memory:number, guardrails:number, actions:number,
 *            instructions:number, manifests:number, skipped:number, errors:Array<{file,error}>}}
 */
export function migrateItems(agentDir) {
  const out = { knowledge: 0, memory: 0, guardrails: 0, actions: 0, instructions: 0, manifests: 0, skipped: 0, errors: [] };
  migrateKnowledgeItems(agentDir, out);
  migrateMemoryEntries(agentDir, out);
  migrateGuardrails(agentDir, out);
  migrateActions(agentDir, out);
  migrateInstructions(agentDir, out);
  seedModuleManifests(agentDir, out);
  return out;
}

