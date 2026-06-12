// Pure mapping from the daemon's detected-hosts response to the session
// composer's host rows, and from a row to the direct-spawn argv
// (POST /api/sessions {type:'agent',...}). Kept React-free so the
// detected/disabled rules and the host→command mapping are unit-testable.

/** Argv an agent session spawns directly on the PTY (no shell, no injection). */
export interface AgentSpawnSpec {
  command: string;
  args: string[];
  /** host CLI name stored on the session (tab title, bookkeeping) */
  host: string;
}

export interface HostRow {
  /** row label */
  label: string;
  /** display command string; key into hostSpawnSpec() */
  command: string;
  /** undetected rows render greyed with "not installed" */
  detected: boolean;
}

/** Hosts zuzuu can wrap, in menu order; `name` matches zuzuuApi.hosts() entries. */
const KNOWN_HOSTS = [
  { name: "claude-code", label: "Claude Code", command: "claude", spawn: { command: "claude", args: [], host: "claude" } },
  { name: "gemini-cli", label: "Gemini CLI", command: "gemini", spawn: { command: "gemini", args: [], host: "gemini" } },
  { name: "codex", label: "Codex", command: "codex", spawn: { command: "codex", args: [], host: "codex" } },
  { name: "pi", label: "pi", command: "pi", spawn: { command: "pi", args: [], host: "pi" } },
] as const;

/** OpenCode ships bundled inside the zuzuu CLI — spawned as `zuzuu code`. */
const OPENCODE = {
  label: "OpenCode (bundled)",
  command: "zuzuu code",
  spawn: { command: "zuzuu", args: ["code"], host: "opencode" },
} as const;

/** Known hosts marked by detection, plus OpenCode — always launchable (bundled). */
export function buildHostRows(hosts: { name: string }[]): HostRow[] {
  const detected = new Set(hosts.map((h) => h.name));
  return [
    ...KNOWN_HOSTS.map((h) => ({ label: h.label, command: h.command, detected: detected.has(h.name) })),
    { label: OPENCODE.label, command: OPENCODE.command, detected: true },
  ];
}

/** The composer's Enter target: the FIRST detected row in menu order
 *  (OpenCode is always detected — bundled — so a default always exists). */
export function composerDefaultHost(rows: HostRow[]): HostRow | null {
  return rows.find((r) => r.detected) ?? null;
}

/** Row command → direct-spawn argv (opencode → `zuzuu code`); null for unknown. */
export function hostSpawnSpec(rowCommand: string): AgentSpawnSpec | null {
  if (rowCommand === OPENCODE.command) return { ...OPENCODE.spawn, args: [...OPENCODE.spawn.args] };
  const known = KNOWN_HOSTS.find((h) => h.command === rowCommand);
  return known ? { ...known.spawn, args: [...known.spawn.args] } : null;
}

const HOST_TITLES: Record<string, string> = {
  claude: "Claude Code",
  gemini: "Gemini CLI",
  codex: "Codex",
  pi: "pi",
  opencode: "OpenCode",
};

/** Agent tab title: the host's display name (falls back to the raw host id). */
export function agentTabTitle(host: string | undefined): string {
  return (host !== undefined ? HOST_TITLES[host] : undefined) ?? host ?? "agent";
}
