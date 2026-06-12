// Launch paths for the terminal pane.
//
// All sessions spawn a CLI DIRECTLY on the PTY (POST /api/sessions
// {type:'agent', command, args} — argv, no shell, no stdin injection), so the
// daemon can run the session-git auto-merge when a host exits. There is no
// plain-terminal path: the workbench surfaces host sessions and zuzuu utility
// runs only.
import { useSessions } from "../state/sessions";
import type { AgentSpawnSpec } from "../faculties/host-launch";

/**
 * Start an agent session: direct-spawn the host, tab it, select it. Single-
 * active-agent v1 rule: if an agent session is already alive, focus it
 * instead of spawning a second one.
 */
export async function startAgentSession(spec: AgentSpawnSpec): Promise<void> {
  const s = useSessions.getState();
  const alive = s.tabs.find((t) => t.type === "agent" && t.alive);
  if (alive) {
    s.setActive(alive.id);
    return;
  }
  await s.create({ type: "agent", command: spec.command, args: spec.args, host: spec.host });
}

/**
 * Run the zuzuu CLI itself as a short-lived utility session (onboarding:
 * `zuzuu init` / `zuzuu enable`). Bypasses startAgentSession's focus-existing
 * rule on purpose — a utility run must always spawn, even while a host
 * session is alive. host:'zuzuu' marks the tab so it gets the plain
 * "Session finished" end card instead of the merge story.
 */
export async function startUtilityRun(args: string[]): Promise<void> {
  await useSessions.getState().create({ type: "agent", command: "zuzuu", args, host: "zuzuu" });
}
