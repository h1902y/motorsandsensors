#!/usr/bin/env node
// zuzuu — the agent-faculty CLI (formerly mns / motors & sensors). Verb-first, entire.io-style; zero deps, no build.
//
//   zuzuu status                 detected hosts + recorded sessions
//   zuzuu capture [--host h]      capture a session → git-native trace + index entry
//   zuzuu trace [--last | FILE]   print a captured trace's span tree
//   zuzuu doctor                  environment + session health
//   zuzuu version | help
//
// Phase 1: post-hoc transcript capture. Phase 2 (planned): `zuzuu enable` installs
// background hooks for invisible live capture across the agent session lifecycle.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { init } from '../zuzuu/commands/init.mjs';
import { status } from '../zuzuu/commands/status.mjs';
import { capture } from '../zuzuu/commands/capture.mjs';
import { trace } from '../zuzuu/commands/trace.mjs';
import { doctor } from '../zuzuu/commands/doctor.mjs';
import { enable, disable } from '../zuzuu/commands/enable.mjs';
import { runHook } from '../zuzuu/commands/hook.mjs';
import { remember, recall, knowledge } from '../zuzuu/commands/knowledge.mjs';
import { review, proposals } from '../zuzuu/commands/review.mjs';
import { distill } from '../zuzuu/commands/distill.mjs';
import { digest } from '../zuzuu/commands/digest.mjs';
import { act } from '../zuzuu/commands/act.mjs';
import { migrate } from '../zuzuu/commands/migrate.mjs';
import { generation } from '../zuzuu/commands/generation.mjs';
import { evalCmd } from '../zuzuu/commands/eval.mjs';
import { code } from '../zuzuu/commands/code.mjs';
import { explain } from '../zuzuu/commands/explain.mjs';
import { inbox } from '../zuzuu/commands/inbox.mjs';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--') { a['--'] = argv.slice(i + 1); break; } // everything after `--` is passthrough
    else if (t === '--last') a.last = true;
    else if (t.startsWith('--')) {
      const key = t.slice(2);
      const val = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
      a[key] = key in a ? [].concat(a[key], val) : val; // repeated flag → array
    }
    else a._.push(t);
  }
  return a;
}

function version() {
  const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
  console.log(`zuzuu ${pkg.version}`);
}

function help() {
  console.log(`zuzuu — evolving faculties for the coding agent you already run  (\`mns\` still works as an alias)

usage: zuzuu <command> [options]

  code [dir]                launch OpenCode as the bundled default host (faculty home + capture + gate + digest)
  init                      scaffold the faculty home (.mns/) — git-style, idempotent
  status                    detected hosts + recorded sessions
  capture [--host NAME]     capture a session → .mns/traces + .mns/sessions.json
          [--session ID] [--file PATH]
  trace [--last | FILE]     print a captured trace's span tree
  remember "fact" [--type t] [--attr k=v] [--rel type=target]
                            add a knowledge item (you are the gate)
  recall "query" [--type t] [--attr k=v] [--related-to id] [--semantic]
                            search knowledge: lexical · graph · semantic
  knowledge reindex|audit   rebuild the search index · check registry/items health
  digest [--json] [--budget N]
                            print the session-start grounding brief
  act [list|show <slug>|new <slug>|schema <slug>]
                            the Actions faculty — runbooks + runnable scripts
  act <slug> [--args JSON]  run a script action
  act propose <slug>        scaffold a proposed action → actions/inbox/ (for review)
  act inbox|approve <slug>|reject <slug>
                            the actions gate (or use \`zuzuu review\`)
  distill [--all|--session ID]
                            mine real sessions → knowledge proposals (default: last)
  inbox                     what's pending your approval, per faculty
  review                    walk pending actions + knowledge proposals (y/n/e/s/q)
  proposals list|show|approve|reject <id>
                            the same gate, non-interactive
  generation [list|show <id>|mint|rollback <id>]
                            pin/list/show/roll back faculty generations (lockfiles)
  enable                    background hooks: invisible live capture + guardrails gate
  disable                   remove the background hooks
  eval [--faculty f]        rank pending proposals by eval score, highest first
  migrate                   one-time migrator: rewrite legacy candidate/er proposals to new shape
  doctor                    environment + session health (reconciles lost sessions)
  explain [topic]           the 5 faculties + how graduation works
  version                   print version
  help                      this message

\`zuzuu capture\` works post-hoc on existing transcripts. \`zuzuu enable\` turns on
live, invisible capture across the session lifecycle — see the README.
(\`mns\` remains a legacy alias for every command above.)`);
}

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

switch (cmd) {
  case 'code': process.exit(code(args)); break;
  case 'init': init(args); break;
  case 'remember': remember(args); break;
  case 'recall': await recall(args); break;
  case 'knowledge': await knowledge(args); break;
  case 'digest': digest(args); break;
  case 'act': act(args); break;
  case 'distill': distill(args); break;
  case 'inbox': inbox(args); break;
  case 'review': await review(args); break;
  case 'proposals': proposals(args); break;
  case 'status': status(); break;
  case 'capture': capture(args); break;
  case 'trace': trace(args); break;
  case 'enable': enable(args); break;
  case 'disable': disable(args); break;
  case 'hook': runHook(args._[0], { host: args.host, session: args.session }); break;
  case 'eval': evalCmd(args); break;
  case 'migrate': migrate(args); break;
  case 'generation': generation(args); break;
  case 'doctor': await doctor(); break;
  case 'explain': explain(args); break;
  case 'version': case '--version': case '-v': version(); break;
  case undefined: case 'help': case '--help': case '-h': help(); break;
  default:
    console.error(`unknown command: ${cmd}\n`);
    help();
    process.exit(1);
}
