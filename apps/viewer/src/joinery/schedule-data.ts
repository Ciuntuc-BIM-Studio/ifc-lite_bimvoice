/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * What a joinery schedule lists, read live from every loaded model: each
 * configured type (one row per catalogue entry, merged across models) with
 * its occurrences counted per level, and the doors / windows without a
 * configured type grouped by class and size. Levels are merged by name and
 * ordered by elevation, top floor last. Every occurrence is numbered within
 * its type, level by level (`occurrenceMark`: W1.3), the numbering a plan
 * tag, the Elements sheet and `schedule-numbering.ts` share.
 */

import { joineryTypesInStore, occurrencesOfTypeInStore, type JoinerySpec } from '@ifc-lite/create';
import { iterateEffectiveEntityIds, type MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import { entityName } from '@/lib/commands/modeling/authored-kinds';
import { getModelLengthUnitScale } from '@/lib/length-unit-scale';
import { catalogue } from './catalog';

export type ScheduleKind = 'door' | 'window' | 'all';

export interface ScheduleOccurrence {
  modelId: string;
  expressId: number;
  globalId: string;
  level: string;
  /** The element's Tag as it is in the model. */
  tag: string | null;
  /** 1-based, within the type, lowest level first. */
  number: number;
}

export interface ScheduleEntry {
  key: string;
  kind: 'door' | 'window';
  /** The configured type; null for elements without one. */
  spec: JoinerySpec | null;
  mark: string;
  name: string;
  /** Metres. */
  width: number;
  height: number;
  /** Count per level name. */
  counts: Record<string, number>;
  total: number;
  occurrences: ScheduleOccurrence[];
}

/** An occurrence's mark: its type's mark and its number (`W1.3`); a number alone for an untyped element. */
export function occurrenceMark(entry: ScheduleEntry, o: ScheduleOccurrence): string {
  return entry.mark && entry.mark !== '—' ? `${entry.mark}.${o.number}` : `${entry.name}-${o.number}`;
}

export interface ScheduleData {
  entries: ScheduleEntry[];
  /** Level names, lowest first. */
  levels: string[];
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

export function scheduleData(kind: ScheduleKind): ScheduleData {
  const s = useViewerStore.getState();
  const byKey = new Map<string, ScheduleEntry>();
  const levelElevation = new Map<string, number>();
  const wanted = (k: 'door' | 'window') => kind === 'all' || kind === k;
  const fromCatalogue = new Map(catalogue().map((spec) => [spec.id, spec]));

  for (const [modelId, model] of s.models) {
    const dataStore = model.ifcDataStore;
    if (!dataStore) continue;
    const live: Live = { dataStore, view: s.mutationViews.get(modelId) ?? null };
    const hierarchy = dataStore.spatialHierarchy;
    const levelOf = (id: number): string => {
      const storey = hierarchy?.elementToStorey.get(id);
      if (storey === undefined) return '—';
      const name = entityName(live, storey) || `#${storey}`;
      levelElevation.set(name, hierarchy?.storeyElevations.get(storey) ?? 0);
      return name;
    };
    const count = (entry: ScheduleEntry, id: number) => {
      const level = levelOf(id);
      entry.counts[level] = (entry.counts[level] ?? 0) + 1;
      entry.total++;
      const attrs = attributes(live, id);
      const tag = attrs?.[7];
      entry.occurrences.push({ modelId, expressId: id, globalId: String(attrs?.[0] ?? ''), level, tag: typeof tag === 'string' ? tag : null, number: 0 });
    };
    const typed = new Set<number>();
    let types: ReturnType<typeof joineryTypesInStore> = [];
    try { types = joineryTypesInStore(dataStore, live.view); } catch { types = []; }
    for (const type of types) {
      if (!wanted(type.spec.kind)) continue;
      // The catalogue's current entry wins over the copy stored in the model.
      const spec = (type.spec.id && fromCatalogue.get(type.spec.id)) || type.spec;
      const key = spec.id ?? `${modelId}:${type.typeId}`;
      const entry = byKey.get(key) ?? { key, kind: spec.kind, spec, mark: spec.mark, name: spec.name, width: spec.width, height: spec.height, counts: {}, total: 0, occurrences: [] };
      byKey.set(key, entry);
      for (const id of occurrencesOfTypeInStore(dataStore, type.typeId, live.view)) {
        if (live.view?.isDeleted(id)) continue;
        typed.add(id);
        count(entry, id);
      }
    }
    // Doors and windows without a configured type, by class and size.
    const unit = getModelLengthUnitScale(dataStore) || 1;
    for (const { expressId: id, type } of iterateEffectiveEntityIds(dataStore, live.view, ['IFCDOOR', 'IFCWINDOW', 'IFCDOORSTANDARDCASE', 'IFCWINDOWSTANDARDCASE'])) {
      if (typed.has(id)) continue;
      const k: 'door' | 'window' = String(type).toUpperCase().startsWith('IFCDOOR') ? 'door' : 'window';
      if (!wanted(k)) continue;
      const attrs = attributes(live, id);
      if (!attrs) continue;
      const height = real(attrs[8]) * unit, width = real(attrs[9]) * unit;
      const size = Number.isFinite(width) && Number.isFinite(height) ? `${Math.round(width * 1000)}×${Math.round(height * 1000)}` : '?';
      const key = `untyped:${k}:${size}`;
      const entry = byKey.get(key) ?? {
        key, kind: k, spec: null, mark: '—', name: k === 'door' ? 'Door' : 'Window',
        width: Number.isFinite(width) ? width : 0, height: Number.isFinite(height) ? height : 0, counts: {}, total: 0, occurrences: [],
      };
      byKey.set(key, entry);
      count(entry, id);
    }
  }
  // Catalogue types not placed yet still belong in the schedule (with no count).
  for (const spec of fromCatalogue.values()) {
    if (!spec.id || byKey.has(spec.id) || !wanted(spec.kind)) continue;
    byKey.set(spec.id, { key: spec.id, kind: spec.kind, spec, mark: spec.mark, name: spec.name, width: spec.width, height: spec.height, counts: {}, total: 0, occurrences: [] });
  }
  const entries = [...byKey.values()]
    .filter((e) => e.total > 0 || e.spec)
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'window' ? -1 : 1) || (a.spec ? 0 : 1) - (b.spec ? 0 : 1)
      || a.mark.localeCompare(b.mark, undefined, { numeric: true }) || a.width - b.width);
  const levels = [...levelElevation.entries()].sort((a, b) => a[1] - b[1]).map(([name]) => name);
  if (entries.some((e) => e.counts['—'])) levels.push('—');
  // Number each type's occurrences: lowest level first, then by model and id, so the numbering is stable.
  const order = new Map(levels.map((l, i) => [l, i]));
  for (const e of entries) {
    e.occurrences.sort((a, b) => (order.get(a.level) ?? 99) - (order.get(b.level) ?? 99) || a.modelId.localeCompare(b.modelId) || a.expressId - b.expressId);
    e.occurrences.forEach((o, i) => { o.number = i + 1; });
  }
  return { entries, levels };
}
