import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zuzuuApi, describeZuzuuError } from "../lib/zuzuu-api";
import { sessionIndicator } from "../modules/session-git";
import { mergeSessionWithFallback, refreshSessionGit } from "../lib/session-git-actions";
import { MenuPopover, StatusDot, type MenuItem } from "./ui";

/**
 * Footer session-git affordance (replaces the old git-branch item):
 * `● session · N checkpoint(s)` while the session branch is checked out,
 * `◌ unfinished session` (warn) when one was left behind, nothing when
 * session-git is disabled/absent. Click → a small merge/continue popover.
 * Deliberately minimal — Phase ④ builds the full session cards on top of
 * the same zuzuuApi.session* client fns.
 */
export function SessionIndicator({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const session = useQuery({
    queryKey: ["zuzuu", "session"],
    queryFn: zuzuuApi.sessionGit,
    refetchInterval: 6000,
    enabled,
  });
  const ind = sessionIndicator(session.data);
  if (ind.kind === "none") return null;

  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void fn()
      .catch((err: unknown) => window.alert(describeZuzuuError(err)))
      .finally(() => {
        setBusy(false);
        refreshSessionGit(queryClient);
      });
  };

  const items: MenuItem[] = [
    // mergeSessionWithFallback handles the exploration-only refusal
    // (empty squash with checkpoints) by offering a discard instead
    { label: "Merge to main", onClick: () => act(mergeSessionWithFallback), disabled: busy },
    ...(ind.kind === "leftover"
      ? [{ label: "Continue session", onClick: () => act(zuzuuApi.sessionContinue), disabled: busy }]
      : []),
  ];

  // the pure label carries a leading ●/◌ glyph; the restyle replaces it with a
  // StatusDot primitive (warn when a session was left behind, ok when active)
  const text = ind.label.replace(/^[●◌]\s*/, "");
  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setMenuOpen((v) => !v)}
        className={`flex shrink-0 items-center gap-1.5 ${ind.kind === "leftover" ? "text-warn hover:text-warn/80" : "text-ink-300 hover:text-accent"}`}
        title={
          ind.kind === "leftover"
            ? "A session branch was left unmerged — merge or continue it"
            : "zuzuu session branch — checkpoints land here, merge squashes to main"
        }
      >
        <StatusDot tone={ind.kind === "leftover" ? "warn" : "ok"} pulse={ind.kind === "leftover"} />
        {text}
      </button>
      {menuOpen && (
        <MenuPopover items={items} onClose={() => setMenuOpen(false)} anchorEl={btnRef.current} ignore={btnRef} />
      )}
    </>
  );
}
