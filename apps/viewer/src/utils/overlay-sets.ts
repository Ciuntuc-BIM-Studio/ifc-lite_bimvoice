/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Property and quantity sets the session wrote as IFC entities (N3): an
 * `IfcPropertySet` / `IfcElementQuantity` tied to its element by an
 * `IfcRelDefinesByProperties`, or listed in a created type's
 * `HasPropertySets` — how the in-store builders write `Pset_LapinTimberFrame`,
 * the roof, truss, corridor and curtain-wall specs, the joinery and catalogue
 * type sets. The parsed store indexes only the file's sets, so without this an
 * element modelled in Lapin read in the panel (and everywhere the view's base
 * sets are read) as if it had none. Read through each entity as it is now
 * (positional edits included), indexed once per overlay revision.
 */

import { PropertyValueType, QuantityType } from '@ifc-lite/data';
import type { MutablePropertyView, PropertyExtractor } from '@ifc-lite/mutations';
import { EntityExtractor, getInheritanceChainAcrossSchemas, resolveEffectiveEntityRecord, type EffectiveEntityRecord, type IfcDataStore } from '@ifc-lite/parser';

type ExtractedPset = ReturnType<PropertyExtractor>[number];
type ExtractedQset = { name: string; globalId?: string; quantities: Array<{ name: string; type: QuantityType; value: number }> };

const ref = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return typeof v === 'string' && /^#\d+$/.test(v) ? Number(v.slice(1)) : null;
};
const refs = (v: unknown): number[] => (Array.isArray(v) ? v.map(ref).filter((id): id is number => id !== null) : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** An attribute's IFC type and inner value: authored `{ typed: { type, value } }` or parsed `[TYPE, value]`. */
function typed(v: unknown): { type: string; value: unknown } | null {
  if (v && typeof v === 'object' && 'typed' in v) {
    const t = (v as { typed: { type?: unknown; value?: unknown } }).typed;
    return typeof t?.type === 'string' ? { type: t.type.toUpperCase(), value: t.value } : null;
  }
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'string') return { type: v[0].toUpperCase(), value: v[1] };
  return null;
}

function propertyValue(v: unknown): { type: PropertyValueType; value: unknown } {
  const t = typed(v);
  if (!t) return { type: typeof v === 'number' ? PropertyValueType.Real : PropertyValueType.String, value: v ?? null };
  const flag = (x: unknown) => (x === true || x === '.T.' ? true : x === false || x === '.F.' ? false : null);
  if (t.type === 'IFCBOOLEAN') return { type: PropertyValueType.Boolean, value: flag(t.value) };
  if (t.type === 'IFCLOGICAL') return { type: PropertyValueType.Logical, value: flag(t.value) };
  if (t.type === 'IFCINTEGER' || t.type === 'IFCCOUNTMEASURE') return { type: PropertyValueType.Integer, value: Number(t.value) };
  if (t.type === 'IFCLABEL') return { type: PropertyValueType.Label, value: t.value };
  if (t.type === 'IFCIDENTIFIER') return { type: PropertyValueType.Identifier, value: t.value };
  if (t.type === 'IFCTEXT') return { type: PropertyValueType.Text, value: t.value };
  if (typeof t.value === 'number') return { type: PropertyValueType.Real, value: t.value };
  return { type: PropertyValueType.String, value: t.value };
}

const QUANTITY_TYPES: Record<string, QuantityType> = {
  IFCQUANTITYLENGTH: QuantityType.Length, IFCQUANTITYAREA: QuantityType.Area, IFCQUANTITYVOLUME: QuantityType.Volume,
  IFCQUANTITYCOUNT: QuantityType.Count, IFCQUANTITYWEIGHT: QuantityType.Weight, IFCQUANTITYTIME: QuantityType.Time,
  IFCQUANTITYNUMBER: QuantityType.Number,
};

interface Index {
  revision: number;
  /** Element (or type) -> the set definitions it has from the overlay. */
  definitions: Map<number, number[]>;
  /** Occurrence -> the type an overlay IfcRelDefinesByType gives it. */
  types: Map<number, number>;
}

const indexes = new WeakMap<MutablePropertyView, Index>();
const extractors = new WeakMap<IfcDataStore, EntityExtractor>();

