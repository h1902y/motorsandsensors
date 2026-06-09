import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { useQueryClient } from "@tanstack/react-query";
import type { WorkspaceInfo } from "@webcode/protocol";
import { TermConnection } from "./connection";
import { termRegistry } from "./registry";
import { registerPathLinks } from "./links";
import { useSessions } from "../state/sessions";
import { useExplorer } from "../state/explorer";

const FONT_FAMILY = '"JetBrains Mono Variable", ui-monospace, Menlo, monospace';

const THEME = {
  background: "#0b0e14",
  foreground: "#d6dde8",
  cursor: "#58e6c0",
  cursorAccent: "#0b0e14",
  selectionBackground: "#2c4f6e80",
  black: "#11161f",
  red: "#f47067",
  green: "#57ab5a",
  yellow: "#c69026",
  blue: "#539bf5",
  magenta: "#b083f0",
  cyan: "#39c5cf",
  white: "#909dab",
  brightBlack: "#545d68",
  brightRed: "#ff938a",
  brightGreen: "#6bc46d",
  brightYellow: "#daaa3f",
  brightBlue: "#6cb6ff",
  brightMagenta: "#dcbdfb",
  brightCyan: "#56d4dd",
  brightWhite: "#cdd9e5",
};

type Status = "connecting" | "open" | "reconnecting" | "closed";

export function TermView({ sessionId, active }: { sessionId: string; active: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const setTitle = useSessions((s) => s.setTitle);
  const setCwd = useSessions((s) => s.setCwd);
  const markExited = useSessions((s) => s.markExited);
  const queryClient = useQueryClient();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const term = new Terminal({
      allowProposedApi: true,
      fontFamily: FONT_FAMILY,
      fontSize: 13,
      lineHeight: 1.25,
      letterSpacing: 0,
      scrollback: 10_000,
      cursorBlink: true,
      macOptionIsMeta: true,
      minimumContrastRatio: 3,
      theme: THEME,
    });
    termRef.current = term;

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new SearchAddon());
    term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri, "_blank")));
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.loadAddon(new ClipboardAddon());

    const conn = new TermConnection(sessionId, term, {
      onTitle: (title) => setTitle(sessionId, title),
      onExit: (code) => {
        setExitCode(code);
        markExited(sessionId);
      },
      onStatus: setStatus,
      onCwd: (cwd) => setCwd(sessionId, cwd),
    });
    termRegistry.set(sessionId, conn);

    const linkDisposable = registerPathLinks(term, {
      rootAbs: () =>
        queryClient.getQueryData<WorkspaceInfo>(["workspace"])?.root,
      cwdRel: () => {
        const tab = useSessions.getState().tabs.find((t) => t.id === sessionId);
        if (!tab?.cwdLive || tab.cwdLive.outside) return undefined;
        return tab.cwdLive.cwd;
      },
      openPreview: (rel) => useExplorer.getState().openPreviewPath(rel),
    });

    term.onData((data) => conn.sendInput(data));
    term.onBinary((data) => conn.sendInput(data));
    term.onResize(({ cols, rows }) => conn.sendResize(cols, rows));
    term.onTitleChange((title) => setTitle(sessionId, title));

    // Cmd+C copies when there's a selection (Ctrl+C stays SIGINT);
    // Cmd+V falls through to the browser paste pipeline.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.metaKey && ev.key === "c" && term.hasSelection()) return false;
      if (ev.metaKey && ev.key === "v") return false;
      return true;
    });

    let disposed = false;
    void document.fonts.load(`13px ${FONT_FAMILY}`).finally(() => {
      if (disposed) return;
      term.open(host);
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => webgl.dispose()); // falls back to DOM renderer
        term.loadAddon(webgl);
      } catch {
        // WebGL unavailable — DOM renderer is fine
      }
      fit.fit();
      conn.connect();
    });

    const ro = new ResizeObserver(() => {
      if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit();
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      linkDisposable.dispose();
      termRegistry.delete(sessionId);
      conn.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId, setTitle, setCwd, markExited, queryClient]);

  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  return (
    <div className="relative h-full w-full bg-ink-950">
      <div ref={hostRef} className="term-host h-full w-full" />
      {status === "reconnecting" && (
        <div className="absolute right-3 top-2 rounded bg-ink-800 px-2 py-0.5 text-[11px] text-yellow-400">
          reconnecting…
        </div>
      )}
      {exitCode !== null && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-ink-700 bg-ink-900/95 px-3 py-1.5 text-[12px] text-ink-300">
          process exited with code {exitCode}
        </div>
      )}
      {status === "closed" && exitCode === null && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-ink-700 bg-ink-900/95 px-3 py-1.5 text-[12px] text-danger">
          disconnected — session may be attached in another window
        </div>
      )}
    </div>
  );
}
