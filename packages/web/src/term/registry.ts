import type { TermConnection } from "./connection";

/**
 * Live connections by session id, so non-terminal UI (the file tree's
 * "cd here", future palette actions) can send input to the active session.
 */
const connections = new Map<string, TermConnection>();

export const termRegistry = {
  set: (id: string, conn: TermConnection) => connections.set(id, conn),
  delete: (id: string) => connections.delete(id),
  get: (id: string | null) => (id ? connections.get(id) : undefined),
};
