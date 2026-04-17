import type { CamelCaseString } from '../shared';

export type EventFraming = {
    readonly kind: string;
    readonly sharedConstantName: CamelCaseString;
};
