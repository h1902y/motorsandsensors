import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { FacultyKey, ProposalSummary } from "@zuzuu-web/protocol";
import { api } from "../lib/api";
import { describeZuzuuError, zuzuuApi } from "../lib/zuzuu-api";
import { useExplorer } from "../state/explorer";
import { Button, confirm } from "../components/ui";
import { ProposalRow } from "./ProposalRow";
import {
  ACTIONS_DIR, ACTIONS_INBOX_DIR, GUARDRAILS_RULES, INSTRUCTIONS_PROJECT,
  actionRunbookPath, facultyItemsDir, facultyReadmePath, parseGuardrailRules,
} from "./faculty-paths";

const openInEditor = (path: string) => useExplorer.getState().openPreviewPath(path);

/** One right-panel faculty tab (all five share this component): pending
 *  proposals first (inline ✓/✗ — the same mutations as the review ceremony),
 *  then the faculty's substance (items / runbooks / project.md / rules), then
 *  a quick link to the faculty README. Item clicks open the file in the
 *  panel's editor (which flips the panel to files mode). */
export function FacultyTab({ facultyKey }: { facultyKey: FacultyKey }) {
  const queryClient = useQueryClient();
  const [err, setErr] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["zuzuu", "faculty", facultyKey],
    queryFn: () => zuzuuApi.faculty(facultyKey),
    refetchInterval: 4000,
  });

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try {
      await fn();
      void queryClient.invalidateQueries({ queryKey: ["zuzuu"] });
    } catch (e) {
      setErr(describeZuzuuError(e));
    }
  };

  // The actions faculty's pending list is its inbox — those go through act
  // approve/reject by slug; every other faculty through the proposal routes.
  const approve = (p: ProposalSummary) =>
    void run(() => (facultyKey === "actions" ? zuzuuApi.approveAction(p.id) : zuzuuApi.approveProposal(p.id, p.faculty)));
  const reject = async (p: ProposalSummary) => {
    const ok = await confirm({ title: "Reject proposal?", message: p.title, okLabel: "Reject", danger: true });
    if (!ok) return;
    void run(() => (facultyKey === "actions" ? zuzuuApi.rejectAction(p.id) : zuzuuApi.rejectProposal(p.id, p.faculty)));
  };

  const proposals = detail.data?.proposals ?? [];

  return (
    <div className="flex flex-col gap-4 p-3">
      {/* pending first — the human gate is the panel's headline */}
      <Section label={`pending proposals (${proposals.length})`}>
        {proposals.length === 0 ? (
          <div className="text-meta text-ink-600">nothing pending</div>
        ) : (
          <div className="flex flex-col">
            {proposals.map((p) => (
              <ProposalRow key={p.id} data={p} onApprove={() => approve(p)} onReject={() => void reject(p)} />
            ))}
          </div>
        )}
        {err && <div className="mt-2 break-all font-mono text-meta text-danger">{err}</div>}
      </Section>

      {facultyKey === "instructions" && <InstructionsBlock />}
      {facultyKey === "guardrails" && <GuardrailsBlock />}
      {facultyKey === "actions" && <ActionsBlock />}
      {(facultyKey === "knowledge" || facultyKey === "memory") && <ItemFilesBlock facultyKey={facultyKey} />}

      <button
        onClick={() => openInEditor(facultyReadmePath(facultyKey))}
        className="self-start text-meta text-ink-500 hover:text-accent"
        title={facultyReadmePath(facultyKey)}
      >
        faculty README ›
      </button>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-meta uppercase tracking-wide text-ink-500">{label}</div>
      {children}
    </div>
  );
}

function FileRow({ name, path, hint }: { name: string; path: string; hint?: string }) {
  return (
    <button
      onClick={() => openInEditor(path)}
      className="flex items-baseline gap-2 border-b border-border py-1 text-left text-ui text-ink-300 last:border-0 hover:text-ink-100"
      title={path}
    >
      <span className="truncate">{name}</span>
      {hint && <span className="ml-auto shrink-0 text-meta text-ink-600">{hint}</span>}
    </button>
  );
}

/** knowledge/items + memory/entries: the real one-fact files on disk (the
 *  ["dir", …] key shares FileTree's cache + fs-event invalidation). */
