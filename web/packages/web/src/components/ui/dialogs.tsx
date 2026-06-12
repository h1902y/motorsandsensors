import { useEffect, useState } from "react";
import { create } from "zustand";
import { Overlay, Dialog } from "./Overlay";
import { Field, Button } from "./primitives";

/**
 * Imperative in-app prompt/confirm so we never use the browser's native
 * window.prompt/confirm. `await prompt({...})` resolves to the string or null;
 * `await confirm({...})` to a boolean. A single <DialogHost/> renders them.
 */
interface PromptSpec {
  kind: "prompt";
  title: string;
  placeholder?: string;
  defaultValue?: string;
  okLabel?: string;
  resolve: (v: string | null) => void;
}
interface ConfirmSpec {
  kind: "confirm";
  title: string;
  message?: string;
  okLabel?: string;
  danger?: boolean;
  resolve: (v: boolean) => void;
}
type Spec = PromptSpec | ConfirmSpec;

interface DialogState {
  current: Spec | null;
  show: (s: Spec) => void;
  clear: () => void;
}
const useDialogStore = create<DialogState>((set) => ({
  current: null,
  show: (current) => set({ current }),
  clear: () => set({ current: null }),
}));

export function prompt(opts: Omit<PromptSpec, "kind" | "resolve">): Promise<string | null> {
  return new Promise((resolve) => useDialogStore.getState().show({ kind: "prompt", ...opts, resolve }));
}
export function confirm(opts: Omit<ConfirmSpec, "kind" | "resolve">): Promise<boolean> {
  return new Promise((resolve) => useDialogStore.getState().show({ kind: "confirm", ...opts, resolve }));
}

export function DialogHost() {
  const current = useDialogStore((s) => s.current);
  const clear = useDialogStore((s) => s.clear);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (current?.kind === "prompt") setValue(current.defaultValue ?? "");
  }, [current]);

  if (!current) return null;

  const close = (result: string | null | boolean) => {
    (current.resolve as (v: unknown) => void)(result);
    clear();
  };

  return (
    <Overlay z={90} onClose={() => close(current.kind === "prompt" ? null : false)}>
      <Dialog width="sm" className="p-4">
        <div className="mb-3 text-body font-semibold text-ink-100">{current.title}</div>
        {current.kind === "prompt" ? (
          <Field
            autoFocus
            value={value}
            placeholder={current.placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) close(value.trim());
            }}
          />
        ) : (
          current.message && <p className="text-ui text-ink-300">{current.message}</p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => close(current.kind === "prompt" ? null : false)}>
            Cancel
          </Button>
          {current.kind === "prompt" ? (
            <Button variant="primary" disabled={!value.trim()} onClick={() => close(value.trim())}>
              {current.okLabel ?? "OK"}
            </Button>
          ) : (
            <Button variant={current.danger ? "danger" : "primary"} onClick={() => close(true)}>
              {current.okLabel ?? "Confirm"}
            </Button>
          )}
        </div>
      </Dialog>
    </Overlay>
  );
}
