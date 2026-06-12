import { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../lib/api";
import { ShikiBlock } from "./shiki";

const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");

/**
 * GFM rendering (tables, task lists, strikethrough, autolinks) via
 * react-markdown + remark-gfm. Raw HTML in the document is NOT rendered
 * (react-markdown default) so untrusted files can't inject markup.
 */
export function MarkdownView({ path, text }: { path: string; text: string }) {
  const dir = parentOf(path);

  // Relative image/link targets resolve against the markdown file's
  // directory and are served through the (auth-gated) download endpoint.
  const transformUrl = useMemo(
    () => (url: string) => {
      if (/^(https?:|mailto:|#|data:)/i.test(url)) return url;
      const joined = url.startsWith("/")
        ? url.slice(1)
        : `${dir ? `${dir}/` : ""}${url}`;
      // normalize ./ and ../ segments
      const parts: string[] = [];
      for (const seg of joined.split("/")) {
        if (seg === "" || seg === ".") continue;
        if (seg === "..") parts.pop();
        else parts.push(seg);
      }
      return `${api.downloadUrl(parts.join("/"))}&inline=1`;
    },
    [dir],
  );

  return (
    <article className="prose prose-invert prose-sm max-w-none px-5 py-4">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={transformUrl}
        components={{
          a: (props) => <a {...props} target="_blank" rel="noreferrer" />,
          code: ({ className, children, ...rest }) => {
            const match = /language-(\w+)/.exec(className ?? "");
            const text = String(children).replace(/\n$/, "");
            if (match && text.includes("\n")) {
              return <ShikiBlock code={text} lang={match[1]!} />;
            }
            if (!match && text.includes("\n")) {
              return <ShikiBlock code={text} lang="text" />;
            }
            return (
              <code className={className} {...rest}>
                {children}
              </code>
            );
          },
          // ShikiBlock brings its own <pre>; avoid double-wrapping
          pre: ({ children }) => <>{children}</>,
        }}
      >
        {text}
      </ReactMarkdown>
    </article>
  );
}
