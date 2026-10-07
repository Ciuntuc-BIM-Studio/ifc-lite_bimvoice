/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Keeps the project in step with the loaded models, and autosaves it.
 *
 * Levels come from every loaded model's IfcBuildingStorey list (with
 * GlobalIds, so a plan survives a re-export that renumbers express ids).
 * The project autosaves to localStorage under the set of loaded model keys,
 * so reopening the same models restores their views; the
 * `.ifclite-project.json` file is the shareable copy.
 */

import { useEffect } from 'react';
import { useViewerStore } from '@/store';
import type { FederatedModel } from '@/store/types';
import { modelLevels } from './model-levels';
import { loadProjectDocument, projectDocument, resetProject, syncProjectWithModels, useProjectStore } from './project-store';
import type { StoreyInput } from './view-defaults';
import type { ProjectDocument, ProjectModelRef } from './types';
import { parseProjectFile, serializeProject } from './project-file';

const AUTOSAVE_PREFIX = 'ifc-lite:project:v1:';
const AUTOSAVE_DEBOUNCE_MS = 500;

interface StoreySource {
  spatialHierarchy?: { byStorey: ReadonlyMap<number, unknown>; storeyElevations: ReadonlyMap<number, number> } | null;
  entities: { getName(id: number): string | null; getGlobalId(id: number): string };
}

export function storeysOf(ds: StoreySource | null | undefined): StoreyInput[] {
  if (!ds?.spatialHierarchy) return [];
  const { byStorey, storeyElevations } = ds.spatialHierarchy;
  return Array.from(byStorey.keys(), (id) => ({
    name: ds.entities.getName(id) || `Storey #${id}`,
    elevation: storeyElevations.get(id) ?? 0,
    globalId: ds.entities.getGlobalId(id) || undefined,
  }));
}

export function modelRef(model: Pick<FederatedModel, 'id' | 'name' | 'sourceContentHash'>): ProjectModelRef {
  return { key: model.sourceContentHash ?? model.name, name: model.name };
}

/** The autosave slot for a set of loaded models (order-independent). */
export function autosaveKey(models: readonly ProjectModelRef[]): string {
  return AUTOSAVE_PREFIX + models.map((m) => m.key).sort().join('|');
}

function readAutosave(key: string): ProjectDocument | null {
  try {
    const text = localStorage.getItem(key);
    return text ? parseProjectFile(text) : null;
  } catch (err) {
    console.warn('[project] ignoring unreadable autosave', err);
    return null;
  }
}

function writeAutosave(key: string, doc: ProjectDocument): void {
  try {
    localStorage.setItem(key, serializeProject(doc));
  } catch (err) {
    console.warn('[project] autosave failed', err);
  }
}

function loadedModels(): { refs: ProjectModelRef[]; storeys: StoreyInput[] } {
  const { models, ifcDataStore } = useViewerStore.getState();
  if (models.size === 0) {
    return ifcDataStore ? { refs: [{ key: 'legacy', name: 'Model' }], storeys: storeysOf(ifcDataStore) } : { refs: [], storeys: [] };
  }
  const refs: ProjectModelRef[] = [];
  const storeys: StoreyInput[] = [];
  for (const model of models.values()) {
    if (!model.ifcDataStore) continue;
    refs.push(modelRef(model));
    // Effective storeys: parsed ones not deleted, plus levels added in this session.
    storeys.push(...modelLevels(model.id));
  }
  return { refs, storeys };
}

/** Mount once: follows model loads and autosaves the project. */
export function useProjectSync(): void {
  useEffect(() => {
    let slot: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onModels = () => {
      const { refs, storeys } = loadedModels();
      if (refs.length === 0) return;
      const key = autosaveKey(refs);
      if (key !== slot) {
        slot = key;
        const saved = readAutosave(key);
        const current = useProjectStore.getState();
        const overlaps = current.models.some((m) => refs.some((r) => r.key === m.key));
        if (saved) loadProjectDocument(saved);
        else if (!overlaps) resetProject();
      }
      syncProjectWithModels(refs, storeys);
    };

    onModels();
    const unsubModels = useViewerStore.subscribe((state, prev) => {
      if (state.models !== prev.models || state.ifcDataStore !== prev.ifcDataStore || state.mutationVersion !== prev.mutationVersion) onModels();
    });
    const unsubProject = useProjectStore.subscribe((state, prev) => {
      if (!slot || (state.views === prev.views && state.sheets === prev.sheets && state.name === prev.name
        && state.drafts === prev.drafts && state.draftLayers === prev.draftLayers && state.hatchPatterns === prev.hatchPatterns)) return;
      const key = slot;
      clearTimeout(timer);
      timer = setTimeout(() => writeAutosave(key, projectDocument()), AUTOSAVE_DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(timer);
      unsubModels();
      unsubProject();
    };
  }, []);
}
