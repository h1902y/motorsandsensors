// The normalized Event — the host-agnostic vocabulary of a run.
//
// This is the seam entire.io calls "one Event": every HostAdapter normalizes its
// native log into Events, and the core turns Events into OTel spans. Nothing here
// knows about Claude Code, Gemini, or OpenTelemetry wire format — swap either side
// without touching this. The README calls this normalized Event "the basis of our
// trace-span schema."
//
// An Event is a span-precursor. Its tree position is expressed purely by ids:
//   refId       — stable unique id of THIS event within the trace
//   parentRefId — refId of its parent, or null for the root
// The core wires parent_span_id = spanId(parentRefId); adapters never compute spans.

/** Semantic kinds. Adapters express as rich a tree as the host's log allows. */
export const EventKind = Object.freeze({
  SESSION: 'session', // the root: one host session
  TURN: 'turn', // one user-prompt -> response cycle (a Run/Episode boundary)
  TOOL_CALL: 'tool_call', // one tool invocation
});

export const Status = Object.freeze({ UNSET: 'unset', OK: 'ok', ERROR: 'error' });

/**
 * @param {object} e
 * @param {string} e.kind         one of EventKind
 * @param {string} e.refId        stable unique id within the trace
 * @param {string|null} e.parentRefId  parent's refId, or null for root
 * @param {string} e.name         span name
 * @param {number} e.startMs      epoch ms (span start)
 * @param {number} [e.endMs]      epoch ms (span end); defaults to startMs (zero-duration)
 * @param {string} [e.status]     one of Status; default UNSET
 * @param {object} [e.attributes] flat key->value (string|number|boolean)
 */
export function event({ kind, refId, parentRefId = null, name, startMs, endMs, status = Status.UNSET, attributes = {} }) {
  if (!refId) throw new Error(`event: refId required (kind=${kind}, name=${name})`);
  return {
    kind,
    refId: String(refId),
    parentRefId: parentRefId == null ? null : String(parentRefId),
    name: name ?? kind,
    startMs: Number(startMs) || 0,
    endMs: endMs == null ? Number(startMs) || 0 : Number(endMs),
    status,
    attributes,
  };
}

/**
 * A normalized trace as produced by an adapter.
 * @param {object} t
 * @param {string} t.host       adapter name, e.g. "claude-code"
 * @param {string} t.sessionId  the host's session identifier
 * @param {string} [t.title]    human label
 * @param {Event[]} t.events    exactly one SESSION root + descendants
 */
export function trace({ host, sessionId, title = '', events }) {
  return { host, sessionId: String(sessionId), title, events };
}
