import { useState } from "react";
import { Overlay, Dialog, Button, ProgressBar, StatusDot, Kbd, cx } from "../components/ui";

// ── Step definitions ──────────────────────────────────────────────────────────
// Each maps to a real zuzuu action. "open-folder" is completed by virtue of
// being in the workbench; the remaining three are still to-do on first launch.

interface Step {
  id: string;
  title: string;
  subtitle: string;
  /** present only when there's a copyable CLI command — machine data → wc-mono */
  cli?: string;
  detail: string;
}

const STEPS: Step[] = [
  {
    id: "open-folder",
    title: "Open a project folder",
    subtitle: "Your workspace is ready.",
    detail:
      "You're working inside the workbench right now. Everything stays local — no upload, no sync.",
  },
  {
    id: "init",
    title: "Create your module home",
    subtitle: "One command scaffolds the .zuzuu/ home.",
    cli: "zz init",
    detail:
      "This creates a hidden .zuzuu/ directory — your agent's Knowledge, Memory, Actions, Instructions, and Guardrails. Think of it as the .git of your agent.",
  },
  {
    id: "connect-host",
    title: "Connect a host agent",
    subtitle: "Claude Code, Gemini CLI, Codex — pick one.",
    cli: "zz code",
    detail:
      "zuzuu wraps the host you already use. Running zz code drops you into a zuzuu-aware Claude Code session; observation starts automatically.",
  },
  {
    id: "first-session",
    title: "Run a session and read your digest",
    subtitle: "After your first session zuzuu proposes what it learned.",
    cli: "zz digest",
    detail:
      "Every session is captured as a trace. zuzuu mines it, proposes facts and actions, and writes a digest — a briefing your agent reads at the start of every future session.",
  },
];

// ── Utility ───────────────────────────────────────────────────────────────────

