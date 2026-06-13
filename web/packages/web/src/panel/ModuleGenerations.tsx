import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ModuleKey } from "@zuzuu-web/protocol";
import { confirm } from "../components/ui";
import { describeZuzuuError, zuzuuApi } from "../lib/zuzuu-api";
import { relativeTime } from "./kit";

/** ONE module's generation lineage (W2.5 Phase 2: generations are per-module
 *  atoms). Compact list — active marked, mintedAt relative, item count from the
 *  diff's mintedFrom — with a rollback affordance (confirm → byte-exact restore). */
export function ModuleGenerations({ moduleKey }: { moduleKey: ModuleKey }) {
  const queryClient = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["zuzuu", "module", moduleKey, "generations"],
    queryFn: () => zuzuuApi.moduleGenerations(moduleKey),
    refetchInterval: 8000,
  });

  const gens = q.data?.generations ?? [];
  const active = q.data?.active ?? null;

  const rollback = async (id: string) => {
    const ok = await confirm({
      title: `Roll ${moduleKey} back to ${id}?`,
      message: "Restores this module's items to that generation's exact bytes and makes it active. Other modules are untouched.",
      okLabel: "Roll back",
      danger: true,
    });
    if (!ok) return;
    setErr(null);
    setBusy(id);
    try {
      await zuzuuApi.rollbackModule(moduleKey, id);
      void queryClient.invalidateQueries({ queryKey: ["zuzuu"] });
    } catch (e) {
      setErr(describeZuzuuError(e));
    } finally {
      setBusy(null);
    }
  };

  if (gens.length === 0) {
    return (
      <div className="text-meta text-ink-600">
        no generations yet — approving a {moduleKey} proposal mints one
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {gens.map((g) => {
        const isActive = g.id === active;
        return (
          <div key={g.id} className="group flex items-center gap-2 rounded-[var(--radius-sm)] px-1.5 py-1 text-meta hover:bg-hover">
            <span className={isActive ? "text-accent" : "text-ink-600"}>{isActive ? "●" : "○"}</span>
            <span className="font-mono text-ink-200">{g.id}</span>
            {isActive && <span className="text-ink-500">active</span>}
            <span className="text-ink-600">
              {g.mintedFrom.length} item{g.mintedFrom.length === 1 ? "" : "s"}
            </span>
            {g.mintedAt && <span className="ml-auto text-ink-600">{relativeTime(g.mintedAt)}</span>}
            {!isActive && (
              <button
                onClick={() => void rollback(g.id)}
                disabled={busy !== null}
                className={`${g.mintedAt ? "" : "ml-auto"} shrink-0 text-ink-600 opacity-0 transition-opacity hover:text-accent group-hover:opacity-100 disabled:opacity-40`}
                title={`Roll back to ${g.id}`}
              >
                {busy === g.id ? "…" : "roll back"}
              </button>
            )}
          </div>
        );
      })}
      {err && <div className="break-all font-mono text-meta text-danger">{err}</div>}
    </div>
  );
}
