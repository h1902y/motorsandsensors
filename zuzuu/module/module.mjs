// zuzuu/module/module.mjs — the Module contract (2026-06-13 spec).
//
// A module = a MANIFEST (<module>/module.json in the home) + an ITEMS
// collection (Module Standard envelopes under manifest.itemsDir) + a set of
// named HOOK exports (built-ins: zuzuu/modules/<id>/index.mjs):
//
//   manifest                                  — the machine contract (this file's shape)
//   miner = { module, aggregate, propose }   — REQUIRED for code modules
//   digestSection(agentDir, ctx)              — optional; default = "N item(s)" line
//   evalSignals(proposal)                     — optional; default mechanical scorer
//   gate(toolCall)                            — optional; ONLY guardrails today
//   applyProposal(agentDir, proposal)         — the adapter's apply
//   validate(agentDir, payload)               — the adapter's validate
//
// Host law (fail-soft everywhere): every hook call is try-wrapped (+ time-boxed
// for miner-class hooks) by the registry — a broken module degrades to
// items-only, never crashes the CLI, the gate, or a host hook.
//
// Manifest-only folders (module.json with NO code) are DECLARATIVE modules:
// they get items listing, card UI, schema validation and the default digest
// line today; third-party CODE loading is deferred (W4).

/** The module-API version this host speaks. Majors above this are skipped. */
export const CONTRACT_VERSION = 1;

/**
 * Normalize a raw manifest object into the full contract shape (defaults
 * filled, id forced to the module's directory name when absent). Pure.
 * @param {object} raw      parsed module.json (or {})
 * @param {string} dirName  the module folder name (fallback id)
 */
export function normalizeManifest(raw = {}, dirName = 'module') {
  const id = typeof raw.id === 'string' && raw.id ? raw.id : dirName;
  const title = typeof raw.title === 'string' && raw.title ? raw.title : id.charAt(0).toUpperCase() + id.slice(1);
  return {
    id,
    title,
    tagline: typeof raw.tagline === 'string' ? raw.tagline : '',
    version: typeof raw.version === 'string' ? raw.version : '1.0.0',
    contract: Number.isFinite(raw.contract) ? raw.contract : CONTRACT_VERSION,
    kinds: Array.isArray(raw.kinds) ? raw.kinds.map(String) : [],
    itemsDir: typeof raw.itemsDir === 'string' && raw.itemsDir ? raw.itemsDir : 'items',
    schema: typeof raw.schema === 'string' && raw.schema ? raw.schema : 'schema.json',
    hooks: {
      miner: !!raw.hooks?.miner,
      digest: !!raw.hooks?.digest,
      eval: !!raw.hooks?.eval,
      gate: !!raw.hooks?.gate,
    },
    ui: {
      icon: typeof raw.ui?.icon === 'string' ? raw.ui.icon : 'folder',
      accent: typeof raw.ui?.accent === 'string' ? raw.ui.accent : 'neutral',
      teaching: typeof raw.ui?.teaching === 'string' ? raw.ui.teaching : '',
    },
  };
}

/** Is a manifest's contract version one this host can serve? (major gate) */
export function compatibleContract(manifest) {
  return Math.floor(manifest?.contract ?? CONTRACT_VERSION) <= CONTRACT_VERSION;
}

/**
 * Validate a manifest's required fields. Returns {ok, errors} — never throws.
 * (Normalization already fills defaults; this flags the truly broken.)
 */
export function validateManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') return { ok: false, errors: ['not an object'] };
  if (!manifest.id || !/^[a-z0-9][a-z0-9_-]*$/.test(manifest.id)) errors.push(`id must be a slug (got '${manifest.id}')`);
  if (!manifest.title) errors.push('title is required');
  if (!compatibleContract(manifest)) errors.push(`contract ${manifest.contract} > host contract ${CONTRACT_VERSION} — skipped`);
  return { ok: errors.length === 0, errors };
}
