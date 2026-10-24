import { Address, scValToNative, xdr } from '@stellar/stellar-sdk';

/**
 * Decoding helpers for Soroban contract events.
 *
 * The stream delivers event topics and payloads as base64 XDR, which is opaque
 * in the log. These turn them into plain JS values the viewer can render as a
 * JSON tree, and never throw: a frame that fails to decode is surfaced as an
 * error entry rather than taking the whole log down.
 */

export interface DecodedValue {
  /** The decoded value, or null when decoding failed. */
  value: unknown;
  /** ScVal arm the value came from, e.g. 'scvSymbol' — useful as a type hint. */
  type: string | null;
  /** Set when the input was not decodable base64 XDR. */
  error?: string;
  /** Raw discriminant for unknown operation types, when available. */
  discriminant?: number;
}

export interface DecodedEvent {
  topics: DecodedValue[];
  data: DecodedValue;
  /** Present when the payload carried one. */
  contractId?: string;
}

/**
 * u128/i128/u64 decode to bigint, which JSON.stringify refuses to serialize.
 * Render them as decimal strings — a Number cast would silently lose precision
 * above 2^53, and token amounts routinely exceed it.
 */
export const jsonReplacer = (_key: string, value: unknown): unknown => {
  if (typeof value === 'bigint') return value.toString();
  // Bytes arms decode to raw octets; hex keeps them readable without pulling
  // Buffer into the browser bundle.
  if (value instanceof Uint8Array) {
    return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return value;
};

/** Stable JSON text for a decoded event, suitable for the copy action. */
export const toDecodedJson = (value: unknown): string =>
  JSON.stringify(value, jsonReplacer, 2);

/** Formats unknown XDR operation errors with the raw discriminant value. */
export const unknownOperationError = (discriminant: number): string =>
  `unknown XDR operation type: ${discriminant}`;

/** Extracts a numeric discriminant from an XDR value when available. */
export const discriminantOf = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  const maybe = value as { value?: unknown; discriminant?: unknown } | null;
  if (maybe && typeof maybe.discriminant === 'number') return maybe.discriminant;
  if (maybe && typeof maybe.value === 'number' && Number.isInteger(maybe.value)) return maybe.value as number;
  return null;
};

/** Decodes one base64 ScVal. Returns an error entry rather than throwing. */
export const decodeScVal = (base64: string): DecodedValue => {
  if (typeof base64 !== 'string' || base64.trim() === '') {
    return { value: null, type: null, error: 'Empty XDR value' };
  }

  try {
    const scVal = xdr.ScVal.fromXDR(base64, 'base64');
    const type = scVal.switch().name;

    // scValToNative maps an address to its own arm; go through Address so both
    // account (G...) and contract (C...) addresses come back strkey-encoded.
    if (type === 'scvAddress') {
      return { value: Address.fromScAddress(scVal.address()).toString(), type };
    }

    return { value: scValToNative(scVal), type };
  } catch (err) {
    const raw = err instanceof Error ? err.message : 'Failed to decode XDR';
    const match = raw.match(/discriminant[^0-9-]*(-?\d+)/i);
    if (match) {
      const discriminant = Number.parseInt(match[1], 10);
      return { value: null, type: null, error: unknownOperationError(discriminant), discriminant };
    }
    if (/unknown (operation|op)/i.test(raw)) {
      return { value: null, type: null, error: 'unknown XDR operation type: see discriminant in value', discriminant: undefined };
    }
    return {
      value: null,
      type: null,
      error: raw,
    };
  }
};

/**
 * Decodes the topics and data of a single event. Accepts either separate
 * topic/data fields or a full base64 ContractEvent envelope.
 */
export const decodeContractEvent = (input: {
  topics?: unknown;
  data?: unknown;
  contractId?: string;
}): DecodedEvent => {
  const rawTopics = Array.isArray(input.topics) ? input.topics : [];

  return {
    topics: rawTopics.map((topic) =>
      typeof topic === 'string'
        ? decodeScVal(topic)
        : { value: topic, type: null, error: 'Topic was not an XDR string' },
    ),
    data:
      typeof input.data === 'string'
        ? decodeScVal(input.data)
        : { value: input.data ?? null, type: null },
    contractId: input.contractId,
  };
};

/**
 * Decodes a base64 ContractEvent envelope, which carries the contract id
 * alongside its topics and data.
 */
export const decodeContractEventEnvelope = (base64: string): DecodedEvent => {
  try {
    const event = xdr.ContractEvent.fromXDR(base64, 'base64');
    const body = event.body().v0();
    const contractIdBytes = event.contractId();

    return {
      topics: body.topics().map((topic) => {
        try {
          const type = topic.switch().name;
          if (type === 'scvAddress') {
            return { value: Address.fromScAddress(topic.address()).toString(), type };
          }
          return { value: scValToNative(topic), type };
        } catch (err) {
          return {
            value: null,
            type: null,
            error: err instanceof Error ? err.message : 'Failed to decode topic',
          };
        }
      }),
      data: (() => {
        const data = body.data();
        try {
          return { value: scValToNative(data), type: data.switch().name };
        } catch (err) {
          return {
            value: null,
            type: null,
            error: err instanceof Error ? err.message : 'Failed to decode data',
          };
        }
      })(),
      contractId: contractIdBytes
        // The SDK declares byte fields as `Opaque[]` (its own "workaround" alias) while producing and consuming Buffers at runtime
        ? Address.contract(contractIdBytes as any).toString()
        : undefined,
    };
  } catch (err) {
    return {
      topics: [],
      data: {
        value: null,
        type: null,
        error: err instanceof Error ? err.message : 'Failed to decode contract event',
      },
    };
  }
};

/**
 * First topic rendered as a label. Soroban convention puts the event name
 * there as a Symbol, which is what the topic badge shows.
 */
export const eventName = (decoded: DecodedEvent): string => {
  const first = decoded.topics[0];
  if (!first || first.value == null) return 'unknown';
  return typeof first.value === 'string' ? first.value : String(first.value);
};
