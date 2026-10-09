/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The open project as a package: its id, the file it was opened from or last
 * saved to (a writable handle where the browser gives one, so Save writes it
 * in place), and what was saved — the models' edit counter and the project
 * document at that moment — so the app can tell whether anything is unsaved.
 */

import { create } from 'zustand';
import type { PackageManifest } from './format';

export interface PackageSession {
  projectId: string | null;
  fileName: string | null;
  /** File System Access handle, when the browser supports writing a picked file. */
  handle: FileSystemFileHandle | null;
  savedAt: number | null;
  /** `mutationVersion` and the project document's JSON when last saved or opened. */
  savedMutationVersion: number | null;
  savedDocument: string | null;
  busy: 'saving' | 'opening' | null;
  /** What a long save or open is doing, shown while it runs. */
  progress: string | null;
  /** The version the open project was saved to or opened from (`versions.ts`). */
  version: { id: string; number: number; name: string } | null;
}

export const usePackageSession = create<PackageSession>()(() => ({
  projectId: null, fileName: null, handle: null, savedAt: null, savedMutationVersion: null, savedDocument: null, busy: null, progress: null, version: null,
}));

export function newProjectId(): string {
  return globalThis.crypto.randomUUID();
}

/** Forget the package (a New project, or models loaded on their own). */
export function resetPackageSession(): void {
  usePackageSession.setState({ projectId: null, fileName: null, handle: null, savedAt: null, savedMutationVersion: null, savedDocument: null, busy: null, progress: null, version: null });
}

/** The version a package says it is, or null. */
export function versionOf(manifest: PackageManifest): PackageSession['version'] {
  const v = manifest.versionInfo;
  return v?.id ? { id: v.id, number: v.number ?? 0, name: v.name ?? '' } : null;
}
