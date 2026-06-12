// Miner registry (WS5-T1) — the faculty-mining plugin table.
//
// Each miner is `{ faculty, aggregate(sessions, opts) -> candidates,
// propose(agentDir, candidates) -> count }`. The `--all-faculties` distill driver
// mines every transcript once into a shared `sessions` array, then runs each
// registered miner's aggregate + propose. Miners self-register on import.

const miners = [];

/** Register a miner. Re-registering the same faculty replaces it (idempotent import). */
export function register(miner) {
  const i = miners.findIndex((m) => m.faculty === miner.faculty);
  if (i >= 0) miners[i] = miner;
  else miners.push(miner);
  return miner;
}

/** All registered miners. */
export function all() {
  return miners.slice();
}

/** The miner for a faculty, or undefined. */
export function get(faculty) {
  return miners.find((m) => m.faculty === faculty);
}

/** Clear the registry — tests only. */
export function reset() {
  miners.length = 0;
}
