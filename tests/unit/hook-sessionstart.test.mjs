import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { sessionStartContext, writeLiveDigest, handleHook } from '../../zuzuu/commands/hook.mjs';

function withHome(fn, project) {
  const root = mkdtempSync(join(tmpdir(), 'mns-hook-'));
  const mns = join(root, '.mns');
  mkdirSync(join(mns, 'knowledge', 'items'), { recursive: true });
  mkdirSync(join(mns, 'knowledge', 'proposals'), { recursive: true });
  mkdirSync(join(mns, 'instructions'), { recursive: true });
  mkdirSync(join(mns, 'guardrails'), { recursive: true });
  writeFileSync(join(mns, 'instructions', 'project.md'), project);
  try {
    return fn(root); // pass repo root; paths() derives .mns under it
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('sessionStartContext returns the Claude additionalContext shape', () => {
  withHome((root) => {
    const out = sessionStartContext(root);
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(out.hookSpecificOutput.additionalContext, /zuzuu faculty digest/);
    assert.match(out.hookSpecificOutput.additionalContext, /Ship daily/);
  }, '# Project steering\n\nShip daily.\n');
});

test('writeLiveDigest writes the digest to .mns/live/digest.md (universal channel)', () => {
  withHome((root) => {
    writeLiveDigest(root);
    const p = join(root, '.mns', '.live', 'digest.md');
    assert.ok(existsSync(p), 'digest.md created');
    assert.match(readFileSync(p, 'utf8'), /zuzuu faculty digest/);
    assert.match(readFileSync(p, 'utf8'), /Ship daily/);
  }, '# Project steering\n\nShip daily.\n');
});

test('handleHook delivers the digest file on an OPEN event for a non-Claude host (pi)', () => {
  withHome((root) => {
    handleHook({ event: 'session_start', payload: { session_id: 'x' }, cwd: root, host: 'pi' });
    assert.ok(existsSync(join(root, '.mns', '.live', 'digest.md')), 'digest delivered on pi session_start');
  }, '# Project steering\n\nShip daily.\n');
});

test('writeLiveDigest on an absent home does not throw (fail-open)', () => {
  const root = mkdtempSync(join(tmpdir(), 'mns-nodigest-'));
  try {
    assert.doesNotThrow(() => writeLiveDigest(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('sessionStartContext on an absent home degrades gracefully (no throw, well-formed)', () => {
  const root = mkdtempSync(join(tmpdir(), 'mns-nohome-'));
  try {
    // No .mns/ here, yet computeDigest is fail-soft per faculty and still
    // renders headers (interview directive + empty knowledge + guardrails) →
    // a non-empty digest, so we get a well-formed payload, never null/throw.
    const out = sessionStartContext(root); // must not throw
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(out.hookSpecificOutput.additionalContext, /zuzuu faculty digest/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
