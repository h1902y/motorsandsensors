// Shared cross-host signal-mining helpers.
//
// CROSS-HOST DISTILL: each adapter's `mineSignals(ref)` extracts the SAME shape
// as the Claude miner (`{commands, files, failures, sequences, correctionTurns,
// destructiveFailures}`) from that host's RAW transcript — command TEXT + a
// failed flag + adjacent-command 2-gram sequences + destructive-failure shapes.
// The aggregation thresholds live in `mns/knowledge/distill.mjs`; this is the
// per-host extraction primitives, factored here so every adapter shares one
// `norm`, one destructive-shape set, and one assembler (DRY, real-wire-built).

export const norm = (cmd) => String(cmd).trim().replace(/\s+/g, ' ').slice(0, 200);

const SEQ_SEP = ' && '; // joins adjacent shell commands into a 2-gram label
const DESTRUCTIVE_SHAPES = [/\brm\s+-[a-z]*r/, /git\s+push\s+.*--force/, /DROP\s+TABLE/i, /chmod\s+-R/];
export const isDestructive = (cmd) => DESTRUCTIVE_SHAPES.some((re) => re.test(cmd));

/** The empty superset — what an unminable / malformed / prompt-only host returns. */
export function emptySignals() {
  return { commands: [], files: [], failures: [], sequences: [], correctionTurns: [], destructiveFailures: [] };
}

/**
 * Assemble the signal superset from an ordered list of shell tool calls.
 * @param {Array<{cmd:string, failed:boolean, tool?:string}>} shellCalls — in transcript order
 * @returns the {commands, files, failures, sequences, correctionTurns, destructiveFailures} shape
 */
export function assembleSignals(shellCalls) {
  const out = emptySignals();
  const order = [];
  for (const call of shellCalls) {
    const cmd = norm(call.cmd);
    if (!cmd) continue;
    const failed = !!call.failed;
    const tool = call.tool || 'bash';
    out.commands.push({ cmd, failed });
    order.push(cmd);
    if (failed) {
      out.failures.push(tool);
      if (isDestructive(cmd)) out.destructiveFailures.push({ cmd, tool });
    }
  }
  for (let i = 0; i + 1 < order.length; i++) out.sequences.push(order[i] + SEQ_SEP + order[i + 1]);
  return out;
}
