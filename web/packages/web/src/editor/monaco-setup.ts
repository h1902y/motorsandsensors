import * as monaco from "monaco-editor";
import { loader } from "@monaco-editor/react";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";

/**
 * Wire Monaco's language workers via Vite `?worker` imports (offline-safe —
 * everything bundled locally, no CDN). The TS worker provides full in-browser
 * IntelliSense for JS/TS with no backend language server.
 */
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case "json":
        return new jsonWorker();
      case "css":
      case "scss":
      case "less":
        return new cssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new htmlWorker();
      case "typescript":
      case "javascript":
        return new tsWorker();
      default:
        return new editorWorker();
    }
  },
};

// Use the locally-bundled monaco instead of @monaco-editor/react's CDN default.
loader.config({ monaco });

const THEME = "webcode-dark";
let themeDefined = false;

/** Register the ink/accent dark theme once. */
export function ensureTheme(): string {
  if (!themeDefined) {
    monaco.editor.defineTheme(THEME, {
      base: "vs-dark",
      inherit: true,
      rules: [],
      colors: {
        "editor.background": "#0a0d12",
        "editor.foreground": "#d6dde8",
        "editorLineNumber.foreground": "#4a5568",
        "editorLineNumber.activeForeground": "#8b98ab",
        "editor.selectionBackground": "#2c4f6e80",
        "editorCursor.foreground": "#58e6c0",
        "editor.lineHighlightBackground": "#11161f",
        "editorWidget.background": "#11161f",
        "editorGutter.background": "#0a0d12",
        "diffEditor.insertedTextBackground": "#57ab5a22",
        "diffEditor.removedTextBackground": "#f4706722",
      },
    });
    themeDefined = true;
  }
  return THEME;
}

/** Map a filename to a Monaco language id. */
const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  php: "php",
  sql: "sql",
  vue: "vue",
  graphql: "graphql",
  dockerfile: "dockerfile",
  lua: "lua",
  r: "r",
  dart: "dart",
};

export function monacoLanguage(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "dockerfile";
  if (lower === "makefile") return "makefile";
  const ext = lower.includes(".") ? lower.slice(lower.lastIndexOf(".") + 1) : "";
  return EXT_LANG[ext] ?? "plaintext";
}
