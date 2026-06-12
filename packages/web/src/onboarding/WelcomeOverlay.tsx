import { Overlay, Dialog, Button } from "../components/ui";

/** First-run welcome — shown until the user has been onboarded. */
export function WelcomeOverlay({
  workspaceName,
  onOpenVaultPicker,
  onDismiss,
}: {
  workspaceName?: string;
  onOpenVaultPicker: () => void;
  onDismiss: () => void;
}) {
  return (
    <Overlay onClose={onDismiss}>
      <Dialog className="p-7">
        <div className="mb-1 text-3xl text-accent">❯_</div>
        <h1 className="text-base font-semibold text-ink-100">Welcome to zuzuu-web</h1>
        <p className="mt-1.5 text-body leading-relaxed text-ink-300">
          A native-feeling terminal, file explorer, and editor for your machine — in the browser.
          You're working in{" "}
          <span className="text-accent">{workspaceName ?? "this folder"}</span>. Everything stays
          local.
        </p>

        <div className="mt-5 grid grid-cols-3 gap-2 text-ui">
          <Tip kbd="⌘K" label="Jump to a file or command" />
          <Tip kbd="⌘R" label="Re-run a recent command" />
          <Tip kbd="⌘⇧O" label="Switch workspace" />
        </div>

        <div className="mt-6 flex items-center gap-2">
          <Button variant="subtle" onClick={onOpenVaultPicker}>
            Open a different folder…
          </Button>
          <Button variant="primary" onClick={onDismiss} className="ml-auto px-4">
            Start working
          </Button>
        </div>
      </Dialog>
    </Overlay>
  );
}

function Tip({ kbd, label }: { kbd: string; label: string }) {
  return (
    <div className="rounded-[var(--radius-ui)] border border-border bg-surface p-2">
      <div className="font-mono text-accent">{kbd}</div>
      <div className="mt-0.5 text-ink-400">{label}</div>
    </div>
  );
}
