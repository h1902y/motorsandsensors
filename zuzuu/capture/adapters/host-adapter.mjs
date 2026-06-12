// The HostAdapter contract — the host-agnostic seam.
//
// Shape borrowed from entire.io's audited adapter model (inspiration/
// entire-io-host-adapter-audit.md): a small required surface to DETECT a host and
// RESOLVE + PARSE its session transcript, normalizing into the one Event vocabulary.
// The dispatcher (registry/capture) routes by capability, never by host name — so
// the core stays agnostic and a new host is "just another adapter".
//
// Capture today is transcript-parsing, which works for ANY host that writes a
// session log to disk (all of them) and needs zero cooperation from the host.
// Live hooks are an OPTIONAL later capability (HookSupport), not the foundation.
//
// An adapter is a plain object implementing:
//
//   name: string
//       stable adapter id, also the OTel `host.name` (e.g. "claude-code").
//
//   detect(): boolean
//       is this host present on the machine? (its data dir exists)
//
//   listSessions(opts?): Array<{ sessionId, label, ref }>
//       enumerate available sessions. `ref` is whatever parse() needs to load it
//       (a file path, or {file, sessionId} when a file holds many sessions).
//       Sorted most-recent-first when possible.
//
//   parse(ref): import('../core/event.mjs').trace
//       load one session and normalize it into a { host, sessionId, title, events }
//       trace whose events are exactly one SESSION root + its descendants.
//
// Optional (not implemented in Experiment 1):
//   installHooks(), parseHookEvent(stdin) -> Event   // live capture where supported

export const HOST_ADAPTER_KEYS = ['name', 'detect', 'listSessions', 'parse'];

/** Throw if an object doesn't implement the required adapter surface. */
export function assertAdapter(a) {
  for (const k of HOST_ADAPTER_KEYS) {
    if (typeof a?.[k] !== (k === 'name' ? 'string' : 'function')) {
      throw new Error(`invalid HostAdapter: missing ${k}`);
    }
  }
  return a;
}
