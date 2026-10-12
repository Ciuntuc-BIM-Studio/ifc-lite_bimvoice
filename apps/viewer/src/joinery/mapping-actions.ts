/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Changing the project's symbol mapping (`symbol-mapping.ts`): the automatic
 * rules, an entry's aliases, and the manual choice for elements or for every
 * element of an IFC type. Only the project changes — never a model.
 */

import { useViewerStore } from '@/store';
import { useProjectStore } from '@/project/project-store';
import { DEFAULT_JOINERY_MAPPING, type JoineryMapping } from './symbol-mapping';
import { elementFacts } from './mapped-joinery';

export const currentMapping = (): JoineryMapping => useProjectStore.getState().joineryMapping ?? DEFAULT_JOINERY_MAPPING;

function commit(next: JoineryMapping): void {
  useProjectStore.setState({ joineryMapping: next, dirty: true });
}

export function setMappingRules(patch: Partial<Pick<JoineryMapping, 'byName' | 'byDimensions' | 'tolerance'>>): void {
  commit({ ...currentMapping(), ...patch });
}

/** The extra names entry `entryId` matches (empty: none). */
export function setEntryAliases(entryId: string, names: readonly string[]): void {
  const m = currentMapping();
  const aliases = { ...m.aliases };
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))];
  if (clean.length) aliases[entryId] = clean;
  else delete aliases[entryId];
  commit({ ...m, aliases });
}

/** A manual choice: an entry id, null for "no symbol", undefined to go back to the automatic rules. */
export type SymbolChoice = string | null | undefined;

function withChoice(map: Record<string, string | null>, keys: readonly string[], choice: SymbolChoice): Record<string, string | null> {
  const next = { ...map };
  for (const k of keys) {
    if (choice === undefined) delete next[k];
    else next[k] = choice;
  }
  return next;
}

/** Choose the symbol of elements, by GlobalId. */
export function setElementSymbol(globalIds: readonly string[], choice: SymbolChoice): void {
  const m = currentMapping();
  commit({ ...m, elements: withChoice(m.elements, globalIds, choice) });
}

/** Choose the symbol of every element of an IFC type, by the type's GlobalId. */
export function setTypeSymbol(typeGlobalId: string, choice: SymbolChoice): void {
  const m = currentMapping();
  commit({ ...m, types: withChoice(m.types, [typeGlobalId], choice) });
}

/** Map the selected doors / windows of the entry's kind to it. Returns how many were mapped. */
export function mapSelectionTo(entryId: string, kind: 'door' | 'window'): number {
  const s = useViewerStore.getState();
  const ids = new Set<number>(s.selectedEntityIds ?? []);
  if (typeof s.selectedEntityId === 'number') ids.add(s.selectedEntityId);
  const guids: string[] = [];
  for (const id of ids) {
    const ref = s.resolveGlobalIdFromModels(id);
    const facts = ref ? elementFacts(ref.modelId, ref.expressId) : null;
    if (facts?.kind === kind && facts.globalId) guids.push(facts.globalId);
  }
  if (guids.length) setElementSymbol(guids, entryId);
  return guids.length;
}
