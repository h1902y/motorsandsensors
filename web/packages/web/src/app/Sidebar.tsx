// The Files pane: header (new file/folder + search toggle) over the tree or
// the workspace search panel.
import { useQueryClient } from "@tanstack/react-query";
import type { ListResponse } from "@zuzuu-web/protocol";
import { api } from "../lib/api";
import { useExplorer } from "../state/explorer";
import { FileTree } from "../explorer/FileTree";
import { SearchPanel } from "../explorer/SearchPanel";
import { Bar, IconButton, ActionMenu, type MenuItem } from "../components/ui";

export function Sidebar() {
  const queryClient = useQueryClient();
  const searchOpen = useExplorer((s) => s.searchOpen);
  const openSearch = useExplorer((s) => s.openSearch);
  const closeSearch = useExplorer((s) => s.closeSearch);

  // Create a file or folder in the selected dir (or workspace root) with a
  // default name, then drop the tree row straight into inline-rename so the
  // user edits the name + extension in place (no upfront prompt).
  const targetDir = () => {
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
    const dir = targetDir();
    return createAndRename(dir, uniqueName(dir, "untitled", ".md"), (p) => api.writeFile(p, ""));
  };
  const newFolder = () => {
    const dir = targetDir();
    return createAndRename(dir, uniqueName(dir, "untitled", ""), (p) => api.mkdir(p));
  };
  const newMenu: MenuItem[] = [
    { label: "New file", iconPath: "M4 1.5h5L13 5.5v9a1 1 0 01-1 1H4a1 1 0 01-1-1v-12a1 1 0 011-1zM9 2v4h4", onClick: () => void newFile() },
    { label: "New folder", iconPath: "M1.5 3.5A1.5 1.5 0 013 2h3l1.5 1.5H13A1.5 1.5 0 0114.5 5v7A1.5 1.5 0 0113 13.5H3A1.5 1.5 0 011.5 12z", onClick: () => void newFolder() },
  ];

  return (
    <div className="flex h-full flex-col">
      <Bar border="b" className="!gap-0">
        <span className="px-1 text-meta uppercase tracking-wider text-ink-500">Files</span>
        <span className="ml-auto flex items-center gap-0.5">
          <ActionMenu items={newMenu} title="New file or folder" iconPath="M8 3v10M3 8h10" />
          <IconButton
            title="Search workspace (⌘F)"
            iconPath="M10.5 10.5L14 14M7 12A5 5 0 117 2a5 5 0 010 10z"
            active={searchOpen}
            onClick={() => (searchOpen ? closeSearch() : openSearch())}
          />
        </span>
      </Bar>
      <div className="min-h-0 flex-1">{searchOpen ? <SearchPanel /> : <FileTree />}</div>
    </div>
  );
}
