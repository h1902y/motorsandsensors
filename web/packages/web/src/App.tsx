// Thin composition root: wires the layout (sidebar | session pane | right
// panel), the footer, global shortcuts and the app-level overlays. All
// behavior lives in app/* modules and the stores.
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { applyWorkflow, type Workflow } from "@zuzuu-web/protocol";
import { useSessions } from "./state/sessions";
import { useConnection } from "./state/connection";
import { termRegistry } from "./term/registry";
import { DisconnectedBanner } from "./DisconnectedBanner";
import { WelcomeOverlay } from "./onboarding/WelcomeOverlay";
import { VaultPicker } from "./onboarding/VaultPicker";
import { DialogHost } from "./components/ui";
import { WorkflowSaveModal, WorkflowRunModal } from "./workflows/WorkflowModals";
import { RightPanel } from "./panel/RightPanel";
import { ReviewFlow } from "./modules/ReviewFlow";
import { agentTabTitle } from "./modules/host-launch";
import { api } from "./lib/api";
import { Layout } from "./app/Layout";
import { Sidebar } from "./app/Sidebar";
import { SessionPane } from "./app/SessionPane";
import { Footer } from "./app/Footer";
import { TakeoverOverlay } from "./app/TakeoverOverlay";
import { initTabGuard } from "./state/takeover";
import { useGlobalShortcuts } from "./app/shortcuts";
import { saveRecording, switchVault } from "./app/vault";
import { useFsEventBridge, useWorkspaceConfigQuery, useWorkspaceQuery, useZuzuuHealthQuery } from "./app/queries";

// the ⌘K palette rides its own chunk — loaded on first open
const CommandPalette = lazy(() =>
  import("./palette/CommandPalette").then((m) => ({ default: m.CommandPalette })));

export default function App() {
  const queryClient = useQueryClient();
  const { tabs, activeId, init } = useSessions();
  const [initError, setInitError] = useState<string | null>(null);

  const workspace = useWorkspaceQuery();
  const wsConfig = useWorkspaceConfigQuery();
  const conn = useConnection();
  const zuzuuHealth = useZuzuuHealthQuery();
  const zuzuuHome = zuzuuHealth.data?.home === true;

  useEffect(() => { init().catch((err: Error) => setInitError(err.message)); }, [init]);
  useEffect(() => { initTabGuard(); }, []);
  useFsEventBridge(workspace.data !== undefined);

  const [vaultPickerOpen, setVaultPickerOpen] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<"all" | "history">("all");
  const [runWorkflow, setRunWorkflow] = useState<Workflow | null>(null);

  useGlobalShortcuts({
    onPalette: useCallback((mode: "all" | "history") => { setPaletteMode(mode); setPaletteOpen(true); }, []),
    onClosePalette: useCallback(() => setPaletteOpen(false), []),
    paletteAllOpen: paletteOpen && paletteMode === "all",
    onOpenVaultPicker: useCallback(() => setVaultPickerOpen(true), []),
    onSaveRecording: useCallback(() => void saveRecording(), []),
  });

  // A workflow with args opens the run modal; argless ones run immediately.
  const handleRunWorkflow = (wf: Workflow) => {
    const hasArgs = (wf.args?.length ?? 0) > 0 || /\{\{\s*\w+\s*\}\}/.test(wf.command);
    if (hasArgs) setRunWorkflow(wf);
    else termRegistry.get(useSessions.getState().activeId)?.sendInput(`\x15${applyWorkflow(wf.command, {})}\r`);
  };

  const activeTab = tabs.find((t) => t.id === activeId);
  useEffect(() => {
    const name = workspace.data?.name ?? "zuzuu-web";
    const tabLabel =
      activeTab && (activeTab.type === "agent" ? agentTabTitle(activeTab.host) : activeTab.title);
    document.title = tabLabel ? `${tabLabel} — ${name}` : name;
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

  return (
    <div className="flex h-full flex-col">
      <TakeoverOverlay />
      <DisconnectedBanner state={conn.state} />
      <Layout
        sidebar={<Sidebar />}
        center={<SessionPane />}
        right={
          <RightPanel
            zuzuuHome={zuzuuHome}
            zuzuuBin={zuzuuHealth.data?.zuzuuBin ?? true}
            onCollapse={() => setRightCollapsed(true)}
          />
        }
        rightCollapsed={rightCollapsed}
        onExpandRight={() => setRightCollapsed(false)}
      />
      <Footer
        zuzuuHome={zuzuuHome}
        onOpenPalette={() => { setPaletteMode("all"); setPaletteOpen(true); }}
      />

      {paletteOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            open
            mode={paletteMode}
            onClose={() => setPaletteOpen(false)}
            onRunWorkflow={handleRunWorkflow}
          />
        </Suspense>
      )}
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
          onPick={(path) => {
            setVaultPickerOpen(false);
            void switchVault(queryClient, path);
          }}
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
