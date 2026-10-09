/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project package (`.bvproj`): one format for a project wherever it is
 * kept — a ZIP on disk, the browser's own storage, later an object store. A
 * manifest lists every part with its SHA-256 and size; the project document
 * is split into parts (so a save rewrites only what changed), the native
 * models travel as complete IFC files, linked models only as references.
 *
 * ```
 * manifest.json
 * project/document.json   name, models, everything not listed below
 * project/views.json      views (plans, sections, elevations, 3D) and their graphics
 * project/sheets.json     sheets and viewports
 * project/drafts/<id>.json  the drafted geometry and annotations of one view (or sheet)
 * project/standards.json  layers, layer groups, text and dimension styles, hatch patterns
 * project/catalogs.json   joinery, element types, profiles, schedules
 * models/<id>.ifc         a native model, with all its edits
 * ```
 */

export const PACKAGE_SUFFIX = '.bvproj';
export const PACKAGE_FORMAT = 'bimvoice-project';
/** Bumped on a change older readers cannot read; readers migrate anything older. */
export const PACKAGE_VERSION = 1;
export const MANIFEST_PATH = 'manifest.json';

export type ModelRole = 'native' | 'linked';

export interface PackageModel {
  /** Stable within the project: the key its views and the document refer to. */
  id: string;
  name: string;
  role: ModelRole;
  /** A native model's IFC inside the package. */
  path?: string;
  /** SHA-256 (hex) of the IFC: inside the package for a native model, of the referenced file for a linked one. */
  sha256?: string;
  size?: number;
  /** Where a linked model is found: its file name, or a URL. */
  source?: string;
}

export interface PackagePart {
  path: string;
  sha256: string;
  size: number;
}

export interface PackageVersionInfo {
  /** Set once versions exist (S5): this version, and the one it was made from. */
  id?: string;
  parent?: string;
  /** 1, 2, 3… within the project. */
  number?: number;
  name?: string;
  message?: string;
}

export interface PackageManifest {
  format: typeof PACKAGE_FORMAT;
  version: number;
  /** The app that wrote it. */
  app: { name: string; version: string };
  projectId: string;
  projectName: string;
  savedAt: string;
  author?: string;
  models: PackageModel[];
  parts: PackagePart[];
  versionInfo?: PackageVersionInfo;
}

/** SHA-256 of bytes, lowercase hex (Web Crypto: browser and Node). */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const SAFE = /[^A-Za-z0-9._-]+/g;
/** A path segment from an id: no separators, no traversal. */
export const segment = (id: string): string => id.replace(SAFE, '_').replace(/^\.+/, '_').slice(0, 120) || '_';
