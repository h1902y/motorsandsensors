import { useQuery } from "@tanstack/react-query";
import { zuzuuApi } from "../lib/zuzuu-api";
import { useEditor } from "../state/editor";
import { useRightPanel } from "../state/right-panel";
import { EditorPane } from "../editor/EditorPane";
import { Bar, IconButton, cx } from "../components/ui";
import { PulseTab } from "./PulseTab";
import { FacultyTab } from "./FacultyTab";
import { FACULTY_TABS, badgeLabel } from "./faculty-paths";

/**
 * The right panel — ONE surface, two modes:
 * - files: the EditorPane (Monaco tabs + previews) with a `‹ faculties`
 *   affordance that flips modes without closing tabs;
 * - faculties (resting): Pulse · Knowledge · Memory · Actions · Instructions ·
 *   Guardrails tab strip (pending badges), plus a `files ›` return chip while
 *   editor tabs exist. Mode flips themselves live in state/right-panel.ts.
 */
export function RightPanel({
  zuzuuHome,
  zuzuuBin,
  onCollapse,
}: {
  zuzuuHome: boolean;
  zuzuuBin: boolean;
  onCollapse: () => void;
}) {
  const mode = useRightPanel((s) => s.mode);
  const facultyTab = useRightPanel((s) => s.facultyTab);
  const setFacultyTab = useRightPanel((s) => s.setFacultyTab);
  const showFiles = useRightPanel((s) => s.showFiles);
  const showFaculties = useRightPanel((s) => s.showFaculties);
  const hasEditor = useEditor((s) => s.openFiles.length > 0);
  const facultiesQ = useQuery({
    queryKey: ["zuzuu", "faculties"],
    queryFn: zuzuuApi.faculties,
    refetchInterval: 8000,
    enabled: zuzuuHome,
  });
  const pendingOf = (key: string) =>
    facultiesQ.data?.faculties.find((f) => f.key === key)?.pending;

  // the store flips to faculties when the last tab closes; this guard only
  // covers the first render after a reload with a stale 'files' mode
  if (mode === "files" && hasEditor) {
    return (
      <EditorPane
        leading={
          <button
            onClick={showFaculties}
            className="shrink-0 self-stretch border-r border-border px-2 text-meta text-ink-500 transition-colors hover:text-accent"
            title="Show faculties (editor tabs stay open)"
          >
            ‹ faculties
          </button>
        }
      />
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface">
      <Bar border="b" className="!gap-0 !px-1">
        <div className="flex h-full min-w-0 flex-1 items-stretch overflow-x-auto">
          <PanelTabButton active={facultyTab === "pulse"} onClick={() => setFacultyTab("pulse")}>
            Pulse
          </PanelTabButton>
          {FACULTY_TABS.map((t) => (
            <PanelTabButton
              key={t.key}
              active={facultyTab === t.key}
              badge={badgeLabel(pendingOf(t.key))}
              onClick={() => setFacultyTab(t.key)}
            >
              {t.label}
            </PanelTabButton>
          ))}
        </div>
        {hasEditor && (
          <button
            onClick={showFiles}
            className="shrink-0 px-2 text-meta text-ink-500 transition-colors hover:text-accent"
            title="Back to the open files"
          >
            files ›
          </button>
        )}
        <IconButton title="Collapse panel" iconPath="M6 4l4 4-4 4" onClick={onCollapse} />
      </Bar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!zuzuuHome ? (
          <EmptyState zuzuuBin={zuzuuBin} />
        ) : facultyTab === "pulse" ? (
          <PulseTab />
        ) : (
          <FacultyTab facultyKey={facultyTab} />
        )}
      </div>
    </div>
  );
}

function PanelTabButton({
  active,
  badge,
  onClick,
  children,
}: {
  active: boolean;
  badge?: string | null;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "relative flex shrink-0 items-center gap-1 px-2 text-meta transition-colors",
        active ? "text-ink-100" : "text-ink-500 hover:text-ink-300",
      )}
    >
      {active && <span className="absolute inset-x-1 -bottom-px h-px bg-accent" />}
      {children}
      {badge != null && (
        <span className="rounded-full bg-[color-mix(in_oklab,var(--color-accent)_18%,transparent)] px-1 text-[10px] leading-4 text-accent">
          {badge}
        </span>
      )}
    </button>
  );
}

/** No zuzuu home yet — the center pane owns setup; the panel stays quiet. */
function EmptyState({ zuzuuBin }: { zuzuuBin: boolean }) {
  return (
    <div className="flex flex-col gap-2 p-4 text-ui leading-relaxed text-ink-500">
      <div className="text-ink-300">No zuzuu home in this project yet.</div>
      <p>
        Once set up, your agent&apos;s faculties — knowledge, memory, actions,
        instructions, guardrails — live here and grow from real sessions.
      </p>
      {!zuzuuBin && (
        <p className="text-meta">
          zuzuu CLI required — <code className="text-warn">npm i -g @zuzuucodes/cli</code>
        </p>
      )}
    </div>
  );
}
