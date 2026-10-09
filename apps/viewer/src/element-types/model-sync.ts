/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Element types in the loaded models (`@ifc-lite/create`'s catalog-type):
 *
 * - placing: the Design tools type what they build with the kind's current
 *   entry — its IFC type written into the model the first time, the layer
 *   set used through a usage — in the same undo step (`authored-defaults`);
 * - changing an entry rewrites its type in every model that has it and
 *   fits every occurrence (a wall's or slab's thickness, a column's or
 *   beam's section) — one undo step per model; roof systems made from a
 *   roof entry regenerate with its covering and structure;
 * - "change type" on selected elements types them by another entry and
 *   fits them to it.
 */

import {
  assignMaterialInStore, assignTypeInStore, catalogTypeOfElement, ensureCatalogTypeInStore, findCatalogTypeInStore,
  occurrencesOfTypeInStore, readRelatedLists, readRoofSystem, resolveJoineryAnchor, rewriteCatalogTypeInStore, setLayerUsageOffset,
  addMaterialLayerSetUsageToStore, type CatalogTypeInput, type RoofSystemSpec,
} from '@ifc-lite/create';
import { iterateEffectiveEntityIds, type MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import { recordModellingCommit } from '@/store/slices/mutation-modelling-records';
import { commitElementSize } from '@/lib/element-size-commit';
import { setElementProfile } from '@/store/slices/mutation-element-profile';
import { registerCatalogDefaults } from '@/lib/commands/modeling/authored-defaults';
import { registerOpeningDefault } from '@/lib/commands/modeling/commands/hosted-place';
import type { AuthoredElementKind } from '@/store/slices/authoringDefaultsSlice';
import type { AuthoringTransaction } from '@/lib/commands/modeling/types';
import { runInspectorEdit } from '@/components/viewer/model-inspector/inspector-edits';
import { applyRoofSystem, roofSystemOfRenderId } from '@/project/roof-system-element';
import { authoredKindOf } from '@/lib/commands/modeling/authored-kinds';
import { currentType, elementType } from './catalog';
import { TYPE_CLASS, layersThickness, type ElementTypeKind, type ElementTypeSpec, type RoofTypeSpec } from './spec';
import { ensureEditMode } from '@/project/edit-mode';

/** The entry as a type object: class, name, mark, layers, and itself as the stored spec. */
export function catalogInput(spec: ElementTypeSpec): CatalogTypeInput | null {
  const ifcClass = TYPE_CLASS[spec.kind];
  if (!ifcClass) return null;
  const layers = spec.kind === 'wall' || spec.kind === 'slab' ? spec.layers : undefined;
  return { id: spec.id, ifcClass, name: spec.name, mark: spec.mark || undefined, layers, spec };
}

const LAYER_DIRECTION: Partial<Record<ElementTypeKind, 'AXIS2' | 'AXIS3'>> = { wall: 'AXIS2', slab: 'AXIS3' };

/** A wall's layers centred on its axis start half its thickness to the right; a slab's run up from its underside. */
const usageOffset = (spec: ElementTypeSpec) => (spec.kind === 'wall' ? -layersThickness(spec.layers) / 2 : 0);

/** The catalogue entry an element is typed by, if any. */
export function elementTypeOfElement(modelId: string, expressId: number): ElementTypeSpec | null {
  const s = useViewerStore.getState();
  const ds = s.models.get(modelId)?.ifcDataStore;
  const read = ds ? catalogTypeOfElement(ds, expressId, s.mutationViews.get(modelId) ?? null) : null;
  return read ? elementType(read.id) : null;
}

/** Fit an occurrence to its entry, inside a transaction. The ids to re-mesh. */
function fitOccurrence(tx: AuthoringTransaction, expressId: number, spec: ElementTypeSpec): number[] {
  switch (spec.kind) {
    case 'wall':
    case 'slab': {
      const outcome = commitElementSize(useViewerStore, tx.modelId, expressId, { kind: spec.kind, thickness: layersThickness(spec.layers) });
      if (!outcome.ok) throw new Error(outcome.reason);
      return outcome.remesh;
    }
    case 'column':
    case 'beam': {
      const outcome = setElementProfile(() => tx.store, tx.modelId, expressId, spec.section);
      if (!outcome.ok) throw new Error(outcome.reason);
      return outcome.remesh;
    }
    default:
      return [expressId];
  }
}

export interface TypePushReport {
  /** Models whose type was rewritten. */
  models: number;
  elements: number;
  refused: string[];
}

function roofSystemsOf(ds: IfcDataStore, view: MutablePropertyView | null, typeId: string): { roofId: number; spec: RoofSystemSpec }[] {
  const out: { roofId: number; spec: RoofSystemSpec }[] = [];
  for (const { expressId } of iterateEffectiveEntityIds(ds, view, ['IFCROOF'])) {
    const spec = readRoofSystem(ds, expressId, view);
    if (spec?.typeId === typeId) out.push({ roofId: expressId, spec });
  }
  return out;
}

/** A roof entry's covering, structure and colours over a roof system's own outline and rules. */
export function roofSpecFromType(spec: RoofSystemSpec, type: RoofTypeSpec): RoofSystemSpec {
  return {
    ...spec, typeId: type.id, timberColor: type.timberColor, structure: structuredClone(type.structure),
    covering: { thickness: layersThickness(type.layers), color: type.color, layers: type.layers.map((l) => ({ ...l })) },
  };
}

/** Push a changed entry to every loaded model that uses it. */
export function pushElementType(spec: ElementTypeSpec): TypePushReport {
  ensureEditMode();
  const report: TypePushReport = { models: 0, elements: 0, refused: [] };
  const s = useViewerStore.getState();
  for (const [modelId, model] of s.models) {
    const ds = model.ifcDataStore;
    if (!ds) continue;
    const view = useViewerStore.getState().mutationViews.get(modelId) ?? null;
    if (spec.kind === 'roof') {
      for (const roof of roofSystemsOf(ds, view, spec.id)) {
        const result = applyRoofSystem({ modelId, roofId: roof.roofId }, roofSpecFromType(roof.spec, spec));
        if (result.ok) report.elements++;
        else report.refused.push(result.error);
      }
      continue;
    }
    const input = catalogInput(spec);
    const found = input ? findCatalogTypeInStore(ds, spec.id, input.ifcClass, view) : null;
    if (!input || !found) continue;
    const ok = runInspectorEdit(modelId, (tx) => {
      recordModellingCommit(useViewerStore, modelId, (editor, store) => {
        const anchor = resolveJoineryAnchor(store, editor.getMutationView());
        const { usages } = rewriteCatalogTypeInStore(store, editor, anchor, found, input);
        for (const usage of usages) setLayerUsageOffset(editor, anchor, usage, usageOffset(spec));
      });
      const remesh: number[] = [];
      for (const id of occurrencesOfTypeInStore(ds, found.typeId, tx.store.mutationViews.get(modelId) ?? null)) {
        try {
          remesh.push(...fitOccurrence(tx, id, spec));
          report.elements++;
        } catch (err) {
          report.refused.push(`#${id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return remesh;
    });
    if (ok) report.models++;
  }
  return report;
}

/** Type `ids` (one model) by `spec` and fit them to it. One undo step. */
export function retypeElements(modelId: string, ids: readonly number[], spec: ElementTypeSpec): boolean {
  ensureEditMode();
  const input = catalogInput(spec);
  if (!input || ids.length === 0) return false;
  return runInspectorEdit(modelId, (tx) => {
    recordModellingCommit(useViewerStore, modelId, (editor, store) => {
      const view = editor.getMutationView();
      const anchor = resolveJoineryAnchor(store, view);
      const type = ensureCatalogTypeInStore(store, editor, anchor, input);
      assignTypeInStore(editor, anchor, type.typeId, ids, readRelatedLists(store, 'IfcRelDefinesByType', view));
      const direction = LAYER_DIRECTION[spec.kind];
      if (type.layerSetId === null || !direction) return;
      for (const id of ids) {
        const { usageId } = addMaterialLayerSetUsageToStore(editor, anchor, { ForLayerSet: type.layerSetId, LayerSetDirection: direction, OffsetFromReferenceLine: usageOffset(spec) });
        assignMaterialInStore(editor, anchor, usageId, [id], readRelatedLists(store, 'IfcRelAssociatesMaterial', view));
      }
    });
    return ids.flatMap((id) => fitOccurrence(tx, id, spec));
  });
}

/** The catalogue kind a Design tool's element kind takes its type from. */
const CATALOG_KIND: Partial<Record<AuthoredElementKind, ElementTypeKind>> = { wall: 'wall', slab: 'slab', column: 'column', beam: 'beam' };

// What the tools build is typed by the current entry: its type written into the model on first use, in the same step.
registerCatalogDefaults((kind, modelId) => {
  const catalogKind = CATALOG_KIND[kind];
  const spec = catalogKind ? currentType(catalogKind) : null;
  const input = spec ? catalogInput(spec) : null;
  if (!input) return null;
  return recordModellingCommit(useViewerStore, modelId, (editor, store) => {
    const type = ensureCatalogTypeInStore(store, editor, resolveJoineryAnchor(store, editor.getMutationView()), input);
    return { typeId: type.typeId, layerSetId: type.layerSetId };
  });
});

// A bare opening starts at the current opening type's size.
registerOpeningDefault(() => {
  const spec = currentType('opening');
  return spec ? { Width: spec.width, Height: spec.height, Sill: spec.sill } : null;
});

const OCCURRENCE: Partial<Record<ElementTypeKind, AuthoredElementKind>> = { wall: 'wall', slab: 'slab', column: 'column', beam: 'beam' };

/** Type the selected elements of the entry's kind by it (roof systems: rebuild them with its build-up). */
export function applyTypeToSelection(spec: ElementTypeSpec): { updated: number; refused: string[] } {
  ensureEditMode();
  const s = useViewerStore.getState();
  const ids = new Set<number>(s.selectedEntityIds ?? []);
  if (s.selectedEntityId !== null && s.selectedEntityId !== undefined) ids.add(s.selectedEntityId);
  const out = { updated: 0, refused: [] as string[] };
  const byModel = new Map<string, number[]>();
  for (const id of ids) {
    if (spec.kind === 'roof') {
      const roof = roofSystemOfRenderId(id);
      if (!roof) continue;
      const result = applyRoofSystem(roof, roofSpecFromType(roof.spec, spec));
      if (result.ok) out.updated++;
      else out.refused.push(result.error);
      continue;
    }
    const ref = s.resolveGlobalIdFromModels(id);
    const ds = ref ? s.models.get(ref.modelId)?.ifcDataStore : null;
    const kind = ref && ds ? authoredKindOf({ dataStore: ds, view: s.mutationViews.get(ref.modelId) }, ref.expressId) : null;
    if (!ref || kind === null || kind !== OCCURRENCE[spec.kind]) continue;
    byModel.set(ref.modelId, [...(byModel.get(ref.modelId) ?? []), ref.expressId]);
  }
  for (const [modelId, elements] of byModel) {
    if (retypeElements(modelId, elements, spec)) out.updated += elements.length;
    else out.refused.push(modelId);
  }
  return out;
}
