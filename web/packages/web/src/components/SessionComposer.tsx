// The session composer — the chat-style bottom bar that starts agent
// sessions: "Start a session with…" + inline host chips. Detected hosts
// render solid; others greyed/disabled with "not installed". Enter starts
// the default (the FIRST detected host — composerDefaultHost).
import { forwardRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { buildHostRows, composerDefaultHost, hostSpawnSpec } from "../faculties/host-launch";
import { startAgentSession } from "../lib/agent-launch";
import { Bar, Kbd, cx } from "./ui";

export function startHostRow(rowCommand: string): void {
  const spec = hostSpawnSpec(rowCommand);
  // single-active-agent rule lives in startAgentSession: while one is
  // alive, picking a host focuses it instead of spawning a second one
  if (spec) void startAgentSession(spec).catch((err: Error) => window.alert(err.message));
}

export const SessionComposer = forwardRef<HTMLDivElement>(function SessionComposer(_props, ref) {
  const hostsQ = useQuery({ queryKey: ["zuzuu", "hosts"], queryFn: zuzuuApi.hosts, refetchInterval: 8000 });
  const rows = buildHostRows(hostsQ.data?.hosts ?? []);
  const dflt = composerDefaultHost(rows);

  return (
    <div
      ref={ref}
      tabIndex={0}
      className="wc-focus outline-none"
      onKeyDown={(e) => {
        if (e.key === "Enter" && dflt) {
          e.preventDefault();
          startHostRow(dflt.command);
        }
      }}
    >
      <Bar border="t" surface="surface" className="!h-auto !min-h-[var(--height-bar)] flex-wrap !gap-1.5 py-1.5">
        <span className="shrink-0 text-meta text-ink-500">Start a session with</span>
        {rows.map((row) => {
          const isDefault = row.command === dflt?.command;
          return (
            <button
              key={row.command}
              disabled={!row.detected}
              onClick={() => startHostRow(row.command)}
              className={cx(
                "wc-focus flex shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2 py-0.5 text-meta transition-colors",
                row.detected
                  ? "border-border text-ink-100 hover:border-accent-dim hover:bg-hover"
                  : "cursor-default border-border/60 text-ink-600",
              )}
              title={row.detected ? `Start ${row.label}` : `${row.label} — not installed`}
            >
              {row.label}
              {!row.detected && <span className="text-ink-600">not installed</span>}
            </button>
          );
        })}
        {dflt && (
          <span className="ml-auto hidden shrink-0 items-center gap-1 text-meta text-ink-600 sm:flex">
            <Kbd>↵</Kbd> {dflt.label}
          </span>
        )}
      </Bar>
    </div>
  );
});