function useCopyText(text: string) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return { copied, copy };
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function CliChip({ command }: { command: string }) {
  const { copied, copy } = useCopyText(command);
  return (
    <div className="mt-3 flex items-center gap-2 rounded-[var(--radius-ui)] border border-border bg-app px-3 py-2">
      {/* CLI command is machine data — wc-mono is correct here */}
      <span className="wc-mono flex-1 text-ui text-accent">{command}</span>
      <button
        onClick={copy}
        title="Copy command"
        className="wc-focus shrink-0 rounded-[var(--radius-sm)] px-2 py-0.5 text-meta text-ink-500 transition-colors hover:bg-hover hover:text-ink-100"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

interface StepRowProps {
  step: Step;
  state: "completed" | "active" | "upcoming";
  index: number;
}

function StepRow({ step, state, index }: StepRowProps) {
  const isCompleted = state === "completed";
  const isActive = state === "active";

  return (
    <div
      className={cx(
        "rounded-[var(--radius-ui)] border px-4 py-3 transition-colors",
        isActive
          ? "border-border-strong bg-elevated"
          : isCompleted
            ? "border-border bg-surface opacity-60"
            : "border-border bg-surface",
      )}
    >
      {/* Row header — always visible */}
      <div className="flex items-start gap-3">
        {/* Step glyph */}
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
          {isCompleted ? (
            <StatusDot tone="ok" title="Completed" />
          ) : isActive ? (
            <span className="wc-sans text-meta font-semibold text-accent">{index + 1}</span>
          ) : (
            <span className="wc-mono text-meta text-ink-600">{index + 1}</span>
          )}
        </div>

        {/* Title + subtitle */}
        <div className="min-w-0 flex-1">
          <div
            className={cx(
              "wc-sans text-ui font-semibold",
              isCompleted ? "text-ink-500" : isActive ? "text-ink-100" : "text-ink-400",
            )}
          >
            {step.title}
          </div>
          <div className={cx("wc-sans mt-0.5 text-meta", isActive ? "text-ink-400" : "text-ink-500")}>
            {step.subtitle}
          </div>
        </div>

        {/* Completed badge */}
        {isCompleted && (
          <span className="wc-sans mt-0.5 shrink-0 text-meta text-ink-500">Done</span>
        )}
      </div>

      {/* Expanded detail — active step only */}
      {isActive && (
        <div className="wc-rise-in ml-8 mt-3">
          <p className="wc-sans text-meta leading-relaxed text-ink-400">{step.detail}</p>
          {step.cli && <CliChip command={step.cli} />}
        </div>
      )}
    </div>
  );
}

// ── Keyboard tips row (kept from original, restyled) ─────────────────────────

function KeyboardTips() {
  return (
    <div className="grid grid-cols-3 gap-2 text-ui">
      <Tip kbd="⌘K" label="Jump to a file or command" />
      <Tip kbd="⌘R" label="Re-run a recent command" />
      <Tip kbd="⌘⇧O" label="Switch workspace" />
    </div>
  );
}

function Tip({ kbd, label }: { kbd: string; label: string }) {
  return (
    <div className="rounded-[var(--radius-ui)] border border-border bg-surface p-2">
      <div className="mb-0.5">
        <Kbd>{kbd}</Kbd>
      </div>
      <div className="wc-sans mt-1 text-meta text-ink-500">{label}</div>
    </div>
  );
}

// ── Completion card ───────────────────────────────────────────────────────────

function CompletionCard({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="wc-graduate rounded-[var(--radius-ui)] border border-border bg-elevated px-5 py-5 text-center">
      <div className="mb-1 text-xl">✦</div>
      <div className="wc-sans text-title font-semibold text-ink-100">Your agent is ready</div>
      <p className="wc-sans mt-1.5 text-meta leading-relaxed text-ink-400">
        zuzuu will observe your sessions and propose what it learned. Every approval makes your
        agent a little smarter.
      </p>
      <Button variant="primary" className="mt-4" onClick={onDismiss}>
        Start working
      </Button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * First-run welcome — a Graphite-style accordion checklist.
 * Steps auto-advance as the user acknowledges them; completed steps are
 * greyed with a check; the active step is expanded with its detail + any
 * copyable CLI command. Progress shown in words + a slim ProgressBar.
 */
export function WelcomeOverlay({
  workspaceName,
  onOpenVaultPicker,
  onDismiss,
}: {
  workspaceName?: string;
  onOpenVaultPicker: () => void;
  onDismiss: () => void;
}) {
  // Step 0 (open-folder) is considered done by default — the user is already in
  // the workbench. The active step starts at 1.
  const [activeIndex, setActiveIndex] = useState(1);
  const [allDone, setAllDone] = useState(false);

  const completedCount = activeIndex; // steps 0..activeIndex-1 are completed
  const totalSteps = STEPS.length;
  const progress = completedCount / totalSteps;

  const advance = () => {
    if (activeIndex >= totalSteps - 1) {
      setAllDone(true);
    } else {
      setActiveIndex((i) => i + 1);
    }
  };

  return (
    <Overlay onClose={onDismiss}>
      <Dialog width="md" className="wc-pop-in">
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="border-b border-border px-5 pt-5 pb-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h1 className="wc-sans text-title font-semibold text-ink-100">
                Get started with zuzuu
              </h1>
              <p className="wc-sans mt-0.5 text-meta text-ink-500">
                Working in{" "}
                <span className="wc-mono text-accent">{workspaceName ?? "this folder"}</span>
              </p>
            </div>
            <button
              onClick={onDismiss}
              title="Close"
              className="wc-focus shrink-0 rounded-[var(--radius-sm)] p-1 text-ink-500 hover:text-ink-100"
            >
              <svg
                viewBox="0 0 16 16"
                className="h-3.5 w-3.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M4 4l8 8m0-8l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          {/* Progress: words + bar */}
          {!allDone && (
            <div className="mt-3 space-y-1.5">
              <div className="wc-sans flex items-center justify-between text-meta text-ink-500">
                <span>
                  Step {Math.min(completedCount + 1, totalSteps)} of {totalSteps}
                </span>
                <span>~3 min</span>
              </div>
              <ProgressBar value={progress} tone="ok" />
            </div>
          )}
        </div>

        {/* ── Body ───────────────────────────────────────────────────── */}
        <div className="space-y-2 p-4">
          {allDone ? (
            <CompletionCard onDismiss={onDismiss} />
          ) : (
            <>
              {STEPS.map((step, i) => {
                const state =
                  i < activeIndex ? "completed" : i === activeIndex ? "active" : "upcoming";
                return <StepRow key={step.id} step={step} state={state} index={i} />;
              })}

              {/* Active step actions */}
              <div className="flex items-center gap-2 pt-1">
                <button
                  onClick={onDismiss}
                  className="wc-focus wc-sans text-meta text-ink-500 hover:text-ink-300"
                >
                  Skip for now
                </button>
                <div className="ml-auto flex items-center gap-2">
                  <Button variant="subtle" onClick={onOpenVaultPicker}>
                    Open a different folder…
                  </Button>
                  <Button variant="primary" onClick={advance}>
                    {activeIndex >= totalSteps - 1 ? "Finish" : "Done — next step"}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Keyboard tips footer ───────────────────────────────────── */}
        {!allDone && (
          <div className="border-t border-border px-4 py-3">
            <div className="wc-eyebrow mb-2">Quick shortcuts</div>
            <KeyboardTips />
          </div>
        )}
      </Dialog>
    </Overlay>
  );
}
