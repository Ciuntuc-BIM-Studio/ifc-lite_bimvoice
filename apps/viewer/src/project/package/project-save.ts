/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The open project as a package: the project document, every native model
 * as the IFC it was loaded from plus its edits over it (N4b: what a Save
 * writes is the edits; `package-base.ts`), or compacted into one IFC with
 * all its edits (the same export as "Export modified IFC"), and the linked
 * models as references. A native model's key in the document
 * becomes the identity of the bytes written, which is what the loader
 * computes when the package is opened again.
 */

import { asSourceBytes, type IfcDataStore } from '@ifc-lite/parser';
import { ParquetExporter } from '@ifc-lite/export';
import { strToU8, unzipSync } from 'fflate';
import { useViewerStore } from '@/store';
import { collectChangedModels } from '@/lib/export/model-changes';
import { exportChangedModelToStep } from '@/lib/export/changed-model-export';
import { mapStepSchema } from '@/lib/export/artifact-naming';
import { placementSourceIdentity } from '@/lib/model-placement/source-identity';
import { projectDocument } from '../project-store';
import { modelRef } from '../project-sync';
import type { ProjectDocument } from '../types';
import { buildPackage, zipPackage, type ModelInput, type PackageFiles } from './package-io';
import { segment, type PackageManifest, type PackageVersionInfo } from './format';
import { packageGeometry, packageGeometryPath } from './package-geometry';
import { nativeTablesFolder } from './native-tables-path';
import { uuidV5 } from '@ifc-lite/encoding';
import { captureModelDelta } from './model-delta';
import { encodeStructured } from './overlay-codec';
import { baseGeometry, compactionReason, modelBase } from './package-base';

const APP = { name: 'BIMVoice', version: '4.0.0' };

/** Put a model's geometry entry in the package when it can be had; a model without one still saves. */
async function addGeometry(extras: Map<string, Uint8Array>, key: string, name: string, make: () => Promise<Uint8Array | null>): Promise<void> {
  try {
    const geometry = await make();
    if (geometry) extras.set(packageGeometryPath(segment(key)), geometry);
  } catch (err) {
    // The geometry only speeds the next open up.
    console.warn('[project] package geometry skipped for', name, err);
  }
}

async function nativeModelBytes(modelId: string, dataStore: IfcDataStore, edited: boolean): Promise<Uint8Array> {
  const source = dataStore.source ? asSourceBytes(dataStore.source) : null;
  // A copy: the parsed source can sit in shared memory, which Blob and Web Crypto refuse.
  if (!edited && source && source.byteLength > 0) return new Uint8Array(source.materialize());
  const state = useViewerStore.getState();
  const artifact = await exportChangedModelToStep(modelId, dataStore, state.mutationViews.get(modelId), {
    schema: mapStepSchema(String(dataStore.schemaVersion ?? 'IFC4')),
    georefMutations: state.georefMutations.get(modelId),
    scheduleState: null,
    description: 'BIMVoice project',
    // The project keeps a live Union's tools: they are elements to edit, not only the target's body.
    keepCombinedTools: true,
  });
  return typeof artifact.content === 'string' ? new TextEncoder().encode(artifact.content) : artifact.content;
}

export interface PackagedProject {
  bytes: Uint8Array;
  /** The package as path → bytes (what a version stores). */
  files: PackageFiles;
  manifest: PackageManifest;
  /** The document as saved (native model keys moved to the saved bytes' identity). */
  doc: ProjectDocument;
}

/** A model's tables (BIM Open Schema Parquet: entities, properties, quantities, relationships) by file name. */
async function modelTables(dataStore: IfcDataStore, modelId: string): Promise<Map<string, Uint8Array>> {
  const bos = await new ParquetExporter(dataStore, undefined, useViewerStore.getState().mutationViews.get(modelId)).exportBOS({ includeGeometry: false });
  return new Map(Object.entries(unzipSync(bos)).filter(([name]) => name.endsWith('.parquet')));
}

/**
 * The model in the native schema, as Arrow tables (N1: written beside the
 * IFC, which stays what the package opens from). Like the analytics tables,
 * a model they cannot be written for still saves.
 */
async function nativeTables(projectId: string, modelId: string, name: string, dataStore: IfcDataStore): Promise<Map<string, Uint8Array>> {
  try {
    const started = performance.now();
    const [{ liftNativeModel }, { MutablePropertyView }, { nativeTablesFromModel }] = await Promise.all([
      import('@ifc-lite/create'), import('@ifc-lite/mutations'), import('./native-tables'),
    ]);
    const view = useViewerStore.getState().mutationViews.get(modelId) ?? new MutablePropertyView(null, modelId);
    const { model, skipped } = liftNativeModel(dataStore, view, { id: nativeModelId(projectId, name), name });
    const files = nativeTablesFromModel(model);
    console.log(`[project] native tables for ${name}: ${model.elements.length} elements, ${skipped.length} kept as IFC only, ${(performance.now() - started).toFixed(0)}ms`);
    return files;
  } catch (err) {
    console.warn('[project] native tables skipped for', name, err);
    return new Map();
  }
}

