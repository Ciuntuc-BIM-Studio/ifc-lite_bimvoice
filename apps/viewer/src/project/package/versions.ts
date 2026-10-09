/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Project versions over a vault — content-addressed parts (by SHA-256) and
 * version records — so versions sharing a part store it once. "Save to
 * version" records the package as a new numbered version; "Update version"
 * rewrites the current one, keeping what it held before among its
 * revisions; a version is rebuilt into package files to open it, and two
 * versions compare part by part. The vault is the browser's storage today
 * (`vault-idb.ts`) and can be an object store (a data lake) later: the
 * layout is the same.
 */

import { MANIFEST_PATH, type PackageManifest } from './format';
import type { PackageFiles } from './package-io';

export interface VersionRevision {
  manifest: PackageManifest;
  updatedAt: number;
  message: string;
}

export interface VersionRecord {
  projectId: string;
  id: string;
  /** 1, 2, 3… within the project. */
  number: number;
  name: string;
  message: string;
  createdAt: number;
  updatedAt: number;
  author?: string;
  /** The version it was made from. */
  parent?: string;
  manifest: PackageManifest;
  /** Bytes of its parts. */
  size: number;
  /** What earlier updates replaced, oldest first. */
  revisions: VersionRevision[];
}

export interface ProjectVault {
  hasBlob(sha256: string): Promise<boolean>;
  putBlob(sha256: string, bytes: Uint8Array): Promise<void>;
  getBlob(sha256: string): Promise<Uint8Array | null>;
  putVersion(record: VersionRecord): Promise<void>;
  listVersions(projectId: string): Promise<VersionRecord[]>;
  deleteVersion(projectId: string, id: string): Promise<void>;
}

/** Store every part the vault does not have yet. */
async function storeParts(vault: ProjectVault, files: PackageFiles, manifest: PackageManifest): Promise<number> {
  let size = 0;
  for (const part of manifest.parts) {
    size += part.size;
    if (await vault.hasBlob(part.sha256)) continue;
    const bytes = files.get(part.path);
    if (!bytes) throw new Error(`Part ${part.path} is missing from the package`);
    await vault.putBlob(part.sha256, bytes);
  }
  return size;
}

export interface VersionMeta {
  name: string;
  message: string;
  author?: string;
  parent?: string;
  now?: number;
  id?: string;
}

/** A new numbered version of the package. */
export async function saveVersion(vault: ProjectVault, files: PackageFiles, manifest: PackageManifest, meta: VersionMeta): Promise<VersionRecord> {
  const existing = await vault.listVersions(manifest.projectId);
  const number = existing.reduce((n, v) => Math.max(n, v.number), 0) + 1;
  const id = meta.id ?? globalThis.crypto.randomUUID();
  const now = meta.now ?? Date.now();
  const name = meta.name || `Version ${number}`;
  const stamped: PackageManifest = { ...manifest, versionInfo: { id, ...(meta.parent ? { parent: meta.parent } : {}), number, name, message: meta.message } };
  const record: VersionRecord = {
    projectId: manifest.projectId, id, number, name, message: meta.message, createdAt: now, updatedAt: now,
    ...(meta.author ? { author: meta.author } : {}), ...(meta.parent ? { parent: meta.parent } : {}),
    manifest: stamped, size: await storeParts(vault, files, manifest), revisions: [],
  };
  await vault.putVersion(record);
  return record;
}

/** The current version rewritten with the package; what it held is kept as a revision. */
export async function updateVersion(vault: ProjectVault, record: VersionRecord, files: PackageFiles, manifest: PackageManifest, message?: string, now = Date.now()): Promise<VersionRecord> {
  const stamped: PackageManifest = { ...manifest, versionInfo: { ...record.manifest.versionInfo, id: record.id, number: record.number, name: record.name, message: message ?? record.message } };
  const updated: VersionRecord = {
    ...record, manifest: stamped, message: message ?? record.message, updatedAt: now,
    size: await storeParts(vault, files, manifest),
    revisions: [...record.revisions, { manifest: record.manifest, updatedAt: record.updatedAt, message: record.message }],
  };
  await vault.putVersion(updated);
  return updated;
}

/** A version's package files, rebuilt from the vault (its manifest included). */
export async function versionFiles(vault: ProjectVault, record: VersionRecord): Promise<PackageFiles> {
  const files: PackageFiles = new Map();
  for (const part of record.manifest.parts) {
    const bytes = await vault.getBlob(part.sha256);
    if (!bytes) throw new Error(`Version ${record.number} is incomplete: ${part.path} is missing from the browser's storage`);
    files.set(part.path, bytes);
  }
  files.set(MANIFEST_PATH, new TextEncoder().encode(JSON.stringify(record.manifest, null, 2)));
  return files;
}

export interface VersionDiff {
  added: string[];
  removed: string[];
  changed: string[];
  /** The same parts, grouped for people: views, sheets, drawings, standards, catalogues, models, document. */
  areas: Record<string, number>;
}

const AREA = (path: string): string => {
  if (path.startsWith('models/')) return 'models';
  if (path.startsWith('analytics/')) return 'analytics';
  if (path.startsWith('project/drafts/')) return 'drawings';
  const m = /^project\/([a-z]+)\.json$/.exec(path);
  return m ? m[1] : 'other';
};

/** What changed from version `a` to version `b`, part by part. */
export function compareVersions(a: PackageManifest, b: PackageManifest): VersionDiff {
  const before = new Map(a.parts.map((p) => [p.path, p.sha256]));
  const after = new Map(b.parts.map((p) => [p.path, p.sha256]));
  const added = [...after.keys()].filter((p) => !before.has(p));
  const removed = [...before.keys()].filter((p) => !after.has(p));
  const changed = [...after.keys()].filter((p) => before.has(p) && before.get(p) !== after.get(p));
  const areas: Record<string, number> = {};
  for (const p of [...added, ...removed, ...changed]) areas[AREA(p)] = (areas[AREA(p)] ?? 0) + 1;
  // A model's file is named by its content: an edited model is one removed and one added file — count it once.
  const models = (list: string[]) => list.filter((p) => AREA(p) === 'models').length;
  if (areas.models) areas.models = Math.max(models(added), models(removed)) + models(changed);
  return { added, removed, changed, areas };
}

/** A vault in memory (tests, and a session without browser storage). */
export function memoryVault(): ProjectVault {
  const blobs = new Map<string, Uint8Array>();
  const versions = new Map<string, VersionRecord>();
  return {
    hasBlob: async (sha) => blobs.has(sha),
    putBlob: async (sha, bytes) => { blobs.set(sha, bytes); },
    getBlob: async (sha) => blobs.get(sha) ?? null,
    putVersion: async (r) => { versions.set(`${r.projectId}:${r.id}`, structuredClone(r)); },
    listVersions: async (projectId) => [...versions.values()].filter((r) => r.projectId === projectId).sort((x, y) => x.number - y.number),
    deleteVersion: async (projectId, id) => { versions.delete(`${projectId}:${id}`); },
  };
}
