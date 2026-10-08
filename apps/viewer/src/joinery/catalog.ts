/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project's door and window catalogue as actions: add, duplicate,
 * change, remove, import, pick the one the Door / Window tools place — and
 * keep the loaded models in step. A change to an entry already placed
 * rewrites its IFC type in every model that has it, resizes the occurrences
 * and re-meshes them, as one undo step per model; "apply to selection"
 * moves selected doors / windows to an entry.
 */

import {
  defaultDoorSpec, defaultWindowSpec, retypeOccurrencesInStore, setJoineryFlipsInStore, syncJoineryTypeInStore,
  type JoineryKind, type JoinerySpec,
} from '@ifc-lite/create';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { requestRemesh } from '@/lib/remesh/remesh-service';
import { useProjectStore } from '@/project/project-store';
import { freshProjectId } from '@/project/view-defaults';
import { invalidateJoineryReads, joineryOfElement } from './element-spec';

type State = ReturnType<typeof useProjectStore.getState>;

export const catalogue = (s: State = useProjectStore.getState()): JoinerySpec[] => s.joineryTypes ?? [];

export function joineryEntry(id: string | undefined): JoinerySpec | null {
  return id ? catalogue().find((t) => t.id === id) ?? null : null;
}

/** The entry the tool of `kind` places, or null (a plain, untyped door / window). */
export function currentJoinery(kind: JoineryKind): JoinerySpec | null {
  const s = useProjectStore.getState();
  return joineryEntry(s.currentJoinery?.[kind]);
}

export function setCurrentJoinery(kind: JoineryKind, id: string | null): void {
  const s = useProjectStore.getState();
  const next = { ...(s.currentJoinery ?? {}) };
  if (id) next[kind] = id;
  else delete next[kind];
  useProjectStore.setState({ currentJoinery: next, dirty: true });
}

