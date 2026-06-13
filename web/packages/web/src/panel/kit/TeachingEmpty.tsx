import { Button } from "../../components/ui";
import { moduleHue, type ModuleDisplay } from "./kit";

/** The inline empty state that teaches: 48px muted module icon, a headline,
 *  ONE teaching sentence, and an optional CTA. Display comes from the
 *  manifest ui descriptor (moduleDisplay), so declarative modules teach
 *  too. */
export function TeachingEmpty({
  display,
  moduleId,
  cta,
}: {
  display: ModuleDisplay;
  /** the module's id — tints the empty-state icon with its identity hue */
  moduleId?: string;
  cta?: { label: string; onClick: () => void };
}) {
  const hue = moduleId ? moduleHue(moduleId) : "var(--color-ink-600)";
  return (
    <div className="wc-rise-in flex flex-col items-center gap-2.5 px-4 py-7 text-center">
      <span
        className="mb-0.5 flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{
          background: `color-mix(in oklab, ${hue} 10%, transparent)`,
          boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${hue} 18%, transparent)`,
        }}
      >
        <svg viewBox="0 0 16 16" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="1.1" style={{ color: `color-mix(in oklab, ${hue} 78%, var(--color-ink-400))` }}>
          <path d={display.icon} strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="wc-sans text-title font-semibold text-ink-200">{display.emptyHeadline}</div>
      <p className="wc-sans max-w-64 text-meta leading-relaxed text-ink-500">{display.teach}</p>
      {cta && (
        <Button size="sm" variant="subtle" onClick={cta.onClick}>
          {cta.label}
        </Button>
      )}
    </div>
  );
}
