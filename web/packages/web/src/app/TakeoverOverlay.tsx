// The calm "this workspace moved to a newer tab" takeover screen. Covers the
// whole app when this tab has been superseded (see state/takeover.ts). Reload
// reclaims the live session for this tab.
import { Button } from "../components/ui";
import { useTakeover } from "../state/takeover";

export function TakeoverOverlay() {
  const superseded = useTakeover((s) => s.superseded);
  if (!superseded) return null;
  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-app px-6 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-[var(--radius-dialog)] bg-hover text-ink-300">
        <svg viewBox="0 0 16 16" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.4">
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M2 6h12M5 3v3" strokeLinecap="round" />
        </svg>
      </span>
      <div className="wc-sans max-w-sm">
        <div className="text-display font-semibold text-ink-100">Opened in another tab</div>
        <p className="mt-1.5 text-ui leading-relaxed text-ink-400">
          Your zuzuu workspace moved to a newer tab — only one can be active at a time, so your session
          lives there now. Reload here to bring it back.
        </p>
      </div>
      <Button variant="primary" onClick={() => window.location.reload()}>Reload to take it back</Button>
    </div>
  );
}
