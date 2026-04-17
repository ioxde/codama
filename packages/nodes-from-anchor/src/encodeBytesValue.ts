import { BytesValueNode } from '@codama/nodes';
import { getBase16Codec, getBase58Codec, getBase64Codec, getUtf8Codec, ReadonlyUint8Array } from '@solana/codecs';

export function encodeBytesValue(value: BytesValueNode): ReadonlyUint8Array {
    switch (value.encoding) {
        case 'base16':
            return getBase16Codec().encode(value.data);
        case 'base58':
            return getBase58Codec().encode(value.data);
        case 'base64':
            return getBase64Codec().encode(value.data);
        case 'utf8':
            return getUtf8Codec().encode(value.data);
    }
}
