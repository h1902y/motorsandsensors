import type { ReactNode } from "react";

/** The one panel section shell: uppercase meta label (+ optional trailing
 *  affordance) over the content. Every panel surface composes this. */
export function Section({
  label,
  trailing,
  children,
}: {
  label: ReactNode;
  trailing?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <div className="wc-eyebrow">{label}</div>
        {trailing && <div className="ml-auto flex shrink-0 items-center gap-2">{trailing}</div>}
      </div>
      {children}
    </div>
  );
}
