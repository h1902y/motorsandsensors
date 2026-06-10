// mns/actions/runner.mjs
// The child harness spawned by dispatch.runAction. NOT imported by anything —
// it's executed: `node runner.mjs <payloadJson>`. It runs the action in its own
// process (isolating process.exit/throw), then prints exactly one result marker.
//
// payload = { runPath, inputs, outputs, default_args, args }
// stdout: the action's own logs, then a final line `__MNS_ACT_RESULT__<json>`.

import { pathToFileURL } from 'node:url';
import { validateInputs, validateOutputs } from './schema.mjs';
import { MARKER } from './marker.mjs';

function emit(obj) {
  process.stdout.write('\n' + MARKER + JSON.stringify(obj) + '\n');
}

const payload = JSON.parse(process.argv[2] || '{}');
try {
  const mod = await import(pathToFileURL(payload.runPath).href);
  if (typeof mod.main !== 'function') {
    emit({ ok: false, error: 'not_runnable', detail: 'run.mjs must export an async main(args)' });
  } else {
    let merged = { ...(payload.default_args ?? {}), ...(payload.args ?? {}) };
    if (typeof mod.prepareArguments === 'function') merged = mod.prepareArguments(merged);
    const vi = validateInputs(payload.inputs, {}, merged);
    if (!vi.ok) {
      emit({ ok: false, error: 'invalid_input', detail: vi.error });
    } else {
      const result = await mod.main(vi.args);
      const vo = validateOutputs(payload.outputs, result);
      if (!vo.ok) emit({ ok: false, error: 'invalid_output', detail: vo.error });
      else emit({ ok: true, value: vo.value });
    }
  }
} catch (e) {
  emit({ ok: false, error: 'script_error', detail: String((e && e.message) || e) });
}
