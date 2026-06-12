// zuzuu/faculty/contract.mjs
// Canonical per-faculty paths — single source of truth for the faculty spine.
// All five us-owned faculties; path helpers are pure (no I/O).

import { join } from 'node:path';

export const FACULTIES = ['knowledge', 'memory', 'actions', 'instructions', 'guardrails'];

/** Root directory for a faculty under agentDir. */
export const facultyDir = (agentDir, f) => join(agentDir, f);

/** Inbox directory (agent-proposed items awaiting review). */
export const inboxDir = (agentDir, f) => join(agentDir, f, 'inbox');

/** Pending proposals directory. */
export const proposalsDir = (agentDir, f) => join(agentDir, f, 'proposals');

/** Archive directory for resolved (approved/rejected) proposals. */
export const archiveDir = (agentDir, f) => join(agentDir, f, 'proposals', 'archive');
