import { Suspense, lazy, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ModuleKey } from "@zuzuu-web/protocol";
import { api } from "../lib/api";
import { zuzuuApi } from "../lib/zuzuu-api";
import { useExplorer } from "../state/explorer";
import { schemaFields } from "./schema-fields";
import { moduleDisplay } from "./kit";
import { moduleReadmePath, moduleSchemaPath } from "./module-paths";

// MarkdownView pulls in shiki — lazy so the module panel stays light until the
// README is actually opened.
const MarkdownView = lazy(() =>
  import("../preview/MarkdownView").then((m) => ({ default: m.MarkdownView })),
);

const openInEditor = (path: string) => useExplorer.getState().openPreviewPath(path);

// ── Field-type icons (16×16 stroke paths) ─────────────────────────────────
// One small glyph per schema field type — Fibery-style type-icon rows.
// These are deliberately minimal so they read as quiet metadata hints.
const FIELD_TYPE_ICONS: Record<string, string> = {
  string: "M4 5h8M4 8h6M4 11h4",                          // text lines
  number: "M5 4v8M7 6l2-2 2 2M11 6l-2 6",                 // numeric hash
  integer: "M5 4v8M7 6l2-2 2 2M11 6l-2 6",
  boolean: "M4 8a4 4 0 008 0M4 8a4 4 0 008 0M8 6v4",      // toggle circle
  array: "M3 4.5h2v7H3M11 4.5h2v7h-2M5 8h6",             // bracket pair
  object: "M4 4.5l4 3 4-3M4 11.5l4-3 4 3",               // diamond
  "string (enum)": "M3.5 5h3v2h-3zM3.5 9h3v2h-3zM9 6h3.5M9 10h3.5", // enum chips
};
const DEFAULT_FIELD_ICON = "M4.5 2.5h5L12 5v8.5H4.5v-11M9 2.5V5.5H12"; // document

function fieldTypeIcon(type: string): string {
  // strip array<…> wrapper → "array", or use the type directly
  const key = type.startsWith("array") ? "array" : type;
  return FIELD_TYPE_ICONS[key] ?? DEFAULT_FIELD_ICON;
}

/** schema.json → typed-field rows (Fibery-style: type glyph · name · value/meta),
 *  with an "open file ›" escape hatch to Monaco for the full JSON. */
export function SchemaView({ moduleKey }: { moduleKey: ModuleKey }) {
  const [open, setOpen] = useState(false);
  const q = useQuery({
    queryKey: ["zuzuu", "module", moduleKey, "schema"],
    queryFn: () => zuzuuApi.moduleSchema(moduleKey),
  });
  const fields = schemaFields(q.data?.schema);
  const moduleLabel = moduleDisplay(moduleKey).label;

  return (
    <div className="flex flex-col gap-2">
      <button onClick={() => setOpen((v) => !v)} className="wc-sans self-start text-meta text-ink-500 hover:text-accent">
        {open ? "▾" : "▸"} schema
      </button>
      {open && (
        <div className="wc-panel-enter flex flex-col gap-0.5 rounded-ui border border-border bg-surface p-2.5">
          <p className="wc-sans mb-1 text-meta text-ink-600">
            The shape every {moduleLabel.toLowerCase()} entry follows — its fields and types.
          </p>
          {q.isLoading && <div className="text-meta text-ink-600">loading…</div>}
          {!q.isLoading && fields.length === 0 && (
            <div className="text-meta text-ink-600">no readable fields — open the file for the raw schema</div>
          )}
          {fields.map((f) => (
            <div key={f.name} className="flex items-baseline gap-2 py-1 border-b border-border last:border-0">
              {/* type glyph */}
              <svg
                viewBox="0 0 16 16"
                className="mt-0.5 h-3 w-3 shrink-0 text-ink-500"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                aria-hidden
              >
                <path d={fieldTypeIcon(f.type)} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {/* field name */}
              <span className="wc-sans min-w-0 shrink-0 text-ui text-ink-200">{f.name}</span>
              {/* type badge */}
              <span className="text-meta text-ink-500">{f.type}</span>
              {/* required marker */}
              {f.required && (
                <span className="shrink-0 rounded-full bg-[color-mix(in_oklab,var(--color-warn)_14%,transparent)] px-1.5 text-meta leading-4 text-warn">
                  required
                </span>
              )}
              {/* enum values — mono chip */}
              {f.enumValues && (
                <span className="wc-mono ml-auto shrink-0 text-meta text-ink-400">
                  {f.enumValues.join(" | ")}
                </span>
              )}
              {/* constraint hint */}
              {f.constraint && !f.enumValues && (
                <span className="wc-mono ml-auto shrink-0 text-meta text-ink-500">{f.constraint}</span>
              )}
            </div>
          ))}
          <button
            onClick={() => openInEditor(moduleSchemaPath(moduleKey))}
            className="wc-sans mt-1.5 self-start text-meta text-ink-600 hover:text-accent"
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
      <button onClick={() => setOpen((v) => !v)} className="wc-sans self-start text-meta text-ink-500 hover:text-accent">
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
            className="wc-sans m-2.5 self-start text-meta text-ink-600 hover:text-accent"
            title={path}
          >
            open file ›
          </button>
        </div>
      )}
    </div>
  );
}
