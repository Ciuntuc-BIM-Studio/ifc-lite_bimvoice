/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The desktop host (`apps/desktop`, a Tauri window around this app): native
 * Open / Save panels and files read and written in place, where a browser
 * offers the File System Access API or a download. Reached through the
 * global the window injects (`withGlobalTauri`), so the web build carries no
 * Tauri dependency; outside the window every call here is unavailable and
 * `isDesktop()` is false.
 */

interface TauriGlobal {
  core: { invoke<T>(cmd: string, args?: unknown, options?: { headers?: Record<string, string> }): Promise<T> };
  event: { listen(event: string, handler: () => void): Promise<() => void> };
}

const tauri = (): TauriGlobal | null => (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__ ?? null;

/** Running inside the Lapin desktop window. */
export const isDesktop = (): boolean => tauri() !== null;

function host(): TauriGlobal {
  const t = tauri();
  if (!t) throw new Error('Not running in the Lapin desktop app');
  return t;
}

export interface FileFilter {
  name: string;
  /** Without the dot: `lapin`, `ifc`. */
  extensions: string[];
}

/** The last path segment of a file path (either separator). */
export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** The native Open panel; the picked path, or null when cancelled. */
export function pickOpenPath(filters: FileFilter[]): Promise<string | null> {
  return host().core.invoke<string | null>('pick_open_file', { filters });
}

/** The native Save panel proposing `defaultName`; the chosen path, or null when cancelled. */
export function pickSavePath(defaultName: string, filters: FileFilter[] = []): Promise<string | null> {
  return host().core.invoke<string | null>('pick_save_file', { defaultName, filters });
}

export async function readPath(path: string): Promise<Uint8Array> {
  const data = await host().core.invoke<ArrayBuffer | number[]>('read_file', { path });
  return data instanceof ArrayBuffer ? new Uint8Array(data) : Uint8Array.from(data);
}

/** Write a file in place (atomically: a temporary sibling renamed over it). */
export async function writePath(path: string, bytes: Uint8Array): Promise<void> {
  await host().core.invoke('write_file', bytes, { headers: { 'x-path': encodeURIComponent(path) } });
}

/**
 * A file on disk as the File System Access handle the package code keeps
 * (`name`, `getFile`, `createWritable`), so Save writes back where a project
 * was opened from exactly as in a browser that has the API.
 */
export function pathHandle(path: string): FileSystemFileHandle {
  const name = baseName(path);
  const handle = {
    kind: 'file' as const,
    name,
    path,
    async getFile() {
      const bytes = await readPath(path);
      return new File([bytes as BlobPart], name);
    },
    async createWritable() {
      const parts: Uint8Array[] = [];
      return {
        async write(data: BufferSource | Blob) {
          if (data instanceof Blob) parts.push(new Uint8Array(await data.arrayBuffer()));
          else parts.push(data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        },
        async close() {
          const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
          let at = 0;
          for (const p of parts) { out.set(p, at); at += p.byteLength; }
          await writePath(path, out);
        },
      };
    },
  };
  return handle as unknown as FileSystemFileHandle;
}

/** Ask where to save `blob` (proposing `filename`) and write it there; false when cancelled. */
export async function saveBlobAs(blob: Blob, filename: string): Promise<boolean> {
  const ext = /\.([^./\\]+)$/.exec(filename)?.[1];
  const path = await pickSavePath(filename, ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : []);
  if (!path) return false;
  await writePath(path, new Uint8Array(await blob.arrayBuffer()));
  return true;
}

/** Project files opened from outside (Finder, the command line), each handed over once. */
export function takeOpenedPaths(): Promise<string[]> {
  return host().core.invoke<string[]>('take_opened_files');
}

/** Called whenever project files are opened from outside while the app runs; returns the unsubscribe. */
export function onFilesOpened(handler: () => void): Promise<() => void> {
  return host().event.listen('lapin://open-file', handler);
}
