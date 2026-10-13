/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Tag templates mapped on element parameters. A template is text with
 * `{field}` placeholders:
 *
 *  - `{Name}`, `{Tag}`, `{Description}`, `{ObjectType}`… — an IFC attribute;
 *  - `{Class}` — the IFC class without `Ifc`; `{Type}` — the element type's name;
 *  - `{Pset_WallCommon.FireRating}` — a property (the occurrence's, else its
 *    type's) or a quantity (`{Qto_WallBaseQuantities.Length}`).
 *
 * Edits apply (the mutation view). A field the element does not have, or has
 * empty, reads `NaN` and is reported as a missing range so it is drawn red.
 */

import { extractQuantitiesOnDemand, extractTypePropertiesOnDemand, type IfcDataStore } from '@ifc-lite/parser';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import { useViewerStore } from '@/store';
import { getOrCreateMutationView } from '@/sdk/adapters/mutation-view';
import { effectiveListStringAttribute } from '@/lib/lists/effective-provider-entities';
import { getAttributeNamesForSchema } from '@ifc-lite/parser';
import { elementByGlobalId } from './element-label';

export const MISSING = 'NaN';

const FIELD = /\{([^{}]+)\}/g;

/** The `{fields}` of a template, in order. */
export function templateFields(template: string): string[] {
  return [...template.matchAll(FIELD)].map((m) => m[1].trim());
}

/** Fill a template: each field's value, or NaN where `value` has none. */
export function fillTemplate(template: string, value: (field: string) => string | null): { text: string; missing: Array<[number, number]> } {
  let text = '';
  const missing: Array<[number, number]> = [];
  let last = 0;
  for (const m of template.matchAll(FIELD)) {
    text += template.slice(last, m.index);
    const v = value(m[1].trim());
    if (v === null || v === '') {
      missing.push([text.length, text.length + MISSING.length]);
      text += MISSING;
    } else text += v;
    last = m.index + m[0].length;
  }
  return { text: text + template.slice(last), missing };
}

/** `params.tagMissing` for missing ranges (read back by `missingRanges`). */
export const encodeMissing = (missing: ReadonlyArray<[number, number]>): string => missing.map(([a, b]) => `${a}:${b}`).join(',');

function formatValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? String(Number(value.toFixed(3))) : null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const parts = value.map(formatValue).filter((v): v is string => v !== null && v !== '');
    return parts.length ? parts.join(', ') : null;
  }
  if (typeof value === 'object' && 'value' in value) return formatValue((value as { value: unknown }).value);
  return null;
}

interface Element {
  store: IfcDataStore;
  view: MutablePropertyView | null;
  expressId: number;
}

function attribute(el: Element, name: string): string | null {
  const created = el.view?.getNewEntity(el.expressId);
  const typeName = created?.type ?? el.store.entities.getTypeName(el.expressId);
  const names = getAttributeNamesForSchema(typeName, el.store.schemaVersion);
  const canonical = names.find((n) => n.toLowerCase() === name.toLowerCase());
  if (!canonical) return null;
  return effectiveListStringAttribute(el.store, el.view ?? undefined, el.expressId, canonical, () => {
    const entity = created ?? el.store.getEntity(el.expressId);
    const value = entity?.attributes[names.indexOf(canonical)];
    return formatValue(value) ?? '';
  }) || null;
}

function className(el: Element): string {
  const type = el.view?.getNewEntity(el.expressId)?.type ?? el.store.entities.getTypeName(el.expressId) ?? '';
  return type.replace(/^Ifc/i, '');
}

function setValue(sets: ReadonlyArray<{ name: string; properties?: ReadonlyArray<{ name: string; value: unknown }>; quantities?: ReadonlyArray<{ name: string; value: unknown }> }>, set: string, prop: string): string | null {
  for (const s of sets) {
    if (s.name.toLowerCase() !== set.toLowerCase()) continue;
    const found = (s.properties ?? s.quantities ?? []).find((p) => p.name.toLowerCase() === prop.toLowerCase());
    const v = found ? formatValue(found.value) : null;
    if (v !== null && v !== '') return v;
  }
  return null;
}

