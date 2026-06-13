import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { zuzuuApi, describeZuzuuError } from "../lib/zuzuu-api";
import { mergeSessionWithFallback, refreshSessionGit } from "../lib/session-git-actions";
import { startUtilityRun } from "../lib/agent-launch";
import { blockReceipt, type EndCard } from "../lib/session-cards";
import { useBlocks } from "../state/blocks";
import type { Block } from "../term/blocks";
import { Button, Receipt, Spinner, StatusDot, confirm } from "./ui";

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
        (like <code className="text-accent-dim">.git</code>) where your agent&apos;s modules —
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

// ── Receipts transcript (Task 6) ─────────────────────────────────────────
// The session pane's DEFAULT surface: the host session rendered as a calm
// conversation of one-line receipts instead of a wall of monospace. The raw
// terminal is demoted to a sibling tab. Receipts are driven entirely by the
// real OSC-133 command blocks (useBlocks store) the terminal already emits —
// no invented data shape, no new daemon API. The expandable body shows the
// raw command (machine data → mono); full output lives in the Terminal tab.

const GLYPH: Record<ReturnType<typeof blockReceipt>["glyph"], string> = {
  // play triangle — a command run
  run: "M5 3.5l7 4.5-7 4.5z",
  // pencil — a file edit
  edit: "M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z",
  // shield — a guarded / destructive command
  guardrail: "M8 2l5 2v4c0 3-2.2 5-5 6-2.8-1-5-3-5-6V4z",
  // magnifier — a search
  search: "M10.5 10.5L14 14M7 12A5 5 0 117 2a5 5 0 010 10z",
  // branch — a git command (two nodes joined by a curve)
  git: "M5 5.5v5M5 3a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM5 10.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM11 3a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM11 6c0 3-3 3-6 4.5",
};

/**
 * The session-as-conversation transcript. One `<Receipt>` per command block:
 * a humanist sans label ("Ran npm test"), machine detail (duration, exit code)
 * in the mono meta chip, expandable to the raw command. Substantial commands
 * (multi-line) read as the body inside the same receipt. A running command at
 * the tail renders as a spinner step; a session that has gone quiet shows the
 * calm paused banner — together the green-check / spinner step rhythm.
 */
export function SessionTranscript({
  sessionId,
  alive,
}: {
  sessionId: string;
  /** the PTY is still attached — drives the paused-vs-running tail state */
  alive: boolean;
}) {
  const blocks = useBlocks((s) => s.bySession[sessionId]) ?? [];
  const runnable = blocks.filter((b) => b.command.trim().length > 0);
  const running = runnable.some((b) => b.exitCode === null);

  if (runnable.length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <p className="max-w-xs text-ui leading-relaxed text-ink-500">
          This session&apos;s activity will appear here as a timeline of receipts.
          The raw terminal lives in the <span className="text-ink-300">Terminal</span> tab.
        </p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-2xl flex-col gap-0.5 px-4 py-4">
        {runnable.map((block) => (
          <TranscriptReceipt key={block.id} block={block} />
        ))}
        {/* paused / running tail — the explicit awaiting-input state */}
        <div className="mt-2 px-2">
          {running ? (
            <div className="flex items-center gap-2 text-ui text-ink-300">
              <Spinner /> Working…
            </div>
          ) : (
            <PausedBanner alive={alive} />
          )}
        </div>
      </div>
    </div>
  );
}

function TranscriptReceipt({ block }: { block: Block }) {
  const r = blockReceipt(block);
  const multiline = block.command.includes("\n");
  return (
    <Receipt
      icon={GLYPH[r.glyph]}
      label={r.label}
      meta={r.meta ?? (r.running ? "running…" : undefined)}
      tone={r.tone}
    >
      {/* expandable body — the raw command is machine data → mono */}
      <pre className="wc-mono whitespace-pre-wrap break-words text-meta text-ink-400">
        {multiline ? block.command : `$ ${block.command}`}
      </pre>
    </Receipt>
  );
}

/**
 * "Paused — waiting for your input." The calm awaiting-input banner the design
 * calls for (Replit's paused state), shown when an alive session has no running
 * command. A dead session reads as ended, not paused.
 */
export function PausedBanner({ alive }: { alive: boolean }) {
  if (!alive) {
    return (
      <div className="flex items-center gap-2 text-ui text-ink-500">
        <StatusDot tone="idle" /> Session ended.
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 rounded-[var(--radius-ui)] border border-border bg-elevated px-3 py-2 text-ui text-ink-300">
      <StatusDot tone="ok" pulse />
      Paused — waiting for your input.
    </div>
  );
}
