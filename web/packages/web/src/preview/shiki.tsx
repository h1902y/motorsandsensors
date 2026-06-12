import { useEffect, useState } from "react";

/**
 * Lazy singleton around shiki — the dynamic import keeps grammars + themes
 * out of the main bundle (Vite splits them into their own chunk, loaded the
 * first time a code preview opens).
 */

type CodeToHtml = (code: string, opts: { lang: string; theme: string }) => Promise<string>;

let loader: Promise<CodeToHtml> | null = null;

function getCodeToHtml(): Promise<CodeToHtml> {
  loader ??= import("shiki").then((m) => m.codeToHtml as CodeToHtml);
  return loader;
}

const THEME = "github-dark-default";

export function useHighlighted(code: string | undefined, lang: string): string | null {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    setHtml(null);
    if (code === undefined) return;
    let cancelled = false;
    getCodeToHtml()
      .then((codeToHtml) => codeToHtml(code, { lang, theme: THEME }))
      .then((out) => {
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        // unknown grammar or load failure — caller keeps the plain fallback
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  return html;
}

/** Shared block renderer: highlighted when ready, plain <pre> meanwhile. */
export function ShikiBlock({ code, lang }: { code: string; lang: string }) {
  const html = useHighlighted(code, lang);
  if (html) {
    return (
      <div
        className="shiki-block overflow-x-auto text-ui leading-relaxed"
        // shiki output is library-generated markup from plain text, not user HTML
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }
  return (
    <pre className="overflow-x-auto whitespace-pre text-ui leading-relaxed text-ink-100">
      {code}
    </pre>
  );
}
