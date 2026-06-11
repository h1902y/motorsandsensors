// mns/miners/memory.mjs
// Memory miner STUB (WS5-T4) — registered no-op; deferred this pass.
//
// WHAT IT WOULD MINE (when implemented):
//   Completed-session episodes — a Run that reached `completed` status in
//   agent/sessions.json — would be distilled into curated episode entries at
//   agent/memory/entries/<id>.md. Each entry captures: what was attempted,
//   key decisions made, outcome, and a set of durable learnings. The miner
//   would emit `memory` proposals of kind 'episode' into
//   agent/memory/proposals/ for human review via `mns review`. Deferred until
//   the Memory substrate (off-edge Postgres/Neon or local Markdown) is
//   established and the session lifecycle state machine is stable enough to
//   reliably produce `completed` runs with rich enough trace data to distill.
//
// Shape: { faculty:'memory', aggregate, propose, stub:true }
// Self-registers on import (no-op).

import { register } from './registry.mjs';

export const miner = {
  faculty: 'memory',
  stub: true,
  aggregate: () => [],
  propose: () => 0,
};

register(miner);
