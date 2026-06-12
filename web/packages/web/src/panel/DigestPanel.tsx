import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { useExplorer } from "../state/explorer";
import { DIGEST_PATH } from "./faculty-paths";

/** The session-start grounding brief (.zuzuu/.live/digest.md). `compact`
 *  (the Pulse tab) shows a short peek + an open-in-editor affordance. */
export function DigestPanel({ compact = false }: { compact?: boolean }) {
  const q = useQuery({ queryKey: ["zuzuu", "digest"], queryFn: zuzuuApi.digest, refetchInterval: 6000 });
  const text = q.data?.text ?? "";
  const hasText = text.trim() !== "";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-meta uppercase tracking-wide text-ink-500">digest</span>
        {compact && hasText && (
          <button
            onClick={() => useExplorer.getState().openPreviewPath(DIGEST_PATH)}
            className="ml-auto text-meta text-ink-500 hover:text-accent"
            title={`Open ${DIGEST_PATH} in the editor`}
          >
            open ›
          </button>
        )}
      </div>
      {!hasText ? (
        <div className="text-meta text-ink-600">no digest yet — generated each session</div>
      ) : (
        <pre className={`${compact ? "max-h-36" : "max-h-64"} overflow-auto rounded-ui border border-border bg-surface p-3 text-meta text-ink-300 whitespace-pre-wrap`}>{text}</pre>
      )}
    </div>
  );
}
