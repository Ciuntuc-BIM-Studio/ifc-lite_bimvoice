/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Reading and writing project packages on disk. Where the browser has the
 * File System Access API (Chrome, Edge) a picked file keeps a handle and Save
 * writes it in place; elsewhere Save downloads the package and Open uses a
 * file input.
 */

import { downloadFile } from '@/lib/export/download';
import { PACKAGE_SUFFIX } from './format';

const TYPES = [{ description: 'BIMVoice project', accept: { 'application/zip': [PACKAGE_SUFFIX] } }];

interface PickerWindow {
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
}
const picker = () => globalThis as unknown as PickerWindow;

export const canWriteInPlace = (): boolean => typeof picker().showSaveFilePicker === 'function';

const aborted = (err: unknown) => err instanceof DOMException && err.name === 'AbortError';

/** Ask where to save; null when cancelled or unsupported. */
export async function pickSaveTarget(suggestedName: string): Promise<FileSystemFileHandle | null> {
  const show = picker().showSaveFilePicker;
  if (!show) return null;
  try {
    return await show({ suggestedName, types: TYPES });
  } catch (err) {
    if (aborted(err)) return null;
    throw err;
  }
}

export async function writeToHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const writable = await (handle as FileSystemFileHandle & { createWritable(): Promise<FileSystemWritableFileStream> }).createWritable();
  await writable.write(bytes as unknown as ArrayBuffer);
  await writable.close();
}

export function downloadPackage(bytes: Uint8Array, fileName: string): void {
  downloadFile(bytes, fileName.endsWith(PACKAGE_SUFFIX) ? fileName : `${fileName}${PACKAGE_SUFFIX}`, 'application/zip');
}

/** Pick a package to open: its bytes, name and (where supported) handle; null when cancelled. */
export async function pickPackageToOpen(): Promise<{ bytes: Uint8Array; name: string; handle: FileSystemFileHandle | null } | null> {
  const show = picker().showOpenFilePicker;
  if (show) {
    try {
      const [handle] = await show({ types: TYPES, multiple: false });
      const file = await handle.getFile();
      return { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, handle };
    } catch (err) {
      if (aborted(err)) return null;
      throw err;
    }
  }
  const file = await pickFile(PACKAGE_SUFFIX);
  return file ? { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, handle: null } : null;
}

/** A plain file input, resolved with the picked file or null. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
