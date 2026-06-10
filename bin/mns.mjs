#!/usr/bin/env node
// mns — motors & sensors CLI. Verb-first, entire.io-style; zero deps, no build.
//
//   mns status                 detected hosts + recorded sessions
//   mns capture [--host h]      capture a session → git-native trace + index entry
//   mns trace [--last | FILE]   print a captured trace's span tree
//   mns doctor                  environment + session health
//   mns version | help
//
// Phase 1: post-hoc transcript capture. Phase 2 (planned): `mns enable` installs
// background hooks for invisible live capture across the agent session lifecycle.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { init } from '../mns/commands/init.mjs';
import { status } from '../mns/commands/status.mjs';
import { capture } from '../mns/commands/capture.mjs';
import { trace } from '../mns/commands/trace.mjs';
import { doctor } from '../mns/commands/doctor.mjs';
import { enable, disable } from '../mns/commands/enable.mjs';
import { runHook } from '../mns/commands/hook.mjs';
import { remember, recall, knowledge } from '../mns/commands/knowledge.mjs';
import { review, proposals } from '../mns/commands/review.mjs';
import { distill } from '../mns/commands/distill.mjs';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--last') a.last = true;
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
  console.log(`mns ${pkg.version}`);
}

function help() {
  console.log(`mns — motors & sensors

usage: mns <command> [options]

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
  distill [--all|--session ID]
                            mine real sessions → knowledge proposals (default: last)
  review                    walk pending knowledge proposals (y/n/e/s/q)
  proposals list|show|approve|reject <id>
                            the same gate, non-interactive
  enable                    background hooks: invisible live capture + guardrails gate
  disable                   remove the background hooks
  doctor                    environment + session health (reconciles lost sessions)
  version                   print version
  help                      this message

\`mns capture\` works post-hoc on existing transcripts. \`mns enable\` turns on
live, invisible capture across the session lifecycle — see the README.`);
}

const [cmd, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

switch (cmd) {
  case 'init': init(args); break;
  case 'remember': remember(args); break;
  case 'recall': await recall(args); break;
  case 'knowledge': await knowledge(args); break;
  case 'distill': distill(args); break;
  case 'review': await review(args); break;
  case 'proposals': proposals(args); break;
  case 'status': status(); break;
  case 'capture': capture(args); break;
  case 'trace': trace(args); break;
  case 'enable': enable(args); break;
  case 'disable': disable(args); break;
  case 'hook': runHook(args._[0], { host: args.host, session: args.session }); break;
  case 'doctor': await doctor(); break;
  case 'version': case '--version': case '-v': version(); break;
  case undefined: case 'help': case '--help': case '-h': help(); break;
  default:
    console.error(`unknown command: ${cmd}\n`);
    help();
    process.exit(1);
}
