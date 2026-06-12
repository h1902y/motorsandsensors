import type { FacultyKey } from "@zuzuu-web/protocol";
import { Button } from "../../components/ui";
import { FACULTY_META } from "./kit";

/** The inline empty state that teaches: 48px muted faculty icon, a headline,
 *  ONE teaching sentence, and an optional CTA. */
export function TeachingEmpty({
  facultyKey,
  cta,
}: {
  facultyKey: FacultyKey;
  cta?: { label: string; onClick: () => void };
}) {
  const meta = FACULTY_META[facultyKey];
  return (
    <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
      <svg viewBox="0 0 16 16" className="h-12 w-12 text-ink-600" fill="none" stroke="currentColor" strokeWidth="1.1">
        <path d={meta.icon} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="text-ui font-medium text-ink-300">{meta.emptyHeadline}</div>
      <p className="max-w-60 text-meta leading-relaxed text-ink-500">{meta.teach}</p>
      {cta && (
        <Button size="sm" variant="subtle" onClick={cta.onClick}>
          {cta.label}
        </Button>
      )}
    </div>
  );
}
