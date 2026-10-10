/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The joinery a door or window is DRAWN with: the configured type the model
 * gives it (`element-spec.ts`), else the catalogue entry the project's symbol
 * mapping picks (`symbol-mapping.ts`), fitted to the element's size. Plans,
 * elevations and the joinery schedule read this; editing (retype, resize)
 * keeps reading the model's own type only.
 */

import type { JoinerySpec } from '@ifc-lite/create';
import type { IfcDataStore } from '@ifc-lite/parser';
import type { MutablePropertyView } from '@ifc-lite/mutations';
import { useViewerStore } from '@/store';
import { useProjectStore } from '@/project/project-store';
import { typeOf } from '@/lib/commands/modeling/authored-kinds';
import { getModelLengthUnitScale } from '@/lib/length-unit-scale';
import { joineryOfElement } from './element-spec';
import {
  DEFAULT_JOINERY_MAPPING, fitToElement, resolveMapping, type ElementFacts, type MappingSource,
} from './symbol-mapping';

export interface DrawnJoinery {
  spec: JoinerySpec;
  /** How the body is turned in its opening (the model's own flips, or the project's per-element flips for a mapped one). */
  flips: number;
  /** 'model': the IFC's configured type; otherwise how the mapping found the entry. */
  source: 'model' | MappingSource;
  /** The catalogue entry (mapped elements), unfitted. */
  entry?: JoinerySpec;
}

interface Live { dataStore: IfcDataStore; view: MutablePropertyView | null }

function attributes({ dataStore, view }: Live, id: number): unknown[] | null {
  if (view?.isDeleted(id)) return null;
  const entity = view?.getNewEntity(id) ?? dataStore.getEntity(id);
  if (!entity) return null;
  const attrs = [...entity.attributes] as unknown[];
  for (const [index, value] of view?.getPositionalMutationsForEntity(id) ?? []) attrs[index] = value;
  return attrs;
}

const real = (v: unknown): number => (typeof v === 'number' ? v : v && typeof v === 'object' && 'real' in v ? Number((v as { real: number }).real) : NaN);
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

/** What the mapping matches a door or window by; null for anything else. */
export function elementFacts(modelId: string, expressId: number): ElementFacts | null {
  const s = useViewerStore.getState();
  const dataStore = s.models.get(modelId)?.ifcDataStore;
  if (!dataStore) return null;
  const live: Live = { dataStore, view: s.mutationViews.get(modelId) ?? null };
  const entity = live.view?.getNewEntity(expressId) ?? dataStore.getEntity(expressId);
  const cls = String(entity?.type ?? '').toUpperCase();
  if (!/^IFC(DOOR|WINDOW)(STANDARDCASE)?$/.test(cls)) return null;
  const attrs = attributes(live, expressId);
  if (!attrs) return null;
  const unit = getModelLengthUnitScale(dataStore) || 1;
  const height = real(attrs[8]) * unit, width = real(attrs[9]) * unit;
  let typeId: number | null = null;
  try { typeId = typeOf(live, expressId); } catch { typeId = null; }
  const typeAttrs = typeId === null ? null : attributes(live, typeId);
  const names = [text(typeAttrs?.[2]), text(attrs[4]), text(attrs[2])].filter((n): n is string => n !== null);
  return {
    kind: cls.startsWith('IFCDOOR') ? 'door' : 'window',
    globalId: text(attrs[0]),
    typeGlobalId: text(typeAttrs?.[0]),
    names,
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
  };
}

interface Memo { key: string; byElement: Map<number, DrawnJoinery | null> }
const memo = new Map<string, Memo>();
// Distinct objects get distinct numbers, so a key changes whenever the mapping or the catalogue is replaced.
const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object): number => {
  let id = ids.get(o);
  if (id === undefined) { id = nextId++; ids.set(o, id); }
  return id;
};

/** The joinery element `expressId` of `modelId` is drawn with, or null (drawn from its mesh). */
export function drawnJoinery(modelId: string, expressId: number): DrawnJoinery | null {
  const s = useViewerStore.getState();
  const p = useProjectStore.getState();
  const view = s.mutationViews.get(modelId) ?? null;
  const mapping = p.joineryMapping ?? DEFAULT_JOINERY_MAPPING;
  const list = p.joineryTypes ?? [];
  const key = `${view ? `${view.getMutationCount()}:${view.getNewEntities().length}` : '-'}|${idOf(mapping)}|${idOf(list)}|${idOf(p.symbolFlips ?? {})}`;
  let m = memo.get(modelId);
  if (!m || m.key !== key) {
    m = { key, byElement: new Map() };
    memo.set(modelId, m);
  }
  if (m.byElement.has(expressId)) return m.byElement.get(expressId) ?? null;
  let out: DrawnJoinery | null = null;
  const own = joineryOfElement(modelId, expressId);
  if (own) {
    out = { spec: own.spec, flips: own.flips, source: 'model' };
  } else {
    const facts = elementFacts(modelId, expressId);
    const match = facts ? resolveMapping(mapping, list, facts) : null;
    if (facts && match) {
      const flips = facts.globalId ? p.symbolFlips?.[facts.globalId] ?? 0 : 0;
      out = { spec: fitToElement(match.entry, facts), flips, source: match.source, entry: match.entry };
    }
  }
  m.byElement.set(expressId, out);
  return out;
}

/** The same, by renderer (federation-global) id. */
export function drawnJoineryOfRenderId(id: number): DrawnJoinery | null {
  const ref = useViewerStore.getState().resolveGlobalIdFromModels(id);
  return ref ? drawnJoinery(ref.modelId, ref.expressId) : null;
}
