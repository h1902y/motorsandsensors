// Pure add/remove of mns's hook block in a Claude Code settings.json object.
//
// settings.json is JSON (not line-based), so we can't use supermemory's HTML
// delimiter blocks. Instead we tag our entries by a stable command SIGNATURE and
// add/remove only those — never clobbering the user's own hooks. Idempotent.

export const SIGNATURE = 'mns.mjs hook'; // every mns hook command contains this
// entire-style: agent can't read its own observability output (feedback loop) —
// but ONLY that. The faculty home (.mns/knowledge etc., served by `mns init`)
// must stay readable, so the deny is narrowed to traces/ + live/.
const DENY_RULES = ['Read(./.mns/traces/**)', 'Read(./.mns/live/**)'];
const LEGACY_DENY = 'Read(./.mns/**)'; // pre-init rule — migrated out on add/remove

// Minimal hook set for lifecycle (Design B re-captures the transcript, so we do
// NOT need PreToolUse/PostToolUse — fewer hooks = less intrusion).
export const LIFECYCLE_EVENTS = ['SessionStart', 'Stop', 'SessionEnd'];

const clone = (o) => JSON.parse(JSON.stringify(o ?? {}));
const hasOurs = (matchers) => (matchers || []).some((m) => (m.hooks || []).some((h) => String(h.command).includes(SIGNATURE)));

/**
 * Return a new settings object with mns lifecycle hooks + the deny rule added.
 * @param {object} settings  existing settings.json contents
 * @param {(event:string)=>string} commandFor  builds the command string per event
 */
export function addHooks(settings, commandFor, events = LIFECYCLE_EVENTS) {
  const s = clone(settings);
  s.hooks ||= {};
  for (const ev of events) {
    s.hooks[ev] ||= [];
    if (!hasOurs(s.hooks[ev])) {
      s.hooks[ev].push({ hooks: [{ type: 'command', command: commandFor(ev) }] });
    }
  }
  s.permissions ||= {};
  s.permissions.deny ||= [];
  s.permissions.deny = s.permissions.deny.filter((r) => r !== LEGACY_DENY); // migrate the old blanket rule
  for (const rule of DENY_RULES) if (!s.permissions.deny.includes(rule)) s.permissions.deny.push(rule);
  return s;
}

/** Return a new settings object with only mns's entries removed (others kept). */
export function removeHooks(settings) {
  const s = clone(settings);
  if (s.hooks) {
    for (const ev of Object.keys(s.hooks)) {
      s.hooks[ev] = (s.hooks[ev] || []).filter((m) => !(m.hooks || []).some((h) => String(h.command).includes(SIGNATURE)));
      if (!s.hooks[ev].length) delete s.hooks[ev];
    }
    if (!Object.keys(s.hooks).length) delete s.hooks;
  }
  if (s.permissions?.deny) {
    s.permissions.deny = s.permissions.deny.filter((r) => !DENY_RULES.includes(r) && r !== LEGACY_DENY);
    if (!s.permissions.deny.length) delete s.permissions.deny;
    if (!Object.keys(s.permissions).length) delete s.permissions;
  }
  return s;
}

/** True if mns hooks are present for all lifecycle events. */
export function isInstalled(settings) {
  return LIFECYCLE_EVENTS.every((ev) => hasOurs(settings?.hooks?.[ev]));
}
