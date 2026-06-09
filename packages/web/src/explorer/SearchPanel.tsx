import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useExplorer } from "../state/explorer";

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

export function SearchPanel() {
  const [input, setInput] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const query = useDebounced(input.trim(), 300);
  const openPreviewPath = useExplorer((s) => s.openPreviewPath);

  const { data, isFetching, error } = useQuery({
    queryKey: ["search", query, regex, caseSensitive],
    enabled: query.length >= 2,
    staleTime: 10_000,
    queryFn: () => api.search(query, { regex, caseSensitive }),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-700 p-2">
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="search workspace…"
          className="w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 text-[12.5px] text-ink-100 placeholder:text-ink-500 focus:border-accent-dim focus:outline-none"
        />
        <div className="mt-1.5 flex items-center gap-2 text-[11px] text-ink-500">
          <OptionToggle label=".*" title="Regular expression" active={regex} onClick={() => setRegex((v) => !v)} />
          <OptionToggle label="Aa" title="Case sensitive" active={caseSensitive} onClick={() => setCaseSensitive((v) => !v)} />
          {isFetching && <span className="ml-auto">searching…</span>}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {error && (
          <div className="px-3 py-2 text-[12px] text-danger">{(error as Error).message}</div>
        )}
        {data?.results.map((file) => (
          <div key={file.path} className="mb-1">
            <div
              className="cursor-default truncate px-2 py-0.5 text-[11.5px] font-semibold text-ink-300 hover:bg-ink-800"
              title={file.path}
              onClick={() => openPreviewPath(file.path)}
            >
              {file.path}
            </div>
            {file.matches.map((m, i) => (
              <div
                key={`${m.line}-${i}`}
                className="flex cursor-default gap-2 px-2 py-0.5 text-[12px] hover:bg-ink-800"
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
          <div className="px-3 py-2 text-[12px] text-ink-500">no matches</div>
        )}
        {query.length > 0 && query.length < 2 && (
          <div className="px-3 py-2 text-[12px] text-ink-500">type at least 2 characters</div>
        )}
      </div>
      {data && (
        <div className="border-t border-ink-700 px-2 py-1 text-[11px] text-ink-500">
          {data.total}{data.truncated ? "+" : ""} matches · {data.results.length} files · {data.engine}
        </div>
      )}
    </div>
  );
}

/** trimStart shifts highlight offsets left by the removed whitespace. */
function shiftRanges(m: { text: string; ranges: [number, number][] }): [number, number][] {
  const cut = m.text.length - m.text.trimStart().length;
  if (cut === 0) return m.ranges;
  return m.ranges
    .map(([s, e]) => [Math.max(0, s - cut), Math.max(0, e - cut)] as [number, number])
    .filter(([s, e]) => e > s);
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
          ? "border-accent-dim bg-ink-800 text-accent"
          : "border-ink-700 text-ink-500 hover:text-ink-300"
      }`}
    >
      {label}
    </button>
  );
}
