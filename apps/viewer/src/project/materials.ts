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
import type { MaterialAppearance, MaterialHatchStyle } from '@ifc-lite/create';
import { findPattern } from '@/drafting/hatch/library';
import type { MaterialViewGraphics, MaterialViewKind, ProjectMaterial } from './types';
import { ifcAppearanceOf } from './material-ifc-read';

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

/** The defaults a material name suggests (its section graphics). */
export function guessMaterial(name: string): Omit<ProjectMaterial, 'id' | 'name'> {
  const n = normaliseMaterialName(name);
  for (const [re, g] of GUESSES) if (re.test(n)) return { hatchScale: 1, ...g };
  return { hatch: null, hatchScale: 1 };
}

export const projectMaterials = (): ProjectMaterial[] => useProjectStore.getState().materials ?? [];

/** A material as one kind of view draws it, and where that came from. */
export type ResolvedMaterial = ProjectMaterial & { auto: boolean; source: 'own' | 'ifc' | 'name' };

/** A hatch IFC names (or describes as lines) as a pattern of the library, when one fits. */
function ifcPattern(h: MaterialHatchStyle | undefined): Pick<MaterialViewGraphics, 'hatch' | 'hatchScale'> | null {
  if (!h) return null;
  if (h.pattern) {
    const known = findPattern(h.pattern) ? h.pattern.toUpperCase() : guessMaterial(h.pattern).hatch;
    return known ? { hatch: known, hatchScale: h.scale ?? 1 } : null;
  }
  if (h.lines) {
    const a = ((h.lines.angleDeg % 180) + 180) % 180;
    // The library's line patterns are 2.5–3 mm apart on paper; the file's spacing is in the model.
    return { hatch: Math.abs(a) < 1 || Math.abs(a - 180) < 1 ? 'HORIZONTAL' : 'LINES45', hatchScale: 1 };
  }
  return null;
}

/** A view kind's graphics from an IFC appearance (plans fall back to the section's). */
function fromIfc(a: MaterialAppearance | null, kind: MaterialViewKind): MaterialViewGraphics | null {
  const h = a?.hatches?.[kind] ?? (kind === 'plan' ? a?.hatches?.section : undefined);
  if (!h) return null;
  return { ...(ifcPattern(h) ?? { hatch: null }), ...(h.background ? { fill: h.background } : {}) };
}

const FIELDS = ['hatch', 'hatchScale', 'fill', 'hatchPen'] as const;

/**
 * The material graphics for a name in one kind of view. Each field comes from
 * the material's own row, else from what the IFC models give it, else (for
 * plans and sections) from what its name suggests. A plan takes the section's
 * graphics unless it has its own; an elevation draws nothing unless told.
 */
export function materialGraphics(
  name: string,
  list: readonly ProjectMaterial[] = projectMaterials(),
  kind: MaterialViewKind = 'section',
  ifc: MaterialAppearance | null = ifcAppearanceOf(name),
): ResolvedMaterial {
  const key = normaliseMaterialName(name);
  const own = list.find((m) => normaliseMaterialName(m.name) === key);
  const ownView: MaterialViewGraphics | undefined = kind === 'section' ? own : kind === 'plan' ? { ...pick(own), ...pick(own?.views?.plan) } : own?.views?.elevation;
  const ifcView = fromIfc(ifc, kind);
  const guess = kind === 'elevation' ? {} : guessMaterial(name);
  const out: ResolvedMaterial = { id: own?.id ?? `auto:${key}`, name: own?.name ?? name, auto: !own, source: own ? 'own' : ifcView ? 'ifc' : 'name' };
  for (const f of FIELDS) {
    const v = ownView && f in ownView ? ownView[f] : ifcView && f in ifcView ? ifcView[f] : (guess as MaterialViewGraphics)[f];
    if (v !== undefined) (out as MaterialViewGraphics)[f] = v as never;
  }
  if (own ? own.membrane : guessMaterial(name).membrane) out.membrane = true;
  const color = own?.color ?? ifc?.color;
  if (color) out.color = color;
  // "The material's colour" is its own surface colour once it has one (a linked model keeps its IFC colours).
  if (out.fill === undefined && own?.color) out.fill = own.color;
  return out;
}

const pick = (g: MaterialViewGraphics | undefined): MaterialViewGraphics => {
  const out: MaterialViewGraphics = {};
  if (g) for (const f of FIELDS) if (f in g) (out as Record<string, unknown>)[f] = g[f];
  return out;
};

/** Write a material's row (creating it from what it shows now when it had none). */
export function setMaterial(name: string, patch: Partial<Omit<ProjectMaterial, 'id' | 'name'>>): void {
  const list = projectMaterials();
  const key = normaliseMaterialName(name);
  const at = list.findIndex((m) => normaliseMaterialName(m.name) === key);
  const base = at >= 0 ? list[at] : seedMaterial(name, list);
  const next = { ...base, ...patch };
  useProjectStore.setState({ materials: at >= 0 ? list.map((m, i) => (i === at ? next : m)) : [...list, next], dirty: true });
}

/** A new row holding what the material shows now (from IFC or its name), so taking it over changes nothing. */
function seedMaterial(name: string, list: readonly ProjectMaterial[]): ProjectMaterial {
  const section = materialGraphics(name, list, 'section');
  const row: ProjectMaterial = { id: freshProjectId('material'), name: name.trim(), ...pick(section) };
  if (section.membrane) row.membrane = true;
  const ifc = ifcAppearanceOf(name);
  if (ifc?.color) row.color = ifc.color;
  const plan = fromIfc(ifc, 'plan'), elevation = fromIfc(ifc, 'elevation');
  if (ifc?.hatches?.plan && plan) row.views = { ...row.views, plan };
  if (elevation) row.views = { ...row.views, elevation };
  return row;
}

/** Write one kind of view's graphics of a material (a section's are the row's own fields). */
export function setMaterialView(name: string, kind: MaterialViewKind, patch: MaterialViewGraphics): void {
  if (kind === 'section') { setMaterial(name, patch); return; }
  const own = projectMaterials().find((m) => normaliseMaterialName(m.name) === normaliseMaterialName(name));
  const base = own ?? seedMaterial(name, projectMaterials());
  setMaterial(name, { ...(own ? {} : pick(base)), views: { ...base.views, [kind]: { ...base.views?.[kind], ...patch } } });
}

/** A plan back to its section's graphics. */
export function clearMaterialView(name: string, kind: Exclude<MaterialViewKind, 'section'>): void {
  const own = projectMaterials().find((m) => normaliseMaterialName(m.name) === normaliseMaterialName(name));
  if (!own?.views?.[kind]) return;
  const views = { ...own.views };
  delete views[kind];
  setMaterial(name, { views: Object.keys(views).length ? views : undefined });
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
