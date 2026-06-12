import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { zuzuuApi, describeZuzuuError } from "../lib/zuzuu-api";
import { mergeSessionWithFallback, refreshSessionGit } from "../lib/session-git-actions";
import { startUtilityRun } from "../lib/agent-launch";
import type { EndCard } from "../lib/session-cards";
import { Button, Spinner, confirm } from "./ui";

/**
 * The session-surface center cards: setup (no zuzuu home), recovery
 * (leftover session branch) and end-of-session (agent exit outcome) — the
 * same centered card shell over the terminal area. Starting sessions lives
 * in the bottom SessionComposer, not here.
 */
function Card({ children, onDismiss }: { children: ReactNode; onDismiss?: () => void }) {
  return (
    <div
      className="relative w-full max-w-sm rounded-ui border border-border bg-elevated p-5"
      style={{ boxShadow: "var(--shadow-menu)" }}
    >
      {onDismiss && (
        <button
          onClick={onDismiss}
          title="Dismiss"
          className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] text-ink-500 hover:bg-hover hover:text-ink-100"
        >
          ✕
        </button>
      )}
      {children}
    </div>
  );
}

/** No zuzuu home yet — onboarding takes the start card's slot in the center
 *  pane. Both CTAs run the zuzuu CLI as a utility session (init / enable);
 *  without the CLI on PATH the install banner replaces dead buttons. */
export function SetupZuzuuCard({ zuzuuBin, onDismiss }: { zuzuuBin: boolean; onDismiss?: () => void }) {
  return (
    <Card {...(onDismiss ? { onDismiss } : {})}>
      <div className="text-base font-medium text-ink-100">Set up zuzuu</div>
      <p className="mt-1 text-ui leading-relaxed text-ink-400">
        zuzuu sets up a hidden <code className="text-accent-dim">.zuzuu/</code> home in this project
        (like <code className="text-accent-dim">.git</code>) where your agent&apos;s faculties —
        knowledge, memory, actions, instructions, guardrails — live and grow from real sessions.
      </p>
      {zuzuuBin ? (
        <div className="mt-4 flex flex-col items-start gap-3">
          <Button variant="primary" onClick={() => void startUtilityRun(["init"])}>
            Set up zuzuu
          </Button>
          <div className="text-meta text-ink-500">
            then{" "}
            <button
              className="text-accent-dim underline decoration-dotted underline-offset-2 hover:text-accent"
              onClick={() => void startUtilityRun(["enable"])}
            >
              Enable live capture
            </button>{" "}
            to observe sessions as they happen
          </div>
        </div>
      ) : (
        <div className="mt-4 rounded-[var(--radius-sm)] border border-warn/40 bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-2 text-ui text-warn">
          zuzuu CLI required — <code>npm i -g @zuzuucodes/cli</code>
        </div>
      )}
    </Card>
  );
}

/** "You left work here" — a leftover session branch found on load. */
export function RecoveryCard({ branch, checkpoints }: { branch: string; checkpoints: number }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const act = (fn: () => Promise<unknown>) => {
    setBusy(true);
    void fn()
      .catch((err: unknown) => window.alert(describeZuzuuError(err)))
      .finally(() => {
        setBusy(false);
        refreshSessionGit(queryClient);
      });
  };

  return (
    <Card>
      <div className="text-base font-medium text-ink-100">You left work here</div>
      <p className="mt-1 text-ui leading-relaxed text-ink-400">
        <span className="text-accent-dim">{branch}</span> — {checkpoints} checkpoint
        {checkpoints === 1 ? "" : "s"} from an earlier session.
      </p>
      <div className="mt-4 flex items-center gap-2">
        {/* continue re-checkouts the branch; the host picker then shows so you relaunch */}
        <Button variant="primary" disabled={busy} onClick={() => act(zuzuuApi.sessionContinue)}>
          Continue session
        </Button>
        <Button disabled={busy} onClick={() => act(mergeSessionWithFallback)}>
          Merge &amp; start fresh
        </Button>
        {busy && <Spinner />}
      </div>
    </Card>
  );
}

