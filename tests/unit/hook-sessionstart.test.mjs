import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sessionStartContext } from '../../mns/commands/hook.mjs';

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
    assert.match(out.hookSpecificOutput.additionalContext, /mns faculty digest/);
    assert.match(out.hookSpecificOutput.additionalContext, /Ship daily/);
  }, '# Project steering\n\nShip daily.\n');
});

test('sessionStartContext on an absent home degrades gracefully (no throw, well-formed)', () => {
  const root = mkdtempSync(join(tmpdir(), 'mns-nohome-'));
  try {
    // No .mns/ here, yet computeDigest is fail-soft per faculty and still
    // renders headers (interview directive + empty knowledge + guardrails) →
    // a non-empty digest, so we get a well-formed payload, never null/throw.
    const out = sessionStartContext(root); // must not throw
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(out.hookSpecificOutput.additionalContext, /mns faculty digest/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
