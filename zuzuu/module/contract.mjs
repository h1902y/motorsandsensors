// zuzuu/module/contract.mjs
// Canonical per-module paths — single source of truth for the module spine.
// All five us-owned modules; path helpers are pure (no I/O).

import { join } from 'node:path';

export const MODULES = ['knowledge', 'memory', 'actions', 'instructions', 'guardrails'];

/** Root directory for a module under agentDir. */
export const moduleDir = (agentDir, f) => join(agentDir, f);

/** Inbox directory (agent-proposed items awaiting review). */
export const inboxDir = (agentDir, f) => join(agentDir, f, 'inbox');

/** Pending proposals directory. */
export const proposalsDir = (agentDir, f) => join(agentDir, f, 'proposals');

/** Archive directory for resolved (approved/rejected) proposals. */
export const archiveDir = (agentDir, f) => join(agentDir, f, 'proposals', 'archive');
