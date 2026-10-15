/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Structured data (an overlay snapshot: Maps, Sets, NaN, undefined, typed
 * arrays) as JSON text and back, so it can travel in the package as a file
 * (the journal keeps it in IndexedDB, which clones it as is). What JSON has
 * no spelling for is written as a one-key object whose key starts with a NUL
 * character, which no IFC or app key does; an object that does have such a
 * key is escaped the same way.
 */

const TAG = '\u0000';
type Tagged = Record<string, unknown>;

const TYPED = {
  Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array,
} as const;
type TypedName = keyof typeof TYPED;

function encode(value: unknown): unknown {
  if (value === undefined) return { [`${TAG}u`]: 0 };
  if (typeof value === 'number') return Number.isFinite(value) ? value : { [`${TAG}n`]: String(value) };
  if (typeof value === 'bigint') return { [`${TAG}b`]: value.toString() };
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(encode);
  if (value instanceof Map) return { [`${TAG}m`]: [...value].map(([k, v]) => [encode(k), encode(v)]) };
  if (value instanceof Set) return { [`${TAG}s`]: [...value].map(encode) };
  if (value instanceof Date) return { [`${TAG}d`]: value.toISOString() };
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    const name = value.constructor.name;
    if (name in TYPED) return { [`${TAG}t`]: name, v: Array.from(value as unknown as ArrayLike<number>, encode) };
  }
  const entries = Object.entries(value);
  const out: Tagged = {};
  for (const [k, v] of entries) out[k] = encode(v);
  return entries.some(([k]) => k.startsWith(TAG)) ? { [`${TAG}o`]: Object.entries(out) } : out;
}

function decode(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decode);
  if (value === null || typeof value !== 'object') return value;
  const keys = Object.keys(value);
  const tagged = value as Tagged;
  if (keys.length > 0 && keys[0].startsWith(TAG)) {
    const tag = keys[0].slice(1);
    const body = tagged[keys[0]];
    switch (tag) {
      case 'u': return undefined;
      case 'n': return Number(body);
      case 'b': return BigInt(String(body));
      case 'm': return new Map((body as Array<[unknown, unknown]>).map(([k, v]) => [decode(k), decode(v)]));
      case 's': return new Set((body as unknown[]).map(decode));
      case 'd': return new Date(String(body));
      case 't': return TYPED[body as TypedName].from((tagged.v as unknown[]).map((n) => Number(decode(n))));
      case 'o': return Object.fromEntries((body as Array<[string, unknown]>).map(([k, v]) => [k, decode(v)]));
      default: throw new Error(`overlay codec: unknown tag ${JSON.stringify(tag)}`);
    }
  }
  const out: Tagged = {};
  for (const k of keys) out[k] = decode(tagged[k]);
  return out;
}

/** `value` as JSON text that {@link decodeStructured} reads back equal. */
export function encodeStructured(value: unknown): string {
  return JSON.stringify(encode(value));
}

export function decodeStructured(text: string): unknown {
  return decode(JSON.parse(text));
}
