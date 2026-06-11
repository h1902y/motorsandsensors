// mns/faculty/provenance.mjs
// Lightweight provenance helpers for the faculty spine.
// A provenance entry is { session, trace, ref } (all optional fields).

/**
 * Build a provenance entry, dropping any undefined keys.
 * @param {{ session?: string, trace?: string, ref?: string }} opts
 * @returns {{ session?: string, trace?: string, ref?: string }}
 */
export function prov({ session, trace, ref } = {}) {
  const entry = {};
  if (session !== undefined) entry.session = session;
  if (trace !== undefined) entry.trace = trace;
  if (ref !== undefined) entry.ref = ref;
  return entry;
}

/**
 * Merge two provenance arrays, deduplicating by `${session}|${ref}`.
 * @param {Array} [a=[]]
 * @param {Array} [b=[]]
 * @returns {Array}
 */
export function mergeProvenance(a = [], b = []) {
  const seen = new Set();
  const result = [];
  for (const entry of [...a, ...b]) {
    const key = `${entry.session ?? ''}|${entry.ref ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
}
