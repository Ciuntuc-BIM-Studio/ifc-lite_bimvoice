/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Classification and material associations created in this session (#5876).
 *
 * The parser's on-demand readers (`extractClassificationsOnDemand`,
 * `extractAllMaterialsOnDemand`) read the source file only, so an
 * `IfcRelAssociatesClassification` / `IfcRelAssociatesMaterial` written into
 * the mutation overlay would never reach the Properties panel. These readers
 * resolve the overlay's own rels, and the entities they point at, into the
 * same `ClassificationInfo` / `MaterialInfo` shapes the panel already renders.
 */

import type { IfcAttributeValue, MutablePropertyView } from '@ifc-lite/mutations';
import type { ClassificationInfo, IfcDataStore, MaterialInfo } from '@ifc-lite/parser';

/** `RelatedObjects` / `Relating*` sit at 4 / 5 on every IfcRelAssociates*. */
const RELATED_OBJECTS = 4;
const RELATING = 5;

const refId = (value: IfcAttributeValue | undefined): number | null => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  const match = typeof value === 'string' ? /^#(\d+)$/.exec(value.trim()) : null;
  return match ? Number(match[1]) : null;
};
const text = (value: IfcAttributeValue | undefined): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;
const isIfc2x3 = (schema: string | undefined) => schema?.toUpperCase() === 'IFC2X3';

function effectiveAttributes(view: MutablePropertyView, id: number, store?: IfcDataStore): IfcAttributeValue[] | null {
  if (view.isDeleted(id)) return null;
  const entity = view.getNewEntity(id) ?? store?.getEntity(id);
  if (!entity) return null;
  const attrs = [...entity.attributes];
  for (const [index, value] of view.getPositionalMutationsForEntity(id) ?? []) attrs[index] = value;
  return attrs;
}

function includesAny(related: IfcAttributeValue | undefined, ids: readonly number[]): boolean {
  return Array.isArray(related) && related.some((value) => ids.includes(refId(value) ?? -1));
}

/**
 * Live overlay rels of `relType` whose RelatedObjects include any of
 * `entityIds` (an element and the base it aliases, like the source readers
 * see), with the entity each relates.
 */
function overlayTargets(view: MutablePropertyView, relType: string, entityIds: readonly number[], store?: IfcDataStore): Array<{ id: number; attrs: IfcAttributeValue[] }> {
  const targets: Array<{ id: number; attrs: IfcAttributeValue[] }> = [];
  const created = Array.from(view.getNewEntitiesOfType(relType), (entity) => entity.expressId);
  const editedSource = store ? [...new Set(view.getMutations()
    .filter((mutation) => mutation.type === 'UPDATE_POSITIONAL_ATTRIBUTE' && mutation.attributeName === '@4')
    .map((mutation) => mutation.entityId))] : [];
  for (const relId of [...created, ...editedSource]) {
    const source = store?.getEntity(relId);
    if (!created.includes(relId) && source?.type.toUpperCase() !== relType) continue;
    const rel = effectiveAttributes(view, relId, store);
    if (!rel || !includesAny(rel[RELATED_OBJECTS], entityIds)) continue;
    // The parser already reports an original source association. Only add
    // recipients newly appended by this session's positional mutation.
    if (source && includesAny(source.attributes[RELATED_OBJECTS], entityIds)) continue;
    const target = refId(rel[RELATING]);
    const attrs = target === null ? null : effectiveAttributes(view, target, store);
    if (target !== null && attrs) targets.push({ id: target, attrs });
  }
  return targets;
}

/** Classifications the session associated with any of `entityIds`, as the panel renders them. */
export function overlayClassifications(view: MutablePropertyView | null | undefined, entityIds: readonly number[], schema: string | undefined, store?: IfcDataStore): ClassificationInfo[] {
  if (!view) return [];
  return overlayTargets(view, 'IFCRELASSOCIATESCLASSIFICATION', entityIds, store).map((reference) => {
    const source = refId(reference.attrs[3]);
    const classification = source === null ? null : effectiveAttributes(view, source, store);
    return {
      system: text(classification?.[3]),
      // IFC2X3 names the code ItemReference; IFC4+ Identification. Same slot.
      identification: text(reference.attrs[1]),
      name: text(reference.attrs[2]),
      location: text(reference.attrs[0]),
      description: isIfc2x3(schema) ? undefined : text(reference.attrs[4]),
    };
  });
}

