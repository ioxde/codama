# `ArgumentValueNode`

A node that refers to an argument — e.g. an instruction argument in the context of an instruction.

## Attributes

### Data

| Attribute | Type                  | Description                                                                      |
| --------- | --------------------- | -------------------------------------------------------------------------------- |
| `kind`    | `"argumentValueNode"` | The node discriminator.                                                          |
| `name`    | `CamelCaseString`     | The name of the argument.                                                        |
| `path`    | `CamelCaseString[]`   | (Optional) Field path into the argument, for referring to a nested struct field. |

### Children

_This node has no children._

## Functions

### `argumentValueNode(name, path?)`

Helper function that creates a `ArgumentValueNode` object from the argument name and an optional field path. Both are camel-cased. An empty `path` is omitted.

```ts
const node = argumentValueNode('amount');

// Refers to `planData.planId`.
const nested = argumentValueNode('plan_data', ['plan_id']);
```

## Examples

### An instruction argument defaulting to another argument

```ts
instructionNode({
    name: 'mint',
    arguments: [
        instructionArgumentNode({
            name: 'amount',
            type: numberTypeNode('u64'),
        }),
        instructionArgumentNode({
            name: 'amountToDelegate',
            type: numberTypeNode('u64'),
            defaultValue: argumentValueNode('amount'),
        }),
        // ...
    ],
});
```
