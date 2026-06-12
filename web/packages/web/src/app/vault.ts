// Vault (workspace) switching + the session-recording save flow — app-level
// actions that touch several stores at once, kept out of the components.
import type { QueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useEditor } from "../state/editor";
import { useBlocks } from "../state/blocks";
import { useExplorer } from "../state/explorer";
import { useSessions } from "../state/sessions";
import { prompt } from "../components/ui";

/** Switch the daemon's workspace seamlessly — no full reload. Reset the
 *  client stores (the daemon already tore down the old sessions), drop all
 *  cached queries, then re-seed sessions and refetch for the new root. */
export async function switchVault(queryClient: QueryClient, path: string): Promise<void> {
  try {
    await api.switchWorkspace(path);
    useEditor.getState().resetAll();
    useBlocks.getState().resetAll();
    useExplorer.getState().resetAll();
    useSessions.getState().reset(); // unmounts terminals → disposes their sockets
    queryClient.clear();
    await useSessions.getState().init(); // re-seed for the new root
    await queryClient.invalidateQueries(); // workspace/config/files/git…
  } catch (err) {
    window.alert(`Could not open vault: ${(err as Error).message}`);
  }
}

/** Save the active session's output ring buffer as an asciicast file. */
export async function saveRecording(): Promise<void> {
  // read the active session fresh — this is also invoked from a window event
  const s = useSessions.getState();
  const tab = s.tabs.find((t) => t.id === s.activeId);
  if (!tab) return;
  const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
  const path = await prompt({
    title: "Save session recording",
    defaultValue: `recordings/${tab.title}-${stamp}.cast`,
    okLabel: "Save",
  });
  if (!path) return;
  try {
    const res = await api.saveRecording(tab.id, path);
    if (res.truncated) {
      window.alert("Saved — note: the oldest output was dropped (buffer cap reached).");
    }
  } catch (err) {
    window.alert(`Could not save recording: ${(err as Error).message}`);
  }
}
