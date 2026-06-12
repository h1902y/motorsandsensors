import type { TermConnection } from "./connection";

/**
 * Live connections by session id, so non-terminal UI (the file tree's
 * "cd here", Home CTAs, future palette actions) can send input to a session.
 */
const connections = new Map<string, TermConnection>();
const registerWaiters = new Map<string, ((conn: TermConnection) => void)[]>();

export const termRegistry = {
  set: (id: string, conn: TermConnection) => {
    connections.set(id, conn);
    for (const resolve of registerWaiters.get(id) ?? []) resolve(conn);
    registerWaiters.delete(id);
  },
  delete: (id: string) => connections.delete(id),
  get: (id: string | null) => (id ? connections.get(id) : undefined),
  /** Resolves once the session's TermView has mounted (registered a
   *  connection) and its socket is open — then input can be injected. */
  whenReady: async (id: string): Promise<TermConnection> => {
    const conn =
      connections.get(id) ??
      (await new Promise<TermConnection>((resolve) => {
        registerWaiters.set(id, [...(registerWaiters.get(id) ?? []), resolve]);
      }));
    await conn.whenOpen();
    return conn;
  },
};
