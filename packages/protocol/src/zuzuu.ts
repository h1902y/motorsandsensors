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

export interface FacultyItem {
  id: string;
  title: string;
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
