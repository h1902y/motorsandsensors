import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSession, transition, canTransition, isTerminal, SessionState } from '../../zuzuu/session.mjs';

test('makeSession requires id and host, defaults to CAPTURED, computes duration', () => {
  assert.throws(() => makeSession({ host: 'h' }), /id required/);
  assert.throws(() => makeSession({ id: '1' }), /host required/);
  const s = makeSession({
    id: 1,
    host: 'claude-code',
    startedAt: '2026-06-09T10:00:00.000Z',
    endedAt: '2026-06-09T10:00:10.000Z',
  });
  assert.equal(s.id, '1');
  assert.equal(s.status, SessionState.CAPTURED);
  assert.equal(s.durationMs, 10_000);
  // WS3-T3: generation defaults to null
  assert.equal(s.generation, null);
});

test('makeSession: generation param threads through', () => {
  const s = makeSession({
    id: 'sess-1',
    host: 'claude-code',
    generation: 'gen_003',
    startedAt: '2026-06-09T10:00:00.000Z',
    endedAt: '2026-06-09T10:00:01.000Z',
  });
  assert.equal(s.generation, 'gen_003');
});

test('makeSession rejects an unknown status', () => {
  assert.throws(() => makeSession({ id: '1', host: 'h', status: 'bogus' }), /unknown status/);
});

test('lifecycle: legal transitions allowed, illegal rejected', () => {
  assert.ok(canTransition(SessionState.OPENING, SessionState.ACTIVE));
  assert.ok(canTransition(SessionState.ACTIVE, SessionState.COMPLETED));
  assert.ok(canTransition(SessionState.ACTIVE, SessionState.CRASHED));
  assert.ok(!canTransition(SessionState.COMPLETED, SessionState.ACTIVE));
  assert.ok(!canTransition(SessionState.CAPTURED, SessionState.ACTIVE));
});

test('terminal states are terminal; live states are not', () => {
  for (const s of [SessionState.COMPLETED, SessionState.ABANDONED, SessionState.CRASHED, SessionState.CAPTURED])
    assert.ok(isTerminal(s));
  for (const s of [SessionState.OPENING, SessionState.ACTIVE]) assert.ok(!isTerminal(s));
});

test('transition() applies a legal move and stamps endedAt/duration on terminal', () => {
  const open = makeSession({ id: '1', host: 'h', status: SessionState.OPENING, startedAt: '2026-06-09T10:00:00.000Z', endedAt: '2026-06-09T10:00:00.000Z' });
  const active = transition(open, SessionState.ACTIVE);
  assert.equal(active.status, SessionState.ACTIVE);
  const done = transition(active, SessionState.COMPLETED, '2026-06-09T10:05:00.000Z');
  assert.equal(done.status, SessionState.COMPLETED);
  assert.equal(done.endedAt, '2026-06-09T10:05:00.000Z');
  assert.equal(done.durationMs, 300_000);
});

test('transition() throws on an illegal move', () => {
  const done = makeSession({ id: '1', host: 'h', status: SessionState.COMPLETED, startedAt: '2026-06-09T10:00:00.000Z', endedAt: '2026-06-09T10:00:01.000Z' });
  assert.throws(() => transition(done, SessionState.ACTIVE), /illegal session transition/);
});
