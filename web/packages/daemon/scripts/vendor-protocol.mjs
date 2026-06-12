#!/usr/bin/env node
// Vendor @zuzuu-web/protocol (private workspace package) into the compiled
// dist so the published @zuzuucodes/web package is self-contained.
//
// Why: the protocol package is private (never published), but the daemon
// imports runtime values from it (e.g. ClientOp), so the compiled output
// carries bare `@zuzuu-web/protocol` specifiers that would not resolve on a
// clean install. npm's bundleDependencies cannot help — npm pack skips
// symlinked workspace deps. So after tsc we copy protocol's dist into
// dist/protocol/ and rewrite the specifier to a relative import.
//
// Dev is untouched: tsx/vitest run from src/, where the workspace symlink
// resolves the bare specifier normally.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const daemonDist = path.resolve(HERE, "..", "dist");
const protocolDist = path.resolve(HERE, "..", "..", "protocol", "dist");
const vendorDir = path.join(daemonDist, "protocol");

if (!fs.existsSync(path.join(protocolDist, "index.js"))) {
  console.error("vendor-protocol: ../protocol/dist not built — run the protocol build first");
  process.exit(1);
}

// 1. copy protocol dist (js only; .d.ts not needed at runtime)
fs.rmSync(vendorDir, { recursive: true, force: true });
fs.mkdirSync(vendorDir, { recursive: true });
for (const f of fs.readdirSync(protocolDist)) {
  if (f.endsWith(".js")) fs.copyFileSync(path.join(protocolDist, f), path.join(vendorDir, f));
}

// 2. rewrite bare specifiers in the daemon's top-level dist modules
let rewritten = 0;
for (const f of fs.readdirSync(daemonDist)) {
  if (!f.endsWith(".js")) continue;
  const file = path.join(daemonDist, f);
  const src = fs.readFileSync(file, "utf8");
  const out = src.replaceAll('"@zuzuu-web/protocol"', '"./protocol/index.js"');
  if (out !== src) {
    fs.writeFileSync(file, out);
    rewritten++;
  }
}
console.log(`vendor-protocol: vendored protocol into dist/protocol, rewrote ${rewritten} module(s)`);
