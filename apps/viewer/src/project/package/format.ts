/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project package (`.lapin`; `.bvproj` before, still opened): one format for a project wherever it is
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
 * project/standards.json  layers, layer groups, text, dimension and axis styles, hatch patterns
 * project/catalogs.json   joinery, element types, profiles, schedules
 * models/<id>.ifc         a native model: the IFC it was loaded from, or (compacted) with all its edits
 * models/<id>.overlay.json  its edits over that IFC (N4b), when not compacted
 * models/<id>/geometry.bin  that IFC's meshes as a load-cache entry (N4a)
 * analytics/<model>/*.parquet  its elements, properties, quantities and
 *                          relationships as tables (versions only), for BI
 * ```
 */

export const PACKAGE_SUFFIX = '.lapin';
/** Earlier names of the same package, still opened. */
export const LEGACY_PACKAGE_SUFFIXES: readonly string[] = ['.bvproj'];
/** Every suffix Open accepts. */
export const OPEN_PACKAGE_SUFFIXES: readonly string[] = [PACKAGE_SUFFIX, ...LEGACY_PACKAGE_SUFFIXES];
export const PACKAGE_FORMAT = 'bimvoice-project';
/** Bumped on a change older readers cannot read; readers migrate anything older. */
export const PACKAGE_VERSION = 2;
export const MANIFEST_PATH = 'manifest.json';

export type ModelRole = 'native' | 'linked';

export interface PackageModel {
  /** Stable within the project: the key its views and the document refer to. */
  id: string;
  name: string;
  role: ModelRole;
  /** A native model's IFC inside the package. */
  path?: string;
  /** Its edits over that IFC (`model-delta.ts`, encoded by `overlay-codec.ts`); absent: the IFC has them all. */
  overlay?: string;
  /** When that IFC was first written: what the load cache validates its geometry against. */
  baseSavedAt?: string;
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
  // A model's IFC and geometry are the same bytes from save to save (N4b): hashed once.
  const known = hashes.get(bytes);
  if (known) return known;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (bytes.byteLength >= 1 << 20) hashes.set(bytes, hex);
  return hex;
}

const hashes = new WeakMap<Uint8Array, string>();

const SAFE = /[^A-Za-z0-9._-]+/g;
/** A path segment from an id: no separators, no traversal. */
export const segment = (id: string): string => id.replace(SAFE, '_').replace(/^\.+/, '_').slice(0, 120) || '_';
