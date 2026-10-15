/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The package's ZIP, with each large part compressed once (N4b): a model's
 * IFC and geometry are the same bytes from save to save, so their deflated
 * form and CRC are kept and written again as they are — a save then costs
 * the parts that changed, not the model's size. Standard ZIP (deflate or
 * stored entries), read by any unzip.
 */

import { deflateSync, Zip, type ZipInputFile } from 'fflate';

interface Packed { crc: number; size: number; data: Uint8Array<ArrayBuffer>; compression: 0 | 8 }

/** Parts this size and up keep their packed form. */
const KEEP = 1 << 20;
const packed = new WeakMap<Uint8Array, Map<number, Packed>>();

let table: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** The same bytes over a plain ArrayBuffer (a shared one copied). */
const plain = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  bytes.buffer instanceof ArrayBuffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);

function pack(bytes: Uint8Array, level: number): Packed {
  const known = packed.get(bytes)?.get(level);
  if (known) return known;
  const deflated = level > 0 ? deflateSync(bytes, { level: level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }) : null;
  const out: Packed = deflated && deflated.byteLength < bytes.byteLength
    ? { crc: crc32(bytes), size: bytes.byteLength, data: deflated, compression: 8 }
    : { crc: crc32(bytes), size: bytes.byteLength, data: plain(bytes), compression: 0 };
  if (bytes.byteLength >= KEEP) {
    let levels = packed.get(bytes);
    if (!levels) packed.set(bytes, (levels = new Map()));
    levels.set(level, out);
  }
  return out;
}

/** A ZIP of `files`, each deflated at `levelOf(path, bytes)` (0: stored). */
export function zipParts(files: ReadonlyMap<string, Uint8Array>, levelOf: (path: string, bytes: Uint8Array) => number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let failure: Error | null = null;
  const zip = new Zip((err, chunk) => {
    if (err) failure = err;
    else chunks.push(chunk);
  });
  for (const [path, bytes] of files) {
    const p = pack(bytes, levelOf(path, bytes));
    const entry: ZipInputFile = { filename: path, size: p.size, crc: p.crc, compression: p.compression };
    zip.add(entry);
    entry.ondata!(null, p.data, true);
  }
  zip.end();
  if (failure) throw failure;
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.byteLength, 0));
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}
