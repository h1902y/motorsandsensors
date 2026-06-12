// zuzuu/commands/migrate.mjs
// `zuzuu migrate` — one-time migrators.
//
//   (default)  proposal schema: legacy {candidate, er} → spine {payload, analysis, faculty} (WS2-T5)
//   --home     faculty home: visible agent/ → hidden .zuzuu/ (W1, 2026-06-12)
//   --items    Faculty Standard (W24): legacy per-faculty shapes → one envelope —
//              knowledge/memory frontmatter keys standardised, rules.json
//              exploded into guardrails/items/, action.json+SKILL.md → ACTION.md,
//              instructions/project.md → items/steering.md. Idempotent,
//              fail-soft per item. Auto-runs from `zuzuu init` when old shapes
//              are detected (like migrateHome).
//
// Pure cores:  migrateProposals(agentDir) → { scanned, migrated, skipped }
//              migrateHome(root) → { migrated }
//              migrateItems(agentDir) → { knowledge, memory, guardrails, actions, instructions, skipped, errors }
// CLI surface: migrate(args) — resolves paths, runs the core, prints summary.

import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync, rmSync, statSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { paths, repoRoot } from '../store.mjs';
import { proposalsDir, archiveDir } from '../faculty/contract.mjs';
import { ensureGitignore } from '../scaffold.mjs';
import { injectBlock, BLOCK_VERSION } from '../inject.mjs';
import { serializeEnvelope, deriveTitle } from '../faculty/envelope.mjs';
import { serializeItem } from '../knowledge/items.mjs';

// ---------------------------------------------------------------------------
// pure core — testable without process.*
// ---------------------------------------------------------------------------

/**
 * Determine whether a parsed JSON record is already in the new shape.
 * A record is "new" when it has `payload` AND `faculty` set.
 * If it only has `candidate` and/or lacks `faculty` it is legacy.
 */
function isLegacy(rec) {
  if (!rec || typeof rec !== 'object') return false;
  // already migrated: has payload and faculty
  if (rec.payload !== undefined && rec.faculty !== undefined) return false;
  // legacy if it has candidate or er keys, or is simply missing faculty/payload
  return rec.candidate !== undefined || rec.er !== undefined || rec.faculty === undefined;
}

/**
 * Convert a legacy record to the new unified shape.
 * Returns the migrated record (caller writes it back).
 */
function migrateRecord(rec) {
  const out = { ...rec };

  // payload = candidate (drop candidate)
  if (out.candidate !== undefined) {
    if (out.payload === undefined) out.payload = out.candidate;
    delete out.candidate;
  }

  // analysis = { er } (drop er)
  if (out.er !== undefined) {
    if (out.analysis === undefined) out.analysis = { er: out.er };
    delete out.er;
  }

  // faculty defaults to 'knowledge' (only knowledge proposals exist pre-spine)
  if (!out.faculty) out.faculty = 'knowledge';

  return out;
}

/**
 * Scan one directory of *.json files and migrate legacy records in-place.
 * Fail-soft: bad JSON files are counted as skipped and never throw.
 * Returns { migrated, scanned, skipped } for this directory.
 */
function migrateDir(dir) {
  if (!existsSync(dir)) return { migrated: 0, scanned: 0, skipped: 0 };

  const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
  let migrated = 0;
  let skipped = 0;

  for (const file of files) {
    const fpath = join(dir, file);
    let rec;
    try {
      rec = JSON.parse(readFileSync(fpath, 'utf8'));
    } catch {
      skipped++;
      continue;
    }

    if (!isLegacy(rec)) {
      skipped++;
      continue;
    }

    try {
      const migrated_rec = migrateRecord(rec);
      writeFileSync(fpath, JSON.stringify(migrated_rec, null, 2) + '\n');
      migrated++;
    } catch {
      skipped++;
    }
  }

  return { migrated, scanned: files.length, skipped };
}

/**
 * Scan both pending and archived Knowledge proposals.
 * Returns { scanned, migrated, skipped }.
 */
