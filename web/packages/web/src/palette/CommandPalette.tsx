import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Workflow } from "@zuzuu-web/protocol";
import { api } from "../lib/api";
import { useSessions } from "../state/sessions";
import { useExplorer } from "../state/explorer";
import { useBlocks } from "../state/blocks";
import { termRegistry } from "../term/registry";
import { Overlay } from "../components/ui";

/**
 * ⌘K fuzzy launcher over data webcode already has: files, command history
 * (from the block model), workspace search, sessions, and saved workflows.
 */
export function CommandPalette({
  open,
  mode = "all",
  onClose,
  onRunWorkflow,
}: {
  open: boolean;
  /** "history" opens directly into run-recent-command (⌘R) */
  mode?: "all" | "history";
  onClose: () => void;
  onRunWorkflow: (wf: Workflow) => void;
}) {
  const [searchValue, setSearchValue] = useState("");
  const queryClient = useQueryClient();
  const openPreviewPath = useExplorer((s) => s.openPreviewPath);
  const openSearch = useExplorer((s) => s.openSearch);
  const blockHistory = useBlocks((s) => s.history);
  const { tabs, activeId, setActive, create } = useSessions();

  const files = useQuery({
    queryKey: ["files"],
    queryFn: api.listFiles,
    enabled: open && mode === "all",
    staleTime: 30_000,
  });
  const workflows = useQuery({
    queryKey: ["workflows"],
    queryFn: api.listWorkflows,
    enabled: open && mode === "all",
    staleTime: 10_000,
  });
  const shellHist = useQuery({
    queryKey: ["history"],
    queryFn: api.history,
    enabled: open,
    staleTime: 15_000,
  });

  // session blocks first (most relevant), then shell-history file, deduped
  const history = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of [...blockHistory, ...(shellHist.data?.commands ?? [])]) {
      const t = c.trim();
      if (t && !seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    return out;
  }, [blockHistory, shellHist.data]);

  // Alt held at selection time → insert-without-run for recent commands
  const altRef = useRef(false);

  useEffect(() => {
    if (!open) setSearchValue("");
  }, [open]);

  if (!open) return null;

  const historyOnly = mode === "history";

  const run = (fn: () => void) => {
    fn();
    onClose();
  };
  const sendToTerminal = (cmd: string) =>
    termRegistry.get(activeId)?.sendInput(`\x15${cmd}\r`);
  const insertToTerminal = (cmd: string) =>
    termRegistry.get(activeId)?.sendInput(`\x15${cmd}`);

  return (
    <Overlay onClose={onClose} align="top">
      <Command
        label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-[var(--radius-dialog)] border border-border bg-elevated"
        style={{ boxShadow: "var(--shadow-dialog)" }}
        onClick={(e) => e.stopPropagation()}
        loop
      >
        <Command.Input
          autoFocus
          value={searchValue}
          onValueChange={setSearchValue}
          onKeyDown={(e) => (altRef.current = e.altKey)}
          placeholder={historyOnly ? "Run a recent command… (Alt+Enter inserts without running)" : "Jump to file, run a command, search…"}
          className="w-full border-b border-border bg-transparent px-4 py-3 text-body text-ink-100 placeholder:text-ink-500 focus:outline-none"
        />
        <Command.List className="max-h-[50vh] overflow-auto p-1.5">
          <Command.Empty className="px-3 py-6 text-center text-ui text-ink-500">
            no matches
          </Command.Empty>

          {!historyOnly && searchValue.trim().length >= 2 && (
            <Command.Group heading="Search">
              <Item onSelect={() => run(() => openSearch(searchValue.trim()))}>
                <Kind>search</Kind> "{searchValue.trim()}" in workspace
              </Item>
            </Command.Group>
          )}

          {history.length > 0 && (
            <Command.Group heading={historyOnly ? "Recent commands" : "History"}>
              {history.slice(0, historyOnly ? 200 : 8).map((cmd, i) => (
                <Item
                  key={`h-${i}`}
                  value={`history ${cmd}`}
                  onSelect={() => run(() => (altRef.current ? insertToTerminal(cmd) : sendToTerminal(cmd)))}
                >
                  <Kind>run</Kind> {cmd}
                </Item>
              ))}
            </Command.Group>
          )}

          {!historyOnly && (workflows.data?.workflows.length ?? 0) > 0 && (
            <Command.Group heading="Workflows">
              {workflows.data!.workflows.map((wf) => (
                <Item key={`w-${wf.name}`} value={`workflow ${wf.name} ${wf.command}`} onSelect={() => run(() => onRunWorkflow(wf))}>
                  <Kind>flow</Kind> {wf.name}
                  <span className="ml-2 truncate text-ink-500">{wf.description ?? wf.command}</span>
                </Item>
              ))}
            </Command.Group>
          )}

          {!historyOnly && (
            <Command.Group heading="Files">
              {(files.data?.files ?? []).slice(0, 500).map((f) => (
                <Item key={`f-${f}`} value={`file ${f}`} onSelect={() => run(() => openPreviewPath(f))}>
                  <Kind>file</Kind> {f}
                </Item>
              ))}
            </Command.Group>
          )}

          {!historyOnly && (
            <Command.Group heading="Sessions">
              {tabs.map((t) => (
                <Item key={`s-${t.id}`} value={`session ${t.title} ${t.id}`} onSelect={() => run(() => setActive(t.id))}>
                  <Kind>term</Kind> {t.title}
                  {t.id === activeId && <span className="ml-2 text-accent-dim">active</span>}
                </Item>
              ))}
              <Item value="new terminal session" onSelect={() => run(() => void create())}>
                <Kind>term</Kind> New terminal
              </Item>
            </Command.Group>
          )}

          {!historyOnly && (
            <Command.Group heading="Workspace">
              <Item
                value="switch vault workspace open folder"
                onSelect={() => run(() => window.dispatchEvent(new Event("zuzuu-web:open-vault-picker")))}
              >
                <Kind>vault</Kind> Switch vault… <span className="ml-2 text-ink-500">⌘⇧O</span>
              </Item>
              <Item
                value="save session recording cast asciicast"
                onSelect={() => run(() => window.dispatchEvent(new Event("zuzuu-web:save-recording")))}
              >
                <Kind>rec</Kind> Save session recording (.cast)
              </Item>
              <Item
                value="refresh files reload tree"
                onSelect={() =>
                  run(() => {
                    void queryClient.invalidateQueries({ queryKey: ["dir"] });
                    void queryClient.invalidateQueries({ queryKey: ["files"] });
                  })
                }
              >
                <Kind>fs</Kind> Refresh files
              </Item>
            </Command.Group>
          )}
        </Command.List>
      </Command>
    </Overlay>
  );
}

function Item({
  children,
  value,
  onSelect,
}: {
  children: React.ReactNode;
  value?: string;
  onSelect: () => void;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-1 truncate rounded-[var(--radius-sm)] px-2 py-1.5 text-ui text-ink-100 data-[selected=true]:bg-hover"
    >
      {children}
    </Command.Item>
  );
}

function Kind({ children }: { children: React.ReactNode }) {
  return (
    <span className="mr-1 shrink-0 rounded-[var(--radius-sm)] bg-hover px-1.5 py-0.5 text-meta uppercase tracking-wide text-ink-400">
      {children}
    </span>
  );
}
