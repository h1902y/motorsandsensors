import { useMemo } from "react";
import Papa from "papaparse";

const MAX_ROWS = 1000;

export function CsvView({ text, name }: { text: string; name: string }) {
  const { header, rows, total } = useMemo(() => {
    const delimiter = name.toLowerCase().endsWith(".tsv") ? "\t" : undefined;
    const parsed = Papa.parse<string[]>(text.trim(), { delimiter });
    const data = (parsed.data as string[][]).filter((r) => r.length > 1 || (r[0] ?? "") !== "");
    return {
      header: data[0] ?? [],
      rows: data.slice(1, 1 + MAX_ROWS),
      total: Math.max(0, data.length - 1),
    };
  }, [text, name]);

  return (
    <div className="px-4 py-3">
      <table className="w-full border-collapse text-ui">
        <thead>
          <tr>
            {header.map((cell, i) => (
              <th
                key={i}
                className="sticky top-0 border border-border bg-hover px-2 py-1 text-left font-semibold text-ink-100"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 ? "bg-surface" : ""}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-border px-2 py-1 text-ink-100">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {total > MAX_ROWS && (
        <div className="py-2 text-meta text-ink-500">
          showing first {MAX_ROWS} of {total} rows
        </div>
      )}
    </div>
  );
}
