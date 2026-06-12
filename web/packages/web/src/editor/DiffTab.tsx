import { DiffEditor } from "@monaco-editor/react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ensureTheme, monacoLanguage } from "./monaco-setup";

/** Monaco side-by-side diff: HEAD/index (left) vs working file (right). */
export function DiffTab({ path, name }: { path: string; name: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["git", "diff", path],
    queryFn: async () => {
      const [diff, working] = await Promise.all([
        api.gitDiff(path),
        api.readFile(path).catch(() => ""),
      ]);
      return { original: diff.original, working };
    },
  });

  if (error) return <Centered danger>{(error as Error).message}</Centered>;
  if (isLoading || !data) return <Centered>loading diff…</Centered>;

  return (
    <DiffEditor
      original={data.original}
      modified={data.working}
      language={monacoLanguage(name)}
      theme={ensureTheme()}
      options={{
        readOnly: true,
        renderSideBySide: true,
        fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
        fontSize: 13,
        minimap: { enabled: false },
        automaticLayout: true,
      }}
    />
  );
}

export default DiffTab;

function Centered({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div className={`flex h-full items-center justify-center text-ui ${danger ? "text-danger" : "text-ink-500"}`}>
      {children}
    </div>
  );
}