export function migrateProposals(agentDir) {
  const pending = migrateDir(proposalsDir(agentDir, 'knowledge'));
  const archived = migrateDir(archiveDir(agentDir, 'knowledge'));

  return {
    scanned: pending.scanned + archived.scanned,
    migrated: pending.migrated + archived.migrated,
    skipped: pending.skipped + archived.skipped,
  };
}

// ---------------------------------------------------------------------------
// home migration — agent/ → .zuzuu/ (W1, 2026-06-12)
// ---------------------------------------------------------------------------

// The denies the old visible-agent/ home installed; scrubbed here (NOT kept in
// install.mjs — clean break) and replaced by the current narrow .zuzuu/ pair.
const LEGACY_DENY_RULES = ['Read(./agent/.traces/**)', 'Read(./agent/.live/**)'];
const NEW_DENY_RULES = ['Read(./.zuzuu/.traces/**)', 'Read(./.zuzuu/.live/**)'];

/**
 * One-shot HOME migration: visible `agent/` → hidden `.zuzuu/` (byte-identical
 * inner layout). Gated on `agent/agent.json` — `agent/` is a common dir name,
 * so an unrelated agent/ dir in a brownfield repo must NEVER be touched (the
 * one place this differs from the old `.mns→agent` precedent). Idempotent +
 * fail-soft; NEVER clobbers an existing .zuzuu/. Pure FS move (renameSync).
 * @returns {{migrated: boolean}}
 */
export function migrateHome(root = repoRoot()) {
  const legacy = join(root, 'agent');
  const home = join(root, '.zuzuu');
  if (existsSync(home) || !existsSync(join(legacy, 'agent.json'))) return { migrated: false };

  renameSync(legacy, home); // move the whole home (atomic on same filesystem)

  rewriteTraceRefs(home);
  rewriteGitignore(root);
  scrubLegacyDenies(root);
  // derived index: drop, it rebuilds on the next recall/reindex
  try { rmSync(join(home, 'knowledge', '.index.db'), { force: true }); } catch { /* fail-soft */ }
  return { migrated: true };
}

/** sessions.json stores repo-relative traceRefs (`agent/.traces/…`) — re-point them. */
function rewriteTraceRefs(home) {
  const index = join(home, 'sessions.json');
  if (!existsSync(index)) return;
  try {
    const idx = JSON.parse(readFileSync(index, 'utf8'));
    for (const s of idx.sessions || []) {
      if (typeof s.traceRef === 'string' && s.traceRef.startsWith('agent/')) {
        s.traceRef = '.zuzuu/' + s.traceRef.slice('agent/'.length);
      }
    }
    writeFileSync(index, JSON.stringify(idx, null, 2) + '\n');
  } catch { /* fail-soft: a bad index never blocks the move */ }
}

/** Drop legacy `agent/` ignore lines, then append the canonical .zuzuu/ ones. */
function rewriteGitignore(root) {
  const path = join(root, '.gitignore');
  if (existsSync(path)) {
    const kept = readFileSync(path, 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('agent/'))
      .join('\n');
    writeFileSync(path, kept.endsWith('\n') || kept === '' ? kept : kept + '\n');
  }
  ensureGitignore(root); // appends .zuzuu/.traces/, .zuzuu/.live/, .zuzuu/knowledge/.index.db
}

/** Swap the old agent/ deny rules for the .zuzuu/ pair in any .claude settings file. */
function scrubLegacyDenies(root) {
  for (const f of ['settings.json', 'settings.local.json']) {
    const path = join(root, '.claude', f);
    if (!existsSync(path)) continue;
    try {
      const s = JSON.parse(readFileSync(path, 'utf8'));
      const deny = s?.permissions?.deny;
      if (!Array.isArray(deny)) continue;
      const hadOurs = deny.some((r) => LEGACY_DENY_RULES.includes(r));
      if (!hadOurs) continue;
      s.permissions.deny = deny.filter((r) => !LEGACY_DENY_RULES.includes(r));
      for (const rule of NEW_DENY_RULES) if (!s.permissions.deny.includes(rule)) s.permissions.deny.push(rule);
      writeFileSync(path, JSON.stringify(s, null, 2) + '\n');
    } catch { /* fail-soft: never break settings we can't parse */ }
  }
}

