import type { IDisposable, ILink, Terminal } from "@xterm/xterm";

/**
 * Makes file paths in terminal output clickable → opens them in the preview
 * pane. Conservative matcher: a candidate must contain a `/` or end in a
 * known code extension, optionally suffixed with :line[:col].
 */

const PATH_RE =
  /(?:^|[\s"'`(\[<])((?:\.{1,2}\/|\/)?[\w.@+~-]+(?:\/[\w.@+~-]+)+|[\w@+-][\w.@+-]*\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|rb|java|kt|swift|c|h|cpp|hpp|cs|php|sh|css|scss|html|json|jsonc|ya?ml|toml|md|sql|vue|svelte|lock|txt|log|cast))((?::\d+){0,2})(?=[\s"'`)\]>:,;]|$)/g;

export interface LinkContext {
  /** workspace root, absolute */
  rootAbs: () => string | undefined;
  /** session's live cwd, workspace-relative ("" = root), undefined if outside root */
  cwdRel: () => string | undefined;
  openPreview: (relPath: string) => void;
}

function normalize(segments: string[]): string | null {
  const out: string[] = [];
  for (const seg of segments) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) return null; // escapes the workspace
      out.pop();
    } else out.push(seg);
  }
  return out.join("/");
}

/** Resolve a matched path string to a workspace-relative path, or null. */
export function resolveCandidate(
  raw: string,
  rootAbs: string | undefined,
  cwdRel: string | undefined,
): string | null {
  if (raw.startsWith("~")) return null;
  if (raw.startsWith("/")) {
    if (!rootAbs) return null;
    if (raw === rootAbs) return "";
    if (!raw.startsWith(rootAbs + "/")) return null;
    return raw.slice(rootAbs.length + 1);
  }
  if (cwdRel === undefined) return null; // shell is outside the workspace
  return normalize([...cwdRel.split("/"), ...raw.split("/")]);
}

export function registerPathLinks(term: Terminal, ctx: LinkContext): IDisposable {
  return term.registerLinkProvider({
    provideLinks(bufferLineNumber, callback) {
      const line = term.buffer.active.getLine(bufferLineNumber - 1);
      if (!line) return callback(undefined);
      const text = line.translateToString(true);
      const links: ILink[] = [];
      for (const m of text.matchAll(PATH_RE)) {
        const raw = m[1]!;
        const suffix = m[2] ?? "";
        const rel = resolveCandidate(raw, ctx.rootAbs(), ctx.cwdRel());
        if (rel === null || rel === "") continue;
        const start = m.index + m[0].indexOf(raw);
        links.push({
          range: {
            start: { x: start + 1, y: bufferLineNumber },
            end: { x: start + raw.length + suffix.length, y: bufferLineNumber },
          },
          text: raw + suffix,
          activate: () => ctx.openPreview(rel),
        });
      }
      callback(links.length ? links : undefined);
    },
  });
}
