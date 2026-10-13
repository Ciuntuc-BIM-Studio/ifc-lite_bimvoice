/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { baseName, isDesktop, pathHandle, saveBlobAs } from './desktop-host';

interface Call { cmd: string; args: unknown; headers?: Record<string, string> }

function fakeHost(answers: Record<string, unknown> = {}): Call[] {
  const calls: Call[] = [];
  (globalThis as { __TAURI__?: unknown }).__TAURI__ = {
    core: {
      invoke: async (cmd: string, args?: unknown, options?: { headers?: Record<string, string> }) => {
        calls.push({ cmd, args, headers: options?.headers });
        return answers[cmd] ?? null;
      },
    },
    event: { listen: async () => () => undefined },
  };
  return calls;
}

afterEach(() => { delete (globalThis as { __TAURI__?: unknown }).__TAURI__; });

describe('desktop host', () => {
  it('is only present inside the desktop window', () => {
    assert.equal(isDesktop(), false);
    fakeHost();
    assert.equal(isDesktop(), true);
  });

  it('names a file by its last path segment', () => {
    assert.equal(baseName('/Users/me/Proiecte/casa.lapin'), 'casa.lapin');
    assert.equal(baseName('C:\\Proiecte\\casa.lapin'), 'casa.lapin');
  });

  it('writes a path handle in place, the bytes raw and the path in a header', async () => {
    const calls = fakeHost();
    const handle = pathHandle('/tmp/Proiect ă.lapin');
    assert.equal(handle.name, 'Proiect ă.lapin');
    const writable = await (handle as unknown as { createWritable(): Promise<{ write(d: BufferSource): Promise<void>; close(): Promise<void> }> }).createWritable();
    await writable.write(new Uint8Array([1, 2]));
    await writable.write(new Uint8Array([3]).buffer);
    await writable.close();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].cmd, 'write_file');
    assert.deepEqual([...(calls[0].args as Uint8Array)], [1, 2, 3]);
    assert.equal(decodeURIComponent(calls[0].headers?.['x-path'] ?? ''), '/tmp/Proiect ă.lapin');
  });

  it('reads a path handle back as a File', async () => {
    fakeHost({ read_file: new Uint8Array([9, 8]).buffer });
    const file = await pathHandle('/tmp/a.lapin').getFile();
    assert.equal(file.name, 'a.lapin');
    assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [9, 8]);
  });

  it('saves a download through the native Save panel, and not when it is cancelled', async () => {
    const calls = fakeHost({ pick_save_file: '/tmp/plan.dxf' });
    assert.equal(await saveBlobAs(new Blob(['x']), 'plan.dxf'), true);
    assert.deepEqual(calls.map((c) => c.cmd), ['pick_save_file', 'write_file']);
    assert.deepEqual(calls[0].args, { defaultName: 'plan.dxf', filters: [{ name: 'DXF', extensions: ['dxf'] }] });

    const cancelled = fakeHost();
    assert.equal(await saveBlobAs(new Blob(['x']), 'plan.dxf'), false);
    assert.deepEqual(cancelled.map((c) => c.cmd), ['pick_save_file']);
  });
});
