import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Drives the REAL binary (`mns init`) in temp dirs — the three git-style modes.
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'mns.mjs');

function run(cwd) {
  const r = spawnSync(process.execPath, [BIN, 'init'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mns-init-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Recursive snapshot of every file's content (for byte-identical assertions). */
function snapshot(dir, base = dir, acc = {}) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) snapshot(p, base, acc);
    else acc[p.slice(base.length)] = readFileSync(p, 'utf8');
  }
  return acc;
}

test('mode 1 — empty dir: greenfield scaffold + AGENTS.md/CLAUDE.md created', () => {
  withTemp((cwd) => {
    const out = run(cwd);
    assert.match(out, /Initialized empty mns home/);
    assert.ok(existsSync(join(cwd, '.mns', 'knowledge', 'README.md')));
    assert.ok(existsSync(join(cwd, '.mns', 'mns.json')));
    assert.ok(existsSync(join(cwd, 'AGENTS.md')), 'greenfield creates AGENTS.md');
    assert.ok(existsSync(join(cwd, 'CLAUDE.md')), 'greenfield creates CLAUDE.md');
    assert.match(readFileSync(join(cwd, 'AGENTS.md'), 'utf8'), /mns:faculties:v\d+/);
    assert.match(readFileSync(join(cwd, '.gitignore'), 'utf8'), /\.mns\/traces\//);
  });
});

test('mode 2 — existing project: scaffold + inject into existing CLAUDE.md, user text intact', () => {
  withTemp((cwd) => {
    writeFileSync(join(cwd, 'index.js'), '// app\n');
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Existing guidance\n\nUser rules here.\n');
    writeFileSync(join(cwd, '.gitignore'), 'node_modules/\n');
    const out = run(cwd);
    assert.match(out, /Initialized mns home in existing project/);
    const claude = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    assert.ok(claude.startsWith('# Existing guidance'), 'user content untouched at top');
    assert.match(claude, /mns:faculties:v\d+/);
    assert.ok(!existsSync(join(cwd, 'AGENTS.md')), 'brownfield does NOT create new host files');
    const gi = readFileSync(join(cwd, '.gitignore'), 'utf8');
    assert.ok(gi.startsWith('node_modules/'), 'gitignore preserved');
    assert.match(gi, /\.mns\/live\//);
  });
});

test('mode 3 — reinit: byte-identical no-op on a complete home; user edits survive', () => {
  withTemp((cwd) => {
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Mine\n');
    run(cwd);
    // user customizes a seeded file
    writeFileSync(join(cwd, '.mns', 'instructions', 'project.md'), 'CUSTOM\n');
    const before = snapshot(cwd);
    const out = run(cwd);
    assert.match(out, /Reinitialized existing mns home/);
    assert.deepEqual(snapshot(cwd), before, 'second init changed nothing');
  });
});

test('mode 3 — reinit restores missing pieces only', () => {
  withTemp((cwd) => {
    run(cwd);
    rmSync(join(cwd, '.mns', 'actions'), { recursive: true });
    const out = run(cwd);
    assert.match(out, /restored : 2 missing piece/);
    assert.ok(existsSync(join(cwd, '.mns', 'actions', 'README.md')));
  });
});

test('reinit upgrades an older faculty block to the current version in place', async () => {
  const { facultiesBlock, BLOCK_VERSION } = await import('../../mns/inject.mjs');
  withTemp((cwd) => {
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Mine\n\n' + facultiesBlock(1) + '\n\n## After section\n');
    const out = run(cwd);
    assert.match(out, new RegExp(`upgraded → v${BLOCK_VERSION}`));
    const text = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    assert.ok(text.includes(`mns:faculties:v${BLOCK_VERSION}`), 'current version present');
    assert.ok(!text.includes('mns:faculties:v1 '), 'old version gone');
    assert.equal((text.match(/mns:faculties:v\d+/g) || []).length, 1, 'exactly one block');
    assert.ok(text.startsWith('# Mine'), 'user heading intact');
    assert.ok(text.includes('## After section'), 'trailing user content intact');
  });
});
