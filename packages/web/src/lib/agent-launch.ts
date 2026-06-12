// Create a terminal session and type a command into it — the Home CTAs'
// "start an agent session" / "zuzuu init" path. Reuses the exact new-tab path
// the + button uses (useSessions.create → api.createSession + setActive) and
// the workflow injection convention (\x15 kill-line, then the command, then ⏎).
import { useSessions } from "../state/sessions";
import { useView } from "../state/view";
import { termRegistry } from "../term/registry";

export async function launchInTerminal(command: string): Promise<void> {
  await useSessions.getState().create(); // appends a tab and makes it active
  const id = useSessions.getState().activeId;
  if (!id) return;
  // TermView instances only mount in the IDE view — switch first so the new
  // session's connection gets created, then wait for its socket to open.
  useView.getState().setMode("ide");
  const conn = await termRegistry.whenReady(id);
  conn.sendInput(`\x15${command}\r`);
}
