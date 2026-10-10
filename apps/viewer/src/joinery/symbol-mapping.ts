/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Symbol mapping: which configurator entry draws a door or window that the
 * model does not type itself (an imported IFC). The mapping lives in the
 * project, never in the IFC, so it works on models that are only documented.
 * An element takes, first found:
 *
 *  1. its own manual choice (by element GlobalId);
 *  2. its IFC type's manual choice (by type GlobalId);
 *  3. by name: its type's Name, its ObjectType or its Name equals an entry's
 *     name, mark or one of the entry's aliases (case, spaces and punctuation
 *     ignored);
 *  4. by dimensions: the entry of its kind whose width and height are within
 *     the tolerance of the element's (the closest one).
 *
 * A manual choice of `null` means "no symbol" and stops the automatic rules.
 * The entry is fitted to the element's own size (`fitToElement`), so a
 * symbol always fills its opening.
 */

import type { JoineryKind, JoinerySpec } from '@ifc-lite/create';

export interface JoineryMapping {
  /** Automatic matching by type / element name. */
  byName: boolean;
  /** Automatic matching by width and height. */
  byDimensions: boolean;
  /** Metres either way, for matching by dimensions. */
  tolerance: number;
  /** Extra names an entry matches, by entry id (e.g. the names an IFC exporter gives the type). */
  aliases: Record<string, string[]>;
  /** Manual choice per IFC type GlobalId: an entry id, or null for none. */
  types: Record<string, string | null>;
  /** Manual choice per element GlobalId: an entry id, or null for none. */
  elements: Record<string, string | null>;
}

export const DEFAULT_JOINERY_MAPPING: JoineryMapping = {
  byName: true, byDimensions: true, tolerance: 0.02, aliases: {}, types: {}, elements: {},
};

export type MappingSource = 'element' | 'type' | 'name' | 'dimensions';

/** What is known of a door or window, read from the model. */
export interface ElementFacts {
  kind: JoineryKind;
  globalId: string | null;
  typeGlobalId: string | null;
  /** Type Name, element ObjectType, element Name — whichever are set. */
  names: string[];
  /** Metres, when the model gives them. */
  width: number | null;
  height: number | null;
}

export interface MappingMatch {
  entry: JoinerySpec;
  source: MappingSource;
}

/** Case, spaces and punctuation ignored: "D-01 ", "d01" and "D 01" are one name. */
export const normaliseName = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

function manual(choice: string | null | undefined, list: readonly JoinerySpec[], kind: JoineryKind): JoinerySpec | null | undefined {
  if (choice === undefined) return undefined;
  if (choice === null) return null;
  // A choice whose entry was removed (or changed kind) falls through to the rules.
  return list.find((e) => e.id === choice && e.kind === kind);
}

export function resolveMapping(mapping: JoineryMapping, list: readonly JoinerySpec[], facts: ElementFacts): MappingMatch | null {
  const own = manual(facts.globalId ? mapping.elements[facts.globalId] : undefined, list, facts.kind);
  if (own === null) return null;
  if (own) return { entry: own, source: 'element' };
  const byType = manual(facts.typeGlobalId ? mapping.types[facts.typeGlobalId] : undefined, list, facts.kind);
  if (byType === null) return null;
  if (byType) return { entry: byType, source: 'type' };
  const candidates = list.filter((e) => e.kind === facts.kind && e.id);
  if (mapping.byName) {
    const names = new Set(facts.names.map(normaliseName).filter(Boolean));
    const named = candidates.find((e) => [e.name, e.mark, ...(mapping.aliases[e.id ?? ''] ?? [])].some((n) => names.has(normaliseName(n))));
    if (named) return { entry: named, source: 'name' };
  }
  if (mapping.byDimensions && facts.width !== null && facts.height !== null) {
    const { width, height } = facts;
    let best: JoinerySpec | null = null;
    let bestD = Infinity;
    for (const e of candidates) {
      const dw = Math.abs(e.width - width), dh = Math.abs(e.height - height);
      if (dw > mapping.tolerance + 1e-9 || dh > mapping.tolerance + 1e-9) continue;
      if (dw + dh < bestD) { best = e; bestD = dw + dh; }
    }
    if (best) return { entry: best, source: 'dimensions' };
  }
  return null;
}

/** The entry at the element's own size (its panels are proportions, so they follow). */
export function fitToElement(entry: JoinerySpec, facts: Pick<ElementFacts, 'width' | 'height'>): JoinerySpec {
  const width = facts.width && facts.width > 0 ? facts.width : entry.width;
  const height = facts.height && facts.height > 0 ? facts.height : entry.height;
  return width === entry.width && height === entry.height ? entry : { ...entry, width, height };
}

/** A mapping read from a project file: what is malformed is dropped. */
export function readJoineryMapping(v: unknown): JoineryMapping {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return { ...DEFAULT_JOINERY_MAPPING };
  const o = v as Record<string, unknown>;
  const choices = (x: unknown): Record<string, string | null> => {
    const out: Record<string, string | null> = {};
    if (typeof x !== 'object' || x === null) return out;
    for (const [k, c] of Object.entries(x)) if (typeof c === 'string' || c === null) out[k] = c;
    return out;
  };
  const aliases: Record<string, string[]> = {};
  if (typeof o.aliases === 'object' && o.aliases !== null) {
    for (const [k, list] of Object.entries(o.aliases)) {
      if (Array.isArray(list)) aliases[k] = list.filter((n): n is string => typeof n === 'string' && n.trim() !== '');
    }
  }
  return {
    byName: o.byName !== false,
    byDimensions: o.byDimensions !== false,
    tolerance: typeof o.tolerance === 'number' && Number.isFinite(o.tolerance) && o.tolerance >= 0 ? o.tolerance : DEFAULT_JOINERY_MAPPING.tolerance,
    aliases,
    types: choices(o.types),
    elements: choices(o.elements),
  };
}
