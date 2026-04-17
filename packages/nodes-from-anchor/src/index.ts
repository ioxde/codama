import { RootNode } from '@codama/nodes';
import { visit } from '@codama/visitors';

import { defaultVisitor } from './defaultVisitor';
import { IdlV00, rootNodeFromAnchorV00 } from './v00';
import { IdlV01, rootNodeFromAnchorV01 } from './v01';

export * from './defaultVisitor';
export * from './detectEventCpiPrograms';
export * from './discriminators';
export * from './extractPdasVisitor';
export * from './v00';
export * from './v01';
export * from './wrapEventsWithCpiDiscriminatorVisitor';

export type AnchorIdl = IdlV00 | IdlV01;

export type RootNodeFromAnchorOptions = {
    cpiEvents?: readonly string[];
};

export function rootNodeFromAnchor(idl: AnchorIdl, options: RootNodeFromAnchorOptions = {}): RootNode {
    const root = rootNodeFromAnchorWithoutDefaultVisitor(idl);
    const innerOptions =
        options.cpiEvents !== undefined ? { cpiEventsByProgram: { [root.program.name]: options.cpiEvents } } : {};
    return visit(root, defaultVisitor(innerOptions));
}

export function rootNodeFromAnchorWithoutDefaultVisitor(idl: AnchorIdl): RootNode {
    if ((idl.metadata as { spec?: string })?.spec === '0.1.0') {
        return rootNodeFromAnchorV01(idl as IdlV01);
    }

    return rootNodeFromAnchorV00(idl as IdlV00);
}
