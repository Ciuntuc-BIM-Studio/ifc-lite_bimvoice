/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The version commands on the open project: Save to version saves the
 * project (as Save does) stamped as a new numbered version, with each native
 * model's tables as Parquet for analysis, and records it in the browser's
 * vault; Update version saves it again as the current version,
 * which keeps its number and name, what it held before kept as a revision.
 */

import { toast } from '@/components/ui/toast';
import { resolve } from '@/i18n/registry';
import { saveProject } from './save-actions';
import { newProjectId, usePackageSession } from './session';
import { idbVault } from './vault-idb';
import { saveVersion, updateVersion, type ProjectVault, type VersionRecord } from './versions';

let vault: ProjectVault = idbVault;
/** The vault versions go to (the browser's; a data lake later). */
export function useVault(next: ProjectVault): void { vault = next; }
export const currentVault = (): ProjectVault => vault;

function projectId(): string {
  const s = usePackageSession.getState();
  if (s.projectId) return s.projectId;
  const id = newProjectId();
  usePackageSession.setState({ projectId: id });
  return id;
}

export async function saveToVersion(name: string, message: string): Promise<VersionRecord | null> {
  const project = projectId();
  const parent = usePackageSession.getState().version?.id;
  const number = (await vault.listVersions(project)).reduce((n, v) => Math.max(n, v.number), 0) + 1;
  const id = globalThis.crypto.randomUUID();
  const label = name.trim() || `Version ${number}`;
  const packaged = await saveProject(false, { id, ...(parent ? { parent } : {}), number, name: label, message }, { analytics: true });
  if (!packaged) return null;
  try {
    const record = await saveVersion(vault, packaged.files, packaged.manifest, { id, name: label, message, ...(parent ? { parent } : {}) });
    usePackageSession.setState({ version: { id: record.id, number: record.number, name: record.name } });
    toast.success(resolve('projectVersions.saved', { number: record.number, name: record.name }));
    return record;
  } catch (err) {
    toast.error(resolve('projectVersions.failed', { detail: err instanceof Error ? err.message : String(err) }));
    return null;
  }
}

export async function updateCurrentVersion(message?: string): Promise<VersionRecord | null> {
  const current = usePackageSession.getState().version;
  const project = usePackageSession.getState().projectId;
  const record = current && project ? (await vault.listVersions(project)).find((v) => v.id === current.id) : undefined;
  if (!record) {
    toast.info(resolve('projectVersions.noCurrent'));
    return null;
  }
  const packaged = await saveProject(false, { ...record.manifest.versionInfo, message: message ?? record.message }, { analytics: true });
  if (!packaged) return null;
  try {
    const updated = await updateVersion(vault, record, packaged.files, packaged.manifest, message);
    toast.success(resolve('projectVersions.updated', { number: updated.number, name: updated.name }));
    return updated;
  } catch (err) {
    toast.error(resolve('projectVersions.failed', { detail: err instanceof Error ? err.message : String(err) }));
    return null;
  }
}
