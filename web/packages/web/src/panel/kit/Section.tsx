import type { ReactNode } from "react";

/** The one panel section shell: uppercase meta label (+ optional trailing
 *  affordance) over the content. Every panel surface composes this. */
export function Section({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <div className="text-meta uppercase tracking-wide text-ink-500">{label}</div>
        {trailing && <div className="ml-auto flex shrink-0 items-center gap-2">{trailing}</div>}
      </div>
      {children}
    </div>
  );
}
