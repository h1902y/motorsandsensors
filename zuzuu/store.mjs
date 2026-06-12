// The git-native .zuzuu/ store (the hidden faculty home — the .git model:
// transparency via porcelain, not an un-dotted dir).
//
// Layout (entire.io-style split — linkage in git, blobs out of the diff):
//   .zuzuu/sessions.json         tracked   — the session index (small, diff-friendly,
//                                            each entry links to a git commit)
//   .zuzuu/.traces/<host>-<id>.otlp.jsonl  gitignored — the bulky OTLP blobs (dot-prefixed)
//
// Trace blobs are git-ignored in Phase 1; Phase 2 moves them to an orphan branch.

import { join, relative, resolve, isAbsolute } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { writeNdjson } from '../experiments/experiment-1-trace-capture/core/otlp.mjs';

const INDEX_VERSION = 1;

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Repo root via git, falling back to cwd. */
export function repoRoot(cwd = process.cwd()) {
  return git(['rev-parse', '--show-toplevel'], cwd) || cwd;
}

/** Resolve the faculty home: the hidden `.zuzuu/`. The single chokepoint for the
 *  whole CLI. */
export function homeDir(root = repoRoot()) {
  return join(root, '.zuzuu');
}

/** Internal liveness dir (git-ignored, dot-prefixed) under the home. */
export const liveDir = (agentDir) => join(agentDir, '.live');

export function paths(cwd = process.cwd()) {
  const root = repoRoot(cwd);
  const dir = homeDir(root);
  return { root, dir, index: join(dir, 'sessions.json'), tracesDir: join(dir, '.traces') };
}

/** Current commit + branch, or nulls if not a git repo. */
export function gitInfo(cwd = process.cwd()) {
  return { commit: git(['rev-parse', 'HEAD'], cwd), branch: git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd) };
}

export function readIndex(cwd = process.cwd()) {
  const { index } = paths(cwd);
  if (!existsSync(index)) return { version: INDEX_VERSION, sessions: [] };
  try {
    const data = JSON.parse(readFileSync(index, 'utf8'));
    return { version: data.version ?? INDEX_VERSION, sessions: Array.isArray(data.sessions) ? data.sessions : [] };
  } catch {
    return { version: INDEX_VERSION, sessions: [] };
  }
}

function writeIndex(idx, cwd = process.cwd()) {
  const { dir, index } = paths(cwd);
  mkdirSync(dir, { recursive: true });
  // stable order: newest first by startedAt
  const sessions = [...idx.sessions].sort((a, b) => Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0));
  // Atomic write (tmp + rename) so a concurrent reader never sees a half-written
  // file (which readIndex would silently treat as empty). NOTE: this prevents
  // *corruption*, not the lost-update race when two sessions in the same repo
  // upsert concurrently — Phase 3 should move to per-session record files (no
  // shared index) or file locking. Trace blobs are per-session, so unaffected.
  const tmp = `${index}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: INDEX_VERSION, sessions }, null, 2) + '\n');
  renameSync(tmp, index);
}

/** Write an OTLP request array as a trace blob; returns the repo-relative ref. */
export function writeTrace(host, sessionId, requests, cwd = process.cwd()) {
  const { tracesDir, root } = paths(cwd);
  const file = join(tracesDir, `${host}-${sessionId}.otlp.jsonl`);
  writeNdjson(file, requests);
  return relative(root, file);
}

/** Insert-or-replace a session record by id, persist the index. */
export function upsertSession(record, cwd = process.cwd()) {
  const idx = readIndex(cwd);
  const sessions = idx.sessions.filter((s) => !(s.id === record.id && s.host === record.host));
  sessions.push(record);
  writeIndex({ ...idx, sessions }, cwd);
  return record;
}

/** Resolve a possibly-relative traceRef against the repo root. */
export function resolveTrace(ref, cwd = process.cwd()) {
  return isAbsolute(ref) ? ref : resolve(repoRoot(cwd), ref);
}

/** Most-recently-modified trace blob, or null. */
export function lastTrace(cwd = process.cwd()) {
  const { tracesDir } = paths(cwd);
  if (!existsSync(tracesDir)) return null;
  const files = readdirSync(tracesDir)
    .filter((f) => f.endsWith('.otlp.jsonl'))
    .map((f) => ({ f: join(tracesDir, f), m: statSync(join(tracesDir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  return files.length ? files[0].f : null;
}
