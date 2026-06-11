// mns/faculty/contract.mjs
// Canonical per-faculty paths — single source of truth for the faculty spine.
// All five us-owned faculties; path helpers are pure (no I/O).

import { join } from 'node:path';

export const FACULTIES = ['knowledge', 'memory', 'actions', 'instructions', 'guardrails'];

/** Root directory for a faculty under mnsDir. */
export const facultyDir = (mnsDir, f) => join(mnsDir, f);

/** Inbox directory (agent-proposed items awaiting review). */
export const inboxDir = (mnsDir, f) => join(mnsDir, f, 'inbox');

/** Pending proposals directory. */
export const proposalsDir = (mnsDir, f) => join(mnsDir, f, 'proposals');

/** Archive directory for resolved (approved/rejected) proposals. */
export const archiveDir = (mnsDir, f) => join(mnsDir, f, 'proposals', 'archive');
