import { Suspense, lazy, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ModuleKey } from "@zuzuu-web/protocol";
import { api } from "../lib/api";
import { zuzuuApi } from "../lib/zuzuu-api";
import { useExplorer } from "../state/explorer";
import { schemaFields } from "./schema-fields";
import { moduleReadmePath, moduleSchemaPath } from "./module-paths";

// MarkdownView pulls in shiki — lazy so the module panel stays light until the
// README is actually opened.
const MarkdownView = lazy(() =>
  import("../preview/MarkdownView").then((m) => ({ default: m.MarkdownView })),
);

const openInEditor = (path: string) => useExplorer.getState().openPreviewPath(path);

/** schema.json → a readable field list (name · type · required · enum), with an
 *  "open file ›" escape hatch to Monaco for the full JSON. */
export function SchemaView({ moduleKey }: { moduleKey: ModuleKey }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["zuzuu", "module", moduleKey, "schema"],
    queryFn: () => zuzuuApi.moduleSchema(moduleKey),
  });
  const fields = schemaFields(q.data?.schema);

  return (
    <div className="flex flex-col gap-2">
      <button onClick={() => setOpen((v) => !v)} className="self-start text-meta text-ink-500 hover:text-accent">
        {open ? "▾" : "▸"} schema
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 rounded-ui border border-border bg-surface p-2.5">
          {q.isLoading && <div className="text-meta text-ink-600">loading…</div>}
          {!q.isLoading && fields.length === 0 && (
            <div className="text-meta text-ink-600">no readable fields — open the file for the raw schema</div>
          )}
          {fields.map((f) => (
            <div key={f.name} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-meta">
              <span className="font-mono text-ink-100">{f.name}</span>
              <span className="text-ink-500">{f.type}</span>
              {f.required && <span className="text-warn">required</span>}
              {f.enumValues && (
                <span className="font-mono text-ink-400">{f.enumValues.join(" | ")}</span>
              )}
              {f.constraint && <span className="text-ink-600">{f.constraint}</span>}
            </div>
          ))}
          <button
            onClick={() => openInEditor(moduleSchemaPath(moduleKey))}
            className="mt-1 self-start text-meta text-ink-600 hover:text-accent"
            title={moduleSchemaPath(moduleKey)}
          >
            open file ›
          </button>
        </div>
      )}
    </div>
  );
}

/** README.md → rendered markdown (reuses the preview MarkdownView), with an
 *  "open file ›" escape hatch. Fetched on demand. */
export function ReadmeView({ moduleKey }: { moduleKey: ModuleKey }) {
  const [open, setOpen] = useState(false);
  const path = moduleReadmePath(moduleKey);
  const q = useQuery({
    queryKey: ["zuzuu", "module", moduleKey, "readme"],
    queryFn: () => api.readFile(path),
    enabled: open,
  });

  return (
    <div className="flex flex-col gap-2">
      <button onClick={() => setOpen((v) => !v)} className="self-start text-meta text-ink-500 hover:text-accent">
        {open ? "▾" : "▸"} README
      </button>
      {open && (
        <div className="rounded-ui border border-border bg-surface">
          {q.isLoading && <div className="p-2.5 text-meta text-ink-600">loading…</div>}
          {q.isError && <div className="p-2.5 text-meta text-ink-600">no README yet</div>}
          {q.data && (
            <Suspense fallback={<div className="p-2.5 text-meta text-ink-600">rendering…</div>}>
              <div className="max-h-80 overflow-y-auto text-ui">
                <MarkdownView path={path} text={q.data} />
              </div>
            </Suspense>
          )}
          <button
            onClick={() => openInEditor(path)}
            className="m-2.5 self-start text-meta text-ink-600 hover:text-accent"
            title={path}
          >
            open file ›
          </button>
        </div>
      )}
    </div>
  );
}
