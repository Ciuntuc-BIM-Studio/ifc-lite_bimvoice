/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The package's ZIP, with each large part compressed once (N4b): a model's
 * IFC and geometry are the same bytes from save to save, so their deflated
 * form and CRC are kept and written again as they are — a save then costs
 * the parts that changed, not the model's size; the first time, they are
 * packed in a worker (`prepackParts`). Standard ZIP (deflate or stored
 * entries), read by any unzip.
 */

import { deflateSync, Zip, type ZipInputFile } from 'fflate';
import { crc32 } from './zip-crc';
import type { ZipPackRequest, ZipPackResponse } from '@/workers/zipPack.worker';

interface Packed { crc: number; size: number; data: Uint8Array<ArrayBuffer>; compression: 0 | 8 }

/** Parts this size and up keep their packed form. */
const KEEP = 1 << 20;
const packed = new WeakMap<Uint8Array, Map<number, Packed>>();

/** The same bytes over a plain ArrayBuffer (a shared one copied). */
const plain = (bytes: Uint8Array): Uint8Array<ArrayBuffer> =>
  bytes.buffer instanceof ArrayBuffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes);

/** A part's packed form from its CRC and deflated bytes (stored when deflating does not pay). */
function packedOf(bytes: Uint8Array, level: number, crc: number, deflated: Uint8Array<ArrayBuffer> | null): Packed {
  const out: Packed = deflated && deflated.byteLength < bytes.byteLength
    ? { crc, size: bytes.byteLength, data: deflated, compression: 8 }
    : { crc, size: bytes.byteLength, data: plain(bytes), compression: 0 };
  if (bytes.byteLength >= KEEP) {
    let levels = packed.get(bytes);
    if (!levels) packed.set(bytes, (levels = new Map()));
    levels.set(level, out);
  }
  return out;
}

function pack(bytes: Uint8Array, level: number): Packed {
  const known = packed.get(bytes)?.get(level);
  if (known) return known;
  return packedOf(bytes, level, crc32(bytes), level > 0 ? deflateSync(bytes, { level: level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }) : null);
}

/**
 * Pack the large parts `zipParts` has not packed yet off the main thread (one
 * worker for the call), so the ZIP itself is then only assembled. Without
 * workers (tests, old browsers) `zipParts` packs them itself.
 */
export async function prepackParts(files: ReadonlyMap<string, Uint8Array>, levelOf: (path: string, bytes: Uint8Array) => number): Promise<void> {
  const todo = [...files].filter(([path, bytes]) => bytes.byteLength >= KEEP && !packed.get(bytes)?.has(levelOf(path, bytes)));
  if (todo.length === 0 || typeof Worker === 'undefined') return;
  let worker: Worker;
  try {
    worker = new Worker(new URL('../../workers/zipPack.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return;
  }
  try {
    for (const [i, [path, bytes]] of todo.entries()) {
      const level = levelOf(path, bytes);
      const reply = await new Promise<ZipPackResponse>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<ZipPackResponse>) => resolve(e.data);
        worker.onerror = (e) => reject(new Error(e.message));
        worker.postMessage({ id: i, bytes, level } satisfies ZipPackRequest);
      });
      if (reply.error) throw new Error(reply.error);
      packedOf(bytes, level, reply.crc, reply.deflated);
    }
  } catch (err) {
    // The parts not packed here are packed on the main thread by `zipParts`.
    console.warn('[project] packing the package off the main thread failed', err);
  } finally {
    worker.terminate();
  }
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