/** End-of-session card over a dead agent terminal (TermView renders it). */
export function SessionEndCard({
  state,
  onStartNew,
  onCloseTab,
  onDismiss,
}: {
  state: Exclude<EndCard, { kind: "banner" }>;
  onStartNew: () => void;
  onCloseTab: () => void;
  /** fall back to the plain exit banner (e.g. "Keep" on no-net-changes) */
  onDismiss: () => void;
}) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const discard = async () => {
    const ok = await confirm({
      title: "Discard exploration checkpoints",
      message: "Delete the session branch and its checkpoints? main is untouched either way.",
      okLabel: "Discard checkpoints",
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await zuzuuApi.sessionDiscard();
    } catch (err) {
      window.alert(describeZuzuuError(err));
    }
    setBusy(false);
    refreshSessionGit(queryClient);
    onDismiss();
  };

  const startClose = (
    <div className="mt-4 flex items-center gap-2">
      <Button variant="primary" onClick={onStartNew}>Start new session</Button>
      <Button onClick={onCloseTab}>Close tab</Button>
    </div>
  );

  switch (state.kind) {
    case "utility":
      // zuzuu utility runs (init / enable) — no checkpoints, no merge story
      return (
        <Card>
          <div className="text-base font-medium text-ink-100">Session finished</div>
          <div className="mt-4 flex items-center gap-2">
            <Button onClick={onCloseTab}>Close</Button>
          </div>
        </Card>
      );
    case "merged":
      return (
        <Card>
          <div className="text-base font-medium text-ink-100">Session ended — merged to main ✓</div>
          <p className="mt-1 text-ui text-ink-400">
            {state.commits} checkpoint{state.commits === 1 ? "" : "s"} → 1 commit
          </p>
          {startClose}
        </Card>
      );
    case "no-changes":
      return (
        <Card>
          <div className="text-base font-medium text-ink-100">Session ended</div>
          <p className="mt-1 text-ui text-ink-400">No changes to merge — main is untouched.</p>
          {startClose}
        </Card>
      );
    case "cli-absent":
      return (
        <Card onDismiss={onDismiss}>
          <div className="text-base font-medium text-ink-100">Session ended</div>
          <div className="mt-3 rounded-[var(--radius-sm)] border border-warn/40 bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-2 text-ui text-warn">
            zuzuu CLI required to merge session checkpoints —{" "}
            <code>npm i -g @zuzuucodes/cli</code>
          </div>
          {startClose}
        </Card>
      );
    case "no-net-changes":
      return (
        <Card>
          <div className="text-base font-medium text-ink-100">No net changes</div>
          <p className="mt-1 text-ui leading-relaxed text-ink-400">
            {state.checkpoints !== null
              ? `${state.checkpoints} exploration checkpoint${state.checkpoints === 1 ? "" : "s"} retained`
              : "Exploration checkpoints retained"}{" "}
            — the tree ended identical to main.
          </p>
          <div className="mt-4 flex items-center gap-2">
            <Button variant="danger" disabled={busy} onClick={() => void discard()}>
              Discard checkpoints
            </Button>
            <Button disabled={busy} onClick={onDismiss}>Keep</Button>
            {busy && <Spinner />}
          </div>
        </Card>
      );
    case "conflict":
      return (
        <Card onDismiss={onDismiss}>
          <div className="text-base font-medium text-ink-100">Merge hit a conflict</div>
          <p className="mt-1 text-ui leading-relaxed text-ink-400">
            Your checkpoints are safe on the session branch. Resolve in a terminal:{" "}
            <code className="text-accent-dim">zuzuu session merge</code>.
          </p>
          {startClose}
        </Card>
      );
    case "failed":
      return (
        <Card onDismiss={onDismiss}>
          <div className="text-base font-medium text-ink-100">Session merge failed</div>
          <p className="mt-1 break-words text-ui leading-relaxed text-ink-400">{state.message}</p>
          <p className="mt-2 text-meta text-ink-500">
            Checkpoints stay on the session branch — resolve in a terminal.
          </p>
          {startClose}
        </Card>
      );
  }
}
