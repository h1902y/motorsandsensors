import { useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { GitStatusEntry } from "@zuzuu-web/protocol";
import { api } from "../lib/api";
import { useEditor } from "../state/editor";
import { Textarea, Button } from "../components/ui";

const isStaged = (e: GitStatusEntry) => e.index !== " " && e.index !== "?";
const isUnstaged = (e: GitStatusEntry) => e.worktree !== " " || e.index === "?";

function statusLetter(e: GitStatusEntry, staged: boolean): string {
  const c = staged ? e.index : e.worktree;
  if (e.index === "?" && e.worktree === "?") return "U";
  return c === " " ? "" : c;
}

export function GitPanel() {
  const queryClient = useQueryClient();
  const openFileInEditor = useEditor((s) => s.open);
  const [message, setMessage] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["git", "status"],
    queryFn: api.gitStatus,
    refetchInterval: 4000,
    placeholderData: keepPreviousData,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["git"] });
  };

  if (isLoading) return <Empty>loading…</Empty>;
  if (!data?.repo) return <Empty>not a git repository</Empty>;

  const staged = data.entries.filter(isStaged);
  const changes = data.entries.filter((e) => isUnstaged(e) && !isStaged(e));

  const openDiff = (e: GitStatusEntry) =>
    openFileInEditor({ path: e.path, name: e.path.split("/").pop() ?? e.path, diff: true });

  const commit = async () => {
    if (!message.trim() || staged.length === 0) return;
    try {
      await api.gitCommit(message.trim());
      setMessage("");
      refresh();
    } catch (err) {
      window.alert((err as Error).message);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-2 py-1.5 text-meta text-ink-300">
        <span className="rounded-[var(--radius-sm)] bg-hover px-1.5 py-0.5 text-accent-dim">⎇ {data.branch}</span>
        <span className="ml-auto text-ink-500">{data.entries.length} changed</span>
      </div>

      <div className="border-b border-border p-2">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={`Commit message (${staged.length} staged)`}
          rows={2}
        />
        <Button
          variant="primary"
          onClick={() => void commit()}
          disabled={!message.trim() || staged.length === 0}
          className="mt-1.5 w-full"
        >
          Commit
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Section
          title="Staged"
          entries={staged}
          staged
          onClick={openDiff}
          onAction={(e) => void api.gitUnstage([e.path]).then(refresh)}
          actionTitle="Unstage"
          actionIcon="M3 8h10"
        />
        <Section
          title="Changes"
          entries={changes}
          staged={false}
          onClick={openDiff}
          onAction={(e) => void api.gitStage([e.path]).then(refresh)}
          actionTitle="Stage"
          actionIcon="M8 3v10M3 8h10"
        />
        {data.entries.length === 0 && <Empty>no changes</Empty>}
      </div>
    </div>
  );
}

function Section({
  title,
  entries,
  staged,
  onClick,
  onAction,
  actionTitle,
  actionIcon,
}: {
  title: string;
  entries: GitStatusEntry[];
  staged: boolean;
  onClick: (e: GitStatusEntry) => void;
  onAction: (e: GitStatusEntry) => void;
  actionTitle: string;
  actionIcon: string;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="py-1">
      <div className="px-2 py-0.5 text-meta uppercase tracking-wider text-ink-500">
        {title} · {entries.length}
      </div>
      {entries.map((e) => {
        const letter = statusLetter(e, staged);
        return (
          <div
            key={e.path}
            className="group flex cursor-default items-center gap-1.5 px-2 py-0.5 text-ui hover:bg-hover"
            onClick={() => onClick(e)}
            title={e.path}
          >
            <span className="truncate text-ink-100">{e.path.split("/").pop()}</span>
            <span className="truncate text-meta text-ink-500">{e.path.split("/").slice(0, -1).join("/")}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1">
              <button
                onClick={(ev) => {
                  ev.stopPropagation();
                  onAction(e);
                }}
                title={actionTitle}
                className="hidden rounded p-0.5 text-ink-400 hover:bg-hover hover:text-ink-100 group-hover:block"
              >
                <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d={actionIcon} strokeLinecap="round" />
                </svg>
              </button>
              <span className={`w-3 text-center text-meta ${letter === "D" ? "text-danger" : letter === "U" ? "text-accent-dim" : "text-warn"}`}>
                {letter}
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-2 text-ui text-ink-500">{children}</div>;
}
