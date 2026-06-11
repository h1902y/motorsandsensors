// Liveness store for in-flight sessions: thin lifecycle records under agent/.live/.
// Holds NO spans (Design B — spans come from re-parsing the transcript). Just
// enough to know a session is open and when it was last seen, so a killed
// terminal (which sends no SessionEnd) can be reconciled later.
//
// agent/.live/ is git-ignored (transient machine state, like .git/ session state).

import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { paths, liveDir as liveDirOf } from '../store.mjs';
import { SessionState } from '../session.mjs';

const liveDir = (cwd) => liveDirOf(paths(cwd).dir);
// Some hosts pass a file PATH as the session id (pi → the session-file path).
// Sanitize for the record filename (the real id is preserved inside the JSON),
// or the write fails into a non-existent nested dir. read/write/close all route
// through here, so the key stays consistent.
const recFile = (id) => `${String(id ?? 'unknown').replace(/[^A-Za-z0-9._-]/g, '_').slice(-120) || 'unknown'}.json`;
const recPath = (id, cwd) => join(liveDir(cwd), recFile(id));

function read(id, cwd) {
  try {
    return JSON.parse(readFileSync(recPath(id, cwd), 'utf8'));
  } catch {
    return null;
  }
}

function write(rec, cwd) {
  mkdirSync(liveDir(cwd), { recursive: true });
  writeFileSync(recPath(rec.id, cwd), JSON.stringify(rec, null, 2) + '\n');
  return rec;
}

/** Open (or refresh) a live session record. `generation` is the active gen id (WS3-T3). */
export function openLive({ id, host, transcriptPath, startedAt, now, generation = null }, cwd = process.cwd()) {
  const existing = read(id, cwd);
  return write(
    existing
      ? { ...existing, lastSeen: now, transcriptPath: transcriptPath ?? existing.transcriptPath, generation: existing.generation ?? generation }
      : { id, host, status: SessionState.ACTIVE, startedAt, lastSeen: now, transcriptPath, generation },
    cwd,
  );
}

/** Bump the heartbeat; create the record if a signal arrives before SessionStart. */
export function touchLive({ id, host, transcriptPath, now }, cwd = process.cwd()) {
  const existing = read(id, cwd);
  if (!existing) return openLive({ id, host, transcriptPath, startedAt: new Date(now).toISOString(), now }, cwd);
  return write({ ...existing, lastSeen: now, transcriptPath: transcriptPath ?? existing.transcriptPath }, cwd);
}

/** Remove a live record (its lifecycle has reached a terminal state). */
export function closeLive(id, cwd = process.cwd()) {
  try {
    rmSync(recPath(id, cwd), { force: true });
  } catch {
    /* ignore */
  }
}

export function listLive(cwd = process.cwd()) {
  const dir = liveDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/** A live record is stale if its heartbeat is older than the window. */
export const isStale = (rec, now, thresholdMs) => now - (rec.lastSeen || 0) > thresholdMs;
