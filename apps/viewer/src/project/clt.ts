/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/**
 * Cross-laminated timber (CLT) walls and slabs as project element types: a
 * panel is a layer set of lamellae, their grain alternating from layer to
 * layer — the outer layers along the panel (0°), the next across it (90°).
 * Each orientation is a project material of its own ("CLT C24 0°",
 * "CLT C24 90°"), hatched WOOD along the grain and WOODCROSS across it, so a
 * section shows the build-up as it is laminated; the type is written into
 * the models like any wall or slab type, its layers as IfcMaterialLayers.
 */

import { addElementType, setCurrentType, updateElementType, elementType } from '@/element-types/catalog';
import { defaultTypeSpec, type SlabTypeSpec, type WallTypeSpec } from '@/element-types/spec';
import { setMaterial } from './materials';

export type CltKind = 'wall' | 'slab';

/** Common panel build-ups, lamella thicknesses outermost first (metres). */
export const CLT_LAYUPS: Readonly<Record<3 | 5 | 7, number[]>> = {
  3: [0.03, 0.04, 0.03],
  5: [0.04, 0.02, 0.02, 0.02, 0.04],
  7: [0.03, 0.03, 0.03, 0.03, 0.03, 0.03, 0.03],
};

const CLT_COLOUR = '#dcb986';

/** The material of a lamella: its class and whether it runs along the panel's main direction. */
export const cltMaterialName = (grade: string, along: boolean) => `CLT ${grade} ${along ? '0°' : '90°'}`;

export interface CltSpec {
  kind: CltKind;
  /** Lamella thicknesses, outermost first (an odd count, symmetric is usual). */
  layers: number[];
  grade: string;
  name?: string;
}

/** A panel's default name: its thickness, layer count and class. */
export function cltName(s: CltSpec): string {
  const mm = Math.round(s.layers.reduce((t, l) => t + l, 0) * 1000);
  return `CLT ${mm} ${s.layers.length}s ${s.grade}${s.kind === 'slab' ? ' slab' : ''}`;
}

/** Make the two lamella materials known to the project: hatch, fill and colour. */
function ensureCltMaterials(grade: string): void {
  setMaterial(cltMaterialName(grade, true), { hatch: 'WOOD', hatchScale: 0.5, color: CLT_COLOUR });
  setMaterial(cltMaterialName(grade, false), { hatch: 'WOODCROSS', hatchScale: 0.5, color: CLT_COLOUR });
}

/** Add a CLT type to the project catalogue and make it the current wall or slab type. Its id. */
export function addCltType(s: CltSpec): string {
  if (s.layers.length < 3 || s.layers.some((l) => !(l > 0))) throw new Error('A CLT panel needs at least three lamellae of positive thickness');
  ensureCltMaterials(s.grade);
  const id = addElementType(s.kind);
  const created = elementType(id);
  if (!created) throw new Error('The CLT type could not be added');
  const layers = s.layers.map((thickness, i) => ({ name: cltMaterialName(s.grade, i % 2 === 0), thickness, color: CLT_COLOUR }));
  const base = { id, mark: created.mark, name: s.name?.trim() || cltName(s) };
  const spec = s.kind === 'wall'
    ? { ...(defaultTypeSpec('wall') as Omit<WallTypeSpec, 'id' | 'mark' | 'name'>), ...base, kind: 'wall' as const, layers }
    : { ...(defaultTypeSpec('slab') as Omit<SlabTypeSpec, 'id' | 'mark' | 'name'>), ...base, kind: 'slab' as const, layers };
  updateElementType(spec);
  setCurrentType(s.kind, id);
  return id;
}
