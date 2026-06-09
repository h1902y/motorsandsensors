// Adapter registry. Routes by capability/detection, never by host name baked into
// the core. Adding a host = add an adapter here; nothing else changes.

import { assertAdapter } from './host-adapter.mjs';
import { claudeCode } from './claude-code.mjs';
import { geminiCli } from './gemini-cli.mjs';
import { codex } from './codex.mjs';
import { opencode } from './opencode.mjs';

export const ADAPTERS = [claudeCode, geminiCli, codex, opencode].map(assertAdapter);

export function byName(name) {
  return ADAPTERS.find((a) => a.name === name) || null;
}

/** Adapters whose host has on-disk data right now. */
export function detected() {
  return ADAPTERS.filter((a) => a.detect());
}
