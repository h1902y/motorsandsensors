import fsp from "node:fs/promises";
import path from "node:path";
import type { Workflow } from "@zuzuu-web/protocol";
import { resolveSafe } from "./safe-path.js";

const WORKFLOW_DIR = ".webcode/workflows";

/** List workflows stored under .webcode/workflows/*.json in the workspace. */
export async function listWorkflows(root: string): Promise<Workflow[]> {
  let dir: string;
  try {
    dir = await resolveSafe(root, WORKFLOW_DIR);
  } catch {
    return [];
  }
  let names: string[];
  try {
    names = await fsp.readdir(dir);
  } catch {
    return []; // dir doesn't exist yet
  }
  const workflows: Workflow[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const raw = await fsp.readFile(path.join(dir, name), "utf8");
      const wf = JSON.parse(raw) as Workflow;
      if (wf.name && wf.command) workflows.push(wf);
    } catch {
      // skip malformed
    }
  }
  return workflows.sort((a, b) => a.name.localeCompare(b.name));
}

/** Persist a workflow as .webcode/workflows/<slug>.json. */
export async function saveWorkflow(root: string, wf: Workflow): Promise<string> {
  const slug = wf.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "workflow";
  const rel = `${WORKFLOW_DIR}/${slug}.json`;
  const abs = await resolveSafe(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, JSON.stringify(wf, null, 2) + "\n", "utf8");
  return rel;
}
