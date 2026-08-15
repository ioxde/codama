// Resolvers
export { resolveInstructionAccountAddress, resolveStandalonePda } from './resolvers';
export type { StandalonePdaConfig } from './resolvers';

// Visitors
export {
    createCodecInputTransformer,
    createDefaultValueEncoderVisitor,
    DEFAULT_VALUE_ENCODER_SUPPORTED_NODE_KINDS,
    // ioxde fork: path helpers, consumed by @codama/dynamic-instructions.
    formatArgumentPathSuffix,
    tryResolveArgumentPathValue,
} from './visitors';

// Helpers
export { isPublicKeyLike, isAddressConvertible, toAddress } from './shared/address';
export { OPTIONAL_NODE_KINDS } from './shared/nodes';

// ioxde fork: `createProgramClient`'s `pdas` proxy needs this at runtime. Import the module directly,
// never the `./codegen` barrel — that re-exports `generateTypesFromFile`, pulling `node:fs` into the
// browser and react-native bundles.
export {
    type CollectedPdaNode,
    collectPdaNodeDetailsFromIdl,
    collectPdaNodesFromIdl,
} from './codegen/collect-pda-nodes';

// Types
export type { AccountsInput, ArgumentsInput, ResolverFn, ResolversInput, ResolverFnInput } from './shared/types';
export type { AddressInput, PublicKeyLike } from './shared/address';