function entityType(view: MutablePropertyView, id: number, store?: IfcDataStore): string {
  return (view.getEntityTypeMutation(id)?.newType ?? view.getNewEntity(id)?.type ?? store?.getEntity(id)?.type ?? '').toUpperCase();
}

const num = (value: IfcAttributeValue | undefined): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const refList = (value: IfcAttributeValue | undefined): number[] => (Array.isArray(value) ? value.map(refId).filter((id): id is number => id !== null) : []);

/**
 * One material definition as the parser's resolver gives a file's (`MaterialInfo`):
 * a material, a layer set (or its usage), a profile set (or its usage), a
 * constituent set or a list, its members named by their materials.
 */
function resolveOverlayMaterial(view: MutablePropertyView, id: number, schema: string | undefined, store: IfcDataStore | undefined, depth = 0): MaterialInfo | null {
  const attrs = effectiveAttributes(view, id, store);
  if (!attrs || depth > 3) return null;
  const type = entityType(view, id, store);
  const legacy = isIfc2x3(schema);
  const materialOf = (ref: IfcAttributeValue | undefined) => {
    const m = refId(ref);
    const ma = m === null ? null : effectiveAttributes(view, m, store);
    return { materialName: text(ma?.[0]), materialCategory: legacy ? undefined : text(ma?.[2]) };
  };
  // Layer thicknesses read in metres, as the resolver gives them.
  const scale = store?.lengthUnitScale ?? 1;
  switch (type) {
    case 'IFCMATERIAL':
      return { type: 'Material', name: text(attrs[0]), description: legacy ? undefined : text(attrs[1]), category: legacy ? undefined : text(attrs[2]) };
    case 'IFCMATERIALLAYERSETUSAGE':
    case 'IFCMATERIALPROFILESETUSAGE': {
      const set = refId(attrs[0]);
      return set === null ? null : resolveOverlayMaterial(view, set, schema, store, depth + 1);
    }
    case 'IFCMATERIALLAYERSET':
      return {
        type: 'MaterialLayerSet', name: text(attrs[1]), description: text(attrs[2]),
        layers: refList(attrs[0]).flatMap((layerId) => {
          const la = effectiveAttributes(view, layerId, store);
          if (!la) return [];
          const thickness = num(la[1]);
          return [{ ...materialOf(la[0]), thickness: thickness === undefined ? undefined : thickness * scale, isVentilated: la[2] === true || la[2] === '.T.', name: text(la[3]), category: text(la[5]) }];
        }),
      };
    case 'IFCMATERIALPROFILESET':
      return {
        type: 'MaterialProfileSet', name: text(attrs[0]), description: text(attrs[1]),
        profiles: refList(attrs[2]).flatMap((profileId) => {
          const pa = effectiveAttributes(view, profileId, store);
          return pa ? [{ ...materialOf(pa[2]), name: text(pa[0]), category: text(pa[5]) }] : [];
        }),
      };
    case 'IFCMATERIALCONSTITUENTSET':
      return {
        type: 'MaterialConstituentSet', name: text(attrs[0]), description: text(attrs[1]),
        constituents: refList(attrs[2]).flatMap((constituentId) => {
          const ca = effectiveAttributes(view, constituentId, store);
          return ca ? [{ ...materialOf(ca[2]), name: text(ca[0]), fraction: num(ca[3]), category: text(ca[4]) }] : [];
        }),
      };
    case 'IFCMATERIALLIST':
      return { type: 'MaterialList', materials: refList(attrs[0]).flatMap((m) => {
        const { materialName, materialCategory } = materialOf(`#${m}`);
        return materialName ? [{ name: materialName, ...(materialCategory ? { category: materialCategory } : {}) }] : [];
      }) };
    default:
      return null;
  }
}

/** Materials the session associated with any of `entityIds`, as the panel renders them (the parser's shapes). */
export function overlayMaterials(view: MutablePropertyView | null | undefined, entityIds: readonly number[], schema: string | undefined, store?: IfcDataStore): MaterialInfo[] {
  if (!view) return [];
  return overlayTargets(view, 'IFCRELASSOCIATESMATERIAL', entityIds, store)
    .map((material) => resolveOverlayMaterial(view, material.id, schema, store))
    .filter((m): m is MaterialInfo => m !== null);
}
