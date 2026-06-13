// run-tests — runs the hermetic suite and reports pass/fail counts.
import { spawnSync } from 'node:child_process';

export async function main() {
  const r = spawnSync('npm', ['test'], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/pass (\d+)[\s\S]*?fail (\d+)/);
  const ok = r.status === 0;
  return { ok, summary: m ? `pass ${m[1]} / fail ${m[2]}` : (ok ? 'passed' : 'failed') };
}
