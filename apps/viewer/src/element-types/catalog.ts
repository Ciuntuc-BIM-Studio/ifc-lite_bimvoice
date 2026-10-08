/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * The project's element type catalogue as actions: add, duplicate, change,
 * remove, import / export, and the entry each Design tool builds with. The
 * current entry of a kind drives the tool's dimensions (a wall's thickness
 * is its layers', a column's section is the type's), so what is drawn next
 * matches the type it is typed by.
 */

import { useViewerStore } from '@/store';
import { useProjectStore } from '@/project/project-store';
import { freshProjectId } from '@/project/view-defaults';
import { sectionDimensions } from '@/lib/profile-section/profile-kinds';
import {
  ELEMENT_TYPE_CATALOGUE_FORMAT, ELEMENT_TYPE_CATALOGUE_VERSION, MARK_PREFIX, defaultTypeSpec, layersThickness, readElementTypeCatalogue,
  type ElementTypeKind, type ElementTypeSpec,
} from './spec';

type State = ReturnType<typeof useProjectStore.getState>;

export const elementTypes = (s: State = useProjectStore.getState()): ElementTypeSpec[] => s.elementTypes ?? [];

export function elementType(id: string | undefined | null): ElementTypeSpec | null {
  return id ? elementTypes().find((t) => t.id === id) ?? null : null;
}

export function typesOfKind<K extends ElementTypeKind>(kind: K): Extract<ElementTypeSpec, { kind: K }>[] {
  return elementTypes().filter((t): t is Extract<ElementTypeSpec, { kind: K }> => t.kind === kind);
}

/** The entry the tool of `kind` builds with, or null (the tool's own defaults). */
export function currentType<K extends ElementTypeKind>(kind: K): Extract<ElementTypeSpec, { kind: K }> | null {
  const spec = elementType(useProjectStore.getState().currentTypes?.[kind]);
  return spec && spec.kind === kind ? spec as Extract<ElementTypeSpec, { kind: K }> : null;
}

/** The tool defaults an entry stands for (dimensions, section). */
export function applyToolDefaults(spec: ElementTypeSpec): void {
  const s = useViewerStore.getState();
  switch (spec.kind) {
    case 'wall':
      s.setAuthoringDims('wall', { Thickness: layersThickness(spec.layers), Height: spec.height });
      break;
    case 'slab':
      s.setAuthoringDims('slab', { Thickness: layersThickness(spec.layers) });
      s.setAuthoringDefaults({ slabClass: 'slab' });
      break;
    case 'column':
    case 'beam': {
      const owner = spec.kind;
      if (spec.section.Type === 'Rectangle') {
        s.setAuthoringDims(owner, owner === 'column'
          ? { Width: spec.section.XDim, Depth: spec.section.YDim, Height: spec.height }
          : { Width: spec.section.XDim, Height: spec.section.YDim });
        s.setAuthoringProfile(owner, 'Rectangle');
      } else {
        if (owner === 'column') s.setAuthoringDims('column', { Height: spec.height });
        s.setAuthoringProfile(owner, spec.section.Type, sectionDimensions(spec.section));
      }
      if (owner === 'beam') s.setAuthoringDefaults({ beamClass: 'beam' });
      break;
    }
    default:
      // Roofs and openings are read by their tools when they build.
      break;
  }
}

export function setCurrentType(kind: ElementTypeKind, id: string | null): void {
  const s = useProjectStore.getState();
  const next = { ...(s.currentTypes ?? {}) };
  if (id) next[kind] = id;
  else delete next[kind];
  useProjectStore.setState({ currentTypes: next, dirty: true });
  const spec = elementType(id);
  if (spec) applyToolDefaults(spec);
}

function nextMark(kind: ElementTypeKind, list: readonly ElementTypeSpec[]): string {
  const used = new Set(list.map((t) => t.mark));
  for (let n = 1; ; n++) if (!used.has(`${MARK_PREFIX[kind]}${n}`)) return `${MARK_PREFIX[kind]}${n}`;
}

const KIND_NAME: Readonly<Record<ElementTypeKind, string>> = { wall: 'Wall', slab: 'Slab', column: 'Column', beam: 'Beam', roof: 'Roof', opening: 'Opening' };

export function addElementType(kind: ElementTypeKind, from?: ElementTypeSpec): string {
  const list = elementTypes();
  const id = freshProjectId('type');
  const mark = nextMark(kind, list);
  const base = from ? structuredClone(from) : { ...defaultTypeSpec(kind), name: '', mark: '' };
  const name = from ? `${from.name} copy` : `${KIND_NAME[kind]} ${mark}`;
  useProjectStore.setState({ elementTypes: [...list, { ...base, id, mark, name } as ElementTypeSpec], dirty: true });
  return id;
}

/** Replace an entry in the catalogue only (the models follow on `pushElementType`). */
export function updateElementType(spec: ElementTypeSpec): void {
  useProjectStore.setState({ elementTypes: elementTypes().map((t) => (t.id === spec.id ? spec : t)), dirty: true });
  if (useProjectStore.getState().currentTypes?.[spec.kind] === spec.id) applyToolDefaults(spec);
}

export function removeElementType(id: string): void {
  const s = useProjectStore.getState();
  const current = { ...(s.currentTypes ?? {}) };
  for (const [kind, value] of Object.entries(current)) if (value === id) delete current[kind as ElementTypeKind];
  useProjectStore.setState({ elementTypes: elementTypes(s).filter((t) => t.id !== id), currentTypes: current, dirty: true });
}

/** Add imported entries; an entry whose id is already in the catalogue replaces it. */
export function importElementTypes(text: string): number {
  const incoming = readElementTypeCatalogue(text);
  const list = [...elementTypes()];
  for (const spec of incoming) {
    const at = list.findIndex((t) => t.id === spec.id);
    if (at >= 0) list[at] = spec;
    else list.push(spec);
  }
  useProjectStore.setState({ elementTypes: list, dirty: true });
  return incoming.length;
}

export function exportElementTypes(): string {
  return JSON.stringify({ format: ELEMENT_TYPE_CATALOGUE_FORMAT, version: ELEMENT_TYPE_CATALOGUE_VERSION, types: elementTypes() }, null, 2);
}
