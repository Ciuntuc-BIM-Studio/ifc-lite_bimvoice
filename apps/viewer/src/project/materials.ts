/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project's building materials (`ProjectMaterial`): how each
 * IfcMaterial draws where a view cuts it — its hatch, fill and hatch pen,
 * or a heavy dashed line for a membrane. Matched by name, case- and
 * space-insensitively. A material with no row of its own still draws: its
 * name suggests the hatch (concrete, brick, insulation, timber, steel…) and
 * whether it is a membrane (vapour barrier, foil, damp-proof course…).
 */

import { iterateEffectiveEntityIds, type MutablePropertyView } from '@ifc-lite/mutations';
import type { IfcDataStore } from '@ifc-lite/parser';
import { useViewerStore } from '@/store';
import { useProjectStore } from './project-store';
import { freshProjectId } from './view-defaults';
import type { ProjectMaterial } from './types';

/** Layers thinner than this are not cut into bands (the geometry engine merges them): they draw as membranes. */
export const MEMBRANE_THICKNESS_M = 0.002;

export const normaliseMaterialName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

const GUESSES: readonly [RegExp, Partial<ProjectMaterial>][] = [
  [/vapou?r|barrier|membrane|foil|\bdpc\b|damp|bitum|sheet|folie|barier/, { membrane: true, hatch: null }],
  [/insul|wool|eps\b|xps\b|polystyren|pir\b|pur\b|vata|izola/, { hatch: 'INSULATION', fill: null }],
  [/brick|masonry|block|caramid|zidari|bca|aac/, { hatch: 'BRICK' }],
  [/concrete|beton|screed|sapa|c\d\d\//, { hatch: 'CONCRETE' }],
  [/timber|wood|clt|osb|plywood|lemn/, { hatch: 'WOOD' }],
  [/steel|metal|otel|alumin/, { hatch: 'STEEL' }],
  [/gravel|ballast|pietris|aggregate/, { hatch: 'GRAVEL' }],
  [/earth|soil|pamant|ground/, { hatch: 'EARTH' }],
  [/tile|ceramic|gresie|faianta/, { hatch: 'TILES' }],
  [/plaster|render|gypsum|tencuial|gips|finish|paint/, { hatch: null }],
];

/** The defaults a material name suggests. */
export function guessMaterial(name: string): Omit<ProjectMaterial, 'id' | 'name'> {
  const n = normaliseMaterialName(name);
  for (const [re, g] of GUESSES) if (re.test(n)) return { hatchScale: 1, ...g };
  return { hatch: null, hatchScale: 1 };
}

export const projectMaterials = (): ProjectMaterial[] => useProjectStore.getState().materials ?? [];

/** The material graphics for a name: its row, else what its name suggests (`auto`). */
export function materialGraphics(name: string, list: readonly ProjectMaterial[] = projectMaterials()): ProjectMaterial & { auto: boolean } {
  const key = normaliseMaterialName(name);
  const own = list.find((m) => normaliseMaterialName(m.name) === key);
  return own ? { ...own, auto: false } : { id: `auto:${key}`, name, ...guessMaterial(name), auto: true };
}

/** Write a material's row (creating it from its defaults when it had none). */
export function setMaterial(name: string, patch: Partial<Omit<ProjectMaterial, 'id' | 'name'>>): void {
  const list = projectMaterials();
  const key = normaliseMaterialName(name);
  const at = list.findIndex((m) => normaliseMaterialName(m.name) === key);
  const base = at >= 0 ? list[at] : { id: freshProjectId('material'), name: name.trim(), ...guessMaterial(name) };
  const next = { ...base, ...patch };
  useProjectStore.setState({ materials: at >= 0 ? list.map((m, i) => (i === at ? next : m)) : [...list, next], dirty: true });
}

/** Back to what the name suggests: the row goes. */
export function resetMaterial(name: string): void {
  const key = normaliseMaterialName(name);
  useProjectStore.setState({ materials: projectMaterials().filter((m) => normaliseMaterialName(m.name) !== key), dirty: true });
}

/** An IfcMaterial's Name (its first attribute), from the overlay or the parsed file. */
export function ifcMaterialName(store: IfcDataStore, view: MutablePropertyView | null | undefined, id: number): string | null {
  if (view?.isDeleted(id)) return null;
  const own = view?.getPositionalMutationsForEntity(id)?.get(0);
  const raw = own ?? (view?.getNewEntity(id) ?? store.getEntity(id))?.attributes[0];
  return typeof raw === 'string' && raw.trim() ? raw : null;
}

/** Every IfcMaterial name in the loaded models, plus the table's own rows, sorted. */
export function materialNamesInModels(): string[] {
  const s = useViewerStore.getState();
  const names = new Map<string, string>();
  for (const [modelId, model] of s.models) {
    const store = model.ifcDataStore;
    if (!store) continue;
    const view = s.mutationViews.get(modelId) ?? null;
    for (const { expressId } of iterateEffectiveEntityIds(store, view, ['IFCMATERIAL'])) {
      const name = ifcMaterialName(store, view, expressId);
      if (name && name.trim()) names.set(normaliseMaterialName(name), name.trim());
    }
  }
  for (const m of projectMaterials()) names.set(normaliseMaterialName(m.name), m.name);
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}
