# `EventNode`

This node represents an event emitted by a program.

## Attributes

### Data

| Attribute | Type                            | Description                                                                                      |
| --------- | ------------------------------- | ------------------------------------------------------------------------------------------------ |
| `kind`    | `"eventNode"`                   | The node discriminator.                                                                          |
| `name`    | `CamelCaseString`               | The name of the event.                                                                           |
| `docs`    | `string[]`                      | Additional Markdown documentation for the event.                                                 |
| `framing` | [`EventFraming`](#eventframing) | (Optional) Framing metadata when the event was wrapped by a framing visitor. See variants below. |

### Children

| Attribute        | Type                                                    | Description                                                                                                                                                            |
| ---------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `data`           | [`TypeNode`](./typeNodes/README.md)                     | The type node that describes the event payload.                                                                                                                        |
| `discriminators` | [`DiscriminatorNode`](./discriminatorNodes/README.md)[] | (Optional) The nodes that distinguish this event from others in the program. If multiple discriminators are provided, they are combined using a logical AND operation. |

### EventFraming

Open-ended metadata describing how an event was wrapped on the wire by an upstream producer:

| Field                | Type              | Description                                                                                   |
| -------------------- | ----------------- | --------------------------------------------------------------------------------------------- |
| `kind`               | `string`          | Producer-defined discriminator (e.g. `'anchorEventCpi'` from `@codama/nodes-from-anchor`).    |
| `sharedConstantName` | `CamelCaseString` | Canonical camelCase seed for the hoisted constant. Renderers apply their own case convention. |

Concrete variants are owned by producer packages — codama itself doesn't enumerate them. For example, `@codama/nodes-from-anchor` exports `AnchorEventCpiFraming` and the `anchorEventCpiFraming` constant.

## Functions

### `eventNode(input)`

Helper function that creates an `EventNode` object from an input object.

```ts
const node = eventNode({
    name: 'transferEvent',
    data: structTypeNode([
        structFieldTypeNode({ name: 'authority', type: publicKeyTypeNode() }),
        structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') }),
    ]),
});
```

## Examples

### An event with a struct payload

```ts
eventNode({
    name: 'transferEvent',
    data: structTypeNode([
        structFieldTypeNode({ name: 'authority', type: publicKeyTypeNode() }),
        structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') }),
    ]),
});
```

### An event with a hidden prefix discriminator

```ts
eventNode({
    name: 'transferEvent',
    data: hiddenPrefixTypeNode(structTypeNode([structFieldTypeNode({ name: 'amount', type: numberTypeNode('u64') })]), [
        constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 8), bytesValueNode('base16', '0102030405060708')),
    ]),
    discriminators: [
        constantDiscriminatorNode(
            constantValueNode(fixedSizeTypeNode(bytesTypeNode(), 8), bytesValueNode('base16', '0102030405060708')),
        ),
    ],
});
```
