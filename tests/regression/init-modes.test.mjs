import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// Drives the REAL binary (`home init`) in temp dirs — the three git-style modes.
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'zuzuu.mjs');

function run(cwd) {
  const r = spawnSync(process.execPath, [BIN, 'init'], { cwd, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

function withTemp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'zuzuu-init-'));
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
    assert.match(out, /Initialized empty zuzuu home/);
    assert.ok(existsSync(join(cwd, '.zuzuu', 'knowledge', 'README.md')));
    assert.ok(existsSync(join(cwd, '.zuzuu', 'memory', 'entries')), 'memory/entries scaffolded');
    assert.match(readFileSync(join(cwd, '.zuzuu', 'memory', 'README.md'), 'utf8'), /Remember next time/, 'memory README documents the record schema');
    assert.ok(existsSync(join(cwd, '.zuzuu', 'agent.json')));
    assert.ok(existsSync(join(cwd, 'AGENTS.md')), 'greenfield creates AGENTS.md');
    assert.ok(existsSync(join(cwd, 'CLAUDE.md')), 'greenfield creates CLAUDE.md');
    assert.match(readFileSync(join(cwd, 'AGENTS.md'), 'utf8'), /zuzuu:faculties:v\d+/);
    assert.match(readFileSync(join(cwd, '.gitignore'), 'utf8'), /\.zuzuu\/\.traces\//);
  });
});

test('mode 2 — existing project: inject into existing CLAUDE.md + guarantee AGENTS.md (Codex/OpenCode/pi)', () => {
  withTemp((cwd) => {
    writeFileSync(join(cwd, 'index.js'), '// app\n');
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Existing guidance\n\nUser rules here.\n');
    writeFileSync(join(cwd, '.gitignore'), 'node_modules/\n');
    const out = run(cwd);
    assert.match(out, /Initialized zuzuu home in existing project/);
    const claude = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    assert.ok(claude.startsWith('# Existing guidance'), 'user content untouched at top');
    assert.match(claude, /zuzuu:faculties:v\d+/);
    // brownfield now GUARANTEES AGENTS.md — the universal file Codex/OpenCode/pi read.
    assert.ok(existsSync(join(cwd, 'AGENTS.md')), 'brownfield ensures AGENTS.md exists');
    assert.match(readFileSync(join(cwd, 'AGENTS.md'), 'utf8'), /zuzuu:faculties:v\d+/);
    const gi = readFileSync(join(cwd, '.gitignore'), 'utf8');
    assert.ok(gi.startsWith('node_modules/'), 'gitignore preserved');
    assert.match(gi, /\.zuzuu\/\.live\//);
  });
});

test('mode 2 — a project that already has AGENTS.md gets the block injected, not clobbered', () => {
  withTemp((cwd) => {
    writeFileSync(join(cwd, 'index.js'), '// app\n');
    writeFileSync(join(cwd, 'AGENTS.md'), '# Team conventions\n\nUse tabs.\n');
    run(cwd);
    const agents = readFileSync(join(cwd, 'AGENTS.md'), 'utf8');
    assert.ok(agents.startsWith('# Team conventions'), 'user AGENTS.md content preserved');
    assert.match(agents, /zuzuu:faculties:v\d+/);
    assert.equal((agents.match(/zuzuu:faculties:v\d+/g) || []).length, 1, 'exactly one block');
  });
});

test('mode 3 — reinit: byte-identical no-op on a complete home; user edits survive', () => {
  withTemp((cwd) => {
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Mine\n');
    run(cwd);
    // user customizes a seeded file
    writeFileSync(join(cwd, '.zuzuu', 'instructions', 'project.md'), 'CUSTOM\n');
    const before = snapshot(cwd);
    const out = run(cwd);
    assert.match(out, /Reinitialized existing zuzuu home/);
    assert.deepEqual(snapshot(cwd), before, 'second init changed nothing');
  });
});

test('mode 3 — reinit restores missing pieces only', () => {
  withTemp((cwd) => {
    run(cwd);
    rmSync(join(cwd, '.zuzuu', 'actions'), { recursive: true });
    const out = run(cwd);
    assert.match(out, /restored : 3 missing piece/);
    assert.ok(existsSync(join(cwd, '.zuzuu', 'actions', 'README.md')));
  });
});

test('reinit upgrades an older faculty block to the current version in place', async () => {
  const { facultiesBlock, BLOCK_VERSION } = await import('../../zuzuu/inject.mjs');
  withTemp((cwd) => {
    writeFileSync(join(cwd, 'CLAUDE.md'), '# Mine\n\n' + facultiesBlock(1) + '\n\n## After section\n');
    const out = run(cwd);
    assert.match(out, new RegExp(`upgraded → v${BLOCK_VERSION}`));
    const text = readFileSync(join(cwd, 'CLAUDE.md'), 'utf8');
    assert.ok(text.includes(`zuzuu:faculties:v${BLOCK_VERSION}`), 'current version present');
    assert.ok(!text.includes('zuzuu:faculties:v1 '), 'old version gone');
    assert.equal((text.match(/zuzuu:faculties:v\d+/g) || []).length, 1, 'exactly one block');
    assert.ok(text.startsWith('# Mine'), 'user heading intact');
    assert.ok(text.includes('## After section'), 'trailing user content intact');
  });
});
