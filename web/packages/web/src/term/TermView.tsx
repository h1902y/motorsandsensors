import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionType, WorkspaceInfo } from "@zuzuu-web/protocol";
import { api } from "../lib/api";
import { endCard } from "../lib/session-cards";
import { refreshSessionGit } from "../lib/session-git-actions";
import { SessionEndCard } from "../components/SessionCards";
import { Spinner } from "../components/ui";
import { TermConnection } from "./connection";
import { termRegistry } from "./registry";
import { registerPathLinks } from "./links";
import { BlockTracker, type Block } from "./blocks";
import { BlockGutter } from "./BlockGutter";
import { useSessions } from "../state/sessions";
import { useExplorer } from "../state/explorer";
import { useBlocks } from "../state/blocks";
import { useWorkflowDraft } from "../workflows/draft";

const FONT_FAMILY = '"JetBrains Mono Variable", ui-monospace, Menlo, monospace';

const THEME = {
  background: "#0a0d12",
  foreground: "#d6dde8",
  cursor: "#58e6c0",
  cursorAccent: "#0a0d12",
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

export function TermView({
  sessionId,
  active,
  sessionType = "shell",
  host,
  onStartNew,
  onCloseTab,
}: {
  sessionId: string;
  active: boolean;
  /** agent sessions get the end-of-session card instead of the exit banner */
  sessionType?: SessionType;
  /** host CLI name; host==="zuzuu" marks a utility run (init / enable) */
  host?: string;
  /** open the start-a-session card (end-card CTA) */
  onStartNew?: () => void;
  onCloseTab?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const trackerRef = useRef<BlockTracker | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  const [stickyCmd, setStickyCmd] = useState<{ command: string; exitCode: number | null } | null>(null);
  const setTitle = useSessions((s) => s.setTitle);
  const setCwd = useSessions((s) => s.setCwd);
  const markExited = useSessions((s) => s.markExited);
  const setBlocks = useBlocks((s) => s.setBlocks);
  const addCommand = useBlocks((s) => s.addCommand);
  const openWorkflowDraft = useWorkflowDraft((s) => s.open);
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

    // Command blocks from OSC 133 semantic-prompt markers.
    const blocksOf = useBlocks.getState().bySession[sessionId] ?? [];
    void blocksOf;
    const tracker = new BlockTracker(term, {
      onChange: (blocks: Block[]) => {
        setBlocks(sessionId, blocks);
        setTick((t) => t + 1);
      },
      onCommand: (cmd) => addCommand(cmd),
    });
    trackerRef.current = tracker;
    term.parser.registerOscHandler(133, (payload) => {
      tracker.handle(payload);
      return true;
    });

    const updateSticky = () => {
      const buf = term.buffer.active;
      const topRow = buf.viewportY;
      const blocks = tracker.list();
      // header shows when scrolled above the bottom and a finished block owns the top row
      const atBottom = buf.viewportY >= buf.baseY;
      const owner = blocks.find(
        (b) => b.outputEnd !== null && b.outputStart <= topRow && (b.outputEnd ?? 0) > topRow,
      );
      setStickyCmd(!atBottom && owner ? { command: owner.command, exitCode: owner.exitCode } : null);
      setTick((t) => t + 1);
    };

    term.onData((data) => conn.sendInput(data));
    term.onBinary((data) => conn.sendInput(data));
    term.onResize(({ cols, rows }) => conn.sendResize(cols, rows));
    term.onTitleChange((title) => setTitle(sessionId, title));
    term.onScroll(updateSticky);
    term.onRender(() => setTick((t) => t + 1));

    const jumpBlock = (dir: 1 | -1) => {
      const buf = term.buffer.active;
      const top = buf.viewportY;
      const starts = tracker.list().map((b) => b.outputStart).sort((a, b) => a - b);
      const target =
        dir === 1 ? starts.find((s) => s > top) : [...starts].reverse().find((s) => s < top);
      if (target !== undefined) term.scrollToLine(target);
    };

    // Cmd+C copies a selection (Ctrl+C stays SIGINT); Cmd+V falls through to
    // browser paste; Cmd+↑/↓ jump between command blocks.
    term.attachCustomKeyEventHandler((ev) => {
      if (ev.type !== "keydown") return true;
      if (ev.metaKey && ev.key === "c" && term.hasSelection()) return false;
      if (ev.metaKey && ev.key === "v") return false;
      if (ev.metaKey && ev.key === "ArrowUp") {
        jumpBlock(-1);
        return false;
      }
      if (ev.metaKey && ev.key === "ArrowDown") {
        jumpBlock(1);
        return false;
      }
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
      tracker.dispose();
      trackerRef.current = null;
      termRegistry.delete(sessionId);
      conn.dispose();
      term.dispose();
      termRef.current = null;
    };
  }, [sessionId, setTitle, setCwd, markExited, setBlocks, addCommand, queryClient]);

  useEffect(() => {
    if (active) termRef.current?.focus();
  }, [active]);

  const reRun = (command: string) =>
    termRegistry.get(sessionId)?.sendInput(`\x15${command}\r`);

  // Agent exit → fetch the daemon-recorded auto-merge outcome (the GET awaits
  // whenClosed(), so a fetch that races the merge still gets closeResult) and
  // render the end-of-session card over the dead terminal.
  const isAgent = sessionType === "agent";
  const [endDismissed, setEndDismissed] = useState(false);
  const detail = useQuery({
    queryKey: ["session-detail", sessionId, exitCode],
    queryFn: () => api.sessionDetail(sessionId),
    enabled: isAgent && exitCode !== null,
    staleTime: Infinity,
  });
  const closeResult = detail.data?.closeResult;
  useEffect(() => {
    // the merge already ran server-side at PTY exit — pull the SPA caches up
    if (closeResult !== undefined) refreshSessionGit(queryClient);
  }, [closeResult, queryClient]);
  const end = endCard(sessionType, host, closeResult);
  const isUtility = end.kind === "utility";
  useEffect(() => {
    // utility run finished (zuzuu init / enable) — refresh the zuzuu queries
    // so onboarding flips to the faculties dashboard without a reload
    if (isUtility && exitCode !== null) {
      void queryClient.invalidateQueries({ queryKey: ["zuzuu"] });
    }
  }, [isUtility, exitCode, queryClient]);
  const showEndCard = isAgent && exitCode !== null && !endDismissed;

  return (
    <div className="relative h-full w-full bg-ink-950">
      <div ref={hostRef} className="term-host h-full w-full" />
      {termRef.current && trackerRef.current && hostRef.current && (
        <BlockGutter
          term={termRef.current}
          tracker={trackerRef.current}
          host={hostRef.current}
          tick={tick}
          onReRun={reRun}
          onSaveWorkflow={(command) => openWorkflowDraft(command)}
          send={reRun}
        />
      )}
      {stickyCmd && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center gap-2 border-b border-border bg-surface/95 px-3 py-1 text-ui backdrop-blur">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              stickyCmd.exitCode === null
                ? "bg-ink-500"
                : stickyCmd.exitCode === 0
                  ? "bg-accent"
                  : "bg-danger"
            }`}
          />
          <span className="truncate text-ink-300">{stickyCmd.command.split("\n")[0]}</span>
        </div>
      )}
      {status === "reconnecting" && (
        <div className="absolute right-3 top-2 rounded bg-hover px-2 py-0.5 text-meta text-warn">
          reconnecting…
        </div>
      )}
      {/* shell sessions keep the plain exit banner; agent sessions get the
          end-of-session card (or the banner once dismissed / outcome unknown) */}
      {exitCode !== null && (!showEndCard || end.kind === "banner") && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-border bg-surface/95 px-3 py-1.5 text-ui text-ink-300">
          process exited with code {exitCode}
        </div>
      )}
      {/* utility runs never merge — skip the spinner, show their card at once */}
      {showEndCard && detail.isPending && !isUtility && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink-950/70 p-6">
          <div className="flex items-center gap-2 text-ui text-ink-300">
            <Spinner /> session ended — merging checkpoints…
          </div>
        </div>
      )}
      {showEndCard && (isUtility || !detail.isPending) && end.kind !== "banner" && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink-950/70 p-6">
          <SessionEndCard
            state={end}
            onStartNew={onStartNew ?? (() => {})}
            onCloseTab={onCloseTab ?? (() => {})}
            onDismiss={() => setEndDismissed(true)}
          />
        </div>
      )}
      {status === "closed" && exitCode === null && (
        <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-border bg-surface/95 px-3 py-1.5 text-ui text-danger">
          disconnected — session may be attached in another window
        </div>
      )}
    </div>
  );
}
