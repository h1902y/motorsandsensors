export type PreviewCategory =
  | "markdown"
  | "code"
  | "image"
  | "pdf"
  | "video"
  | "audio"
  | "csv"
  | "cast"
  | "binary";

/** Text previews above this size show a "too large" card instead. */
export const TEXT_SIZE_LIMIT = 1.5 * 1024 * 1024;

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico", "bmp", "avif"]);
const VIDEO = new Set(["mp4", "webm", "mov", "m4v"]);
const AUDIO = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac"]);
const MARKDOWN = new Set(["md", "markdown", "mdx"]);
const CSV = new Set(["csv", "tsv"]);

/** extension → shiki language id (only where it differs or needs pinning) */
const LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "jsonc",
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
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "fish",
  ps1: "powershell",
  sql: "sql",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  xml: "xml",
  graphql: "graphql",
  proto: "proto",
  dockerfile: "docker",
  prisma: "prisma",
  lua: "lua",
  r: "r",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  zig: "zig",
  nix: "nix",
  tf: "hcl",
  diff: "diff",
  patch: "diff",
  tex: "latex",
};

/** Extensionless / dotfile names that are still text. */
const TEXT_NAMES = new Set([
  "dockerfile",
  "makefile",
  "license",
  "readme",
  "changelog",
  "authors",
  "codeowners",
  ".gitignore",
  ".gitattributes",
  ".npmrc",
  ".nvmrc",
  ".editorconfig",
  ".env",
  ".prettierrc",
  ".eslintrc",
  ".zshrc",
  ".bashrc",
]);

const PLAIN_TEXT_EXT = new Set(["txt", "text", "log", "lock", "cfg", "conf", "env", "gitignore", "csv"]);

export function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function categorize(name: string): PreviewCategory {
  const lower = name.toLowerCase();
  const ext = extOf(lower);
  if (MARKDOWN.has(ext)) return "markdown";
  if (ext === "cast") return "cast";
  if (IMAGE.has(ext)) return "image";
  if (ext === "pdf") return "pdf";
  if (VIDEO.has(ext)) return "video";
  if (AUDIO.has(ext)) return "audio";
  if (CSV.has(ext)) return "csv";
  if (ext in LANG || PLAIN_TEXT_EXT.has(ext) || TEXT_NAMES.has(lower)) return "code";
  if (ext === "") return TEXT_NAMES.has(lower) ? "code" : "binary";
  // unknown extension: try as text — the binary sniff downgrades it if needed
  return "code";
}

export function shikiLang(name: string): string {
  const lower = name.toLowerCase();
  if (lower === "dockerfile") return "docker";
  if (lower === "makefile") return "make";
  return LANG[extOf(lower)] ?? "text";
}

/** Heuristic: NUL bytes or a high replacement-char ratio ⇒ not text. */
export function looksBinary(text: string): boolean {
  if (text.includes("\0")) return true;
  if (text.length === 0) return false;
  const sample = text.slice(0, 8192);
  let bad = 0;
  for (const ch of sample) if (ch === "�") bad++;
  return bad / sample.length > 0.05;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let u = -1;
  do {
    v /= 1024;
    u++;
  } while (v >= 1024 && u < units.length - 1);
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[u]}`;
}
