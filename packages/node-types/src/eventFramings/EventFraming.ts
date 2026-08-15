import type { CamelCaseString } from '../brands';

/**
 * ioxde fork: how an event payload is framed on the wire — `anchorEventCpi` wraps it in a self-CPI
 * instruction prefixed by a shared constant. No `@codama/spec` counterpart, so it lives outside
 * `../generated/` and survives `pnpm generate`.
 */
export type EventFraming = {
    /** Framing strategy — e.g. `'anchorEventCpi'`. */
    readonly kind: string;
    /** Name of the shared constant holding the framing prefix. */
    readonly sharedConstantName: CamelCaseString;
};
