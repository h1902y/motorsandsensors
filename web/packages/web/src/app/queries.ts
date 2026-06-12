// Shared app-level query hooks + the fs-event → query-invalidation bridge.
// One definition per polled resource so every consumer shares the cache key
// and the refetch cadence (the fs-event bridge is the push path; these
// intervals are the fallback).
import { useEffect } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { zuzuuApi } from "../lib/zuzuu-api";
import { fsEvents } from "../lib/fs-events";

export const useWorkspaceQuery = () =>
  useQuery({ queryKey: ["workspace"], queryFn: api.workspace });

export const useWorkspaceConfigQuery = () =>
  useQuery({ queryKey: ["workspace", "config"], queryFn: api.workspaceConfig });

export const useFilesQuery = () =>
  useQuery({ queryKey: ["files"], queryFn: api.listFiles, staleTime: 30_000, placeholderData: keepPreviousData });

// zuzuu agent surface: health gates everything; status carries generation +
// pending + drift; session-git feeds the footer indicator and recovery card.
export const useZuzuuHealthQuery = () =>
  useQuery({ queryKey: ["zuzuu", "health"], queryFn: zuzuuApi.health, refetchInterval: 8000 });

export const useZuzuuStatusQuery = (enabled: boolean) =>
  useQuery({ queryKey: ["zuzuu", "status"], queryFn: zuzuuApi.status, refetchInterval: 8000, enabled });

export const useSessionGitQuery = (enabled: boolean) =>
  useQuery({ queryKey: ["zuzuu", "session"], queryFn: zuzuuApi.sessionGit, refetchInterval: 6000, enabled });

const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");

/** Start the fs-events socket once the workspace is known and map pushed
 *  paths onto query invalidations (dirs, git, the zuzuu home, previews). */
export function useFsEventBridge(workspaceReady: boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!workspaceReady) return;
    fsEvents.start((path) => {
      void queryClient.invalidateQueries({ queryKey: ["dir", path] });
      void queryClient.invalidateQueries({ queryKey: ["git", "status"] });
      // anything under the zuzuu home → refresh the agent queries (status,
      // overview, digest, eval …); the 4–8s polls remain the fallback
      if (path === ".zuzuu" || path.startsWith(".zuzuu/")) {
        void queryClient.invalidateQueries({ queryKey: ["zuzuu"] });
      }
      // refresh any open preview whose file lives in the changed directory
      void queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === "preview" &&
          typeof q.queryKey[1] === "string" &&
          parentOf(q.queryKey[1]) === path,
      });
    });
    // The home dir + its .live internals (depth-0 watches don't see into
    // subdirs, so digest.md changes need the .live watch). watch() dedupes
    // and re-subscribes after reconnects.
    fsEvents.watch(".zuzuu");
    fsEvents.watch(".zuzuu/.live");
  }, [workspaceReady, queryClient]);
}
