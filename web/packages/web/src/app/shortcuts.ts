// Global keyboard shortcuts + app-level window events, extracted from App:
//   ⌘K palette · ⌘R run-recent · ⌘F workspace search · ⌘S save ·
//   ⌘⇧O vault picker · Esc close palette
// plus the zuzuu-web:* window events other surfaces dispatch.
import { useEffect } from "react";
import { useExplorer } from "../state/explorer";
import { useEditor } from "../state/editor";

export interface ShortcutHandlers {
  onPalette: (mode: "all" | "history") => void;
  onClosePalette: () => void;
  /** true while the palette is open in "all" mode — ⌘K then toggles closed */
  paletteAllOpen: boolean;
  onOpenVaultPicker: () => void;
  onSaveRecording: () => void;
}

export function useGlobalShortcuts(h: ShortcutHandlers): void {
  const { onPalette, onClosePalette, paletteAllOpen, onOpenVaultPicker, onSaveRecording } = h;
  const saveActive = useEditor((s) => s.saveActive);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (paletteAllOpen) onClosePalette();
        else onPalette("all");
      } else if ((e.metaKey || e.ctrlKey) && e.key === "f" && !e.shiftKey && !e.altKey) {
        // Monaco owns find while an editor has focus — don't steal it
        if ((e.target as HTMLElement | null)?.closest?.(".monaco-editor")) return;
        e.preventDefault();
        useExplorer.getState().openSearch(); // search lives in the Files panel
      } else if ((e.metaKey || e.ctrlKey) && e.key === "r") {
        e.preventDefault();
        onPalette("history");
      } else if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveActive();
      } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        onOpenVaultPicker();
      } else if (e.key === "Escape") {
        onClosePalette();
      }
    };
    const onOpenPicker = () => onOpenVaultPicker();
    const onSaveRec = () => onSaveRecording();
    window.addEventListener("keydown", onKey);
    window.addEventListener("zuzuu-web:open-vault-picker", onOpenPicker);
    window.addEventListener("zuzuu-web:save-recording", onSaveRec);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("zuzuu-web:open-vault-picker", onOpenPicker);
      window.removeEventListener("zuzuu-web:save-recording", onSaveRec);
    };
  }, [onPalette, onClosePalette, paletteAllOpen, onOpenVaultPicker, onSaveRecording, saveActive]);
}
