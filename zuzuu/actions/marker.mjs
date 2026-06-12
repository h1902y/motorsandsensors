// zuzuu/actions/marker.mjs
// The result-marker sentinel, in its own module so importing it has NO side
// effects (runner.mjs runs harness logic at top-level and must never be imported).
export const MARKER = '__ZUZUU_ACT_RESULT__';
