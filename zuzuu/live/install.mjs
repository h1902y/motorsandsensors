// Pure add/remove of zuzuu's hook block in a Claude Code settings.json object.
//
// settings.json is JSON (not line-based), so we can't use supermemory's HTML
// delimiter blocks. Instead we tag our entries by a stable command SIGNATURE and
// add/remove only those — never clobbering the user's own hooks. Idempotent.

export const SIGNATURE = 'zuzuu.mjs'; // appears in every zuzuu hook command path, quote-agnostic
const tagged = (cmd) => String(cmd).includes(SIGNATURE);
// entire-style: agent can't read its own observability output (feedback loop) —
// but ONLY that. The faculty home (agent/knowledge etc., served by `zuzuu init`)
// must stay readable, so the deny is narrowed to .traces/ + .live/.
const DENY_RULES = ['Read(./agent/.traces/**)', 'Read(./agent/.live/**)'];

// Minimal hook set: lifecycle (Design B re-captures the transcript — no
// PostToolUse needed) + the PreToolUse Guardrails GATE (the one place we *do*
// sit on the hot path: it evaluates agent/guardrails/rules.json per tool call,
// fails open, and stays silent unless a rule matches).
export const LIFECYCLE_EVENTS = ['SessionStart', 'Stop', 'SessionEnd'];
export const GATE_EVENTS = ['PreToolUse'];
const ALL_EVENTS = [...LIFECYCLE_EVENTS, ...GATE_EVENTS];

const clone = (o) => JSON.parse(JSON.stringify(o ?? {}));
const hasOurs = (matchers) => (matchers || []).some((m) => (m.hooks || []).some((h) => tagged(h.command)));

/** Pure hook add for ANY host's {hooks:{Event:[{hooks:[…]}]}} config. No permissions. */
export function addHookEntries(settings, commandFor, events) {
  const s = clone(settings);
  s.hooks ||= {};
  for (const ev of events) {
    s.hooks[ev] ||= [];
    if (!hasOurs(s.hooks[ev])) s.hooks[ev].push({ hooks: [{ type: 'command', command: commandFor(ev) }] });
  }
  return s;
}

/** Pure hook remove (only zuzuu entries) for ANY host. */
export function removeHookEntries(settings) {
  const s = clone(settings);
  if (s.hooks) {
    for (const ev of Object.keys(s.hooks)) {
      s.hooks[ev] = (s.hooks[ev] || []).filter((m) => !(m.hooks || []).some((h) => tagged(h.command)));
      if (!s.hooks[ev].length) delete s.hooks[ev];
    }
    if (!Object.keys(s.hooks).length) delete s.hooks;
  }
  return s;
}

/**
 * Return a new settings object with zuzuu lifecycle hooks + the deny rule added.
 * @param {object} settings  existing settings.json contents
 * @param {(event:string)=>string} commandFor  builds the command string per event
 */
export function addHooks(settings, commandFor, events = ALL_EVENTS) {
  const s = addHookEntries(settings, commandFor, events);
  s.permissions ||= {};
  s.permissions.deny ||= [];
  for (const rule of DENY_RULES) if (!s.permissions.deny.includes(rule)) s.permissions.deny.push(rule);
  return s;
}

/** Return a new settings object with only zuzuu's entries removed (others kept). */
export function removeHooks(settings) {
  const s = removeHookEntries(settings);
  if (s.permissions?.deny) {
    s.permissions.deny = s.permissions.deny.filter((r) => !DENY_RULES.includes(r));
    if (!s.permissions.deny.length) delete s.permissions.deny;
    if (s.permissions && !Object.keys(s.permissions).length) delete s.permissions;
  }
  return s;
}

/** True if zuzuu hooks are present for all lifecycle + gate events. */
export function isInstalled(settings) {
  return ALL_EVENTS.every((ev) => hasOurs(settings?.hooks?.[ev]));
}
