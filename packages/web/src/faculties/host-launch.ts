// Pure mapping from the daemon's detected-hosts response to the "Start agent
// session" menu rows (HomeCtas renders these). Kept React-free so the
// detected/disabled rules are unit-testable.

export interface HostRow {
  /** menu label */
  label: string;
  /** what gets typed into the terminal */
  command: string;
  /** undetected rows render greyed with "not installed" */
  detected: boolean;
}

/** Hosts zuzuu can wrap, in menu order; `name` matches zuzuuApi.hosts() entries. */
const KNOWN_HOSTS = [
  { name: "claude", label: "Claude Code", command: "claude" },
  { name: "gemini-cli", label: "Gemini CLI", command: "gemini" },
  { name: "codex", label: "Codex", command: "codex" },
  { name: "pi", label: "pi", command: "pi" },
] as const;

/** Known hosts marked by detection, plus OpenCode — always launchable (bundled). */
export function buildHostRows(hosts: { name: string }[]): HostRow[] {
  const detected = new Set(hosts.map((h) => h.name));
  return [
    ...KNOWN_HOSTS.map((h) => ({ label: h.label, command: h.command, detected: detected.has(h.name) })),
    { label: "OpenCode (bundled)", command: "zuzuu code", detected: true },
  ];
}