function record(store: IfcDataStore, view: MutablePropertyView, id: number): EffectiveEntityRecord | null {
  if (view.isDeleted(id)) return null;
  const created = view.getNewEntity(id);
  let source = null;
  if (!created && store.source?.length) {
    // @raw-entity-enumeration-ok point lookup of one set (or member) an overlay relation names
    const at = store.entityIndex.byId.get(id) ?? store.deferredEntityIndex?.get(id);
    let extractor = extractors.get(store);
    if (!extractor) extractors.set(store, (extractor = new EntityExtractor(store.source)));
    source = at ? extractor.extractEntity(at) : null;
  }
  const entity = created ?? source;
  if (!entity) return null;
  return resolveEffectiveEntityRecord(entity, {
    retype: view.getEntityTypeMutation(id)?.newType,
    named: view.getAttributeMutationsForEntity(id).map(({ name, value }) => [name, value] as const),
    positional: view.getPositionalMutationsForEntity(id) ?? [],
  }, store.schemaVersion);
}

const typeObjects = new Map<string, boolean>();
function isTypeObject(type: string): boolean {
  let known = typeObjects.get(type);
  if (known === undefined) typeObjects.set(type, (known = getInheritanceChainAcrossSchemas(type).includes('IfcTypeObject')));
  return known;
}

const EMPTY: Index = { revision: -1, definitions: new Map(), types: new Map() };

function index(store: IfcDataStore, view: MutablePropertyView): Index {
  // Partial and duck-typed views (tests, older callers) have no overlay entities to read.
  if (typeof view.getMutationRevision !== 'function' || typeof view.getNewEntitiesOfType !== 'function') return EMPTY;
  const revision = view.getMutationRevision();
  const known = indexes.get(view);
  if (known && known.revision === revision) return known;
  const definitions = new Map<number, number[]>();
  const add = (owner: number, def: number) => definitions.set(owner, [...(definitions.get(owner) ?? []), def]);
  for (const created of view.getNewEntitiesOfType('IFCRELDEFINESBYPROPERTIES')) {
    const rel = record(store, view, created.expressId);
    const def = ref(rel?.attributes[5]);
    if (!rel || def === null) continue;
    for (const owner of refs(rel.attributes[4])) add(owner, def);
  }
  const types = new Map<number, number>();
  for (const created of view.getNewEntitiesOfType('IFCRELDEFINESBYTYPE')) {
    const rel = record(store, view, created.expressId);
    const type = ref(rel?.attributes[5]);
    if (!rel || type === null || view.isDeleted(type)) continue;
    for (const occurrence of refs(rel.attributes[4])) types.set(occurrence, type);
  }
  // A created type's own sets (HasPropertySets).
  for (const created of view.getNewEntities()) {
    if (!isTypeObject(created.type)) continue;
    const type = record(store, view, created.expressId);
    for (const def of refs(type?.attributes[5])) add(created.expressId, def);
  }
  const out = { revision, definitions, types };
  indexes.set(view, out);
  return out;
}

/** The property sets `entityId` has from the overlay's own set entities. */
export function overlayPropertySets(store: IfcDataStore, view: MutablePropertyView, entityId: number): ExtractedPset[] {
  const out: ExtractedPset[] = [];
  for (const def of index(store, view).definitions.get(entityId) ?? []) {
    const set = record(store, view, def);
    if (set?.type.toUpperCase() !== 'IFCPROPERTYSET') continue;
    const properties: ExtractedPset['properties'] = [];
    for (const member of refs(set.attributes[4])) {
      const p = record(store, view, member);
      const name = text(p?.attributes[0]);
      if (!p || !name) continue;
      const kind = p.type.toUpperCase();
      if (kind === 'IFCPROPERTYSINGLEVALUE') properties.push({ name, ...propertyValue(p.attributes[2]) });
      else if (kind === 'IFCPROPERTYENUMERATEDVALUE') {
        const values = (Array.isArray(p.attributes[2]) ? p.attributes[2] : []).map((v) => String(typed(v)?.value ?? v));
        properties.push({ name, type: PropertyValueType.Enum, value: values.join(', '), values });
      }
    }
    if (properties.length) out.push({ name: text(set.attributes[2]), globalId: text(set.attributes[0]) || undefined, properties });
  }
  return out;
}

