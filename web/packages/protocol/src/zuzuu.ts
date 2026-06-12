// Shared types for the zuzuu faculties dashboard (the /api/zuzuu/* contract).

export type FacultyKey = "knowledge" | "memory" | "actions" | "instructions" | "guardrails";

export interface ZuzuuHealth {
  home: boolean;
  zuzuuBin: boolean;
}

export interface ZuzuuStatus {
  home: boolean;
  activeGeneration: string | null;
  pending: Record<string, number>;
  drift: { dirty: boolean; items: string[] };
}

export interface FacultySummary {
  key: FacultyKey;
  count: number;
  pending: number;
}

/** One Faculty Standard envelope item (one .md per item: strict frontmatter +
 *  prose body). The daemon passes the CLI's parsed envelope through whole;
 *  when the CLI is absent it degrades to a frontmatter peek — id/kind/title/
 *  status survive, payload/body/provenance may be missing. */
export interface FacultyItem {
  id: string;
  faculty: string;
  /** per-faculty kinds: fact|entity|command|… (knowledge is an open set),
   *  episode, runbook|script, steering|amendment, rule */
  kind: string;
  title: string;
  /** active | archived */
  status?: string;
  created_at?: string;
  updated_at?: string;
  provenance?: Record<string, string>[];
  payload?: Record<string, unknown>;
  body?: string;
}

/** An envelope file the CLI could not parse (fail-soft listing). */
export interface FacultyItemError {
  file: string;
  error: string;
}

export interface ProposalSummary {
  id: string;
  faculty: string;
  title: string;
}

export interface FacultyDetail {
  key: string;
  items: FacultyItem[];
  proposals: ProposalSummary[];
  errors?: FacultyItemError[];
  /** true = zuzuu CLI absent; items are a best-effort frontmatter peek */
  degraded?: boolean;
}

/** GET /faculty/:key/schema — the faculty's payload schema (JSON-Schema
 *  subset) via `zuzuu faculty schema`, falling back to the seeded
 *  .zuzuu/<faculty>/schema.json when the CLI is absent. */
export interface FacultySchema {
  key: string;
  schema: unknown;
  source: "cli" | "home" | "absent";
}

export interface InboxResponse {
  pending: ProposalSummary[];
  total: number;
}

export interface GenerationSummary {
  id: string;
  mintedAt: string | null;
  mintedFrom: string[];
}

export interface GenerationList {
  active: string | null;
  generations: GenerationSummary[];
}

export interface GenerationDiff {
  id: string;
  forkedFrom: string | null;
  mintedFrom: string[];
  faculties: Record<string, { added?: string[]; changed?: string[] | boolean; removed?: string[] }>;
}

export interface SessionsResponse {
  sessions: unknown[];
}

export interface DigestResponse {
  text: string;
}

// ── Write side (mutations are CLI-only; the daemon shells out to zuzuu) ──

/** GET /eval — a proposal as ranked by `zuzuu eval`; nulls when the CLI is
 *  absent and the daemon fell back to an unranked file-read listing. */
export interface RankedProposal {
  id: string;
  faculty: string;
  title: string;
  score: number | null;
  confidence: string | null;
  rationale: string | null;
}

export interface EvalResponse {
  ranked: RankedProposal[];
}

/** GET /hosts — from `zuzuu status`; cliAbsent means the CLI wasn't runnable. */
export interface HostsResponse {
  hosts: { name: string }[];
  cliAbsent: boolean;
}

/** POST /proposals/:id/approve and /actions/:slug/approve */
export interface ApproveResult {
  ok: boolean;
  action?: string;
  itemIds?: string[];
  warnings?: string[];
}

/** POST /proposals/:id/reject and /actions/:slug/reject */
export interface RejectResult {
  ok: boolean;
  id?: string;
}

/** POST /generation/mint */
export interface MintResult {
  id: string;
  mintedFrom: string[];
  forkedFrom: string | null;
}

/** POST /generation/:id/rollback */
export interface RollbackResult {
  ok: boolean;
  restored: number;
  active: string;
}

// ── Session-git (invisible session branch: agent session = zz/session-*) ──

export interface SessionGitActive {
  branch: string;
  checkpoints: number;
  dirty: boolean;
  /** checkpoints exist but the tree equals main (exploration-only session) */
  noNetChanges: boolean;
}

/** GET /api/zuzuu/session — `zuzuu session status --json`;
 *  cliAbsent:true when the zuzuu CLI wasn't runnable. */
export interface SessionGitStatus {
  enabled: boolean;
  mainBranch?: string | null;
  active?: SessionGitActive | null;
  onSessionBranch?: boolean;
  cliAbsent?: boolean;
}

/** `zuzuu session merge --json` (also the agent-exit auto-merge). */
export interface SessionMergeResult {
  ok: boolean;
  /** squash commit sha, or null when the session had no changes */
  mergedAs?: string | null;
  /** branch the squash landed on */
  mergedTo?: string;
  commits?: number;
  branch?: string;
  conflict?: boolean;
  /** e.g. 'no-session-branch' | 'empty-squash-with-checkpoints' */
  reason?: string;
  warning?: string;
  restoredTo?: string | null;
}

/** Stored on a daemon session after the agent-exit auto-merge ran;
 *  read via GET /api/sessions/:id. */
export type SessionCloseResult =
  | { cliAbsent: true }
  | { ok: true; merge: SessionMergeResult }
  | { ok: false; stderr?: string; refusal?: Record<string, unknown> };
