#!/usr/bin/env node
// zuzuu — the agent-module CLI (formerly zuzuu / motors & sensors). Verb-first, entire.io-style; zero deps, no build.
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
import { review } from '../zuzuu/commands/review.mjs';
import { proposals } from '../zuzuu/commands/proposals.mjs';
import { distill } from '../zuzuu/commands/distill.mjs';
import { digest } from '../zuzuu/commands/digest.mjs';
import { act } from '../zuzuu/commands/act.mjs';
import { migrate } from '../zuzuu/commands/migrations/index.mjs';
import { generation } from '../zuzuu/commands/generation.mjs';
import { evalCmd } from '../zuzuu/commands/eval.mjs';
import { code } from '../zuzuu/commands/code.mjs';
import { web } from '../zuzuu/commands/web.mjs';
import { explain } from '../zuzuu/commands/explain.mjs';
import { inbox } from '../zuzuu/commands/inbox.mjs';
import { session } from '../zuzuu/commands/session.mjs';
import { sessions } from '../zuzuu/commands/sessions.mjs';
import { module } from '../zuzuu/commands/module.mjs';

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
  console.log(`zuzuu — evolving modules for the coding agent you already run

usage: zuzuu <command> [options]

  code [dir]                launch OpenCode as the bundled default host (module home + capture + gate + digest)
  web [dir] [--stop|--status]
                            launch the visual workbench (reuses a running one;
                            --stop ends it, --status reports it)
  init                      scaffold the module home (.zuzuu/) — git-style, idempotent
  status                    detected hosts + recorded sessions
  capture [--host NAME]     capture a session → .zuzuu/.traces + .zuzuu/sessions.json
          [--session ID] [--file PATH]
  trace [--last | FILE]     print a captured trace's span tree
  remember "fact" [--type t] [--attr k=v] [--rel type=target]
                            add a knowledge item (you are the gate)
  recall "query" [--type t] [--attr k=v] [--related-to id] [--semantic]
                            search knowledge: lexical · graph · semantic
  knowledge reindex|audit   rebuild the search index · check registry/items health
  module items <f> [--json|--jsonl]
                            list a module's envelope items (one doc · one line per item)
  module schema <f> [--json]
                            print a module's payload schema (JSON-Schema subset)
  module manifest <f> [--json]
                            print a module's manifest (module.json)
  module overview [--json] every module in one shot: ui + counts + top items + pending
  digest [--json] [--budget N]
                            print the session-start grounding brief
  act [list|show <slug>|new <slug>|schema <slug>]
                            the Actions module — runbooks + runnable scripts
  act <slug> [--args JSON]  run a script action
  act propose <slug>        scaffold a proposed action → actions/inbox/ (for review)
  act inbox|approve <slug>|reject <slug>
                            the actions gate (or use \`zuzuu review\`)
  distill [--all|--session ID]
                            mine real sessions → knowledge proposals (default: last)
  inbox                     what's pending your approval, per module
  review                    walk pending actions + knowledge proposals (y/n/e/s/q)
  proposals list|show|approve|reject <id>
                            the same gate, non-interactive
  generation [list|show <id>|mint|rollback <id>]
                            pin/list/show/roll back module generations (lockfiles)
  enable                    background hooks: invisible live capture + guardrails gate
  disable                   remove the background hooks
  session [status|merge|continue|discard]
                            the invisible session branch (one per agent session)
  sessions [--json]         recorded sessions with lifecycle state labels
  session inspect <id> [--json]
                            one session: trace summary + per-module mined signals
  eval [--module f]        rank pending proposals by eval score, highest first
  migrate [--home|--items|--modules]
                            one-time migrators: proposal schema · --home moves agent/ → .zuzuu/
                            · --items rewrites legacy module shapes → the envelope standard
                            · --modules renames faculty → module (keys, manifests, lockfiles)
  doctor                    environment + session health (reconciles lost sessions)
  explain [topic]           the 5 modules + how graduation works
  version                   print version
  help                      this message

\`zuzuu capture\` works post-hoc on existing transcripts. \`zuzuu enable\` turns on
live, invisible capture across the session lifecycle — see the README.`);
}

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

switch (cmd) {
  case 'code': process.exit(code(args)); break;
  case 'web': await web(args); break;
  case 'init': init(args); break;
  case 'remember': remember(args); break;
  case 'recall': await recall(args); break;
  case 'knowledge': await knowledge(args); break;
  case 'digest': digest(args); break;
  case 'act': act(args); break;
  case 'distill': await distill(args); break;
  case 'inbox': inbox(args); break;
  case 'review': await review(args); break;
  case 'proposals': proposals(args); break;
  case 'status': status(args); break;
  case 'capture': capture(args); break;
  case 'trace': trace(args); break;
  case 'enable': enable(args); break;
  case 'disable': disable(args); break;
  case 'hook': runHook(args._[0], { host: args.host, session: args.session }); break;
  case 'session': session(args); break;
  case 'sessions': sessions(args); break;
  case 'module': module(args); break;
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
