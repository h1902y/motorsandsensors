// zuzuu/commands/explain.mjs — `zuzuu explain [topic]` (WS-B).
//
// The product, explained from the CLI: the five modules, the graduation loop,
// and how to get in the loop (inbox · review · generation). Pure text builder
// (explainText) + a thin printer (explain) so it's trivially testable.

const MODULE_ONE_LINERS = [
  'knowledge    — what is TRUE (semantic facts)',
  'memory       — what HAPPENED (episodic notes)',
  'actions      — how to DO (runbooks + runnable scripts)',
  'instructions — who to BE (the pinned steering / system prompt)',
  'guardrails   — what NOT to do (enforced tool gates)',
];

const MODULE_CONTRACTS = {
  knowledge:
    'knowledge — the semantic module: what is TRUE. Durable facts the agent can ' +
    'recall (lexical · graph · semantic). New facts land in knowledge/inbox/, become ' +
    'proposals/, and on approval graduate to knowledge/items/.',
  memory:
    'memory — the episodic module: what HAPPENED. Notes from real sessions — ' +
    'decisions, gotchas, context — proposed to memory/inbox/, reviewed, then pinned ' +
    'as memory/entries/.',
  actions:
    'actions — the procedural module: how to DO. Runbooks and runnable scripts. ' +
    'Propose one with `zuzuu act propose <slug>` (lands in actions/inbox/); on approval ' +
    'it becomes an active action you can run with `zuzuu act <slug>`.',
  instructions:
    'instructions — the directive module: who to BE. The pinned steering item ' +
    '(instructions/items/steering.md) that grounds every session. Empty by default — the ' +
    'digest tells the agent to interview you and draft it for your approval.',
  guardrails:
    'guardrails — the protective module: what NOT to do, ENFORCED. One rule per item in ' +
    'guardrails/items/ gates tool calls (deny > ask > allow) before they run. ' +
    'A refusal here is policy, not preference. The gate fails open — never breaks the host.',
};

const LOOP_DIAGRAM = [
  '  session → mine → inbox/ → proposals/ → (zuzuu review: you approve) → module + a new generation',
].join('\n');

const VALID_TOPICS = 'topics: modules · graduation · knowledge · memory · actions · instructions · guardrails';

function overview() {
  return [
    'zuzuu — five modules your coding agent grows from real use, human-gated.',
    '',
    'The 5 modules:',
    ...MODULE_ONE_LINERS.map((l) => '  ' + l),
    '',
    'The graduation loop:',
    LOOP_DIAGRAM,
    '',
    '  Nothing graduates without you. Each approval mints a generation — an',
    '  immutable checkpoint you can roll back to.',
    '',
    'Get in the loop:',
    '  zuzuu inbox             what is pending your approval',
    '  zuzuu review            walk each proposal: approve / reject / edit',
    '  zuzuu generation list   the generations you have minted (rollback anytime)',
    '',
    'More: `zuzuu explain modules` · `zuzuu explain graduation` · `zuzuu explain <module>`',
  ].join('\n');
}

function modules() {
  return [
    'The 5 modules — each us-owned, trace-grown, generation-pinned, served:',
    '',
    ...MODULE_ONE_LINERS.map((l) => '  ' + l),
    '',
    'Promotion path (the same for every module):',
    '  inbox/      agent-proposed candidates (raw)',
    '  proposals/  reviewable records (with evidence + analysis)',
    '  items/      graduated — pinned into the active generation',
    '',
    'You move a candidate along by running `zuzuu review`.',
  ].join('\n');
}

function graduation() {
  return [
    'The graduation loop — how observability becomes a new generation:',
    '',
    LOOP_DIAGRAM,
    '',
    '1. A real session is mined into candidate learnings → module inbox/.',
    '2. Candidates become proposals/ (evidence + entity-resolution analysis).',
    '3. THE HUMAN GATE: `zuzuu review` walks each one — you approve, reject, or edit.',
    '   Nothing graduates without you (Proposals are always human-approved in v1).',
    '4. Each review that approves anything mints a GENERATION — an immutable,',
    '   content-addressed checkpoint of the whole module state.',
    '5. Rollback is flipping a pointer: `zuzuu generation rollback <id>` restores a',
    '   past generation by content. Your approvals are never lost.',
    '',
    'Inspect: `zuzuu generation list` · `zuzuu generation show <id>`.',
  ].join('\n');
}

/**
 * Pure: return the explanation text for a topic.
 * No topic → overview. Unknown topic → overview + a topics hint.
 * @param {string} [topic]
 * @returns {string}
 */
export function explainText(topic) {
  if (!topic) return overview();
  const t = String(topic).toLowerCase();
  if (t === 'modules') return modules();
  if (t === 'graduation') return graduation();
  if (MODULE_CONTRACTS[t]) return MODULE_CONTRACTS[t];
  // unknown → overview + hint
  return overview() + '\n\nunknown topic "' + topic + '" — ' + VALID_TOPICS;
}

/** Printer: `zuzuu explain [topic]`. */
export function explain(args, log = console.log) {
  log(explainText(args?._?.[0]));
}
