import { describe, expect, test } from 'vitest';

import {
    CODAMA_ERROR__DYNAMIC_CLIENT__ACCOUNT_MISSING,
    CODAMA_ERROR__DYNAMIC_CLIENT__ARGUMENT_MISSING,
} from '../src/codes';
import { getHumanReadableErrorMessage } from '../src/message-formatter';

describe('getHumanReadableErrorMessage', () => {
    test('leaves an unmatched placeholder as its literal $token', () => {
        // Decoding without context (`npx @codama/errors decode -- <code>`) should show which variables
        // were expected, not blank them out.
        expect(getHumanReadableErrorMessage(CODAMA_ERROR__DYNAMIC_CLIENT__ACCOUNT_MISSING)).toBe(
            'Missing account [$accountName] in [$instructionName] instruction.',
        );
    });

    test('renders ARGUMENT_MISSING with an empty argumentPath', () => {
        expect(
            getHumanReadableErrorMessage(CODAMA_ERROR__DYNAMIC_CLIENT__ARGUMENT_MISSING, {
                argumentName: 'amount',
                argumentPath: '',
                instructionName: 'transfer',
            }),
        ).toBe('Missing argument [amount] in [transfer].');
    });

    test('renders ARGUMENT_MISSING with a nested argumentPath', () => {
        expect(
            getHumanReadableErrorMessage(CODAMA_ERROR__DYNAMIC_CLIENT__ARGUMENT_MISSING, {
                argumentName: 'planData',
                argumentPath: '.planId',
                instructionName: 'createPlan',
            }),
        ).toBe('Missing argument [planData.planId] in [createPlan].');
    });
});