function propertyOrQuantity(el: Element, set: string, prop: string): string | null {
  const { store, view, expressId } = el;
  const props = view ? view.getForEntity(expressId) : (store.properties?.getForEntity(expressId) ?? []);
  const own = setValue(props, set, prop);
  if (own !== null) return own;
  const baseQuantities = (id: number) => extractQuantitiesOnDemand(store, id) as unknown as ReturnType<MutablePropertyView['getQuantitiesForEntity']>;
  const quantities = view ? (view.hasQuantityBase() ? view.getQuantitiesForEntity(expressId) : view.getQuantitiesForEntity(expressId, baseQuantities)) : baseQuantities(expressId);
  const quantity = setValue(quantities, set, prop);
  if (quantity !== null) return quantity;
  const type = extractTypePropertiesOnDemand(store, view?.resolveBaseEntityId(expressId) ?? expressId);
  if (!type) return null;
  return setValue(view ? view.getForEntity(type.typeId) : type.properties, set, prop);
}

function typeName(el: Element): string | null {
  const type = extractTypePropertiesOnDemand(el.store, el.view?.resolveBaseEntityId(el.expressId) ?? el.expressId);
  return type ? attribute({ ...el, expressId: type.typeId }, 'Name') : null;
}

/** One field of an element. */
function fieldValue(el: Element, field: string): string | null {
  const dot = field.indexOf('.');
  if (dot > 0) return propertyOrQuantity(el, field.slice(0, dot).trim(), field.slice(dot + 1).trim());
  const key = field.toLowerCase();
  if (key === 'class') return className(el) || null;
  if (key === 'type') return typeName(el);
  return attribute(el, field);
}

function elementAt(modelId: string, expressId: number): Element | null {
  const store = useViewerStore.getState().models.get(modelId)?.ifcDataStore;
  if (!store) return null;
  return { store, view: getOrCreateMutationView(useViewerStore, modelId), expressId };
}

function element(globalId: string): Element | null {
  const at = elementByGlobalId(globalId);
  return at ? elementAt(at.modelId, at.expressId) : null;
}

/** The element's IFC class (`IfcWall`), or null when it is not loaded. */
export function elementClass(globalId: string): string | null {
  const el = element(globalId);
  return el ? `Ifc${className(el)}` : null;
}

/** Whether a tag type with these classes tags this class (none listed: any). */
export function tagsClass(classes: readonly string[], ifcClass: string): boolean {
  if (classes.length === 0) return true;
  const bare = (c: string) => c.toLowerCase().replace(/^ifc/, '');
  return classes.some((c) => bare(c) === bare(ifcClass));
}

/** A template filled from an element, or null when the element is no longer loaded. */
export function elementTagText(globalId: string, template: string): { text: string; missing: Array<[number, number]> } | null {
  const el = element(globalId);
  if (!el) return null;
  return fillTemplate(template, (field) => fieldValue(el, field));
}

/** A template filled from a selected element (the standards dialog's preview). */
export function entityTagText(modelId: string, expressId: number, template: string): { text: string; missing: Array<[number, number]> } | null {
  const el = elementAt(modelId, expressId);
  return el ? fillTemplate(template, (field) => fieldValue(el, field)) : null;
}

const ATTRIBUTE_FIELDS = ['Name', 'Tag', 'Description', 'ObjectType', 'Class', 'Type'];

/** The fields an element has, with their values: attributes, then `Set.Property` for its properties, quantities and type properties. */
export function entityFields(modelId: string, expressId: number): Array<{ field: string; value: string }> {
  const el = elementAt(modelId, expressId);
  if (!el) return [];
  const out: Array<{ field: string; value: string }> = [];
  const seen = new Set<string>();
  const push = (field: string, value: string | null) => {
    if (value === null || value === '' || seen.has(field.toLowerCase())) return;
    seen.add(field.toLowerCase());
    out.push({ field, value });
  };
  for (const f of ATTRIBUTE_FIELDS) push(f, fieldValue(el, f));
  const { store, view } = el;
  const sets = (list: ReadonlyArray<{ name: string; properties?: ReadonlyArray<{ name: string; value: unknown }>; quantities?: ReadonlyArray<{ name: string; value: unknown }> }>) => {
    for (const set of list) for (const p of set.properties ?? set.quantities ?? []) push(`${set.name}.${p.name}`, formatValue(p.value));
  };
  sets(view ? view.getForEntity(expressId) : (store.properties?.getForEntity(expressId) ?? []));
  const baseQuantities = (id: number) => extractQuantitiesOnDemand(store, id) as unknown as ReturnType<MutablePropertyView['getQuantitiesForEntity']>;
  sets(view ? (view.hasQuantityBase() ? view.getQuantitiesForEntity(expressId) : view.getQuantitiesForEntity(expressId, baseQuantities)) : baseQuantities(expressId));
  const type = extractTypePropertiesOnDemand(store, view?.resolveBaseEntityId(expressId) ?? expressId);
  if (type) sets(view ? view.getForEntity(type.typeId) : type.properties);
  return out;
}
