// The Session primitive — the lifecycle model for an agent coding session.
//
// A Session is the unit motors&sensors tracks: it OPENS when an agent session
// starts and CLOSES when it ends — cleanly (completed), or by being lost/killed
// (abandoned/crashed, reconciled after the fact since a killed terminal sends no
// signal). The state machine below is the contract for that lifecycle.
//
// Phase 1 (post-hoc transcript capture) records sessions as `captured` — a
// lifecycle-unknown snapshot. Phase 2 (live hooks) drives the real transitions:
// opening → active → completed | abandoned | crashed. The full machine is defined
// now so the primitive is stable before live wiring lands.

export const SessionState = Object.freeze({
  OPENING: 'opening', // hook fired session-start; root span opened
  ACTIVE: 'active', // turns/tools flowing
  COMPLETED: 'completed', // clean end (Stop / explicit close)
  ABANDONED: 'abandoned', // no activity past the liveness window; reconciled
  CRASHED: 'crashed', // process/terminal died mid-session; reconciled
  CAPTURED: 'captured', // Phase 1 post-hoc snapshot; lifecycle not tracked live
});

const TERMINAL = new Set([
  SessionState.COMPLETED,
  SessionState.ABANDONED,
  SessionState.CRASHED,
  SessionState.CAPTURED,
]);

// Legal live transitions (Phase 2 enforces these). CAPTURED is post-hoc, off-machine.
const TRANSITIONS = {
  [SessionState.OPENING]: [SessionState.ACTIVE, SessionState.CRASHED, SessionState.ABANDONED],
  [SessionState.ACTIVE]: [SessionState.COMPLETED, SessionState.ABANDONED, SessionState.CRASHED],
  [SessionState.COMPLETED]: [],
  [SessionState.ABANDONED]: [],
  [SessionState.CRASHED]: [],
  [SessionState.CAPTURED]: [],
};

export const isTerminal = (state) => TERMINAL.has(state);
export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

/** Apply a lifecycle transition, throwing on an illegal one. Returns a new record. */
export function transition(session, to, at = session.endedAt) {
  if (!canTransition(session.status, to)) {
    throw new Error(`illegal session transition: ${session.status} -> ${to}`);
  }
  const endedAt = isTerminal(to) ? at : session.endedAt;
  const durationMs = endedAt && session.startedAt ? Date.parse(endedAt) - Date.parse(session.startedAt) : session.durationMs;
  return { ...session, status: to, endedAt, durationMs };
}

/**
 * Build a Session record (the git-native index entry).
 * @param {object} s
 * @param {string} s.id            host session id
 * @param {string} s.host          adapter name
 * @param {string} [s.status]      SessionState; default CAPTURED (Phase 1)
 * @param {string} s.startedAt     ISO
 * @param {string} s.endedAt       ISO
 * @param {string} s.traceId
 * @param {string} s.traceRef      path to the OTLP blob (gitignored)
 * @param {{commit:string|null,branch:string|null}} [s.git]
 * @param {{turns:number,tools:number,errors:number}} [s.counts]
 * @param {string|null} [s.generation]  active generation id at session open (WS3-T3)
 */
export function makeSession({ id, host, status = SessionState.CAPTURED, startedAt, endedAt, traceId, traceRef, git = { commit: null, branch: null }, counts = { turns: 0, tools: 0, errors: 0 }, generation = null }) {
  if (!id) throw new Error('makeSession: id required');
  if (!host) throw new Error('makeSession: host required');
  if (!Object.values(SessionState).includes(status)) throw new Error(`makeSession: unknown status ${status}`);
  const durationMs = startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : 0;
  return { id: String(id), host, status, startedAt, endedAt, durationMs, traceId, traceRef, git, counts, generation };
}
