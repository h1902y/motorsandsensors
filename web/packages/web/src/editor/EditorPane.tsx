import { lazy, Suspense } from "react";
import { categorize } from "../preview/filetypes";
import { useEditor, editorTabId, type OpenFile } from "../state/editor";
import { MediaViewer, MarkdownPreview } from "./MediaViewer";
import { localFileActions } from "../lib/local-actions";
import { Bar, TabBar, Tab, ActionMenu } from "../components/ui";

// Lazy boundary: keeps the whole Monaco graph (editor + language workers,
// ~10MB) out of the main bundle until the first file opens.
const MonacoFile = lazy(() => import("./MonacoFile"));
const DiffTab = lazy(() => import("./DiffTab"));

function EditorFallback() {
  return <div className="flex h-full items-center justify-center text-ui text-ink-500">loading editor…</div>;
}

const EDITABLE = new Set(["code", "markdown"]);

export function EditorPane() {
  const openFiles = useEditor((s) => s.openFiles);
  const activePath = useEditor((s) => s.activePath);
  const buffers = useEditor((s) => s.buffers);
  const mdPreview = useEditor((s) => s.mdPreview);
  const { setActive, close, toggleMdPreview } = useEditor();

  if (openFiles.length === 0) return null;
  const active = openFiles.find((f) => editorTabId(f) === activePath) ?? openFiles[0]!;

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface">
      <Bar border="b" surface="surface" className="!gap-0 overflow-x-auto !px-0">
        <TabBar>
          {openFiles.map((f) => {
            const id = editorTabId(f);
            const isMd = !f.diff && categorize(f.name) === "markdown";
            const previewing = mdPreview[id] ?? false;
            return (
              <Tab
                key={id}
                active={id === activePath}
                onClick={() => setActive(id)}
                onClose={() => close(id)}
                dirty={buffers[id]?.dirty}
                title={f.path}
                className="border-r border-border"
                leading={f.diff ? <span className="text-meta text-accent-dim">diff</span> : undefined}
                trailing={
                  isMd ? (
                    <span
                      role="button"
                      tabIndex={-1}
                      title={previewing ? "Edit" : "Preview"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleMdPreview(id);
                      }}
                      className={`flex h-4 w-4 items-center justify-center rounded-[var(--radius-sm)] hover:bg-elevated ${
                        previewing ? "text-accent" : "text-ink-500 hover:text-ink-200"
                      }`}
                    >
                      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.4">
                        {previewing ? (
                          <path d="M11 3l2 2-7 7H4v-2l7-7z" strokeLinecap="round" strokeLinejoin="round" />
                        ) : (
                          <>
                            <path d="M1 8s2.5-4.5 7-4.5S15 8 15 8s-2.5 4.5-7 4.5S1 8 1 8z" />
                            <circle cx="8" cy="8" r="1.6" />
                          </>
                        )}
                      </svg>
                    </span>
                  ) : undefined
                }
              >
                {f.name}
              </Tab>
            );
          })}
        </TabBar>
      </Bar>
      <ActiveBody file={active} />
    </div>
  );
}

function ActiveBody({ file }: { file: OpenFile }) {
  const mdPreview = useEditor((s) => s.mdPreview[editorTabId(file)] ?? false);
  const buffer = useEditor((s) => s.buffers[editorTabId(file)]);

  if (file.diff) {
    return (
      <div className="min-h-0 flex-1">
        <Suspense fallback={<EditorFallback />}>
          <DiffTab path={file.path} name={file.name} />
        </Suspense>
      </div>
    );
  }

  const category = categorize(file.name);
  const isMarkdown = category === "markdown";
  const editable = EDITABLE.has(category);

  return (
    <>
      {editable && (
        <Bar border="b" className="text-meta text-ink-500">
          <span className="truncate">{file.path}</span>
          {buffer?.dirty && <span className="ml-auto shrink-0 text-ink-500">⌘S to save</span>}
          <ActionMenu items={localFileActions(file.path)} className={buffer?.dirty ? "shrink-0" : "ml-auto shrink-0"} />
        </Bar>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {isMarkdown && mdPreview ? (
          <MarkdownPreview path={file.path} text={buffer?.value ?? ""} />
        ) : editable ? (
          <Suspense fallback={<EditorFallback />}>
            <MonacoFile path={file.path} name={file.name} />
          </Suspense>
        ) : (
          <MediaViewer file={file} />
        )}
      </div>
    </>
  );
}
