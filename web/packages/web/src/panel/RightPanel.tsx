import { useEditor } from "../state/editor";
import { useRightPanel } from "../state/right-panel";
import { EditorPane } from "../editor/EditorPane";
import { Bar, IconButton } from "../components/ui";
import { Dashboard } from "./Dashboard";
import { FacultyView } from "./FacultyView";
import { FACULTY_META } from "./kit";

/**
 * The right panel — ONE surface, two modes:
 * - files: the EditorPane (Monaco tabs + previews) with a `‹ faculties`
 *   affordance that flips modes without closing tabs;
 * - faculties (resting): the dashboard — five FacultyCards ARE the
 *   navigation (no tabs); a card click slides in that faculty's drill-in
 *   (FacultyView). Mode flips themselves live in state/right-panel.ts.
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
  const drillIn = useRightPanel((s) => s.drillIn);
  const showFiles = useRightPanel((s) => s.showFiles);
  const showFaculties = useRightPanel((s) => s.showFaculties);
  const hasEditor = useEditor((s) => s.openFiles.length > 0);

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
      <Bar border="b">
        <span className="min-w-0 truncate text-meta uppercase tracking-wide text-ink-500">
          {drillIn ? `zuzuu · ${FACULTY_META[drillIn].label}` : "zuzuu faculties"}
        </span>
        {hasEditor && (
          <button
            onClick={showFiles}
            className="ml-auto shrink-0 px-1 text-meta text-ink-500 transition-colors hover:text-accent"
            title="Back to the open files"
          >
            files ›
          </button>
        )}
        <IconButton
          title="Collapse panel"
          iconPath="M6 4l4 4-4 4"
          onClick={onCollapse}
          className={hasEditor ? "" : "ml-auto"}
        />
      </Bar>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!zuzuuHome ? (
          <EmptyState zuzuuBin={zuzuuBin} />
        ) : drillIn ? (
          <FacultyView facultyKey={drillIn} />
        ) : (
          <Dashboard zuzuuBin={zuzuuBin} />
        )}
      </div>
    </div>
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
