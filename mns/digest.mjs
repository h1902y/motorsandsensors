// mns/digest.mjs
// The grounding digest — a pure, deterministic, zero-network, no-model brief of
// the faculty home, injected at session start. Returns { text, sections }.
// I/O-free: callers (the CLI + the SessionStart hook) handle output. Every
// reader is wrapped so a single broken faculty never sinks the whole digest.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PLACEHOLDER_MARK = '<!-- Fill in:';

/** Read instructions/project.md; classify empty vs steering text. */
function readInstructions(mnsDir) {
  const path = join(mnsDir, 'instructions', 'project.md');
  let raw = '';
  try {
    raw = readFileSync(path, 'utf8');
  } catch { /* missing or unreadable → treat as empty */ }
  const stripped = raw.replace(/^#.*$/gm, '').trim();
  const empty = !stripped || raw.includes(PLACEHOLDER_MARK);
  return { empty, text: empty ? '' : raw.trim() };
}

const INTERVIEW = [
  'Project steering is empty. Before substantive work, interview your human',
  '(what is this project, its conventions, its priorities), draft',
  '.mns/instructions/project.md from their answers, and get their approval.',
].join(' ');

/**
 * Compute the digest for a faculty home.
 * @param {string} mnsDir  path to the .mns directory
 * @returns {{ text: string, sections: object }}
 */
export function computeDigest(mnsDir) {
  const sections = {};
  const lines = ['# mns faculty digest', ''];

  const instr = readInstructions(mnsDir);
  sections.instructions = instr;
  lines.push('## Instructions');
  lines.push(instr.empty ? INTERVIEW : instr.text);
  lines.push('');

  return { text: lines.join('\n').trimEnd() + '\n', sections };
}
