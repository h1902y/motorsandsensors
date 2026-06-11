// mns/faculty/registry.mjs
// Faculty adapter registry — a module-level Map keyed by adapter.name.
// Adapters register themselves on import; consumers query by name or list all.
//
// This is the registration surface only. Adapters are added in later work units.

/** @type {Map<string, object>} */
const _registry = new Map();

/**
 * Register an adapter (keyed by adapter.name). Overwrites if already registered.
 * @param {{ name: string, [key: string]: any }} adapter
 */
export function register(adapter) {
  _registry.set(adapter.name, adapter);
}

/**
 * Retrieve a registered adapter by name. Returns undefined if not found.
 * @param {string} name
 * @returns {{ name: string, [key: string]: any } | undefined}
 */
export function get(name) {
  return _registry.get(name);
}

/**
 * Return all registered adapters as an array.
 * @returns {Array<{ name: string, [key: string]: any }>}
 */
export function all() {
  return [..._registry.values()];
}
