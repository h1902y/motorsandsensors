#!/usr/bin/env node
// inspect-trace — pretty-print the span tree of an OTLP/JSON NDJSON trace file.
//
//   node bin/inspect-trace.mjs out/claude-code-<id>.otlp.jsonl

import { loadSpans, renderTree } from '../core/render.mjs';

const file = process.argv[2];
if (!file) {
  console.error('usage: inspect-trace.mjs <trace.otlp.jsonl>');
  process.exit(1);
}
console.log(renderTree(loadSpans(file)));