function ItemFilesBlock({ facultyKey }: { facultyKey: "knowledge" | "memory" }) {
  const dir = facultyItemsDir(facultyKey)!;
  const list = useQuery({ queryKey: ["dir", dir], queryFn: () => api.listDir(dir), refetchInterval: 8000, retry: false });
  const files = (list.data?.entries ?? []).filter((e) => e.kind === "file" && e.name !== "README.md");
  const noun = facultyKey === "knowledge" ? "items" : "entries";
  return (
    <Section label={`${noun} (${files.length})`}>
      {files.length === 0 ? (
        <div className="text-meta text-ink-600">none yet — harvested from sessions, human-approved</div>
      ) : (
        <div className="flex flex-col">
          {files.map((f) => <FileRow key={f.name} name={f.name} path={`${dir}/${f.name}`} />)}
        </div>
      )}
    </Section>
  );
}

/** instructions: project.md front-and-center — peek + open-in-editor. */
function InstructionsBlock() {
  const q = useQuery({
    queryKey: ["preview", INSTRUCTIONS_PROJECT],
    queryFn: () => api.readFile(INSTRUCTIONS_PROJECT),
    retry: false,
  });
  return (
    <Section label="project steering">
      <div className="rounded-ui border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <span className="text-ui font-medium text-ink-100">project.md</span>
          <Button size="sm" variant="primary" className="ml-auto" onClick={() => openInEditor(INSTRUCTIONS_PROJECT)}>
            Open in editor
          </Button>
        </div>
        {q.data !== undefined && (
          <pre className="mt-2 max-h-40 overflow-auto text-meta text-ink-400 whitespace-pre-wrap">{q.data.trim() || "(empty)"}</pre>
        )}
        {q.error != null && <div className="mt-2 text-meta text-ink-600">no project.md yet</div>}
      </div>
    </Section>
  );
}

/** guardrails: the parsed rules.json (deny > ask > allow), plus edit. */
function GuardrailsBlock() {
  const q = useQuery({
    queryKey: ["preview", GUARDRAILS_RULES],
    queryFn: () => api.readFile(GUARDRAILS_RULES),
    refetchInterval: 8000,
    retry: false,
  });
  const rules = q.data !== undefined ? parseGuardrailRules(q.data) : [];
  return (
    <Section label={`rules (${rules.length})`}>
      {q.error != null ? (
        <div className="text-meta text-ink-600">no rules.json yet</div>
      ) : rules.length === 0 ? (
        <div className="text-meta text-ink-600">no rules — or rules.json didn&apos;t parse</div>
      ) : (
        <div className="flex flex-col">
          {rules.map((r) => (
            <div key={r.id} className="flex items-baseline gap-2 border-b border-border py-1 text-ui last:border-0" title={r.pattern}>
              <span className={`w-10 shrink-0 text-meta ${r.action === "deny" ? "text-danger" : r.action === "ask" ? "text-warn" : "text-ink-500"}`}>
                {r.action}
              </span>
              <span className="w-12 shrink-0 truncate text-meta text-ink-500">{r.tool}</span>
              <span className="truncate text-ink-300">{r.reason || r.id}</span>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={() => openInEditor(GUARDRAILS_RULES)}
        className="self-start text-meta text-ink-500 hover:text-accent"
        title={GUARDRAILS_RULES}
      >
        edit rules.json ›
      </button>
    </Section>
  );
}

/** actions: active runbooks (dirs under .zuzuu/actions) + raw inbox files. */
function ActionsBlock() {
  const dirQ = useQuery({ queryKey: ["dir", ACTIONS_DIR], queryFn: () => api.listDir(ACTIONS_DIR), refetchInterval: 8000, retry: false });
  const inboxQ = useQuery({ queryKey: ["dir", ACTIONS_INBOX_DIR], queryFn: () => api.listDir(ACTIONS_INBOX_DIR), refetchInterval: 8000, retry: false });
  const runbooks = (dirQ.data?.entries ?? []).filter((e) => e.kind === "dir" && e.name !== "inbox");
  const inbox = (inboxQ.data?.entries ?? []).filter((e) => e.kind === "file");
  return (
    <>
      <Section label={`active runbooks (${runbooks.length})`}>
        {runbooks.length === 0 ? (
          <div className="text-meta text-ink-600">none yet — approve a proposed action to activate it</div>
        ) : (
          <div className="flex flex-col">
            {runbooks.map((r) => (
              <FileRow key={r.name} name={r.name} path={actionRunbookPath(r.name)} hint="action.json" />
            ))}
          </div>
        )}
      </Section>
      {inbox.length > 0 && (
        <Section label={`inbox (${inbox.length})`}>
          <div className="flex flex-col">
            {inbox.map((f) => <FileRow key={f.name} name={f.name} path={`${ACTIONS_INBOX_DIR}/${f.name}`} />)}
          </div>
        </Section>
      )}
    </>
  );
}
