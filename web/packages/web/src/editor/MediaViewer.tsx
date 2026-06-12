import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  TEXT_SIZE_LIMIT,
  categorize,
  formatBytes,
  looksBinary,
} from "../preview/filetypes";
import { MarkdownView } from "../preview/MarkdownView";
import { CsvView } from "../preview/CsvView";
import { CastView } from "../preview/CastView";
import type { OpenFile } from "../state/editor";
import { ActionMenu } from "../components/ActionMenu";
import { localFileActions } from "../lib/local-actions";

function inlineUrl(path: string): string {
  return `${api.downloadUrl(path)}&inline=1`;
}

/** Read-only viewers for non-editable categories (and markdown preview). */
export function MediaViewer({ file }: { file: OpenFile }) {
  const category = categorize(file.name);
  switch (category) {
    case "cast":
      return <CastView src={inlineUrl(file.path)} />;
    case "image":
      return (
        <div className="flex h-full items-center justify-center p-4">
          <img src={inlineUrl(file.path)} alt={file.name} className="max-h-full max-w-full object-contain" />
        </div>
      );
    case "pdf":
      return <iframe src={inlineUrl(file.path)} title={file.name} className="h-full w-full" />;
    case "video":
      return (
        <div className="flex h-full items-center justify-center bg-black/40 p-3">
          <video src={inlineUrl(file.path)} controls className="max-h-full max-w-full" />
        </div>
      );
    case "audio":
      return (
        <div className="flex h-full items-center justify-center p-6">
          <audio src={inlineUrl(file.path)} controls className="w-full" />
        </div>
      );
    case "csv":
      return <CsvText file={file} />;
    case "binary":
      return <BinaryCard file={file} />;
    default:
      return <BinaryCard file={file} />;
  }
}

/** Rendered GFM for the markdown Preview toggle (text comes from the editor buffer). */
export function MarkdownPreview({ path, text }: { path: string; text: string }) {
  return (
    <div className="h-full overflow-auto">
      <MarkdownView path={path} text={text} />
    </div>
  );
}

function CsvText({ file }: { file: OpenFile }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["preview", file.path],
    retry: false,
    queryFn: async () => {
      if ((file.size ?? 0) > TEXT_SIZE_LIMIT) throw new Error("too large");
      return api.readFile(file.path);
    },
  });
  if (error) return <Card>{(error as Error).message}</Card>;
  if (isLoading || data === undefined) return <Card muted>loading…</Card>;
  if (looksBinary(data)) return <BinaryCard file={file} />;
  return <CsvView text={data} name={file.name} />;
}

export function BinaryCard({ file }: { file: OpenFile }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-300">
      <svg viewBox="0 0 24 24" className="h-10 w-10 text-ink-500" fill="none" stroke="currentColor" strokeWidth="1.2">
        <path d="M6 2h8l4 4v14a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zM14 2v4h4" strokeLinejoin="round" />
        <path d="M9 13h6M9 16h4" strokeLinecap="round" />
      </svg>
      <div className="text-ui">
        {file.name}
        {file.size !== undefined && <> · {formatBytes(file.size)}</>}
      </div>
      <div className="text-meta text-ink-500">binary file — no preview</div>
      <div className="flex items-center gap-2">
        <button onClick={() => void api.openLocal(file.path)} className={btn}>Open</button>
        <ActionMenu items={localFileActions(file.path)} title="More" />
      </div>
    </div>
  );
}

const btn =
  "rounded border border-border px-3 py-1 text-ui hover:border-accent-dim hover:text-ink-100";

function Card({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <div className={`flex h-full items-center justify-center px-4 text-ui ${muted ? "text-ink-500" : "text-ink-300"}`}>
      <div>{children}</div>
    </div>
  );
}
