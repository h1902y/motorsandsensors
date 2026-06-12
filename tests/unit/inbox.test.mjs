// tests/unit/inbox.test.mjs (WS-C)
// `home inbox` — what is pending your approval, per faculty. Uses an injected
// `log` (no console scraping) over a temp faculty home.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inbox } from '../../zuzuu/commands/inbox.mjs';

function homeWithKnowledgeProposals(n) {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-inbox-'));
  const home = join(root, '.zuzuu');
  mkdirSync(join(home, 'knowledge', 'proposals'), { recursive: true });
  for (let i = 0; i < n; i++) {
    const id = `fact-${i}`;
    writeFileSync(
      join(home, 'knowledge', 'proposals', `${id}.json`),
      JSON.stringify({
        id,
        faculty: 'knowledge',
        kind: 'item',
        status: 'pending',
        created_at: `2026-01-0${i + 1}T00:00:00.000Z`,
        candidate: { id, type: 'fact', body: `fact number ${i}` },
        er: { verdict: 'new', confidence: 0.9, reason: 'novel' },
      }, null, 2),
    );
  }
  return { root, home };
}

function emptyHome() {
  const root = mkdtempSync(join(tmpdir(), 'zuzuu-inbox-'));
  const home = join(root, '.zuzuu');
  mkdirSync(join(home, 'knowledge', 'proposals'), { recursive: true });
  return { root, home };
}

test('inbox lists pending knowledge proposals + the review hint', () => {
  const { root, home } = homeWithKnowledgeProposals(2);
  try {
    const lines = [];
    inbox({ _: [], agentDir: home }, (s) => lines.push(s));
    const out = lines.join('\n');
    assert.match(out, /knowledge: 2 pending/);
    assert.match(out, /zuzuu review/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('empty home → all caught up', () => {
  const { root, home } = emptyHome();
  try {
    const lines = [];
    inbox({ _: [], agentDir: home }, (s) => lines.push(s));
    const out = lines.join('\n');
    assert.match(out, /all caught up/i);
    assert.doesNotMatch(out, /zuzuu review/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
