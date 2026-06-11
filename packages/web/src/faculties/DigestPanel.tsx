import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";

/** The session-start grounding brief (agent/.live/digest.md). */
export function DigestPanel() {
  const q = useQuery({ queryKey: ["zuzuu", "digest"], queryFn: zuzuuApi.digest, refetchInterval: 6000 });
  const text = q.data?.text ?? "";
  return (
    <div className="flex flex-col gap-2">
      <div className="text-meta uppercase tracking-wide text-ink-500">digest</div>
      {text.trim() === "" ? (
        <div className="text-meta text-ink-600">no digest yet — generated each session</div>
      ) : (
        <pre className="max-h-64 overflow-auto rounded-ui border border-border bg-surface p-3 text-meta text-ink-300 whitespace-pre-wrap">{text}</pre>
      )}
    </div>
  );
}
