import { Editor } from "@monaco-editor/react";
import { ensureTheme, monacoLanguage } from "./monaco-setup";
import { useEditor } from "../state/editor";

// This module (and its monaco-editor import) is lazy-loaded by EditorPane, so
// the whole Monaco graph + workers stays out of the main bundle.
export function MonacoFile({ path, name }: { path: string; name: string }) {
  const buffer = useEditor((s) => s.buffers[path]);
  const setValue = useEditor((s) => s.setValue);
  const save = useEditor((s) => s.save);

  if (!buffer || buffer.loading) return <Centered>loading…</Centered>;
  if (buffer.error) return <Centered danger>{buffer.error}</Centered>;

  return (
    <Editor
      path={path}
      language={monacoLanguage(name)}
      theme={ensureTheme()}
      value={buffer.value}
      onChange={(v) => setValue(path, v ?? "")}
      onMount={(editor, monaco) => {
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
          void save(path);
        });
      }}
      options={{
        fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
        fontSize: 13,
        lineHeight: 1.5,
        minimap: { enabled: true, scale: 1 },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        renderWhitespace: "selection",
        tabSize: 2,
        automaticLayout: true,
        padding: { top: 8 },
      }}
    />
  );
}

// default export for React.lazy
export default MonacoFile;

function Centered({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  return (
    <div className={`flex h-full items-center justify-center text-ui ${danger ? "text-danger" : "text-ink-500"}`}>
      {children}
    </div>
  );
}
