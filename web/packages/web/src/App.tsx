import { useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./lib/api";
import { fsEvents } from "./lib/fs-events";
import { applyWorkflow, type ListResponse, type Workflow } from "@zuzuu-web/protocol";
import { useSessions } from "./state/sessions";
import { useExplorer } from "./state/explorer";
import { FileTree } from "./explorer/FileTree";
import { SearchPanel } from "./explorer/SearchPanel";
import { GitPanel } from "./explorer/GitPanel";
import { AgentPanel } from "./explorer/AgentPanel";
import { agentChipLabel } from "./explorer/agent-panel-logic";
import { TermView } from "./term/TermView";
import { EditorPane } from "./editor/EditorPane";
import { useEditor } from "./state/editor";
import { useBlocks } from "./state/blocks";
import { CommandPalette } from "./palette/CommandPalette";
import { WorkflowSaveModal, WorkflowRunModal } from "./workflows/WorkflowModals";
import { termRegistry } from "./term/registry";
import { useConnection } from "./state/connection";
import { DisconnectedBanner } from "./DisconnectedBanner";
import { WelcomeOverlay } from "./onboarding/WelcomeOverlay";
import { VaultPicker } from "./onboarding/VaultPicker";
import { Bar, ModeTabs, Tab, TabBar, IconButton, StatusDot, DialogHost, prompt, ActionMenu, type MenuItem } from "./components/ui";
import { useView } from "./state/view";
import { FacultiesView } from "./faculties/FacultiesView";
import { ReviewFlow } from "./faculties/ReviewFlow";
import { useReviewOpen } from "./state/review";
import { pendingReviewCount } from "./faculties/review-queue";
import { zuzuuApi } from "./lib/zuzuu-api";

const parentOf = (path: string) => path.split("/").slice(0, -1).join("/");

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}
const fmtMB = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} MB`;

export default function App() {
  const queryClient = useQueryClient();
  const { tabs, activeId, init, create, close, setActive } = useSessions();
  const [initError, setInitError] = useState<string | null>(null);

  const workspace = useQuery({ queryKey: ["workspace"], queryFn: api.workspace });
  const conn = useConnection();
  const wsConfig = useQuery({ queryKey: ["workspace", "config"], queryFn: api.workspaceConfig });
  const gitStatus = useQuery({ queryKey: ["git", "status"], queryFn: api.gitStatus, refetchInterval: 4000, placeholderData: keepPreviousData });
  const files = useQuery({ queryKey: ["files"], queryFn: api.listFiles, staleTime: 30_000, placeholderData: keepPreviousData });

  // zuzuu agent chip: health gates everything; status + the combined review
  // count (same queue the ceremony walks). fs events refresh these; the
  // refetchIntervals are the fallback.
  const zuzuuHealth = useQuery({ queryKey: ["zuzuu", "health"], queryFn: zuzuuApi.health, refetchInterval: 8000 });
  const zuzuuHome = zuzuuHealth.data?.home === true;
  const zuzuuStatus = useQuery({ queryKey: ["zuzuu", "status"], queryFn: zuzuuApi.status, refetchInterval: 8000, enabled: zuzuuHome });
  const zuzuuEval = useQuery({ queryKey: ["zuzuu", "eval"], queryFn: zuzuuApi.evalRanked, refetchInterval: 8000, enabled: zuzuuHome });
  const zuzuuActions = useQuery({ queryKey: ["zuzuu", "faculty", "actions"], queryFn: () => zuzuuApi.faculty("actions"), refetchInterval: 8000, enabled: zuzuuHome });
  const openReview = useReviewOpen((s) => s.setOpen);
  const reviewCount = pendingReviewCount(zuzuuEval.data?.ranked ?? [], zuzuuActions.data?.proposals ?? []);
  const [vaultPickerOpen, setVaultPickerOpen] = useState(false);
  const [vaultMenuOpen, setVaultMenuOpen] = useState(false);

  useEffect(() => {
    init().catch((err: Error) => setInitError(err.message));
  }, [init]);

  useEffect(() => {
    if (!workspace.data) return;
    fsEvents.start((path) => {
      void queryClient.invalidateQueries({ queryKey: ["dir", path] });
      void queryClient.invalidateQueries({ queryKey: ["git", "status"] });
      // anything under the zuzuu home → refresh the agent queries (status,
      // faculties, digest, eval …); the 4–8s polls remain the fallback
      if (path === ".zuzuu" || path.startsWith(".zuzuu/")) {
        void queryClient.invalidateQueries({ queryKey: ["zuzuu"] });
      }
      // refresh any open preview whose file lives in the changed directory
      void queryClient.invalidateQueries({
        predicate: (q) =>
          q.queryKey[0] === "preview" &&
          typeof q.queryKey[1] === "string" &&
          parentOf(q.queryKey[1]) === path,
      });
    });
    // The home dir + its .live internals (depth-0 watches don't see into
    // subdirs, so digest.md changes need the .live watch). watch() dedupes
    // and re-subscribes after reconnects.
    fsEvents.watch(".zuzuu");
    fsEvents.watch(".zuzuu/.live");
  }, [workspace.data, queryClient]);

  const hasEditor = useEditor((s) => s.openFiles.length > 0);
  const saveActive = useEditor((s) => s.saveActive);
  const sidebarMode = useExplorer((s) => s.sidebarMode);
  const setSidebarMode = useExplorer((s) => s.setSidebarMode);
  const view = useView((s) => s.mode);
  const setView = useView((s) => s.setMode);
  const revealPath = useExplorer((s) => s.revealPath);
  const activeTab = tabs.find((t) => t.id === activeId);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<"all" | "history">("all");
  const [runWorkflow, setRunWorkflow] = useState<Workflow | null>(null);

  // global shortcuts: ⌘K palette, ⌘R run-recent, ⌘S save active editor file
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setPaletteMode("all");
        setPaletteOpen((v) => !(v && paletteMode === "all"));
      } else if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault();
        setPaletteMode("history");
        setPaletteOpen(true);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveActive();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        setVaultPickerOpen(true);
      } else if (e.key === "Escape") {
        setPaletteOpen(false);
      }
    };
    const onOpenPicker = () => setVaultPickerOpen(true);
    const onSaveRec = () => void saveRecording();
    window.addEventListener("keydown", onKey);
    window.addEventListener("zuzuu-web:open-vault-picker", onOpenPicker);
    window.addEventListener("zuzuu-web:save-recording", onSaveRec);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("zuzuu-web:open-vault-picker", onOpenPicker);
      window.removeEventListener("zuzuu-web:save-recording", onSaveRec);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveActive, paletteMode]);

  // Create a file or folder in the selected dir (or workspace root) with a
  // default name, then drop the tree row straight into inline-rename so the
  // user edits the name + extension in place (no upfront prompt).
  const sidebarTargetDir = () => {
    const sel = useExplorer.getState().selected;
    return sel ? (sel.includes(".") ? sel.split("/").slice(0, -1).join("/") : sel) : "";
  };
  const uniqueName = (dir: string, base: string, ext: string) => {
    const list = queryClient.getQueryData<ListResponse>(["dir", dir]);
    const taken = new Set((list?.entries ?? []).map((e) => e.name));
    let name = `${base}${ext}`;
    for (let i = 1; taken.has(name); i++) name = `${base}-${i}${ext}`;
    return name;
  };
  const createAndRename = async (dir: string, name: string, mk: (path: string) => Promise<unknown>) => {
    const path = dir ? `${dir}/${name}` : name;
    await mk(path);
    if (dir) useExplorer.getState().revealPath(`${dir}/x`); // expand the dir
    await queryClient.invalidateQueries({ queryKey: ["dir", dir] });
    useExplorer.getState().select(path);
    useExplorer.getState().setRenaming(path);
  };
  const newFile = () => {
    const dir = sidebarTargetDir();
    return createAndRename(dir, uniqueName(dir, "untitled", ".md"), (p) => api.writeFile(p, ""));
  };
  const newFolder = () => {
    const dir = sidebarTargetDir();
    return createAndRename(dir, uniqueName(dir, "untitled", ""), (p) => api.mkdir(p));
  };
  const newMenu: MenuItem[] = [
    { label: "New file", iconPath: "M4 1.5h5L13 5.5v9a1 1 0 01-1 1H4a1 1 0 01-1-1v-12a1 1 0 011-1zM9 2v4h4", onClick: () => void newFile() },
    { label: "New folder", iconPath: "M1.5 3.5A1.5 1.5 0 013 2h3l1.5 1.5H13A1.5 1.5 0 0114.5 5v7A1.5 1.5 0 0113 13.5H3A1.5 1.5 0 011.5 12z", onClick: () => void newFolder() },
  ];

  // Switch the daemon's workspace seamlessly — no full reload. Reset the
  // client stores (the daemon already tore down the old sessions), drop all
  // cached queries, then re-seed sessions and refetch for the new root.
  const switchVault = async (path: string) => {
    setVaultMenuOpen(false);
    setVaultPickerOpen(false);
    try {
      await api.switchWorkspace(path);
      useEditor.getState().resetAll();
      useBlocks.getState().resetAll();
      useExplorer.getState().resetAll();
      useSessions.getState().reset(); // unmounts terminals → disposes their sockets
      queryClient.clear();
      await useSessions.getState().init(); // fresh session in the new root
      await queryClient.invalidateQueries(); // workspace/config/files/git…
    } catch (err) {
      window.alert(`Could not open vault: ${(err as Error).message}`);
    }
  };

  // A workflow with args opens the run modal; argless ones run immediately.
  const handleRunWorkflow = (wf: Workflow) => {
    const hasArgs = (wf.args?.length ?? 0) > 0 || /\{\{\s*\w+\s*\}\}/.test(wf.command);
    if (hasArgs) setRunWorkflow(wf);
    else termRegistry.get(activeId)?.sendInput(`\x15${applyWorkflow(wf.command, {})}\r`);
  };

  const saveRecording = async () => {
    // read the active session fresh — this is also invoked from a window event
    const s = useSessions.getState();
    const tab = s.tabs.find((t) => t.id === s.activeId);
    if (!tab) return;
    const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, "");
    const path = await prompt({
      title: "Save session recording",
      defaultValue: `recordings/${tab.title}-${stamp}.cast`,
      okLabel: "Save",
    });
    if (!path) return;
    try {
      const res = await api.saveRecording(tab.id, path);
      if (res.truncated) {
        window.alert("Saved — note: the oldest output was dropped (buffer cap reached).");
      }
    } catch (err) {
      window.alert(`Could not save recording: ${(err as Error).message}`);
    }
  };
  useEffect(() => {
    const name = workspace.data?.name ?? "zuzuu-web";
    document.title = activeTab ? `${activeTab.title} — ${name}` : name;
  }, [activeTab, workspace.data]);

  if (workspace.error || initError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-300">
        <div className="text-2xl text-accent">❯_</div>
        <div className="max-w-md text-center text-sm leading-relaxed">
          {(workspace.error as Error | null)?.message ?? initError}
        </div>
      </div>
    );
  }

  const dirtyCount = gitStatus.data?.entries.length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <DisconnectedBanner state={conn.state} />
      {view === "faculties" ? (
        <FacultiesView />
      ) : (
      <Group orientation="horizontal" className="min-h-0 flex-1">
        <Panel defaultSize="22%" minSize="160px" maxSize="45%" className="bg-surface">
          <div className="flex h-full flex-col">
            <Bar border="b" className="!gap-0">
              <ModeTabs options={["files", "search", "git", "agent"] as const} value={sidebarMode} onChange={setSidebarMode} />
              <span className="ml-auto flex items-center gap-0.5">
                {sidebarMode === "files" && (
                  <ActionMenu items={newMenu} title="New file or folder" iconPath="M8 3v10M3 8h10" />
                )}
                <IconButton
                  title="Refresh"
                  iconPath="M13 8a5 5 0 11-1.5-3.5M13 3v2.5h-2.5"
                  onClick={() => queryClient.invalidateQueries({ queryKey: sidebarMode === "git" ? ["git"] : sidebarMode === "agent" ? ["zuzuu"] : ["dir"] })}
                />
              </span>
            </Bar>
            <div className="min-h-0 flex-1">
              {sidebarMode === "files" ? (
                <FileTree />
              ) : sidebarMode === "search" ? (
                <SearchPanel />
              ) : sidebarMode === "git" ? (
                <GitPanel />
              ) : (
                <AgentPanel />
              )}
            </div>
          </div>
        </Panel>
        <Separator className="w-px bg-border transition-colors hover:bg-accent-dim" />
        <Panel className="flex min-w-0 flex-col">
          <Bar border="b" surface="surface" className="!gap-0 overflow-x-auto !px-0">
            <TabBar>
              {tabs.map((tab) => (
                <Tab
                  key={tab.id}
                  active={tab.id === activeId}
                  onClick={() => setActive(tab.id)}
                  onClose={() => void close(tab.id)}
                  title={tab.cwdLive ? `${tab.title} · ${tab.cwdLive.cwd}` : tab.title}
                  leading={<StatusDot tone={tab.alive ? "ok" : "idle"} />}
                >
                  {tab.title}
                </Tab>
              ))}
            </TabBar>
            <IconButton title="New terminal" iconPath="M8 3v10M3 8h10" onClick={() => void create()} className="mx-1" />
          </Bar>
          {/* terminals — all kept mounted so sessions survive tab switches */}
          <div className="relative min-h-0 flex-1">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                className="absolute inset-0"
                style={{ visibility: tab.id === activeId ? "visible" : "hidden" }}
              >
                <TermView sessionId={tab.id} active={tab.id === activeId} />
              </div>
            ))}
            {tabs.length === 0 && (
              <div className="flex h-full items-center justify-center text-ui text-ink-600">
                no terminal — press + above
              </div>
            )}
          </div>
        </Panel>
        {hasEditor && (
          <>
            <Separator className="w-px bg-border transition-colors hover:bg-accent-dim" />
            <Panel id="editor" defaultSize="42%" minSize="280px" className="min-w-0">
              <EditorPane />
            </Panel>
          </>
        )}
      </Group>
      )}
      {/* status bar */}
      <Bar border="t" surface="surface" className="relative !gap-2.5 text-meta text-ink-500">
        <ModeTabs
          options={["code", "faculties"] as const}
          value={view === "faculties" ? "faculties" : "code"}
          onChange={(v) => setView(v === "faculties" ? "faculties" : "ide")}
        />
        {/* zuzuu agent chip — active generation · pending review; opens the ceremony */}
        {zuzuuHome && (
          <button
            onClick={() => openReview(true)}
            className="shrink-0 hover:text-accent"
            title="zuzuu — open review"
          >
            {agentChipLabel(zuzuuStatus.data?.activeGeneration, reviewCount)}
          </button>
        )}
        {/* connection health — hover reveals the live stats (files · sessions · uptime · mem) */}
        <span
          className="flex shrink-0 items-center gap-1.5"
          title={[
            `daemon ${conn.state}`,
            files.data ? `${files.data.files.length}${files.data.truncated ? "+" : ""} files` : null,
            `${tabs.filter((t) => t.alive).length} session(s)`,
            conn.uptimeMs !== null ? `up ${fmtUptime(conn.uptimeMs)}` : null,
            conn.rss !== null ? fmtMB(conn.rss) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          <StatusDot
            tone={conn.state === "connected" ? "ok" : conn.state === "reconnecting" ? "warn" : "bad"}
            pulse={conn.state === "reconnecting"}
          />
          <span className="text-accent-dim">❯_</span>
        </span>

        {/* vault name → vault menu */}
        <div className="relative shrink-0">
          <button
            onClick={() => setVaultMenuOpen((v) => !v)}
            className="rounded px-1 text-ink-300 hover:text-accent"
            title={workspace.data?.root}
          >
            {workspace.data?.name ?? "…"} ▾
          </button>
          {vaultMenuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setVaultMenuOpen(false)} />
              <div
                style={{ boxShadow: "var(--shadow-menu)" }}
                className="absolute bottom-full left-0 z-50 mb-1 w-64 overflow-hidden rounded-[var(--radius-ui)] border border-border bg-elevated py-1"
              >
                <button
                  onClick={() => {
                    setVaultMenuOpen(false);
                    setVaultPickerOpen(true);
                  }}
                  className="block w-full px-3 py-1.5 text-left text-ui text-ink-100 hover:bg-hover"
                >
                  Switch vault… <span className="text-ink-500">⌘⇧O</span>
                </button>
                {(wsConfig.data?.recent ?? []).filter((r) => r !== workspace.data?.root).length > 0 && (
                  <div className="mt-1 border-t border-border pt-1">
                    <div className="px-3 py-0.5 text-meta uppercase tracking-wider text-ink-500">Recent</div>
                    {(wsConfig.data?.recent ?? [])
                      .filter((r) => r !== workspace.data?.root)
                      .slice(0, 6)
                      .map((r) => (
                        <button
                          key={r}
                          onClick={() => void switchVault(r)}
                          className="block w-full truncate px-3 py-1 text-left text-ui text-ink-300 hover:bg-hover hover:text-ink-100"
                          title={r}
                        >
                          {r.replace(/^\/Users\/[^/]+/, "~")}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* cwd */}
        {activeTab?.cwdLive && (
          <button
            title="Reveal in file tree"
            onClick={() => {
              if (!activeTab.cwdLive!.outside && activeTab.cwdLive!.cwd) {
                setSidebarMode("files");
                revealPath(activeTab.cwdLive!.cwd);
              }
            }}
            className="shrink-0 truncate text-ink-300 hover:text-accent"
          >
            ❯ {activeTab.cwdLive.outside
              ? `${activeTab.cwdLive.cwd} (outside)`
              : `./${activeTab.cwdLive.cwd}`}
          </button>
        )}

        {/* git branch + dirty count */}
        {gitStatus.data?.repo && (
          <button
            onClick={() => setSidebarMode("git")}
            className="shrink-0 hover:text-accent"
            title="Source Control"
          >
            ⎇ {gitStatus.data.branch}
            {dirtyCount > 0 && <span className="ml-1 text-warn">±{dirtyCount}</span>}
          </button>
        )}

        <button
          onClick={() => setPaletteOpen(true)}
          className="ml-auto shrink-0 rounded-[var(--radius-sm)] px-1.5 text-ink-500 hover:text-accent"
          title="Command palette"
        >
          ⌘K
        </button>
      </Bar>

      <CommandPalette
        open={paletteOpen}
        mode={paletteMode}
        onClose={() => setPaletteOpen(false)}
        onRunWorkflow={handleRunWorkflow}
      />
      <WorkflowSaveModal />
      <WorkflowRunModal workflow={runWorkflow} onClose={() => setRunWorkflow(null)} />
      {/* the one ReviewFlow mount — the chip, agent tab and Home all open this instance */}
      <ReviewFlow />
      <DialogHost />

      {vaultPickerOpen && (
        <VaultPicker
          recent={wsConfig.data?.recent ?? []}
          currentRoot={workspace.data?.root}
          onClose={() => setVaultPickerOpen(false)}
          onPick={switchVault}
        />
      )}
      {wsConfig.data && !wsConfig.data.onboarded && (
        <WelcomeOverlay
          workspaceName={workspace.data?.name}
          onOpenVaultPicker={() => setVaultPickerOpen(true)}
          onDismiss={() => {
            void api.setOnboarded();
            void queryClient.invalidateQueries({ queryKey: ["workspace", "config"] });
          }}
        />
      )}
    </div>
  );
}
