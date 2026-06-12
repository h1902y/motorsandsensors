import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useExplorer } from "../state/explorer";
import { Field, IconButton } from "../components/ui";
import { canSearch, MIN_QUERY_LEN, shiftRanges } from "./search-logic";

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let pos = 0;
  for (const [start, end] of ranges) {
    if (start > pos) parts.push(text.slice(pos, start));
    parts.push(
      <mark key={start} className="rounded-sm bg-accent/25 text-accent">
        {text.slice(start, end)}
      </mark>,
    );
    pos = end;
  }
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}

/**
 * The transient search state of the Files panel: an input row at the top,
 * results replacing the tree below. Esc or ✕ collapses back to the tree
 * (the component unmounts, so the typed query clears with it).
 */
export function SearchPanel() {
  // the ⌘K palette can hand off a seed query via the explorer store
  const seed = useExplorer((s) => s.searchSeed);
  const closeSearch = useExplorer((s) => s.closeSearch);
  const [input, setInput] = useState(seed ?? "");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);

  useEffect(() => {
    if (seed !== null) setInput(seed);
  }, [seed]);

  const query = useDebounced(input.trim(), 300);
  const openPreviewPath = useExplorer((s) => s.openPreviewPath);

  const { data, isFetching, error } = useQuery({
    queryKey: ["search", query, regex, caseSensitive],
    enabled: canSearch(query),
    staleTime: 10_000,
    queryFn: () => api.search(query, { regex, caseSensitive }),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-2">
        <div className="flex items-center gap-1">
          <Field
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                closeSearch();
              }
            }}
            placeholder="search workspace…"
          />
          <IconButton title="Close search (Esc)" iconPath="M4 4l8 8M12 4l-8 8" onClick={closeSearch} />
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-meta text-ink-500">
          <OptionToggle label=".*" title="Regular expression" active={regex} onClick={() => setRegex((v) => !v)} />
          <OptionToggle label="Aa" title="Case sensitive" active={caseSensitive} onClick={() => setCaseSensitive((v) => !v)} />
          {isFetching && <span className="ml-auto">searching…</span>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {error && (
          <div className="px-3 py-2 text-ui text-danger">{(error as Error).message}</div>
        )}
        {data?.results.map((file) => (
          <div key={file.path} className="mb-1">
            <div
              className="cursor-default truncate px-2 py-0.5 text-meta font-semibold text-ink-300 hover:bg-hover"
              title={file.path}
              onClick={() => openPreviewPath(file.path)}
            >
              {file.path}
            </div>
            {file.matches.map((m, i) => (
              <div
                key={`${m.line}-${i}`}
                className="flex cursor-default gap-2 px-2 py-0.5 text-ui hover:bg-hover"
                onClick={() => openPreviewPath(file.path)}
              >
                <span className="w-8 shrink-0 text-right text-ink-500">{m.line}</span>
                <span className="truncate text-ink-100">
                  <Highlighted text={m.text.trimStart()} ranges={shiftRanges(m)} />
                </span>
              </div>
            ))}
          </div>
        ))}
        {data && data.results.length === 0 && (
          <div className="px-3 py-2 text-ui text-ink-500">no matches</div>
        )}
        {query.length > 0 && query.length < MIN_QUERY_LEN && (
          <div className="px-3 py-2 text-ui text-ink-500">type at least 2 characters</div>
        )}
      </div>
      {data && (
        <div className="border-t border-border px-2 py-1 text-meta text-ink-500">
          {data.total}{data.truncated ? "+" : ""} matches · {data.results.length} files · {data.engine}
        </div>
      )}
    </div>
  );
}

function OptionToggle({
  label,
  title,
  active,
  onClick,
}: {
  label: string;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`rounded border px-1.5 py-0.5 font-semibold ${
        active
          ? "border-accent-dim bg-hover text-accent"
          : "border-border text-ink-500 hover:text-ink-300"
      }`}
    >
      {label}
    </button>
  );
}
