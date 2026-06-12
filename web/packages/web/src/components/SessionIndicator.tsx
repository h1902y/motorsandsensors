import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { zuzuuApi, describeZuzuuError } from "../lib/zuzuu-api";
import { mergeRefusalReason, sessionIndicator } from "../faculties/session-git";
import { MenuPopover, confirm, type MenuItem } from "./ui";

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

  // merge/continue/discard all move branches around — refresh everything git-shaped
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["zuzuu", "session"] });
    void queryClient.invalidateQueries({ queryKey: ["git", "status"] });
    void queryClient.invalidateQueries({ queryKey: ["dir"] });
    void queryClient.invalidateQueries({ queryKey: ["files"] });
  };

  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void fn()
      .catch((err: unknown) => window.alert(describeZuzuuError(err)))
      .finally(() => {
        setBusy(false);
        refresh();
      });
  };

  const merge = () =>
    act(async () => {
      try {
        await zuzuuApi.sessionMerge();
      } catch (err) {
        // exploration-only session: checkpoints exist but the tree equals
        // main, so the squash would be empty — offer to discard instead
        if (mergeRefusalReason(err) === "empty-squash-with-checkpoints") {
          const ok = await confirm({
            title: "Nothing to merge",
            message:
              "This session only explored — its checkpoints left the tree identical to main. Discard the exploration checkpoints?",
            okLabel: "Discard exploration checkpoints",
            danger: true,
          });
          if (ok) await zuzuuApi.sessionDiscard();
          return;
        }
        throw err;
      }
    });

  const items: MenuItem[] = [
    { label: "Merge to main", onClick: () => merge(), disabled: busy },
    ...(ind.kind === "leftover"
      ? [{ label: "Continue session", onClick: () => act(zuzuuApi.sessionContinue), disabled: busy }]
      : []),
  ];

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setMenuOpen((v) => !v)}
        className={`shrink-0 ${ind.kind === "leftover" ? "text-warn hover:text-warn/80" : "text-ink-300 hover:text-accent"}`}
        title={
          ind.kind === "leftover"
            ? "A session branch was left unmerged — merge or continue it"
            : "zuzuu session branch — checkpoints land here, merge squashes to main"
        }
      >
        {ind.label}
      </button>
      {menuOpen && (
        <MenuPopover items={items} onClose={() => setMenuOpen(false)} anchorEl={btnRef.current} ignore={btnRef} />
      )}
    </>
  );
}