/** The native model's own id: stable for a model of a project across saves. */
function nativeModelId(projectId: string, name: string): string {
  return uuidV5('3b0f4f61-8c5e-4a8e-9f0f-2c6a2f4b7d90', `${projectId}\n${name}`);
}

export async function packageCurrentProject(projectId: string, options: {
  versionInfo?: PackageVersionInfo; onProgress?: (label: string) => void; analytics?: boolean;
  /** Write the primary model's meshes beside its IFC (`package-geometry.ts`): an explicit Save, not a recovery copy. */
  geometry?: boolean;
  /** Write every edited model as one IFC with its edits (a version), not as its IFC plus a delta. */
  compact?: boolean;
  /** An IFC project (`ProjectDocument.storage`): every edited model as one IFC with its edits, and no native tables. */
  ifc?: boolean;
} = {}): Promise<PackagedProject> {
  const state = useViewerStore.getState();
  const edited = new Set(collectChangedModels(state).models.map((m) => m.id));
  const now = new Date().toISOString();
  const doc = projectDocument();
  const renamed = new Map<string, string>();
  const extras = new Map<string, Uint8Array>();
  const models: ModelInput[] = [];
  for (const model of state.models.values()) {
    if (!model.ifcDataStore) continue;
    const ref = modelRef(model);
    if (model.linked) {
      models.push({ id: ref.key, name: model.name, role: 'linked', source: model.name, ...(model.sourceContentHash ? { sha256: model.sourceContentHash } : {}) });
      continue;
    }
    options.onProgress?.(model.name);
    const hasEdits = edited.has(model.id);
    const delta = captureModelDelta(state, model.id);
    const base = await modelBase(model.ifcDataStore);
    const reason = !base ? 'its IFC is not in memory' : hasEdits ? (options.ifc ? 'an IFC project' : compactionReason(model, delta, !!options.compact)) : null;
    if (reason || !base || !delta) {
      // Compacted: one IFC with every edit, as an export writes it (and, in a Lapin project, the native tables beside it).
      if (hasEdits) console.log(`[project] ${model.name} saved as one IFC with its edits (${reason})`);
      const bytes = await nativeModelBytes(model.id, model.ifcDataStore, hasEdits);
      const key = (await placementSourceIdentity(new Blob([bytes as BlobPart]), undefined, bytes)) ?? ref.key;
      renamed.set(ref.key, key);
      models.push({ id: key, name: model.name, role: 'native', bytes, baseSavedAt: now });
      if (!options.ifc) for (const [path, table] of await nativeTables(projectId, model.id, model.name, model.ifcDataStore)) extras.set(`${nativeTablesFolder(segment(key))}/${path}`, table);
      if (options.geometry) await addGeometry(extras, key, model.name, () => packageGeometry(model, bytes));
    } else {
      // The IFC it was loaded from, unchanged from save to save, and its edits over it (N4b).
      base.savedAt ??= now;
      renamed.set(ref.key, base.key);
      models.push({
        id: base.key, name: model.name, role: 'native', bytes: base.bytes, baseSavedAt: base.savedAt,
        ...(hasEdits ? { overlay: strToU8(encodeStructured(delta)) } : {}),
      });
      if (options.geometry) {
        await addGeometry(extras, base.key, model.name, async () => (base.geometry !== undefined ? base.geometry : (base.geometry = await baseGeometry(model, base, delta))));
      }
    }
    if (options.analytics) {
      try {
        const folder = `analytics/${segment(model.name.replace(/\.[^.]+$/, '') || model.id)}`;
        for (const [name, table] of await modelTables(model.ifcDataStore, model.id)) extras.set(`${folder}/${name}`, table);
      } catch (err) {
        // Tables are for analysis: a model they cannot be written for still saves.
        console.warn('[project] analytics tables skipped for', model.name, err);
      }
    }
  }
  const saved: ProjectDocument = { ...doc, models: models.map((m) => ({ key: m.id, name: m.name })) };
  // Keep a reference the document had to a model not loaded right now.
  for (const ref of doc.models) if (!renamed.has(ref.key) && !saved.models.some((m) => m.key === ref.key)) saved.models.push(ref);
  const { files, manifest } = await buildPackage({ projectId, doc: saved, models, app: APP, versionInfo: options.versionInfo, extras });
  return { bytes: zipPackage(files), files, manifest, doc: saved };
}
