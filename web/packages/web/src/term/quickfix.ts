import { api } from "../lib/api";

export interface QuickFix {
  label: string;
  /** runs the fix; `send` writes a command to the active PTY (kill-line prefixed) */
  run: (send: (cmd: string) => void) => void;
}

/**
 * Inspect a finished block's command + output for known, fixable errors and
 * return a one-click fix. Pure pattern-matching; only kill-port touches the
 * daemon. Returns null when nothing matches.
 */
export function detectQuickFix(command: string, output: string, exitCode: number | null): QuickFix | null {
  if (exitCode === 0 || exitCode === null) return null;

  // git push to a branch with no upstream — git prints the exact fix
  const upstream = /git push --set-upstream (\S+) (\S+)/.exec(output);
  if (/\bgit push\b/.test(command) && upstream) {
    const cmd = `git push --set-upstream ${upstream[1]} ${upstream[2]}`;
    return { label: cmd, run: (send) => send(cmd) };
  }

  // port already in use → kill the listener and rerun the command
  const port =
    /EADDRINUSE.*?:(\d{2,5})/.exec(output)?.[1] ??
    /address already in use.*?:(\d{2,5})/i.exec(output)?.[1] ??
    /listen .*?:(\d{2,5})/i.exec(output)?.[1];
  if (port) {
    return {
      label: `kill :${port} & rerun`,
      run: (send) => {
        void api.killPort(Number(port)).finally(() => {
          if (command) setTimeout(() => send(command), 250);
        });
      },
    };
  }

  // git "did you mean" subcommand suggestion
  const didYouMean = /git: '(\S+)' is not a git command[\s\S]*?Did you mean[\s\S]*?\n\s+(\S+)/.exec(output);
  if (didYouMean) {
    const fixed = command.replace(didYouMean[1]!, didYouMean[2]!);
    return { label: fixed, run: (send) => send(fixed) };
  }

  return null;
}
