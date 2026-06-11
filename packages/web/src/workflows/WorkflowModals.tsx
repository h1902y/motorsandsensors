import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { applyWorkflow, type Workflow } from "@zuzuu-web/protocol";
import { api } from "../lib/api";
import { useWorkflowDraft } from "./draft";
import { termRegistry } from "../term/registry";
import { useSessions } from "../state/sessions";
import { Overlay, Dialog, Button } from "../components/ui";

/** Extract {{arg}} names from a command, in first-seen order. */
function placeholders(command: string): string[] {
  const seen: string[] = [];
  for (const m of command.matchAll(/\{\{\s*(\w+)\s*\}\}/g)) {
    if (!seen.includes(m[1]!)) seen.push(m[1]!);
  }
  return seen;
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <Overlay onClose={onClose} align="top" className="pt-[15vh]">
      <Dialog width="sm" className="p-4">
        <div className="mb-3 text-body font-semibold text-ink-100">{title}</div>
        {children}
      </Dialog>
    </Overlay>
  );
}

const inputCls = "wc-input w-full px-2 py-1.5";

/** "Save as workflow" — opened from a block's action with a seed command. */
export function WorkflowSaveModal() {
  const command0 = useWorkflowDraft((s) => s.command);
  const close = useWorkflowDraft((s) => s.close);
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [command, setCommand] = useState("");

  // seed fields when the draft opens
  useEffect(() => {
    if (command0 !== null) {
      setCommand(command0);
      setName("");
      setDescription("");
    }
  }, [command0]);

  if (command0 === null) return null;

  const args = placeholders(command).map((n) => ({ name: n, placeholder: n }));

  const save = async () => {
    if (!name.trim() || !command.trim()) return;
    const wf: Workflow = {
      name: name.trim(),
      command: command.trim(),
      description: description.trim() || undefined,
      args: args.length ? args : undefined,
    };
    await api.saveWorkflow(wf);
    void queryClient.invalidateQueries({ queryKey: ["workflows"] });
    close();
  };

  return (
    <Modal title="Save as workflow" onClose={close}>
      <div className="space-y-2">
        <input className={inputCls} placeholder="name" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        <input className={inputCls} placeholder="description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        <textarea
          className={`${inputCls} h-20 font-mono`}
          value={command}
          onChange={(e) => setCommand(e.target.value)}
        />
        <p className="text-meta text-ink-500">
          Use <code className="text-accent">{"{{arg}}"}</code> for prompts.
          {args.length > 0 && ` Args: ${args.map((a) => a.name).join(", ")}`}
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={close}>cancel</Button>
          <Button variant="primary" onClick={() => void save()}>save</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Run a workflow: prompt each arg, substitute, send to the active terminal. */
export function WorkflowRunModal({ workflow, onClose }: { workflow: Workflow | null; onClose: () => void }) {
  const activeId = useSessions((s) => s.activeId);
  const [values, setValues] = useState<Record<string, string>>({});

  // reset values when a new workflow opens
  useEffect(() => {
    if (workflow) {
      const init: Record<string, string> = {};
      for (const a of workflow.args ?? []) init[a.name] = a.default ?? "";
      setValues(init);
    }
  }, [workflow]);

  if (!workflow) return null;

  const argDefs: { name: string; placeholder?: string; default?: string }[] =
    workflow.args ?? placeholders(workflow.command).map((n) => ({ name: n }));

  const runIt = () => {
    const command = applyWorkflow(workflow.command, values);
    termRegistry.get(activeId)?.sendInput(`\x15${command}\r`);
    onClose();
  };

  return (
    <Modal title={`Run: ${workflow.name}`} onClose={onClose}>
      <div className="space-y-2">
        <p className="truncate font-mono text-meta text-ink-500">{workflow.command}</p>
        {argDefs.map((a, i) => (
          <div key={a.name}>
            <label className="mb-0.5 block text-meta text-ink-400">{a.name}</label>
            <input
              className={inputCls}
              autoFocus={i === 0}
              placeholder={a.placeholder ?? a.name}
              value={values[a.name] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [a.name]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter") runIt();
              }}
            />
          </div>
        ))}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>cancel</Button>
          <Button variant="primary" onClick={runIt}>run</Button>
        </div>
      </div>
    </Modal>
  );
}
