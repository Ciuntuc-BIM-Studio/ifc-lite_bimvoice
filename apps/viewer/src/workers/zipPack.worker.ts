/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * A package part packed off the main thread (`zip-parts.ts`): its CRC-32 and,
 * at a level above 0, its deflated bytes — the seconds a large model's IFC
 * takes at a first save, which would otherwise freeze the app.
 */

import { deflateSync } from 'fflate';
import { crc32 } from '../project/package/zip-crc';

export interface ZipPackRequest { id: number; bytes: Uint8Array; level: number }
export interface ZipPackResponse { id: number; crc: number; deflated: Uint8Array<ArrayBuffer> | null; error?: string }

self.onmessage = (event: MessageEvent<ZipPackRequest>) => {
  const { id, bytes, level } = event.data;
  try {
    const deflated = level > 0 ? deflateSync(bytes, { level: level as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }) : null;
    const response: ZipPackResponse = { id, crc: crc32(bytes), deflated };
    (self as unknown as Worker).postMessage(response, deflated ? [deflated.buffer] : []);
  } catch (error) {
    (self as unknown as Worker).postMessage({ id, crc: 0, deflated: null, error: error instanceof Error ? error.message : String(error) } satisfies ZipPackResponse);
  }
};