/** Re-inject the current faculties block into any existing host instruction files. */
function reinjectHostBlocks(root) {
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
    const p = join(root, f);
    if (existsSync(p)) {
      const text = readFileSync(p, 'utf8');
      if (!text.includes(`zuzuu:faculties:v${BLOCK_VERSION}`)) writeFileSync(p, injectBlock(text));
    }
  }
}

// ---------------------------------------------------------------------------
// items migration — the Faculty Standard (W24)
// ---------------------------------------------------------------------------

/** Does this file's frontmatter already carry the envelope (a `faculty:` key)? */
function isEnvelopeText(text) {
  const m = String(text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return !!m && /^faculty:/m.test(m[1]);
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
        faculty: 'memory',
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
        faculty: 'guardrails',
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
      faculty: 'actions',
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
      faculty: 'instructions',
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

/**
 * Are pre-standard shapes present? Cheap checks gate the init auto-run.
 */
export function needsItemsMigration(agentDir) {
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
 * One-shot Faculty Standard migration for a home. Idempotent (already-envelope
 * files are skipped) and fail-soft per item (an unconvertible item is reported,
 * never fatal; its legacy source is left in place).
 * @returns {{knowledge:number, memory:number, guardrails:number, actions:number,
 *            instructions:number, skipped:number, errors:Array<{file,error}>}}
 */
export function migrateItems(agentDir) {
  const out = { knowledge: 0, memory: 0, guardrails: 0, actions: 0, instructions: 0, skipped: 0, errors: [] };
  migrateKnowledgeItems(agentDir, out);
  migrateMemoryEntries(agentDir, out);
  migrateGuardrails(agentDir, out);
  migrateActions(agentDir, out);
  migrateInstructions(agentDir, out);
  return out;
}

// ---------------------------------------------------------------------------
// CLI surface
// ---------------------------------------------------------------------------

export function migrate(args = {}) {
  if (args.items) {
    const agentDir = paths().dir;
    const r = migrateItems(agentDir);
    const total = r.knowledge + r.memory + r.guardrails + r.actions + r.instructions;
    console.log(`migrate --items: ${total} item(s) → the Faculty Standard envelope — knowledge ${r.knowledge} · memory ${r.memory} · guardrails ${r.guardrails} · actions ${r.actions} · instructions ${r.instructions} (${r.skipped} already standard)`);
    for (const e of r.errors) console.log(`  ✗ ${e.file}: ${e.error}`);
    if (!total && !r.errors.length) console.log('  nothing to migrate (the home already speaks the envelope)');
    return;
  }
  if (args.home) {
    const root = repoRoot(process.cwd());
    const { migrated } = migrateHome(root);
    if (!migrated) { console.log('migrate --home: nothing to do (already .zuzuu/, or no zuzuu home at agent/)'); return; }
    try { reinjectHostBlocks(root); } catch { /* fail-open */ }
    console.log(`migrate --home: agent/ → .zuzuu/ (hidden, like .git; block v${BLOCK_VERSION}, gitignore + deny rules rewritten)`);
    console.log('  transparency lives in porcelain now: zuzuu status · explain · digest');
    return;
  }
  const agentDir = paths().dir;
  const { scanned, migrated, skipped } = migrateProposals(agentDir);
  console.log(`migrate: scanned ${scanned} proposal(s) — migrated ${migrated}, skipped ${skipped}`);
  if (migrated > 0) {
    console.log('  legacy candidate/er keys rewritten to payload/analysis.er + faculty:knowledge');
  } else {
    console.log('  nothing to migrate (all records already in new shape)');
  }
}
