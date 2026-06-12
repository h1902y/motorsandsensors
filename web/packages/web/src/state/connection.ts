import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

export type ConnState = "connected" | "reconnecting" | "disconnected";

/**
 * Daemon connectivity, driven by a health poll (covers daemon-down even with
 * no terminal open). React Query keeps polling on the interval even after an
 * error, so recovery is detected automatically.
 */
export function useConnection(): {
  state: ConnState;
  uptimeMs: number | null;
  rss: number | null;
} {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 5000,
    retry: false,
    // treat a stale-but-present value as still "have data" until the next poll
    staleTime: 4000,
  });

  let state: ConnState = "connected";
  if (health.isError) state = "disconnected";
  else if (health.isLoading && !health.data) state = "reconnecting";

  return {
    state,
    uptimeMs: health.data?.uptimeMs ?? null,
    rss: health.data?.rss ?? null,
  };
}