function nextMark(kind: JoineryKind, list: readonly JoinerySpec[]): string {
  const prefix = kind === 'door' ? 'D' : 'W';
  const used = new Set(list.map((t) => t.mark));
  for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

export function addJoinery(kind: JoineryKind, from?: JoinerySpec): string {
  const list = catalogue();
  const base = from ? structuredClone(from) : kind === 'door' ? defaultDoorSpec() : defaultWindowSpec();
  const mark = nextMark(kind, list);
  const id = freshProjectId('joinery');
  const name = from ? `${from.name} copy` : `${kind === 'door' ? 'Door' : 'Window'} ${mark}`;
  useProjectStore.setState({ joineryTypes: [...list, { ...base, id, kind, mark, name }], dirty: true });
  return id;
}

export function removeJoinery(id: string): void {
  const s = useProjectStore.getState();
  const current = { ...(s.currentJoinery ?? {}) };
  for (const k of ['door', 'window'] as const) if (current[k] === id) delete current[k];
  useProjectStore.setState({ joineryTypes: catalogue(s).filter((t) => t.id !== id), currentJoinery: current, dirty: true });
}

/** Replace an entry in the catalogue only (the models follow on `pushJoinery`). */
export function updateJoinery(spec: JoinerySpec): void {
  useProjectStore.setState({ joineryTypes: catalogue().map((t) => (t.id === spec.id ? spec : t)), dirty: true });
}

/** Add imported entries; an entry whose id is already in the catalogue replaces it. */
export function importJoinery(specs: readonly JoinerySpec[]): number {
  const list = [...catalogue()];
  for (const spec of specs) {
    const id = spec.id ?? freshProjectId('joinery');
    const at = list.findIndex((t) => t.id === id);
    if (at >= 0) list[at] = { ...spec, id };
    else list.push({ ...spec, id });
  }
  useProjectStore.setState({ joineryTypes: list, dirty: true });
  return specs.length;
}

export interface JoineryModelOutcome {
  /** Occurrences updated / moved across all models. */
  updated: number;
  refused: string[];
}

function eachEditableModel(run: (modelId: string) => void): void {
  for (const [modelId, model] of useViewerStore.getState().models) {
    if (model.ifcDataStore?.source?.byteLength) run(modelId);
  }
}

/** Rewrite `spec`'s IFC type wherever it is placed and refit its occurrences. */
export function pushJoinery(spec: JoinerySpec): JoineryModelOutcome {
  const out: JoineryModelOutcome = { updated: 0, refused: [] };
  eachEditableModel((modelId) => {
    try {
      const result = recordModellingCommit(useViewerStore, modelId, (editor, ds) => syncJoineryTypeInStore(ds, editor, spec));
      if (!result.type) return;
      invalidateJoineryReads(modelId);
      out.updated += result.remesh.length ? new Set(result.remesh).size : 0;
      out.refused.push(...result.refused.map((r) => `#${r.id}: ${r.reason}`));
      if (result.remesh.length) void requestRemesh(useViewerStore.getState, modelId, result.remesh, 'shape');
    } catch (err) {
      out.refused.push(err instanceof Error ? err.message : String(err));
    }
  });
  return out;
}

/** Move the selected doors / windows of `spec`'s kind to it. */
export function applyJoineryToSelection(spec: JoinerySpec): JoineryModelOutcome {
  const s = useViewerStore.getState();
  const ids = new Set<number>(s.selectedEntityIds ?? []);
  if (s.selectedEntityId !== null && s.selectedEntityId !== undefined) ids.add(s.selectedEntityId);
  const byModel = new Map<string, number[]>();
  for (const id of ids) {
    const ref = s.resolveGlobalIdFromModels(id);
    if (ref) byModel.set(ref.modelId, [...(byModel.get(ref.modelId) ?? []), ref.expressId]);
  }
  const out: JoineryModelOutcome = { updated: 0, refused: [] };
  for (const [modelId, elements] of byModel) {
    try {
      const result = recordModellingCommit(useViewerStore, modelId, (editor, ds) => retypeOccurrencesInStore(ds, editor, spec, elements));
      invalidateJoineryReads(modelId);
      out.updated += elements.length - result.refused.length;
      out.refused.push(...result.refused.map((r) => `#${r.id}: ${r.reason}`));
      if (result.remesh.length) void requestRemesh(useViewerStore.getState, modelId, result.remesh, 'shape');
    } catch (err) {
      out.refused.push(err instanceof Error ? err.message : String(err));
    }
  }
  return out;
}

/**
 * Turn the selected configured doors / windows in their openings (bit 1:
 * hinges to the other jamb, bit 2: open to the other side) — in the model,
 * so 3D, plans and exports agree. Returns the renderer ids it did not handle
 * (elements without a configured type), whose plan symbol alone flips.
 */
export function flipSelectedJoinery(bit: 1 | 2): number[] {
  const s = useViewerStore.getState();
  const ids = new Set<number>(s.selectedEntityIds ?? []);
  if (s.selectedEntityId !== null && s.selectedEntityId !== undefined) ids.add(s.selectedEntityId);
  const rest: number[] = [];
  const byModel = new Map<string, { expressId: number; flips: number }[]>();
  for (const id of ids) {
    const ref = s.resolveGlobalIdFromModels(id);
    const typed = ref ? joineryOfElement(ref.modelId, ref.expressId) : null;
    if (!ref || !typed) { rest.push(id); continue; }
    byModel.set(ref.modelId, [...(byModel.get(ref.modelId) ?? []), { expressId: ref.expressId, flips: typed.flips ^ bit }]);
  }
  for (const [modelId, elements] of byModel) {
    recordModellingCommit(useViewerStore, modelId, (editor, ds) => {
      for (const e of elements) setJoineryFlipsInStore(ds, editor, e.expressId, e.flips);
    });
    invalidateJoineryReads(modelId);
    void requestRemesh(useViewerStore.getState, modelId, elements.map((e) => e.expressId), 'shape');
  }
  return rest;
}
