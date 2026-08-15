/**
 * `@codama/node-types` — public API.
 *
 * Most type interfaces in this package are generated from the
 * `@codama/spec` description by `@codama-internal/spec-generators`. To
 * regenerate, run `pnpm generate` from the repository root. Hand-edits
 * to files under `./generated/` will not survive the next regeneration;
 * if you need to extend the surface, add the spec change upstream and
 * regenerate, or add a hand-written sibling file at this top level (as
 * already done for the static helpers below).
 *
 * ioxde fork: `EventNode.framing` and `ArgumentValueNode.path` are hand-applied inside `./generated/`
 * here and in `@codama/nodes`, each marked `// ioxde fork:` (`grep -rn 'ioxde fork:' packages/`).
 * Re-apply after any regeneration of these files; only `pnpm test` catches a dropped line.
 */

export * from './generated';

// Hand-written static helpers — referenced by the generated surface but
// kept outside `./generated/` because they don't depend on the spec.
export * from './brands';
export * from './Docs';
export * from './Version';

// ioxde fork: `EventFraming` lives outside `./generated/`; the hand-applied `EventNode.framing` uses it.
export * from './eventFramings';

// Hand-written deprecated aliases — see each file for rationale.
export * from './ProgramVersion';
