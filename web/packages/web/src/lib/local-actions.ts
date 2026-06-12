import { api } from "./api";
import type { MenuItem } from "../components/ActionMenu";

/**
 * The local-native file actions shared by the tree, editor header, and media
 * card — defined once so "Copy path / Reveal in Finder / Open with default
 * app" don't drift across surfaces.
 */
export function localFileActions(path: string, absPath?: string): MenuItem[] {
  return [
    {
      label: "Copy path",
      iconPath: "M6 6h7v7H6zM3 10V3h7",
      onClick: () => void navigator.clipboard.writeText(absPath ?? path),
    },
    {
      label: "Reveal in Finder",
      iconPath: "M2 5h4l1.5 1.5H14V12a1 1 0 01-1 1H3a1 1 0 01-1-1V5z",
      onClick: () => void api.openLocal(path, true),
    },
    {
      label: "Open with default app",
      iconPath: "M6 3H3v10h10v-3M9 3h4v4M13 3L7 9",
      onClick: () => void api.openLocal(path),
    },
  ];
}
