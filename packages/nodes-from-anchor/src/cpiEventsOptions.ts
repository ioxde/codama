import {
    CODAMA_ERROR__ANCHOR__CPI_EVENTS_DUPLICATE_PROGRAM,
    CODAMA_ERROR__ANCHOR__CPI_EVENTS_UNKNOWN_EVENT,
    CODAMA_ERROR__ANCHOR__CPI_EVENTS_UNKNOWN_PROGRAM,
    CodamaError,
} from '@codama/errors';
import { camelCase, ProgramNode, RootNode } from '@codama/nodes';

export function normalizeCpiEventsOverrides(
    cpiEvents: Record<string, readonly string[]> | undefined,
): Record<string, readonly string[]> | undefined {
    if (!cpiEvents) return undefined;
    const collisions: Record<string, string[]> = {};
    const out: Record<string, readonly string[]> = {};
    for (const [rawName, events] of Object.entries(cpiEvents)) {
        const normalizedName = camelCase(rawName);
        (collisions[normalizedName] ??= []).push(rawName);
        out[normalizedName] = events;
    }
    for (const [normalizedName, originalNames] of Object.entries(collisions)) {
        if (originalNames.length > 1) {
            throw new CodamaError(CODAMA_ERROR__ANCHOR__CPI_EVENTS_DUPLICATE_PROGRAM, {
                normalizedName,
                originalNames,
            });
        }
    }
    return out;
}

export function validateCpiEventsOverrides(
    root: RootNode,
    detectedPrograms: readonly string[],
    normalizedOverrides: Record<string, readonly string[]>,
): void {
    const detected = new Set<string>(detectedPrograms);
    const programsByName = new Map<string, ProgramNode>(
        [root.program, ...root.additionalPrograms].map(p => [p.name, p]),
    );
    for (const [programName, events] of Object.entries(normalizedOverrides)) {
        if (!detected.has(programName)) {
            throw new CodamaError(CODAMA_ERROR__ANCHOR__CPI_EVENTS_UNKNOWN_PROGRAM, {
                detectedPrograms: [...detectedPrograms],
                programName,
            });
        }
        const program = programsByName.get(programName)!;
        const availableEvents = program.events.map(e => e.name);
        const availableSet = new Set(availableEvents);
        for (const rawEventName of events) {
            const eventName = camelCase(rawEventName);
            if (!availableSet.has(eventName)) {
                throw new CodamaError(CODAMA_ERROR__ANCHOR__CPI_EVENTS_UNKNOWN_EVENT, {
                    availableEvents,
                    eventName,
                    programName,
                });
            }
        }
    }
}
