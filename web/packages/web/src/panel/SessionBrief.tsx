// The Session brief — the digest renamed: "what the agent was told now"
// (.zuzuu/.live/digest.md, regenerated each session). Renders UNDER the
// pinned active session in §2 as a one-line disclosure; expandable inline,
// openable in the editor.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { useExplorer } from "../state/explorer";
import { DIGEST_PATH } from "./faculty-paths";

export function SessionBrief() {
  const q = useQuery({ queryKey: ["zuzuu", "digest"], queryFn: zuzuuApi.digest, refetchInterval: 6000 });
  const [expanded, setExpanded] = useState(false);
  const text = q.data?.text ?? "";
  const hasText = text.trim() !== "";
  return (
    <div className="flex flex-col gap-1.5 border-l-2 border-border pl-2.5">
      <div className="flex items-baseline gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-baseline gap-1 text-meta text-ink-500 transition-colors hover:text-ink-300"
          title={expanded ? "Collapse the session brief" : "Expand the session brief"}
        >
          <span className="inline-block w-2">{expanded ? "▾" : "▸"}</span>
          Session brief
        </button>
        {!expanded && (
          <span className="min-w-0 truncate text-meta text-ink-600">
            {hasText ? (text.trim().split("\n")[0] ?? "") : "none yet"}
          </span>
        )}
        {hasText && (
          <button
            onClick={() => useExplorer.getState().openPreviewPath(DIGEST_PATH)}
            className="ml-auto shrink-0 text-meta text-ink-500 hover:text-accent"
            title={`Open ${DIGEST_PATH} in the editor`}
          >
            open ›
          </button>
        )}
      </div>
      {expanded &&
        (!hasText ? (
          <div className="text-meta text-ink-600">no brief yet — generated each session</div>
        ) : (
          <pre className="max-h-36 overflow-auto whitespace-pre-wrap rounded-ui border border-border bg-surface p-card text-meta text-ink-300">{text}</pre>
        ))}
    </div>
  );
}