/** The quantity sets `entityId` has from the overlay's own `IfcElementQuantity` entities. */
export function overlayQuantitySets(store: IfcDataStore, view: MutablePropertyView, entityId: number): ExtractedQset[] {
  const out: ExtractedQset[] = [];
  for (const def of index(store, view).definitions.get(entityId) ?? []) {
    const set = record(store, view, def);
    if (set?.type.toUpperCase() !== 'IFCELEMENTQUANTITY') continue;
    const quantities: ExtractedQset['quantities'] = [];
    for (const member of refs(set.attributes[5])) {
      const q = record(store, view, member);
      const type = q ? QUANTITY_TYPES[q.type.toUpperCase()] : undefined;
      const value = Number(typed(q?.attributes[3])?.value ?? q?.attributes[3]);
      if (!q || type === undefined || !Number.isFinite(value)) continue;
      quantities.push({ name: text(q.attributes[0]), type, value });
    }
    if (quantities.length) out.push({ name: text(set.attributes[2]), globalId: text(set.attributes[0]) || undefined, quantities });
  }
  return out;
}

/**
 * The `IfcPropertySingleValue` behind `psetName.propName` of `entityId`
 * when that set is one the session wrote as entities, with the IFC type its
 * value is written as: an edit of it is an edit of that entity, so the set
 * stays one (and the export writes it once, as edited).
 */
export function overlayPropertyMember(
  store: IfcDataStore, view: MutablePropertyView, entityId: number, psetName: string, propName: string,
): { id: number; setId: number; members: number[]; ifcType: string | null } | null {
  for (const def of index(store, view).definitions.get(entityId) ?? []) {
    const set = record(store, view, def);
    if (set?.type.toUpperCase() !== 'IFCPROPERTYSET' || text(set.attributes[2]) !== psetName) continue;
    for (const member of refs(set.attributes[4])) {
      const p = record(store, view, member);
      if (p?.type.toUpperCase() === 'IFCPROPERTYSINGLEVALUE' && text(p.attributes[0]) === propName) {
        return { id: member, setId: def, members: refs(set.attributes[4]), ifcType: typed(p.attributes[2])?.type ?? null };
      }
    }
  }
  return null;
}

const IFC_TYPE_OF: Partial<Record<PropertyValueType, string>> = {
  [PropertyValueType.Boolean]: 'IfcBoolean', [PropertyValueType.Logical]: 'IfcLogical', [PropertyValueType.Integer]: 'IfcInteger',
  [PropertyValueType.Real]: 'IfcReal', [PropertyValueType.Label]: 'IfcLabel', [PropertyValueType.Identifier]: 'IfcIdentifier',
  [PropertyValueType.Text]: 'IfcText', [PropertyValueType.String]: 'IfcLabel',
};

/** `value` as the NominalValue of a member written as `ifcType` (or as `valueType` says). */
export function authoredNominalValue(value: unknown, valueType: PropertyValueType, ifcType: string | null): { typed: { type: string; value: string | number | boolean } } | null {
  if (value === null || value === undefined) return null;
  const type = ifcType ?? IFC_TYPE_OF[valueType] ?? 'IfcLabel';
  const upper = type.toUpperCase();
  const scalar = upper === 'IFCBOOLEAN' || upper === 'IFCLOGICAL' ? value === true || value === 'true'
    : typeof value === 'number' ? value
      : upper === 'IFCINTEGER' || upper.endsWith('MEASURE') || upper === 'IFCREAL' ? Number(value)
        : String(value);
  return { typed: { type, value: scalar } };
}

/**
 * The type an overlay `IfcRelDefinesByType` gives `entityId` (a Lapin type
 * assignment), with its sets as the view reads them, shaped as
 * `extractTypePropertiesOnDemand` gives a file's; null when it has none there.
 */
export function overlayTypeProperties(store: IfcDataStore, view: MutablePropertyView, entityId: number): { typeId: number; typeName: string; properties: ExtractedPset[] } | null {
  const typeId = index(store, view).types.get(entityId);
  if (typeId === undefined) return null;
  const type = record(store, view, typeId);
  if (!type) return null;
  return { typeId, typeName: text(type.attributes[2]) || type.type, properties: view.getForEntity(typeId) };
}
