import { lazy, Suspense } from "react";
import { useEditor } from "../state/editor";
import { useRightPanel } from "../state/right-panel";
import { Bar, IconButton } from "../components/ui";
import { PanelRoot } from "./PanelRoot";
import { ModuleView } from "./ModuleView";
import { SessionDetail } from "./SessionDetail";
import { moduleDisplay } from "./kit";
import { shortSessionId } from "./sections";

// Lazy boundary: the editor pane graph (Monaco wrapper, markdown/CSV/cast
// previews) rides its own chunk — loaded the first time a file opens.
const EditorPane = lazy(() =>
  import("../editor/EditorPane").then((m) => ({ default: m.EditorPane })));

/**
 * The right panel — ONE surface, two modes:
 * - files: the EditorPane (Monaco tabs + previews) with a `‹ modules`
 *   affordance that flips modes without closing tabs;
 * - modules (resting): the panel root (three sections — needs you /
 *   sessions / modules); a tile click slides in that module's view, a
 *   session row slides in its detail. Mode flips live in state/right-panel.
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
  const drill = useRightPanel((s) => s.drill);
  const showFiles = useRightPanel((s) => s.showFiles);
  const showModules = useRightPanel((s) => s.showModules);
  const hasEditor = useEditor((s) => s.openFiles.length > 0);

  // the store flips to modules when the last tab closes; this guard only
  // covers the first render after a reload with a stale 'files' mode
  if (mode === "files" && hasEditor) {
    return (
      <Suspense fallback={<div className="flex h-full items-center justify-center text-ui text-ink-500">loading editor…</div>}>
        <EditorPane
          leading={
            <button
              onClick={showModules}
              className="shrink-0 self-stretch border-r border-border px-2 text-meta text-ink-500 transition-colors hover:text-accent"
              title="Show modules (editor tabs stay open)"
            >
              ‹ modules
            </button>
          }
        />
      </Suspense>
    );
  }

  const title =
    drill === null
      ? "zuzuu"
      : drill.kind === "module"
        ? `zuzuu · ${moduleDisplay(drill.key).label}`
        : `zuzuu · session ${shortSessionId(drill.id)}`;

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface">
      <Bar border="b">
        <span className="wc-eyebrow min-w-0 truncate">
          {title}
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
        ) : drill?.kind === "module" ? (
          <ModuleView moduleKey={drill.key} />
        ) : drill?.kind === "session" ? (
          <SessionDetail sessionId={drill.id} />
        ) : (
          <PanelRoot zuzuuBin={zuzuuBin} />
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
        Once set up, your agent&apos;s modules — knowledge, memory, actions,
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
